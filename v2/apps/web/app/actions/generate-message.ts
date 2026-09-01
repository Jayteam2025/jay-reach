'use server';

import Anthropic from '@anthropic-ai/sdk';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { resolveAnthropicKey } from '../../lib/anthropic';
import { CHANNEL_WORD_LIMITS, STANDARD_VARIABLES, validateTemplateVariables, type CampaignNature } from '@jay-reach/core';

export type GenerateResult =
  | { ok: true; variantes: { subject: string | null; body: string }[] }
  | { ok: false; error: string };

/**
 * Nombre de propositions.
 *
 * Un seul jet ne laisse pas de choix et invite à tout réécrire ; au-delà de
 * trois, on ne les lit plus. Trois permet de comparer des angles.
 */
const VARIANTES = 3;

/** Limite de mots du canal, celle que le séquenceur applique déjà. */
function limiteDeMots(channel: string, estPremiereEtape: boolean): number {
  if (channel === 'linkedin_invite') return CHANNEL_WORD_LIMITS.linkedin_invite;
  if (channel === 'linkedin_message') return CHANNEL_WORD_LIMITS.linkedin_message;
  if (channel === 'letter') return CHANNEL_WORD_LIMITS.letter;
  return estPremiereEtape ? CHANNEL_WORD_LIMITS.email_opening : CHANNEL_WORD_LIMITS.email_followup;
}

/**
 * Propose des premiers jets de message pour une étape (retour 9.2).
 *
 * Sur quoi la génération s'appuie, et pourquoi :
 *  - le PERSONA ciblé (description, intitulés) : à qui on parle ;
 *  - les THÈMES DE VEILLE de la campagne (descriptif, consigne de
 *    qualification) : pourquoi on écrit à cette personne-là ;
 *  - le CANAL et sa limite de mots : une invitation LinkedIn n'est pas un email ;
 *  - les VARIABLES disponibles : pour que le modèle s'en serve au lieu
 *    d'inventer des détails qu'il ne connaît pas.
 *
 * Volontairement PAS le signal d'un prospect en particulier : au moment où on
 * écrit l'étape, personne n'est encore entré en campagne. Le message doit valoir
 * pour tous ceux qui entreront.
 *
 * Rien n'est envoyé : les propositions atterrissent dans le champ, où elles se
 * relisent et se modifient comme n'importe quel texte écrit à la main.
 */
