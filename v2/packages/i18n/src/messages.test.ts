/**
 * Complétude et qualité des catalogues `en.json`/`nl.json` face à `fr.json`,
 * la référence (tâche 25).
 *
 * `cles-utilisees.test.ts` vérifie déjà que `fr.json` ne contient aucune clé
 * morte, et que toute clé d'`en.json`/`nl.json` existe dans `fr.json` (sens
 * inverse). Il manquait le sens qui compte le plus pour un opérateur anglophone
 * ou néerlandophone : que `en.json`/`nl.json` couvrent VRAIMENT tout `fr.json`,
 * avec des valeurs traduites (pas du français recopié) et des variables ICU
 * identiques — sinon next-intl affiche soit le chemin de la clé (traduction
 * manquante), soit une erreur de rendu (variable absente d'une branche).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';

const ici = fileURLToPath(new URL('.', import.meta.url));
const LANGUES = ['fr', 'en', 'nl'] as const;
type Langue = (typeof LANGUES)[number];

function charger(langue: Langue): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ici, `messages/${langue}.json`), 'utf8')) as Record<string, unknown>;
}

/** Chemin complet -> valeur, pour toutes les clés FEUILLES (chaînes) d'un catalogue. */
function clesFeuilles(catalogue: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  function parcourir(node: unknown, chemin: string): void {
    if (typeof node === 'string') {
      out.set(chemin, node);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [cle, valeur] of Object.entries(node as Record<string, unknown>)) {
        parcourir(valeur, chemin ? `${chemin}.${cle}` : cle);
      }
    }
  }
  parcourir(catalogue, '');
  return out;
}

const catalogues: Record<Langue, Record<string, unknown>> = {
  fr: charger('fr'),
  en: charger('en'),
  nl: charger('nl'),
};
const feuilles: Record<Langue, Map<string, string>> = {
  fr: clesFeuilles(catalogues.fr),
  en: clesFeuilles(catalogues.en),
  nl: clesFeuilles(catalogues.nl),
};

