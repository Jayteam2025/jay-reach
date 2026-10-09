import { renderToStaticMarkup } from 'react-dom/server';
import { collecteServeurDisponible } from '../../sources/collecte-maintenant';
import { describe, expect, it, vi } from 'vitest';
import { configAdzuna, configFranceTravail, configLinkedInPost } from '@jay-reach/core';
import {
  ChampsSourceLinkedIn,
  champsLinkedInValides,
  construireConfigLinkedIn,
  etatChampsLinkedInDepuisConfig,
  type TypeLinkedIn,
} from '../../sources/ChampsSourceLinkedIn';
import { construireEntreeAssistant, nombreBoitesActives } from './Assistant';
import {
  construireConfigOffre,
  bandeauBrouillonLinkedin,
  construireGroupesMenu,
  EtapeSources,
  type EtapeSourcesLibelles,
  type SourceAssistant,
} from './EtapeSources';
import { EtapeQui, type EtapeQuiLibelles } from './EtapeQui';
import { EtapeSequence, type EtapeSequenceLibelles, etapesDepuisModele } from './EtapeSequence';
import { EtapeEnvoi, type EtapeEnvoiLibelles } from './EtapeEnvoi';

const LIBELLES_SOURCES: EtapeSourcesLibelles = {
  titre: 'Sources de la campagne',
  description: "D'où viendront les contacts.",
  ajouter: '+ Ajouter une source',
  vide: 'Aucune source pour l’instant',
  aide: "Vous pourrez ajouter, régler ou couper une source à tout moment dans l'onglet Sources.",
  retirer: 'Retirer',
  menuOffres: "Offres d'emploi",
  menuAdzunaTitre: 'Adzuna',
  menuAdzunaDescription: "Offres publiées sur les sites d'emploi français.",
  menuFranceTravailTitre: 'France Travail',
  menuFranceTravailDescription: "Offres de l'agence publique de l'emploi.",
  menuLinkedin: 'LinkedIn',
  menuLinkedinBadge: 'Collecte activée au lot 4',
  menuLinkedinPostEngagersTitre: "Engageurs d'un post",
  menuLinkedinPostEngagersDescription: 'Les personnes qui ont aimé ou commenté un post.',
  menuLinkedinCompetitorPostsTitre: "Engageurs des posts d'un concurrent",
  menuLinkedinCompetitorPostsDescription: 'Les personnes qui réagissent ou commentent les publications d’une page concurrente.',
  menuLinkedinCreatorPostsTitre: "Engageurs des posts d'un créateur",
  menuLinkedinCreatorPostsDescription: 'Les personnes qui réagissent ou commentent les publications d’un créateur de contenu.',
  menuLinkedinKeywordsTitre: 'Mots-clés',
  menuLinkedinKeywordsDescription: 'Les personnes qui publient sur un sujet.',
  menuLinkedinJobChangeTitre: 'Changement de poste',
  menuLinkedinJobChangeDescription: 'Les profils du persona arrivés en poste récemment.',
  menuManuel: 'Manuel',
  menuCsvTitre: 'Fichier CSV',
  menuCsvNote: "Après la création, dans l'onglet Sources.",
  formNom: 'Nom de la source',
  formMotsCles: 'Mots-clés',
  formMotsClesAide: 'Séparés par des virgules.',
  formLieux: 'Lieux',
  formContrat: 'Type de contrat',
  formContratTous: 'Tous',
  formContratCdi: 'CDI uniquement',
  formLinkedinPostUrl: 'Adresse du post',
  formLinkedinKeepPeople: 'On garde les personnes qui',
  formLinkedinCommented: 'ont commenté',
  formLinkedinReacted: 'ont réagi',
  formLinkedinPostOneCampaign: 'Un post ne peut servir qu\'à une seule campagne.',
  formLinkedinCompetitorPages: 'Pages LinkedIn des concurrents',
  formLinkedinCompetitorPagesHint: 'L’adresse de la page entreprise.',
  formLinkedinCreatorProfiles: 'Profils LinkedIn des créateurs',
  formLinkedinCreatorProfilesHint: 'L’adresse du profil.',
  formLinkedinTopics: 'Mots-clés de recherche',
  formLinkedinTopicsHint: 'Ce que vous taperiez dans la recherche de personnes.',
  formLinkedinJobChangeHint: 'Cette source ne trouve personne de nouveau : elle surveille les contacts que vous avez déjà.',
  formLinkedinErreur: 'Le champ propre à ce type de source est nécessaire.',
  formLinkedinBrouillon: "Cette campagne est un brouillon : rien ne sera collecté tant qu'elle n'est pas lancée.",
  resumeLinkedinJobChange: 'Relit les contacts déjà connus',
  formAjouter: 'Ajouter',
  formAnnuler: 'Annuler',
  formErreur: 'Au moins un mot-clé est nécessaire.',
};

