import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EtatEnvoi, StatutContactCampagne } from '@jay-reach/core';
import { TableContacts, type LigneTableContacts, type TableContactsLibelles } from './TableContacts';
import { FiltresStatuts } from './FiltresStatuts';
import { grouperParHeure, intituleTrancheHoraire, TableFileDuJour, type LigneTableFileDuJour, type TableFileDuJourLibelles } from './TableFileDuJour';

const STATUT_LIBELLES: Record<StatutContactCampagne, string> = {
  a_contacter: 'À contacter',
  sans_email: 'Sans email',
  en_pause: 'En pause',
  en_sequence: 'En séquence',
  a_repondu: 'A répondu',
  interesse: 'Intéressé',
  ecarte: 'Écarté',
  termine: 'Terminé',
  rebond: 'Rebond',
  ne_plus_contacter: 'Ne plus contacter',
};

const LIBELLES: TableContactsLibelles = {
  colonneContact: 'Contact',
  colonnePourquoi: 'Pourquoi lui',
  colonneScore: 'Score',
  colonneEmail: 'Email',
  colonneEtape: 'Étape',
  colonneCampagne: 'Campagne',
  colonneAction: '',
  emailVerifie: 'Vérifié',
  emailATrouver: 'À trouver',
  sansEtape: 'à contacter',
  statut: STATUT_LIBELLES,
  chercherEmail: "Chercher l'email",
  coutChercherEmail: '1 crédit',
  ecarter: 'Écarter',
  reprendre: 'Reprendre',
  vide: 'Aucun contact pour ce filtre.',
};

function ligne(overrides: Partial<LigneTableContacts> = {}): LigneTableContacts {
  return {
    signalId: 'sig-1',
    contactId: 'contact-1',
    nom: 'Julien Fabre',
    poste: 'Chef des ventes',
    entreprise: 'Maison Verdier',
    email: null,
    statut: 'sans_email',
    etape: null,
    etapeTexte: null,
    score: null,
    pourquoi: null,
    inscriptionId: null,
    motifPause: null,
    repriseLe: null,
    prochainMessageLe: null,
    intitulePosteListe: null,
    motifPauseAffiche: null,
    prochainMessageAffiche: null,
    ...overrides,
  };
}

