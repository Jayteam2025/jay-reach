import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import type { CampagneFil, Fiche, ResumeContactFil } from '@jay-reach/core';
import { ListeFils, type LigneFilAffichage } from './ListeFils';
import { Fil, type MessageFilAffiche } from './Fil';
import { ColonneContact } from './ColonneContact';

// Traducteur réel (vraies clés `fr.json`, namespace `reception`) plutôt qu'un
// bouchon `(cle) => cle` : une clé manquante ou mal préfixée casse ce test au
// lieu de rendre silencieusement son chemin brut — même risque que celui
// documenté en tête de `cles-utilisees.test.ts`.
const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'reception' });

const CONTACT: ResumeContactFil = {
  id: 'contact-1',
  nom: 'Karim Benali',
  poste: 'Head of Sales',
  entreprise: 'Woodpecker Studio',
  email: 'k.benali@woodpecker-studio.example',
  emailStatut: 'valid',
  linkedinUrl: null,
};

const CAMPAGNE: CampagneFil = {
  id: 'campagne-1',
  nom: 'Directeur commercial',
  etape: { position: 2, total: 4 },
  sequenceArretee: true,
};

/** Fiche fictive (`lireFiche`, tâche 17) — R75 : la colonne droite ne construit plus son résumé depuis `lireFil` seul. */
const FICHE: Fiche = {
  contact: {
    id: 'contact-1',
    prenom: 'Karim',
    nom: 'Benali',
    poste: 'Head of Sales',
    entreprise: 'Woodpecker Studio',
    ville: 'Nantes',
    photoUrl: null,
    linkedinUrl: null,
    email: 'k.benali@woodpecker-studio.example',
    emailStatut: 'valid',
    telephone: null,
  },
  statut: 'a_repondu',
  score: { valeur: 91, explication: null },
  pourquoi: { providerId: 'adzuna', titre: 'Business developer senior', date: '2026-09-04T00:00:00.000Z', url: null, extrait: null },
  sequence: {
    etapes: [
      { position: 1, etat: 'faite' },
      { position: 2, etat: 'faite' },
      { position: 3, etat: 'a_venir' },
      { position: 4, etat: 'a_venir' },
    ],
    boite: null,
    pause: null,
  },
  echanges: [],
  filId: 'fil-1',
  notes: [],
  historique: [],
  campagnes: [{ id: 'campagne-1', nom: 'Directeur commercial' }],
};

const MESSAGES: MessageFilAffiche[] = [
  {
    id: 'm1',
    direction: 'out',
    corps: 'Karim, une question sur ton équipe',
    quand: '2026-09-11T09:12:00.000Z',
    quandAffiche: '11 sept., 09:12',
    expediteur: 'camille.martin@exemple.fr',
    destinataire: 'Karim Benali',
    objet: 'Karim, une question sur ton équipe',
    repondDepuis: null,
  },
  {
    id: 'm2',
    direction: 'in',
    corps: 'Merci Camille, ça me parle.',
    quand: '2026-09-16T10:22:00.000Z',
    quandAffiche: "aujourd'hui, 10:22",
    expediteur: 'Karim Benali',
    destinataire: null,
    objet: null,
    repondDepuis: null,
  },
];