const IDS_LINKEDIN: readonly TypeLinkedIn[] = [
  'linkedin_post_engagers',
  'linkedin_competitor_posts',
  'linkedin_creator_posts',
  'linkedin_keywords',
  'linkedin_job_change',
];

describe('construireGroupesMenu (R57 — catalogue complet du menu « + Ajouter une source »)', () => {
  it('groupe Offres d’emploi : Adzuna puis France Travail, dans cet ordre, sélectionnables', () => {
    const ouvrir = vi.fn();
    const groupes = construireGroupesMenu(LIBELLES_SOURCES, ouvrir);
    expect(groupes[0]!.titre).toBe(LIBELLES_SOURCES.menuOffres);
    expect(groupes[0]!.entrees.map((e) => e.titre)).toEqual([
      LIBELLES_SOURCES.menuAdzunaTitre,
      LIBELLES_SOURCES.menuFranceTravailTitre,
    ]);
    groupes[0]!.entrees[0]!.onSelectionner?.();
    groupes[0]!.entrees[1]!.onSelectionner?.();
    expect(ouvrir).toHaveBeenNthCalledWith(1, 'adzuna');
    expect(ouvrir).toHaveBeenNthCalledWith(2, 'france_travail');
  });

  it('groupe LinkedIn : le badge « en attente » suit la règle du serveur (aucun type n’en porte plus)', () => {
    const ouvrir = vi.fn();
    const groupes = construireGroupesMenu(LIBELLES_SOURCES, ouvrir);
    expect(groupes[1]!.titre).toBe(LIBELLES_SOURCES.menuLinkedin);
    expect(groupes[1]!.entrees).toHaveLength(IDS_LINKEDIN.length);

    // La RÈGLE, pas une liste figée. Écrit « tous sauf les engageurs d'un post », ce contrôle
    // restait vert alors que deux types de plus étaient collectés et portaient encore un badge
    // qui dit l'inverse. Il interroge donc la même source de vérité que le composant, et un type
    // branché le fait basculer tout seul.
    IDS_LINKEDIN.forEach((id, i) => {
      const html = renderToStaticMarkup(<>{groupes[1]!.entrees[i]!.titre}</>);
      const attendu = !collecteServeurDisponible(id);
      expect({ id, badge: html.includes(LIBELLES_SOURCES.menuLinkedinBadge) }).toEqual({ id, badge: attendu });
      expect(html.includes('jr-puce gris')).toBe(attendu);
    });
    // Les cinq types sont collectés : plus aucun badge. Le contrôle ci-dessus reste la règle, et
    // celui-ci garde la boucle de passer à vide si la liste des types se vidait.
    expect(IDS_LINKEDIN).toHaveLength(5);
    expect(IDS_LINKEDIN.every((id) => collecteServeurDisponible(id))).toBe(true);

    groupes[1]!.entrees.forEach((entree) => entree.onSelectionner?.());
    IDS_LINKEDIN.forEach((id, i) => expect(ouvrir).toHaveBeenNthCalledWith(i + 1, id));
  });

  it('groupe Manuel : Fichier CSV affiché mais inerte (import exige une campagne déjà créée)', () => {
    const groupes = construireGroupesMenu(LIBELLES_SOURCES, vi.fn());
    expect(groupes[2]!.titre).toBe(LIBELLES_SOURCES.menuManuel);
    expect(groupes[2]!.entrees).toHaveLength(1);
    const [csv] = groupes[2]!.entrees;
    expect(csv!.titre).toBe(LIBELLES_SOURCES.menuCsvTitre);
    expect(csv!.description).toBe(LIBELLES_SOURCES.menuCsvNote);
    expect(csv!.desactive).toBe(true);
    expect(csv!.onSelectionner).toBeUndefined();
  });
});

