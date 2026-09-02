'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type EnrichirResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Enrichit l'entreprise d'un signal, à la demande et pour celle-là seulement.
 *
 * L'enrichissement est automatique : le producteur prend les comptes qualifiés
 * et les enfile, dans la limite du plafond quotidien. C'est le bon
 * fonctionnement en régime établi — mais pas pour une mise en route, où l'on
 * veut d'abord voir ce que FullEnrich rend sur deux ou trois entreprises avant
 * d'ouvrir les vannes. Le socle v1 permettait précisément de choisir dans la
 * liste ce qu'on enrichissait ; cette action rend ce geste.
 *
 * Le crédit se décompte du même compteur quotidien : demander à la main ne
 * contourne pas le plafond, sinon le garde-fou ne garderait plus rien.
 */
export async function enrichirMaintenant(
  organizationId: string,
  signalId: string,
): Promise<EnrichirResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const supabase = await createClient();

  const { data: signal } = await supabase
    .from('signals')
    .select('id, account_id, organization_id')
    .eq('id', signalId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  const ligne = signal as { account_id: string | null } | null;
  if (!ligne?.account_id) {
    return { ok: false, error: 'Ce signal n’est rattaché à aucune entreprise : rien à enrichir.' };
  }

  const { data: compte } = await supabase
    .from('accounts')
    .select('id, name, domain, country, enriched_at')
    .eq('id', ligne.account_id)
    .maybeSingle();
  const acc = compte as { id: string; name: string; domain: string | null; country: string | null; enriched_at: string | null } | null;
  if (!acc) {
    return { ok: false, error: 'Entreprise introuvable.' };
  }
  if (acc.enriched_at) {
    return { ok: false, error: `${acc.name} a déjà été enrichie. Ses contacts sont dans Prospects.` };
  }

  // Une persona active avec des intitulés de poste : sans elle, l'enrichissement
  // résout l'entreprise mais ne cherche aucun contact.
  const { data: personas } = await supabase
    .from('personas')
    .select('id, name, title_patterns')
    .eq('organization_id', organizationId)
    .eq('is_active', true);
  const persona = ((personas ?? []) as { id: string; name: string; title_patterns: string[] | null }[])
    .find((p) => (p.title_patterns ?? []).length > 0);
  if (!persona) {
    return { ok: false, error: 'Aucune persona active avec des intitulés de poste. Renseignez-en une d’abord.' };
  }

  // Un job déjà en file ne se paie pas deux fois : l'identifiant est
  // déterministe par (compte, persona), donc redéposer le même ne crée rien —
  // mais le crédit, lui, serait décompté pour rien. Le producteur automatique
  // avait ce défaut, mesuré à trois crédits perdus sur cinq le 02/09/2026.
  const { data: dejaEnFile } = await supabase.rpc('enrichissement_deja_en_file', {
    p_account: acc.id,
    p_persona: persona.id,
  });
  if (dejaEnFile === true) {
    return {
      ok: false,
      error: `${acc.name} est déjà en file d'enrichissement. Ses contacts arriveront dans Prospects.`,
    };
  }

  // Le crédit ensuite : demander à la main ne contourne pas le plafond du jour.
  const { data: cap } = await supabase
    .from('credentials')
    .select('config')
    .eq('organization_id', organizationId)
    .eq('provider_id', 'fullenrich')
    .maybeSingle();
  const saisi = Number((cap as { config?: { daily_cap?: string } } | null)?.config?.daily_cap);
  const plafond = Number.isFinite(saisi) && saisi >= 0 ? saisi : 50;

  const { data: credit } = await supabase.rpc('consume_provider_credit', {
    p_org: organizationId,
    p_provider: 'fullenrich',
    p_cap: plafond,
    p_count: 1,
  });
  if (credit !== true) {
    return {
      ok: false,
      error:
        plafond === 0
          ? 'L’enrichissement est en pause (plafond à 0). Relevez-le dans Fournisseurs pour enrichir.'
          : `Plafond du jour atteint (${plafond} par jour). Relevez-le dans Fournisseurs, ou réessayez demain.`,
    };
  }

  const { error } = await supabase.rpc('enfiler_enrichissement', {
    p_org: organizationId,
    p_account: acc.id,
    p_company: acc.name,
    p_domain: acc.domain,
    p_country: acc.country,
    p_persona: persona.id,
    p_titles: persona.title_patterns,
    p_signal: signalId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/signals');
  return {
    ok: true,
    message: `${acc.name} part à l’enrichissement pour la persona « ${persona.name} ». Ses contacts apparaîtront dans Prospects d’ici quelques minutes.`,
  };
}
