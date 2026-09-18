/**
 * F13 (tâche « vocabulaire ») : les mots des écrans doivent dire ce que les
 * chiffres comptent vraiment. Deux familles de bugs trouvées et corrigées ici,
 * dans les trois catalogues :
 *
 * 1. Le badge d'état « remis » (`dispatched`, `actions.dispatched_at` posé,
 *    PAS encore `delivered_at`) disait « Parti »/« Sent »/« Verzonden » — le
 *    même mot que le départ RÉEL (F12, `EnvoiPrevu.livre`). La ligne se
 *    contredisait elle-même : le badge affirmait un départ, le sous-texte
 *    juste en dessous (`pendingDelivery`) disait « livraison en attente ».
 *    Même bug dans le fil d'activité d'une campagne (`envoisGroupes`, compte
 *    des actions `dispatched`+`delivered` — « envoyés » surclassait les
 *    simplement remises).
 * 2. Le plafond d'enrichissement (FullEnrich) affichait « utilisé / plafond »
 *    sous un libellé nu (« Enrichissement (FullEnrich) ») qui laissait croire
 *    à des contacts TROUVÉS — `lireConsommationDuJour` compte des requêtes
 *    payées (`provider_daily_usage`), pas des succès : une requête peut ne
 *    rien ramener.
 *
 * Ce test verrouille les valeurs corrigées : il rougit si on repasse aux
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

describe('vocabulaire « remis » vs « parti » (F13)', () => {
  // Anciens mots fautifs, un par langue — le badge `dispatched` (remis, pas
  // encore réellement parti) les réutilisait à tort, comme le mot déjà réservé
  // au départ réel (`coquille.sent.gone`, `file.status.delivered`).
  const ANCIEN_MOT_FAUTIF: Record<Langue, string> = { fr: 'Parti', en: 'Sent', nl: 'Verzonden' };
  const NOUVEAU_MOT: Record<Langue, string> = { fr: 'Remis', en: 'Dispatched', nl: 'Doorgestuurd' };

  it.each(LANGUES)("le badge d'état « remis » (%s) n'affirme plus un départ réel", (langue) => {
    expect(valeur(langue, 'campagne.file.status.dispatched')).toBe(NOUVEAU_MOT[langue]);
    expect(valeur(langue, 'campagne.file.status.dispatched')).not.toBe(ANCIEN_MOT_FAUTIF[langue]);
    // Le badge et l'état « livré » (départ réel, F12) doivent rester deux mots
    // distincts : sans ça la contradiction avec `pendingDelivery` reviendrait.
    expect(valeur(langue, 'campagne.file.status.dispatched')).not.toBe(valeur(langue, 'campagne.file.status.delivered'));
  });

  it.each(LANGUES)('le filtre « remis » (%s) reprend le même mot que le badge', (langue) => {
    expect(valeur(langue, 'campagne.file.filters.dispatched')).toContain(NOUVEAU_MOT[langue]);
    expect(valeur(langue, 'campagne.file.filters.dispatched')).not.toContain(ANCIEN_MOT_FAUTIF[langue]);
  });

  it.each(LANGUES)("le tiroir « pas rejouable » (%s) dit « déjà remis », pas « déjà parti »", (langue) => {
    const texte = valeur(langue, 'campagne.file.drawer.notReviewable.dispatched').toLowerCase();
    expect(texte).not.toContain(ANCIEN_MOT_FAUTIF[langue].toLowerCase());
  });

  const MOT_REMIS_MINUSCULE: Record<Langue, string> = { fr: 'remis', en: 'dispatched', nl: 'doorgestuurd' };
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