describe('construireConfigOffre (R58 — mapping contrat/typeContrat par fournisseur)', () => {
  it('France Travail : `typeContrat`, jamais `contrat` — valide contre le vrai schéma zod, CDI conservé', () => {
    const config = construireConfigOffre('france_travail', ['directeur commercial'], ['Lyon'], 'cdi');
    expect(config).toEqual({ motsCles: ['directeur commercial'], lieux: ['Lyon'], exclusions: [], typeContrat: 'cdi' });
    expect(config).not.toHaveProperty('contrat');
    expect(configFranceTravail.parse(config).typeContrat).toBe('cdi');
  });

  it('Adzuna : `contrat`, jamais `typeContrat`', () => {
    const config = construireConfigOffre('adzuna', ['ceo'], [], 'tous');
    expect(config).toEqual({ motsCles: ['ceo'], lieux: [], exclusions: [], contrat: 'tous' });
    expect(config).not.toHaveProperty('typeContrat');
    expect(configAdzuna.parse(config).contrat).toBe('tous');
  });

  it('un `contrat` envoyé à France Travail est désormais rejeté par le schéma (`.strict()`), plus jamais ignoré en silence', () => {
    expect(() => configFranceTravail.parse({ motsCles: ['x'], lieux: [], exclusions: [], contrat: 'cdi' })).toThrow();
  });
});

describe('construireEntreeAssistant — une source LinkedIn choisie dans l’assistant (R57)', () => {
  it('arrive dans l’entrée envoyée à creerCampagneComplete avec son providerId et sa config, valide contre le vrai schéma zod', () => {
    const config = construireConfigLinkedIn('linkedin_post_engagers', {
      ...etatChampsLinkedInDepuisConfig(),
      urlPost: 'https://exemple.fr/post',
    });
    expect(champsLinkedInValides('linkedin_post_engagers', {
      ...etatChampsLinkedInDepuisConfig(),
      urlPost: 'https://exemple.fr/post',
    })).toBe(true);

    const sourceLinkedin: SourceAssistant = {
      cle: 'linkedin_post_engagers-1',
      providerId: 'linkedin_post_engagers',
      nom: "Engageurs d'un post",
      config,
    };

    const entree = construireEntreeAssistant(
      {
        nom: 'Campagne test',
        personaId: 'persona-1',
        scoreMin: '70',
        plafondJour: '30',
        sources: [sourceLinkedin],
        etapes: [{ cle: 'e1', canal: 'email', sujet: 'Objet', corps: 'Corps', delaiJours: 0 }],
        relecture: '5',
        boiteIdsDesactivees: new Set(),
        boites: [],
      },
      false,
    ) as { sources: Array<{ providerId: string; nom: string; config: Record<string, unknown> }> };

    expect(entree.sources).toHaveLength(1);
    expect(entree.sources[0]!.providerId).toBe('linkedin_post_engagers');
    expect(entree.sources[0]!.nom).toBe("Engageurs d'un post");
    expect(entree.sources[0]!.config).toEqual({
      urlPost: 'https://exemple.fr/post',
      garder: ['commente', 'reagi'],
    });
    // C'est exactement ce que `creerSource` validera (packages/core/src/fonctions/sources.ts).
    expect(() => configLinkedInPost.parse(entree.sources[0]!.config)).not.toThrow();
  });
});