describe('TableContacts', () => {
  it('ligne « Sans email » -> bouton « Chercher l’email » avec le coût', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'sans_email', email: null })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain("Chercher l&#x27;email");
    expect(html).toContain('1 crédit');
    // Pas de puce d'email « Vérifié » sur cette ligne (email absent).
    expect(html).not.toContain('Vérifié');
  });

  it('ligne « A répondu » -> puce de ton bon', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[
          ligne({
            statut: 'a_repondu',
            email: 'karim@exemple.fr',
            etape: 1,
            etapeTexte: 'Étape 2',
          }),
        ]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-puce bon');
    expect(html).toContain('A répondu');
    // Email connu -> puce « Vérifié », jamais le bouton d'enrichissement.
    expect(html).toContain('Vérifié');
    expect(html).not.toContain("Chercher l&#x27;email");
  });

  // T29, partie B : une ligne `en_pause` montre la puce, le motif et le
  // bouton Reprendre — jamais l'une des autres actions.
  it('ligne « En pause » -> puce, motif du dessous et bouton Reprendre', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[
          ligne({
            statut: 'en_pause',
            email: 'sami@exemple.fr',
            inscriptionId: 'enr-1',
            motifPause: 'email_gate:bouncer_invalid',
            motifPauseAffiche: { texte: 'Email jugé non délivrable', title: null },
          }),
        ]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-puce attention');
    expect(html).toContain('En pause');
    expect(html).toContain('Email jugé non délivrable');
    expect(html).toContain('Reprendre');
    expect(html).not.toContain('Écarter');
    expect(html).not.toContain("Chercher l&#x27;email");
  });

  // F11 : la copie ne distingue plus une pause d'absence des autres pauses — le bouton dit
  // toujours « Reprendre » (rougirait si la clé `resumeNow`/le libellé distinct revenait).
  it('ligne « En pause » (absence) -> bouton « Reprendre », jamais « Reprendre maintenant »', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[
          ligne({
            statut: 'en_pause',
            email: 'lea@exemple.fr',
            inscriptionId: 'enr-2',
            motifPause: 'absence',
            motifPauseAffiche: { texte: 'Absent', title: null },
          }),
        ]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('Reprendre');
    expect(html).not.toContain('Reprendre maintenant');
  });

  // F11 : une inscription active dont le prochain envoi est daté annonce cette date, sous la
  // puce de statut — rougirait si `prochainMessageAffiche` cessait d'être rendu.
  it('ligne « En séquence » avec une échéance -> puce et date du prochain message', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[
          ligne({
            statut: 'en_sequence',
            email: 'yanis@exemple.fr',
            inscriptionId: 'enr-3',
            prochainMessageAffiche: 'Prochain message le 28 septembre',
          }),
        ]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('En séquence');
    expect(html).toContain('Prochain message le 28 septembre');
  });

  it('ligne « En séquence » sans échéance connue -> pas de ligne de prochain message', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'en_sequence', email: 'yanis@exemple.fr', inscriptionId: 'enr-3' })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('En séquence');
    expect(html).not.toContain('Prochain message');
  });

  it('ligne « À contacter » -> bouton Écarter (pas encore d’inscription active)', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'a_contacter', email: 'antoine@exemple.fr' })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('Écarter');
  });

  it('variante `global` ajoute la colonne Campagne', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'termine', email: 'x@exemple.fr', campagneNom: 'Directeur commercial' })]}
        colonnes="global"
        organisationId="org-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('Directeur commercial');
    expect(html).toContain('>Campagne<');
  });

  it('variante `campagne` ne montre pas la colonne Campagne', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'termine', email: 'x@exemple.fr' })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('>Campagne<');
  });

  it('le nom du contact est un lien vers ?contact=<id>', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'termine', email: 'x@exemple.fr', contactId: 'contact-42' })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('href="?contact=contact-42"');
  });

  it('affiche pourquoi et le score, tiret si absents (R33, R36)', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[
          ligne({ statut: 'a_repondu', email: 'x@exemple.fr', score: 88, pourquoi: 'A commenté un post récent' }),
          ligne({
            statut: 'a_contacter',
            email: 'y@exemple.fr',
            score: null,
            pourquoi: null,
            signalId: null,
            contactId: 'contact-2',
          }),
        ]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('A commenté un post récent');
    expect(html).toContain('88');
    expect(html).toContain('—');
  });

  it('« sans email » sans signal (R36, inscription sans signal) ne montre pas le bouton d’enrichissement', () => {
    const html = renderToStaticMarkup(
      <TableContacts
        lignes={[ligne({ statut: 'sans_email', email: null, signalId: null })]}
        colonnes="campagne"
        organisationId="org-1"
        campagneId="camp-1"
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain("Chercher l&#x27;email");
    expect(html).toContain('Sans email');
  });

  it('aucune ligne -> le texte vide fourni par l’appelant', () => {
    const html = renderToStaticMarkup(
      <TableContacts lignes={[]} colonnes="campagne" organisationId="org-1" campagneId="camp-1" libelles={LIBELLES} />,
    );
    expect(html).toContain('Aucun contact pour ce filtre.');
  });

  describe('point 2 (issue #120) : `posteListe`, campagne à liste', () => {
    it('sans `posteListe` (campagne à sources) : colonnes « Pourquoi lui »/« Score » inchangées', () => {
      const html = renderToStaticMarkup(
        <TableContacts
          lignes={[ligne({ pourquoi: 'A commenté un post récent', score: 88 })]}
          colonnes="campagne"
          organisationId="org-1"
          campagneId="camp-1"
          libelles={LIBELLES}
        />,
      );
      expect(html).toContain('Pourquoi lui');
      expect(html).toContain('Score');
      expect(html).toContain('A commenté un post récent');
      expect(html).toContain('88');
    });

    it('`posteListe.trouve` à `true` : une seule colonne remplace « Pourquoi lui »/« Score », valeur `intitulePosteListe`', () => {
      const html = renderToStaticMarkup(
        <TableContacts
          lignes={[ligne({ pourquoi: null, score: null, intitulePosteListe: 'Responsable RH' })]}
          colonnes="campagne"
          organisationId="org-1"
          campagneId="camp-1"
          posteListe={{ trouve: true, titre: 'Intitulé de poste' }}
          libelles={LIBELLES}
        />,
      );
      expect(html).not.toContain('Pourquoi lui');
      expect(html).not.toContain('>Score<');
      expect(html).toContain('Intitulé de poste');
      expect(html).toContain('Responsable RH');
    });

    it('point 3 (revue F5) : la colonne posteListe est calée comme `pourquoi` (largeur compressible + ellipse), sans réduire sa taille de police', () => {
      const html = renderToStaticMarkup(
        <TableContacts
          lignes={[ligne({ pourquoi: null, score: null, intitulePosteListe: 'Responsable régional des ventes grands comptes' })]}
          colonnes="campagne"
          organisationId="org-1"
          campagneId="camp-1"
          posteListe={{ trouve: true, titre: 'Intitulé de poste' }}
          libelles={LIBELLES}
        />,
      );
      // Même calage que `pourquoi` (largeur cible + `largeurMax: '0'`, tour de correction F6, point
      // 25 bis) : sans lui, un intitulé long forcerait la largeur minimale de toute la table.
      expect(html).toContain('max-width:0');
      // Ellipse posée, mais SANS `jr-petit` : l'intitulé de poste est une donnée principale, pas une
      // justification, il garde sa taille de police normale (contrairement à `pourquoi`).
      expect(html).toContain('<span class="jr-tronque">Responsable régional des ventes grands comptes</span>');
      expect(html).not.toContain('jr-petit');
    });

    it('`posteListe.trouve` à `false` : « Pourquoi lui »/« Score » masquées, sans remplacement', () => {
      const html = renderToStaticMarkup(
        <TableContacts
          lignes={[ligne({ pourquoi: null, score: null })]}
          colonnes="campagne"
          organisationId="org-1"
          campagneId="camp-1"
          posteListe={{ trouve: false, titre: 'Intitulé de poste' }}
          libelles={LIBELLES}
        />,
      );
      expect(html).not.toContain('Pourquoi lui');
      expect(html).not.toContain('>Score<');
      expect(html).not.toContain('Intitulé de poste');
    });
  });
});

