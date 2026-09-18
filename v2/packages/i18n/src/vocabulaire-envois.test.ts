/**
 * F13 (tâche « vocabulaire ») : les mots des écrans doivent dire ce que les
 * chiffres comptent vraiment.
 *
 * Vocabulaire final (décision du 18/09, tranchée après relecture) : DEUX états,
 * pas trois.
 *   - « Remis » (fr) / « Dispatched » (en) / « Doorgegeven » (nl) : remis au
 *     transporteur, pas encore réellement envoyé (email `dispatched`).
 *   - « Parti » (fr) / « Sent » (en) / « Verstuurd » (nl) : réellement parti —
 *     un email `delivered` (le `completed_time` de SalesBlink, il a fini
 *     d'envoyer ; aucun accusé de réception ne revient, « livré » promettait
 *     donc plus qu'on ne sait), ET une action LinkedIn dès `dispatched` (pas de
 *     transporteur asynchrone entre l'extension et le départ, F12).
 * Le badge dépend donc du CANAL, pas du seul statut brut — `etatAffichage`
 * (`apps/web/lib/file-du-jour.ts`) le calcule, testé séparément là-bas.
 *
 * Bugs trouvés et corrigés au passage :
 *   - Le fil d'activité d'une campagne (`envoisGroupes`, compte des actions
 *     `dispatched`+`delivered`) disait « envoyés » — surclassait les emails
 *     simplement remis. Devenu « remis » (périmètre plus large que le badge,
 *     volontairement laissé ainsi : le mot reste vrai pour les deux).
 *   - Le plafond d'enrichissement (FullEnrich) affichait « utilisé / plafond »
 *     sous un libellé nu qui laissait croire à des contacts TROUVÉS —
 *     `lireConsommationDuJour` compte des requêtes payées, pas des succès.
 *   - Le néerlandais disait « Doorgestuurd » pour « remis », qui veut dire
 *     « transféré à un tiers » — mot totalement différent, corrigé en
 *     « Doorgegeven ».
 *
 * Ce test verrouille les valeurs actuelles : il rougit si on repasse aux
 * anciens mots.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = fileURLToPath(new URL('.', import.meta.url));
const LANGUES = ['fr', 'en', 'nl'] as const;
type Langue = (typeof LANGUES)[number];

function charger(langue: Langue): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ici, `messages/${langue}.json`), 'utf8')) as Record<string, unknown>;
}

const CATALOGUES: Record<Langue, Record<string, unknown>> = {
  fr: charger('fr'),
  en: charger('en'),
  nl: charger('nl'),
};

function valeur(langue: Langue, chemin: string): string {
  let node: unknown = CATALOGUES[langue];
  for (const part of chemin.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) {
      throw new Error(`clé absente dans ${langue}.json : ${chemin}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`pas une chaîne dans ${langue}.json : ${chemin}`);
  return node;
}

describe('vocabulaire « remis » vs « parti » (F13, décision finale du 18/09)', () => {
  const MOT_REMIS: Record<Langue, string> = { fr: 'Remis', en: 'Dispatched', nl: 'Doorgegeven' };
  const MOT_PARTI: Record<Langue, string> = { fr: 'Parti', en: 'Sent', nl: 'Verstuurd' };

  it.each(LANGUES)('le badge « remis » (%s) dit le mot retenu, distinct du badge « parti »', (langue) => {
    expect(valeur(langue, 'campagne.file.status.dispatched')).toBe(MOT_REMIS[langue]);
    // Sans cette distinction, la contradiction avec `pendingDelivery` (« livraison en
    // attente » sous un badge qui affirmerait déjà un départ) reviendrait.
    expect(valeur(langue, 'campagne.file.status.dispatched')).not.toBe(valeur(langue, 'campagne.file.status.delivered'));
  });

  it.each(LANGUES)(
    'le badge « parti » (%s) dit le mot retenu — jamais « livré », qui promet un accusé de réception qu’on n’a pas',
    (langue) => {
      expect(valeur(langue, 'campagne.file.status.delivered')).toBe(MOT_PARTI[langue]);
    },
  );

  it.each(LANGUES)('les filtres reprennent les mêmes mots que les badges (%s)', (langue) => {
    expect(valeur(langue, 'campagne.file.filters.dispatched')).toContain(MOT_REMIS[langue]);
    expect(valeur(langue, 'campagne.file.filters.delivered')).toContain(MOT_PARTI[langue]);
  });

  it.each(LANGUES)('le tiroir « pas rejouable » (%s) reprend les mêmes mots', (langue) => {
    expect(valeur(langue, 'campagne.file.drawer.notReviewable.dispatched').toLowerCase()).toContain(
      MOT_REMIS[langue].toLowerCase(),
    );
    expect(valeur(langue, 'campagne.file.drawer.notReviewable.delivered').toLowerCase()).toBe(MOT_PARTI[langue].toLowerCase());
  });

  it.each(LANGUES)('l’entonnoir de campagne (%s) dit « emails partis », jamais « livrés »', (langue) => {
    expect(valeur(langue, 'campagne.overview.funnel.delivered').toLowerCase()).toContain(MOT_PARTI[langue].toLowerCase());
  });

  const MOT_REMIS_MINUSCULE: Record<Langue, string> = { fr: 'remis', en: 'dispatched', nl: 'doorgegeven' };
  const ANCIEN_MOT_GROUPE: Record<Langue, string> = { fr: 'envoyé', en: 'sent', nl: 'verzonden' };

  it.each(LANGUES)(
    "le fil d'activité (%s) dit « emails remis », jamais « envoyés » (compte dispatched+delivered)",
    (langue) => {
      for (const cle of [
        'campagne.overview.activity.envoisGroupes.withStep',
        'campagne.overview.activity.envoisGroupes.withoutStep',
        'campagne.activite.envoisGroupes.withStep',
        'campagne.activite.envoisGroupes.withoutStep',
      ]) {
        const texte = valeur(langue, cle).toLowerCase();
        expect(texte).toContain(MOT_REMIS_MINUSCULE[langue]);
        expect(texte).not.toContain(ANCIEN_MOT_GROUPE[langue]);
      }
    },
  );

  // Ancien verbe de départ du titre, distinct par langue (« partent »/« goes out »/« verzonden »).
  const ANCIEN_VERBE_TITRE: Record<Langue, string> = { fr: 'part', en: 'goes out', nl: 'verzonden' };

  it.each(LANGUES)("le titre de la file du jour (%s) ne prétend plus que tout part aujourd'hui", (langue) => {
    // Le total (`compteurs.tous`) inclut des envois échoués ou bloqués
    // (`lireEnvoisDuJour` n'exclut que `cancelled`) : ils ne « partiront »
    // jamais. Le titre reste au conditionnel du planning (« prévu »).
    const texte = valeur(langue, 'campagne.file.title').toLowerCase();
    expect(texte).not.toContain(ANCIEN_VERBE_TITRE[langue]);
  });
});

describe('vocabulaire « demandé » de l’enrichissement (F13)', () => {
  // `lireConsommationDuJour` (`packages/core/src/fonctions/plafonds.ts`) compte des
  // lignes `provider_daily_usage` (requêtes PAYÉES à FullEnrich), jamais des
  // contacts effectivement trouvés — une requête peut échouer sans rien ramener.
  const MOT_DEMANDE: Record<Langue, RegExp> = { fr: /demandé/i, en: /requested/i, nl: /aangevraagd/i };

  it.each(LANGUES)('les trois écrans de plafonds (%s) disent « demandé », jamais un chiffre nu', (langue) => {
    for (const cle of ['aujourdhui.caps.enrichment', 'campagne.overview.caps.enrichment', 'reglages.plafonds.consommation.enrichissement']) {
      expect(valeur(langue, cle)).toMatch(MOT_DEMANDE[langue]);
    }
  });
});