describe('nombreBoitesActives (R71, tour de correction 4)', () => {
  const boites = [
    { id: 'b1', identite: 'a@exemple.fr', marque: null },
    { id: 'b2', identite: 'b@exemple.fr', marque: null },
    { id: 'b3', identite: 'c@exemple.fr', marque: null },
  ];

  it('compte les boîtes cochées quand aucune n’est décochée', () => {
    expect(nombreBoitesActives(boites, new Set())).toBe(3);
  });

  it('compte les boîtes cochées quand certaines sont décochées', () => {
    expect(nombreBoitesActives(boites, new Set(['b1']))).toBe(2);
  });

  it('rend 0 quand toutes les boîtes sont décochées', () => {
    expect(nombreBoitesActives(boites, new Set(['b1', 'b2', 'b3']))).toBe(0);
  });
});

describe('construireEntreeAssistant — sélection des boîtes d’envoi (R71, tour de correction 4)', () => {
  const boites = [
    { id: 'b1', identite: 'a@exemple.fr', marque: null },
    { id: 'b2', identite: 'b@exemple.fr', marque: null },
    { id: 'b3', identite: 'c@exemple.fr', marque: null },
  ];
  const etatBase = {
    nom: 'Campagne test',
    personaId: null,
    scoreMin: '70',
    plafondJour: '30',
    sources: [],
    etapes: [],
    relecture: '5',
  };

  it('une boîte décochée sur trois -> enregistre la liste explicite des deux qui restent cochées, jamais []', () => {
    const entree = construireEntreeAssistant(
      { ...etatBase, boites, boiteIdsDesactivees: new Set(['b1']) },
      false,
    ) as { boiteIds: string[] };
    expect(entree.boiteIds).toEqual(['b2', 'b3']);
  });

  it('toutes décochées -> [] (sémantique « toutes » côté back), mais l’écran désactive alors « Créer et lancer »', () => {
    const entree = construireEntreeAssistant(
      { ...etatBase, boites, boiteIdsDesactivees: new Set(['b1', 'b2', 'b3']) },
      false,
    ) as { boiteIds: string[] };
    expect(entree.boiteIds).toEqual([]);
  });
});