describe('catalogues de traduction fr/en/nl', () => {
  it.each(['en', 'nl'] as const)(
    '%s.json a exactement les mêmes clés feuilles que fr.json',
    (langue) => {
      const fr = new Set(feuilles.fr.keys());
      const autre = new Set(feuilles[langue].keys());
      const manquantes = [...fr].filter((c) => !autre.has(c)).sort();
      const enTrop = [...autre].filter((c) => !fr.has(c)).sort();
      expect({ manquantes, enTrop }).toEqual({ manquantes: [], enTrop: [] });
    },
  );

  it.each(LANGUES)('%s.json : aucune valeur vide ou identique à sa clé complète', (langue) => {
    const problemes: string[] = [];
    for (const [cle, valeur] of feuilles[langue]) {
      if (valeur.trim() === '') problemes.push(`${cle} est vide`);
      // Repli next-intl visible en production quand une traduction manque :
      // le chemin de clé s'affiche tel quel (voir messages-compilent.test.ts).
      // Une valeur strictement égale à SON PROPRE chemin complet trahit ce
      // même symptôme copié en dur dans le JSON plutôt que traduit.
      if (valeur === cle) problemes.push(`${cle} vaut son propre chemin de clé`);
    }
    expect(problemes).toEqual([]);
  });

  // Un nom de variable ICU est un identifiant juste après `{`, immédiatement
  // suivi de `}` ou `,` — ça exclut le texte littéral des branches plurielles
  // (`{n, plural, one {Tous #} other {Toutes #}}` : "Tous" est suivi d'un
  // espace, pas de `}`/`,`, donc jamais confondu avec une variable).
  const VARIABLE = /\{([a-zA-Z0-9_]+)(?=[,}])/g;
  function variablesIcu(valeur: string): Set<string> {
    return new Set([...valeur.matchAll(VARIABLE)].map((m) => m[1]!));
  }

  it('même ensemble de variables ICU dans les trois langues, pour chaque clé', () => {
    const ecarts: string[] = [];
    for (const [cle, valeurFr] of feuilles.fr) {
      const varsFr = variablesIcu(valeurFr);
      for (const langue of ['en', 'nl'] as const) {
        const valeur = feuilles[langue].get(cle);
        if (valeur === undefined) continue; // déjà signalé par le test de parité des clés ci-dessus
        const vars = variablesIcu(valeur);
        const identiques = vars.size === varsFr.size && [...varsFr].every((v) => vars.has(v));
        if (!identiques) {
          ecarts.push(
            `${cle} : fr={${[...varsFr].sort().join(',')}} ${langue}={${[...vars].sort().join(',')}}`,
          );
        }
      }
    }
    expect(ecarts).toEqual([]);
  });

  it.each(LANGUES)('%s : tous les messages compilent en ICU', (langue) => {
    const invalides: string[] = [];
    for (const [cle, valeur] of feuilles[langue]) {
      try {
        new IntlMessageFormat(valeur, langue);
      } catch (err) {
        invalides.push(`${cle} : ${valeur} → ${(err as Error).message.split('\n')[0]}`);
      }
    }
    expect(invalides).toEqual([]);
  });

  // Anti-français : clés-repères (titres de page, entrées de menu, boutons
  // principaux, libellés de statut) dont la traduction doit vraiment
  // s'écarter du français — repli le plus fréquent d'un traducteur pressé :
  // recopier la valeur `fr` telle quelle. Liste de base (30) choisie parmi
  // les clés du nouveau design dont la traduction en/nl diffère
  // structurellement du français (les cognats stricts comme "Contacts"/
  // "Contacts" ou "Personas"/"Personas" en sont volontairement absents : ils
  // échoueraient le test sans être de mauvaises traductions). Trois clés de
  // vocabulaire métier LinkedIn s'y sont ajoutées après une relecture qui a
  // trouvé « Engageurs » (français) laissé tel quel dans `nl.json` — la liste
  // de base ne les couvrait pas (elle vise les repères d'écran, pas tout le
  // vocabulaire) : les ajouter ici transforme le correctif ponctuel en garde
  // non-régression.
  const CLES_ANTI_FRANCAIS = [
    'coquille.nav.today',
    'coquille.nav.inbox',
    'coquille.nav.settings',
    'reglages.title',
    'reglages.nav.senders',
    'reglages.nav.providers',
    'reglages.nav.engine',
    'reglages.nav.account',
    'campagne.header.launch',
    'campagne.header.edit',
    'campagne.header.pause',
    'campagne.tabs.overview',
    'campagne.tabs.queue',
    'campagne.tabs.sequence',
    'campagne.status.draft',
    'campagne.status.paused',
    'campagne.status.archived',
    'contacts.export',
    'contacts.tabs.companies',
    'contacts.actions.discard',
    'contacts.actions.resume',
    'contacts.status.a_contacter',
    'contacts.status.interesse',
    'contacts.status.termine',
    'reglages.expediteurs.boxesTitle',
    'reglages.personas.new',
    'reglages.moteur.titre',
    'campagne.contacts.actions.enrich',
    'reglages.compte.session.bouton',
    'campagne.file.actions.review',
    'sources.fournisseurs.linkedin_post_engagers',
    'campagne.sources.menu.linkedinPostEngagers.title',
    'campagne.nouvelle.sources.menuLinkedinPostEngagersTitle',
  ] as const;

  const MOTS_FRANCAIS = [
    'le',
    'la',
    'les',
    'des',
    'une',
    'et',
    'ou',
    'dans',
    'pour',
    'avec',
    'envoyer',
    'réponse',
    'campagne',
    'contacts',
    'réglages',
    'engageurs',
  ];
  // Bornés par des espaces ou une ponctuation (pas par \b, qui traiterait un
  // caractère accentué comme une frontière de mot et laisserait passer par
  // exemple "réponse" collé à une apostrophe typographique).
  const MOT_FRANCAIS = new RegExp(`(?<![a-zà-ÿ0-9])(${MOTS_FRANCAIS.join('|')})(?![a-zà-ÿ0-9])`, 'i');

  it.each(['en', 'nl'] as const)('%s : les clés-repères diffèrent vraiment du français', (langue) => {
    const problemes: string[] = [];
    for (const cle of CLES_ANTI_FRANCAIS) {
      const valeurFr = feuilles.fr.get(cle);
      const valeur = feuilles[langue].get(cle);
      if (valeurFr === undefined || valeur === undefined) {
        problemes.push(`${cle} : absente d'un des catalogues`);
        continue;
      }
      if (valeur === valeurFr) problemes.push(`${cle} : identique au français ("${valeur}")`);
      const mot = MOT_FRANCAIS.exec(valeur);
      if (mot) problemes.push(`${cle} : contient le mot français "${mot[0]}" ("${valeur}")`);
    }
    expect(problemes).toEqual([]);
  });
});