describe('FiltresStatuts', () => {
  it('rend une puce par statut avec son compteur, et « Tous » en tête', () => {
    const compteurs = {
      tous: 3,
      a_contacter: 1,
      sans_email: 0,
      en_pause: 0,
      en_sequence: 1,
      a_repondu: 1,
      interesse: 0,
      ecarte: 0,
      termine: 0,
      rebond: 0,
      ne_plus_contacter: 0,
    };
    const html = renderToStaticMarkup(
      <FiltresStatuts
        base="/campaigns/camp-1/contacts"
        compteurs={compteurs}
        filtreActif="tous"
        libelles={{ tous: 'Tous', ...STATUT_LIBELLES }}
      />,
    );
    expect(html).toContain('href="/campaigns/camp-1/contacts"');
    expect(html).toContain('href="/campaigns/camp-1/contacts?filtre=en_sequence"');
    expect(html).toContain('jr-puce accent');
  });

  it('préserve la recherche `q` en changeant de filtre', () => {
    const compteurs = {
      tous: 1,
      a_contacter: 1,
      sans_email: 0,
      en_pause: 0,
      en_sequence: 0,
      a_repondu: 0,
      interesse: 0,
      ecarte: 0,
      termine: 0,
      rebond: 0,
      ne_plus_contacter: 0,
    };
    const html = renderToStaticMarkup(
      <FiltresStatuts
        base="/campaigns/camp-1/contacts"
        compteurs={compteurs}
        filtreActif="tous"
        recherche="karim"
        libelles={{ tous: 'Tous', ...STATUT_LIBELLES }}
      />,
    );
    expect(html).toContain('href="/campaigns/camp-1/contacts?filtre=a_contacter&amp;q=karim"');
  });
});