describe('EtapeSources — sources déjà ajoutées', () => {
  it('une source « changement de poste » ajoutée dit ce qu’elle fait, sans chiffre inventé ni badge « en attente »', () => {
    const source: SourceAssistant = {
      cle: 'k1',
      providerId: 'linkedin_job_change',
      nom: 'Changement de poste',
      config: {},
    };
    const html = renderToStaticMarkup(
      <EtapeSources sources={[source]} onAjouter={() => {}} onRetirer={() => {}} disabled={false} libelles={LIBELLES_SOURCES} />,
    );
    expect(html).toContain('Relit les contacts déjà connus');
    expect(html).not.toContain('profils par jour');
    expect(html).not.toContain(LIBELLES_SOURCES.menuLinkedinBadge);
  });

  it('le formulaire des engageurs d’un post porte le bandeau de brouillon, les autres types non', () => {
    const html = renderToStaticMarkup(<>{bandeauBrouillonLinkedin('linkedin_post_engagers', LIBELLES_SOURCES)}</>);
    expect(html).toContain('jr-bandeau attention');
    expect(html).toContain('brouillon');
    for (const id of ['adzuna', 'france_travail', 'linkedin_keywords', 'linkedin_job_change'] as const) {
      expect(bandeauBrouillonLinkedin(id, LIBELLES_SOURCES)).toBeNull();
    }
  });

  it('une source « engageurs d’un post » ajoutée n’affiche plus le badge « en attente »', () => {
    const source: SourceAssistant = {
      cle: 'k3',
      providerId: 'linkedin_post_engagers',
      nom: "Engageurs d'un post",
      config: { urlPost: 'https://www.linkedin.com/posts/x', garder: ['commente'] },
    };
    const html = renderToStaticMarkup(
      <EtapeSources sources={[source]} onAjouter={() => {}} onRetirer={() => {}} disabled={false} libelles={LIBELLES_SOURCES} />,
    );
    expect(html).toContain('https://www.linkedin.com/posts/x');
    expect(html).not.toContain(LIBELLES_SOURCES.menuLinkedinBadge);
  });

  it('une source « recherche par mot-clé » ajoutée se résume par ses mots-clés, sans badge « en attente »', () => {
    const source: SourceAssistant = {
      cle: 'k4',
      providerId: 'linkedin_keywords',
      nom: 'Recherche par mot-clé',
      config: { sujets: ['CRM commercial', 'pipe de vente'] },
    };
    const html = renderToStaticMarkup(
      <EtapeSources sources={[source]} onAjouter={() => {}} onRetirer={() => {}} disabled={false} libelles={LIBELLES_SOURCES} />,
    );
    expect(html).toContain('CRM commercial, pipe de vente');
    expect(html).not.toContain('profils par jour');
    expect(html).not.toContain(LIBELLES_SOURCES.menuLinkedinBadge);
  });

  it('le menu : plus aucun type LinkedIn ne porte le badge « en attente »', () => {
    const groupes = construireGroupesMenu(LIBELLES_SOURCES, vi.fn());
    const badgePour = (id: TypeLinkedIn) =>
      renderToStaticMarkup(<>{groupes[1]!.entrees[IDS_LINKEDIN.indexOf(id)]!.titre}</>).includes(LIBELLES_SOURCES.menuLinkedinBadge);
    expect(badgePour('linkedin_keywords')).toBe(false);
    expect(badgePour('linkedin_job_change')).toBe(false);
  });

  it('une source Adzuna ajoutée résume mots-clés et lieux, sans badge LinkedIn', () => {
    const source: SourceAssistant = {
      cle: 'k2',
      providerId: 'adzuna',
      nom: 'Adzuna · Test',
      config: { motsCles: ['ceo', 'fondateur'], lieux: ['Lyon'] },
    };
    const html = renderToStaticMarkup(
      <EtapeSources sources={[source]} onAjouter={() => {}} onRetirer={() => {}} disabled={false} libelles={LIBELLES_SOURCES} />,
    );
    expect(html).toContain('ceo, fondateur · Lyon');
    expect(html).not.toContain(LIBELLES_SOURCES.menuLinkedinBadge);
  });
});