export async function generateStepMessage(
  organizationId: string,
  campaignId: string,
  input: {
    readonly channel: string;
    readonly nature: CampaignNature;
    readonly estPremiereEtape: boolean;
    readonly consigne: string;
  },
): Promise<GenerateResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const apiKey = await resolveAnthropicKey(organizationId);
  if (!apiKey) {
    return { ok: false, error: 'Aucune clé Anthropic configurée. Renseignez-la dans Fournisseurs.' };
  }

  const supabase = await createClient();

  // Contexte de la campagne : ses thèmes de veille et ses personas ciblés.
  const { data: campagne } = await supabase
    .from('campaigns')
    .select('name, entry_rules')
    .eq('id', campaignId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  const { data: liens } = await supabase.from('campaign_sources').select('source_id').eq('campaign_id', campaignId);
  const sourceIds = ((liens ?? []) as { source_id: string }[]).map((l) => l.source_id);
  const { data: themes } = sourceIds.length
    ? await supabase.from('sources').select('name, description, config').in('id', sourceIds)
    : { data: [] };

  // La clé est `personas`, pas `persona_ids` : c'est celle que l'éditeur écrit
  // et celle que documente `campaigns/validation.ts`. Lue au mauvais nom, la
  // liste ressortait toujours vide et le message se rédigeait sans savoir à
  // qui il s'adressait — sans que rien ne le signale.
  const personaIds = ((campagne as { entry_rules?: { personas?: string[] } } | null)?.entry_rules?.personas) ?? [];
  const { data: personas } = personaIds.length
    ? await supabase.from('personas').select('name, description, title_patterns').in('id', personaIds)
    : { data: [] };

  const contexteThemes = ((themes ?? []) as { name: string; description: string | null; config: { scoring_prompt?: string } | null }[])
    .map((t) => `- ${t.name}${t.description ? ` : ${t.description}` : ''}${t.config?.scoring_prompt ? `\n  Ce qui rend un contact pertinent : ${t.config.scoring_prompt}` : ''}`)
    .join('\n');

  const contextePersonas = ((personas ?? []) as { name: string; description: string | null; title_patterns: string[] | null }[])
    .map((p) => `- ${p.name}${p.description ? ` : ${p.description}` : ''}${p.title_patterns?.length ? ` (intitulés : ${p.title_patterns.slice(0, 8).join(', ')})` : ''}`)
    .join('\n');

  const variables = Object.entries(STANDARD_VARIABLES)
    .filter(([, dispo]) => dispo === 'always' || dispo === input.nature)
    .map(([nom]) => `{{${nom}}}`)
    .join(', ');

  const limite = limiteDeMots(input.channel, input.estPremiereEtape);
  const avecObjet = input.channel === 'email';

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system:
        'Tu rédiges des messages de prospection B2B en français, pour un commercial qui écrit lui-même. ' +
        `Chaque proposition fait au plus ${limite} mots. ` +
        'Emploie les variables fournies plutôt que d\'inventer des noms, des chiffres ou des détails d\'entreprise : ' +
        'tout ce qui n\'est pas une variable sera identique pour tous les destinataires. ' +
        'Pas de formule creuse, pas de superlatif, pas de « j\'espère que vous allez bien ». ' +
        'Chaque proposition prend un angle différent des autres. ' +
        'Ne signe pas : la signature est ajoutée à l\'envoi. ' +
        `Réponds UNIQUEMENT par un tableau JSON de ${VARIANTES} objets ` +
        (avecObjet ? '{"subject": "...", "body": "..."}' : '{"body": "..."}') +
        ', sans texte autour.',
      messages: [
        {
          role: 'user',
          content:
            `Canal : ${input.channel}. ${input.estPremiereEtape ? 'Premier message de la séquence.' : 'Message de relance.'}\n` +
            `Campagne : ${(campagne as { name?: string } | null)?.name ?? ''}\n` +
            (contexteThemes ? `\nCe qui fait entrer un prospect dans cette campagne :\n${contexteThemes}\n` : '') +
            (contextePersonas ? `\nÀ qui on écrit :\n${contextePersonas}\n` : '') +
            `\nVariables utilisables : ${variables}\n` +
            (input.consigne.trim() ? `\nConsigne de l'opérateur : ${input.consigne.trim()}\n` : '') +
            `\nRédige ${VARIANTES} propositions.`,
        },
      ],
    });

    const texte = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Le modèle encadre parfois son JSON d'un bloc de code, malgré la consigne.
    const json = texte.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const brut = JSON.parse(json) as unknown;
    if (!Array.isArray(brut)) {
      return { ok: false, error: 'Réponse du modèle inattendue.' };
    }

    const variantes = brut
      .map((v) => {
        const o = v as { subject?: unknown; body?: unknown };
        return {
          subject: avecObjet && typeof o.subject === 'string' ? o.subject.trim() : null,
          body: typeof o.body === 'string' ? o.body.trim() : '',
        };
      })
      // Une proposition dont les variables ne passeraient pas la validation
      // serait refusée à l'enregistrement : autant ne pas la proposer.
      .filter((v) => v.body.length > 0 && validateTemplateVariables(v.body, input.nature).length === 0);

    if (variantes.length === 0) {
      return { ok: false, error: 'Aucune proposition exploitable. Réessayez.' };
    }
    return { ok: true, variantes };
  } catch (err) {
    // Ne jamais relayer l'erreur brute : elle peut porter des en-têtes.
    console.error('[generate] échec de génération', err instanceof Error ? err.message : 'inconnu');
    return { ok: false, error: 'La génération a échoué. Réessayez.' };
  }
}