function envoi(overrides: Partial<LigneTableFileDuJour> = {}): LigneTableFileDuJour {
  return {
    id: 'a1',
    heure: '09:04',
    envoye: true,
    contactNom: 'Claire Moreau',
    etape: 0,
    campagneNom: 'Directeur commercial',
    expediteur: 'm.rousseau@exemple.fr',
    canal: 'email',
    etapeTexte: 'Étape 1',
    ...overrides,
  };
}

const ETAT_LIBELLES: Record<EtatEnvoi, string> = {
  scheduled: 'Prévu',
  pending_approval: 'À relire',
  approved: 'Prévu',
  dispatched: 'Parti',
  delivered: 'Livré',
  failed: 'Échoué',
  blocked: 'Bloqué',
  cancelled: 'Annulé',
  skipped: 'Annulé',
};

const FILE_LIBELLES: TableFileDuJourLibelles = {
  colonneHeure: 'Heure',
  colonneContact: 'Contact',
  colonneEtape: 'Étape et objet',
  colonneDepuis: 'Depuis',
  colonneEtat: 'État',
  groupeCompte: (n) => `${n} email${n > 1 ? 's' : ''}`,
  etat: ETAT_LIBELLES,
  livraisonEnAttente: 'livraison en attente',
  relire: 'Relire',
  reporter: 'Reporter',
  ecarter: 'Écarter',
  reessayer: 'Réessayer',
  chercherEmail: "Chercher l'email",
  coutChercherEmail: '1 crédit',
  aucunePlaceholder: '—',
};

describe('TableFileDuJour', () => {
  it('une ligne en échec affiche le bouton Réessayer (E3)', () => {
    const html = renderToStaticMarkup(
      <TableFileDuJour
        envois={[envoi({ id: 'a1', etatDetaille: 'failed', raisonEchec: 'boîte refusée (550)', contactId: 'contact-1' })]}
        organisationId="org-1"
        campagneId="camp-1"
        libelles={FILE_LIBELLES}
      />,
    );
    expect(html).toContain('Réessayer');
    expect(html).toContain('Écarter');
    expect(html).toContain('boîte refusée (550)');
  });
});

describe('grouperParHeure', () => {
  it('regroupe des envois consécutifs de la même heure', () => {
    const groupes = grouperParHeure([
      envoi({ id: 'a1', heure: '09:04' }),
      envoi({ id: 'a2', heure: '09:31' }),
      envoi({ id: 'a3', heure: '10:12' }),
    ]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0]).toMatchObject({ heure: '09' });
    expect(groupes[0]!.envois).toHaveLength(2);
    expect(groupes[1]).toMatchObject({ heure: '10' });
    expect(groupes[1]!.envois).toHaveLength(1);
  });

  it('un envoi sans heure connue forme sa propre tranche', () => {
    const groupes = grouperParHeure([envoi({ id: 'a1', heure: null }), envoi({ id: 'a2', heure: '09:04' })]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0]!.heure).toBe('—');
  });

  it('liste vide -> aucune tranche', () => {
    expect(grouperParHeure([])).toEqual([]);
  });
});

describe('intituleTrancheHoraire', () => {
  it('formate une tranche d’une heure', () => {
    expect(intituleTrancheHoraire('09')).toBe('09:00 à 10:00');
  });
  it('boucle correctement à minuit', () => {
    expect(intituleTrancheHoraire('23')).toBe('23:00 à 00:00');
  });
});