describe('EtapeQui — options persona (R59 : vrai bouton, aria-pressed)', () => {
  const LIBELLES: EtapeQuiLibelles = {
    nom: 'Nom de la campagne',
    nomPlaceholder: 'Relance directeurs commerciaux',
    personaTitre: 'Qui cherchez-vous ?',
    personaVide: 'Aucun persona actif.',
    personaNouveau: '+ Nouveau persona',
    personaNouveauAide: 'Dans Réglages › Personas.',
    scoreMin: 'Score minimal',
    scoreMinSuffixe: '/ 100',
    scoreMinAide: 'En dessous de ce seuil, le contact est écarté.',
    plafondJour: 'Nouveaux contacts par jour',
    plafondJourSuffixe: 'contacts',
    plafondJourAide: 'Plafond de la campagne.',
  };

  it('chaque persona est un <button type="button">, plus aucun role="button" sur un div', () => {
    const html = renderToStaticMarkup(
      <EtapeQui
        nom=""
        onNomChange={() => {}}
        personas={[
          { id: 'p1', nom: 'Directeur commercial' },
          { id: 'p2', nom: 'CEO' },
        ]}
        personaId="p1"
        onPersonaIdChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('role="button"');
    expect((html.match(/<button type="button" class="option/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('R66 (tour de correction 2) : les champs nom, score et plafond ont un id, chacun relié à son libellé par un vrai <label>', () => {
    const html = renderToStaticMarkup(
      <EtapeQui
        nom=""
        onNomChange={() => {}}
        personas={[]}
        personaId={null}
        onPersonaIdChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    for (const id of ['assistant-qui-nom', 'assistant-qui-score-min', 'assistant-qui-plafond-jour']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe('EtapeSequence — options « partir de » et pilules d’étape (R59 : vrai bouton, aria-pressed)', () => {
  const LIBELLES: EtapeSequenceLibelles = {
    partirDe: 'Partir de',
    modeleVideNom: 'Vide',
    modeleVideDescription: 'Écrire chaque étape soi-même.',
    apercu: 'Aperçu de la séquence',
    ajouterEtape: '+ Ajouter une étape',
    etape: 'Étape',
    canal: 'Canal',
    canalEmail: 'Email',
    canalLinkedinInvite: 'Invitation LinkedIn',
    canalLinkedinMessage: 'Message LinkedIn',
    inviteSansNote: 'L’invitation part sans note.',
    objet: 'Objet',
    corps: 'Corps',
    delai: 'Délai',
    delaiSuffixe: 'jours',
    delaiPilule: (n: number) => `+${n} j`,
    envoiImmediat: 'Envoyée au lancement de la campagne.',
    supprimer: 'Supprimer l’étape',
    variablesAide: 'Variables disponibles.',
    vide: 'Aucune étape.',
  };

  // Mesuré en production le 08/10 : aucun écran ne savait créer une invitation, alors que
  // l'écran Séquence demandait d'en ajouter une. Ces deux contrôles gardent l'ouverture.
  it('le canal propose l’invitation ET le message, distinctement', () => {
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={[{ cle: 'a', canal: 'email', sujet: '', corps: 'Bonjour', delaiJours: 0 }]}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('value="linkedin_invite"');
    expect(html).toContain('value="linkedin_message"');
    expect(html).toContain('Invitation LinkedIn');
    expect(html).toContain('Message LinkedIn');
  });

  it('une invitation n’a pas de champ message : le corps cède la place à la phrase qui dit pourquoi', () => {
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={[{ cle: 'a', canal: 'linkedin_invite', sujet: '', corps: '', delaiJours: 0 }]}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain(LIBELLES.variablesAide);
    expect(html).toContain(LIBELLES.inviteSansNote);
  });

  // Vu à l'écran le 08/10 : passer une étape du modèle « Question puis trois relances » en
  // invitation laissait la pilule annoncer « 1 · {{prenom}}, une question sur votre équipe ».
  // L'objet reste en mémoire pour un retour à l'email, mais il ne doit plus rien étiqueter.
  it('la pilule d’une étape LinkedIn dit le canal, jamais l’objet d’un email abandonné', () => {
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={[
          { cle: 'a', canal: 'linkedin_invite', sujet: 'Objet resté là', corps: '', delaiJours: 0 },
          { cle: 'b', canal: 'linkedin_message', sujet: 'Autre objet', corps: 'Bonjour {{prenom}}, ravi…', delaiJours: 2 },
          { cle: 'c', canal: 'linkedin_message', sujet: '', corps: '', delaiJours: 3 },
        ]}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('Objet resté là');
    expect(html).not.toContain('Autre objet');
    expect(html).toContain('1 · Invitation LinkedIn');
    // Un message porte ses premiers mots : deux messages de suite doivent rester distinguables.
    expect(html).toContain('2 · Bonjour {{prenom}}, ravi…');
    expect(html).toContain('3 · Message LinkedIn');
  });

  it('aucun role="button" résiduel : les options de modèle et les pilules sont de vrais boutons', () => {
    const etapes = etapesDepuisModele('question_relances');
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={etapes}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('role="button"');
    // Les deux modèles + « Vide » : trois <button class="option">.
    expect((html.match(/<button type="button" class="option"/g) ?? []).length).toBe(3);
    // Une pilule par étape du modèle, la première ouverte par défaut (`en-cours`).
    expect(html).toContain('class="pilule en-cours"');
  });

  it('R65 (tour de correction 2) : la première étape (ouverte par défaut) n’a pas de champ délai, pas d’étape précédente', () => {
    const etapes = etapesDepuisModele('question_relances');
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={etapes}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    // Première étape ouverte par défaut (`etapeOuverte = etapes[0].cle`) : le texte de repli s’affiche, pas le champ délai.
    expect(html).toContain(LIBELLES.envoiImmediat);
    expect(html).not.toContain(LIBELLES.delai);
  });

  it('R66 (tour de correction 2) : canal, objet et corps ont un id relié à leur libellé par un vrai <label>', () => {
    const etapes = etapesDepuisModele('question_relances');
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={etapes}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    // Étape 1 ouverte par défaut : canal + objet (email) + corps, tous les
    // trois visibles sans simuler de clic. Le champ délai (masqué pour cette
    // étape par R65) garde son id posé dans le code, non exercé par ce rendu.
    for (const id of ['assistant-sequence-canal', 'assistant-sequence-objet', 'assistant-sequence-corps']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe('EtapeEnvoi — repli tuile « @ » pour une boîte de marque inconnue (R60, comme PileDeBoites)', () => {
  const LIBELLES: EtapeEnvoiLibelles = {
    boitesTitre: 'Boîtes qui enverront',
    boitesVide: 'Aucune boîte active.',
    boitesAucuneActive: 'Choisissez au moins une boîte.',
    relecture: 'Relecture des premiers envois',
    relectureSuffixe: 'envois',
    relectureAide: 'Les premiers envois attendent une validation manuelle.',
    recapTitre: 'Récapitulatif',
    recapPersona: 'Persona',
    recapSources: 'Sources',
    recapSequence: 'Séquence',
    recapEnvoi: 'Envoi',
    recapPremierPassage: 'Premier passage des sources',
    recapPremierPassageValeur: 'Dès le lancement.',
    erreurLancement: 'Le lancement a été refusé :',
  };

  it('boîte sans marque connue -> tuile « @ » (jamais aucune tuile)', () => {
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[{ id: 'b1', identite: 'boite@exemple.fr', marque: null }]}
        boiteIdsDesactivees={new Set()}
        onToggleBoite={() => {}}
        aucuneBoiteActive={false}
        relecture="5"
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-tuile-logo em');
    expect(html).toContain('>@<');
  });

  it('boîte de marque connue -> `.jr-boite.avec-logo` (R62, tour de correction 2) : trois enfants, colonne de plus pour la tuile', () => {
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[{ id: 'b1', identite: 'boite@outlook.com', marque: 'outlook' }]}
        boiteIdsDesactivees={new Set()}
        onToggleBoite={() => {}}
        aucuneBoiteActive={false}
        relecture="5"
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('class="jr-boite avec-logo"');
  });

  it('R71 (tour de correction 4) : aucune boîte cochée -> aide « Choisissez au moins une boîte »', () => {
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[{ id: 'b1', identite: 'boite@exemple.fr', marque: null }]}
        boiteIdsDesactivees={new Set(['b1'])}
        onToggleBoite={() => {}}
        aucuneBoiteActive={true}
        relecture="5"
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain(LIBELLES.boitesAucuneActive);
  });

  it('R71 : au moins une boîte cochée -> pas d’aide « Choisissez au moins une boîte »', () => {
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[{ id: 'b1', identite: 'boite@exemple.fr', marque: null }]}
        boiteIdsDesactivees={new Set()}
        onToggleBoite={() => {}}
        aucuneBoiteActive={false}
        relecture="5"
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain(LIBELLES.boitesAucuneActive);
  });

  it('R66 (tour de correction 2) : le champ de relecture a un id relié à son libellé par un vrai <label>', () => {
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[]}
        boiteIdsDesactivees={new Set()}
        onToggleBoite={() => {}}
        aucuneBoiteActive={false}
        relecture="5"
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('for="assistant-envoi-relecture"');
    expect(html).toContain('id="assistant-envoi-relecture"');
  });
});

describe('ChampsSourceLinkedIn — champs avec id (R66, tour de correction 2)', () => {
  const LIBELLES = {
    postUrl: 'Adresse du post',
    keepPeople: 'On garde les personnes qui',
    commented: 'ont commenté',
    reacted: 'ont réagi',
    postOneCampaign: 'Un post ne peut servir qu\'à une seule campagne.',
    competitorPages: 'Pages LinkedIn des concurrents',
    competitorPagesHint: 'L’adresse de la page entreprise.',
    creatorProfiles: 'Profils LinkedIn des créateurs',
    creatorProfilesHint: 'L’adresse du profil.',
    topics: 'Mots-clés de recherche',
    topicsHint: 'Ce que vous taperiez dans la recherche de personnes.',
    jobChangeHint: 'Cette source ne trouve personne de nouveau : elle surveille les contacts que vous avez déjà.',
  };

  it('chaque champ du sous-type affiché a un id (préfixé par idPrefix) relié à son libellé', () => {
    const html = renderToStaticMarkup(
      <ChampsSourceLinkedIn
        providerId="linkedin_keywords"
        etat={etatChampsLinkedInDepuisConfig()}
        onChange={() => {}}
        libelles={LIBELLES}
        idPrefix="assistant-sources-linkedin"
      />,
    );
    for (const id of ['assistant-sources-linkedin-topics']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('sans idPrefix, retombe sur le préfixe par défaut « linkedin » (compatibilité du tiroir de la tâche 11)', () => {
    const html = renderToStaticMarkup(
      <ChampsSourceLinkedIn
        providerId="linkedin_keywords"
        etat={etatChampsLinkedInDepuisConfig()}
        onChange={() => {}}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('id="linkedin-topics"');
  });

  it('les engageurs d\'un post n\'ont ni compte ni cadence, et affichent la règle « un post, une campagne »', () => {
    const html = renderToStaticMarkup(
      <ChampsSourceLinkedIn
        providerId="linkedin_post_engagers"
        etat={etatChampsLinkedInDepuisConfig()}
        onChange={() => {}}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('linkedin-account-id');
    expect(html).not.toContain('linkedin-profiles-per-day');
    expect(html).toContain('seule campagne');
  });

  it('le choix du persona n\'apparait que si la campagne en porte plusieurs, et devient obligatoire', () => {
    const personas = [
      { id: 'p1', nom: 'Directeur commercial' },
      { id: 'p2', nom: 'DRH' },
    ];
    const rendu = (liste: typeof personas) =>
      renderToStaticMarkup(
        <ChampsSourceLinkedIn
          providerId="linkedin_post_engagers"
          etat={etatChampsLinkedInDepuisConfig()}
          onChange={() => {}}
          libelles={{ ...LIBELLES, persona: 'Persona de la source', personaChoisir: 'Choisir' }}
          personas={liste}
        />,
      );
    expect(rendu(personas)).toContain('DRH');
    expect(rendu(personas.slice(0, 1))).not.toContain('Persona de la source');
    expect(rendu([])).not.toContain('Persona de la source');

    const etat = { ...etatChampsLinkedInDepuisConfig(), urlPost: 'https://exemple.fr/p' };
    expect(champsLinkedInValides('linkedin_post_engagers', etat, 2)).toBe(false);
    expect(champsLinkedInValides('linkedin_post_engagers', { ...etat, personaId: 'p2' }, 2)).toBe(true);
    expect(champsLinkedInValides('linkedin_post_engagers', etat, 1)).toBe(true);
    expect(construireConfigLinkedIn('linkedin_post_engagers', { ...etat, personaId: 'p2' })).toEqual({
      urlPost: 'https://exemple.fr/p',
      garder: ['commente', 'reagi'],
      personaId: 'p2',
    });
  });
});