describe('Réception — rendu des trois volets', () => {
  it('ListeFils : puces de filtre, campagne, liste des fils avec canal/puces', () => {
    const fils: LigneFilAffichage[] = [
      {
        id: 'fil-1',
        nom: 'Karim Benali',
        canal: 'email',
        classification: 'human_reply',
        apercu: 'Merci Camille, ça me parle.',
        quandAffiche: "aujourd'hui, 10:22",
        interet: 'interested',
        relanceLeAffiche: null,
      },
      {
        id: 'fil-2',
        nom: 'Marc Delorme',
        canal: 'linkedin',
        classification: 'auto_absence',
        apercu: 'Absent jusqu’au 22 septembre.',
        quandAffiche: 'hier',
        interet: null,
        relanceLeAffiche: '23/09',
      },
    ];
    const html = renderToStaticMarkup(
      <ListeFils
        t={t}
        fils={fils}
        compteurs={{ a_traiter: 2, interesses: 1, absences: 1, traites: 0, tous: 3 }}
        filtreActif="a_traiter"
        campagneId={null}
        campagnes={[{ id: 'campagne-1', nom: 'Directeur commercial' }]}
        filSelectionneId="fil-1"
      />,
    );
    expect(html).toContain('jr-liste');
    expect(html).toContain('jr-conversations');
    expect(html).toContain('jr-filtres');
    expect(html).toContain('Karim Benali');
    expect(html).toContain('Marc Delorme');
    expect(html).toContain('jr-canal li'); // pastille LinkedIn du second fil
    expect(html).toContain('Absence, relance le 23/09');
    expect(html).toContain('Directeur commercial'); // option du sélecteur de campagne
  });

  it('ListeFils : liste vide -> état vide, pas de <ul>', () => {
    const html = renderToStaticMarkup(
      <ListeFils
        t={t}
        fils={[]}
        compteurs={{ a_traiter: 0, interesses: 0, absences: 0, traites: 0, tous: 0 }}
        filtreActif="a_traiter"
        campagneId={null}
        campagnes={[]}
        filSelectionneId={null}
      />,
    );
    expect(html).not.toContain('jr-conversations');
    expect(html).toContain('jr-vide');
  });

  it('Fil : en-tête (contact, campagne, étape, séquence arrêtée), messages, zone de réponse', () => {
    const html = renderToStaticMarkup(
      <Fil
        t={t}
        filId="fil-1"
        contact={CONTACT}
        canal="email"
        campagne={CAMPAGNE}
        boite={{ id: 'boite-1', identite: 'camille.martin@exemple.fr', marque: 'outlook' }}
        messages={MESSAGES}
        interet={null}
        traite={false}
        reponsePossible={true}
        raisonReponseImpossible={null}
        transportReponse="salesblink"
      />,
    );
    expect(html).toContain('jr-fil-entete');
    expect(html).toContain('jr-fil-corps');
    expect(html).toContain('Karim Benali');
    expect(html).toContain('Woodpecker Studio');
    expect(html).toContain('Directeur commercial');
    expect(html).toContain('étape 2 sur 4');
    expect(html).toContain('séquence arrêtée à la réponse');
    expect(html).toContain('jr-message'); // cartes de messages
    expect(html).toContain('jr-reponse'); // zone de réponse toujours affichée
    expect(html).toContain('camille.martin@exemple.fr');
    expect(html).toContain('SalesBlink');
  });

  it('Fil : bouton Répondre indisponible affiche la raison (clé i18n traduite)', () => {
    const html = renderToStaticMarkup(
      <Fil
        t={t}
        filId="fil-2"
        contact={{ ...CONTACT, id: null }}
        canal="linkedin"
        campagne={null}
        boite={null}
        messages={[]}
        interet={null}
        traite={false}
        reponsePossible={false}
        raisonReponseImpossible="reception.fil.raisonReponseImpossible.canalNonEmail"
        transportReponse={null}
      />,
    );
    // Apostrophe échappée en HTML (`&#x27;`) par renderToStaticMarkup : on
    // vérifie de part et d'autre plutôt que la ponctuation exacte.
    expect(html).toContain('Répondre depuis Jay Reach');
    expect(html).toContain('pour les fils email.');
  });

  it('Fil : boîte nulle mais transport connu -> le transport reste affiché (tour de correction 1)', () => {
    const html = renderToStaticMarkup(
      <Fil
        t={t}
        filId="fil-3"
        contact={CONTACT}
        canal="email"
        campagne={null}
        boite={null}
        messages={[]}
        interet={null}
        traite={false}
        reponsePossible={true}
        raisonReponseImpossible={null}
        transportReponse="microsoft_graph"
      />,
    );
    expect(html).toContain('Microsoft');
  });

  it('ColonneContact : pourquoi lui, où en est-on, coordonnées, notes, lien vers la fiche (alimenté par lireFiche, R75)', () => {
    const html = renderToStaticMarkup(
      <ColonneContact
        t={t}
        fiche={FICHE}
        canal="email"
        campagneId="campagne-1"
        pourquoiQuandAffiche="4 sept."
      />,
    );
    expect(html).toContain('jr-colonne');
    expect(html).toContain('Business developer senior');
    expect(html).toContain('score 91');
    expect(html).toContain('jr-sequence-pilules');
    expect(html).toContain('k.benali@woodpecker-studio.example');
    expect(html).toContain('vérifié');
    expect(html).toContain('Aucune note.');
    expect(html).toContain('/campaigns/campagne-1/contacts?contact=contact-1');
  });

  it('ColonneContact : affiche les vraies notes de la fiche quand il y en a', () => {
    const html = renderToStaticMarkup(
      <ColonneContact
        t={t}
        fiche={{ ...FICHE, notes: [{ id: 'note-1', texte: 'À relancer jeudi', quand: '2026-09-12T08:00:00.000Z', auteurNom: 'Camille' }] }}
        canal="email"
        campagneId="campagne-1"
        pourquoiQuandAffiche="4 sept."
      />,
    );
    expect(html).toContain('À relancer jeudi');
    expect(html).not.toContain('Aucune note.');
  });

  it('ColonneContact : sans campagne rattachée au fil, aucun lien « Ouvrir la fiche complète »', () => {
    const html = renderToStaticMarkup(
      <ColonneContact t={t} fiche={FICHE} canal="email" campagneId={null} pourquoiQuandAffiche="4 sept." />,
    );
    expect(html).not.toContain('Ouvrir la fiche complète');
  });

  // Tour de correction 1, Important (relecture, T29) : une inscription
  // `en_pause` avec au moins une étape déjà faite n'est PAS « séquence
  // arrêtée » (reprenable), contrairement à `a_repondu` (FICHE, fixture de
  // base) où l'affichage reste inchangé.
  it('ColonneContact : une inscription a_repondu avec une étape faite affiche « séquence arrêtée »', () => {
    const html = renderToStaticMarkup(
      <ColonneContact t={t} fiche={FICHE} canal="email" campagneId="campagne-1" pourquoiQuandAffiche="4 sept." />,
    );
    expect(html).toContain('séquence arrêtée à la réponse');
  });

  it('ColonneContact : une inscription en_pause avec une étape faite n’affiche PAS « séquence arrêtée » (reprenable)', () => {
    const html = renderToStaticMarkup(
      <ColonneContact
        t={t}
        fiche={{ ...FICHE, statut: 'en_pause' }}
        canal="email"
        campagneId="campagne-1"
        pourquoiQuandAffiche="4 sept."
      />,
    );
    expect(html).not.toContain('séquence arrêtée à la réponse');
  });
});
