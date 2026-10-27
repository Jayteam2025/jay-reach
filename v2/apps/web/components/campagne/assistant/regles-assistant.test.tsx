import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { schemaCreerCampagneComplete } from '@jay-reach/core';
import { construireEntreeAssistant } from './Assistant';
import { EtapeEnvoi, type EtapeEnvoiLibelles } from './EtapeEnvoi';
import { EtapeQui, PLAFOND_JOUR_MAX, type EtapeQuiLibelles } from './EtapeQui';
import { EtapeSequence, type EtapeSequenceEtape, type EtapeSequenceLibelles } from './EtapeSequence';
import {
  ajouterEtapeALaSequence,
  appliquerModificationEtape,
  canalParDefaut,
  erreurEtapeQui,
  personaInitial,
  premiereEtapeIncomplete,
  relectureInitiale,
} from './regles-assistant';

const etape = (cle: string, patch: Partial<EtapeSequenceEtape> = {}): EtapeSequenceEtape => ({
  cle,
  canal: 'email',
  sujet: 'Objet',
  corps: 'Corps',
  delaiJours: 2,
  ...patch,
});

describe('relectureInitiale : le défaut de l’organisation, pas 5', () => {
  it('un défaut à 0 donne 0', () => {
    expect(relectureInitiale(0)).toBe('0');
  });
  it('un défaut posé par l’organisation est repris tel quel', () => {
    expect(relectureInitiale(3)).toBe('3');
  });
  it('une valeur absurde retombe sur 0, jamais sur NaN ni sur un négatif', () => {
    expect(relectureInitiale(Number.NaN)).toBe('0');
    expect(relectureInitiale(-2)).toBe('0');
  });
});

describe('personaInitial : présélection seulement quand il n’y a rien à choisir', () => {
  it('plusieurs personas : aucun présélectionné', () => {
    expect(personaInitial([{ id: 'p1', nom: 'Commercial Terrain' }, { id: 'p2', nom: 'Directeur commercial' }])).toBeNull();
  });
  it('un seul persona : c’est lui', () => {
    expect(personaInitial([{ id: 'p2', nom: 'Directeur commercial' }])).toBe('p2');
  });
  it('aucun persona : rien', () => {
    expect(personaInitial([])).toBeNull();
  });
});

describe('erreurEtapeQui : nom d’abord, puis persona obligatoire quand il y en a', () => {
  const deux = [{ id: 'p1', nom: 'A' }, { id: 'p2', nom: 'B' }];
  it('sans nom : erreur de nom', () => {
    expect(erreurEtapeQui({ nom: '  ', personaId: 'p1' }, deux)).toBe('nom');
  });
  it('plusieurs personas, aucun choisi : erreur de persona', () => {
    expect(erreurEtapeQui({ nom: 'Ma campagne', personaId: null }, deux)).toBe('persona');
  });
  it('persona choisi : rien ne bloque', () => {
    expect(erreurEtapeQui({ nom: 'Ma campagne', personaId: 'p2' }, deux)).toBeNull();
  });
  it('aucun persona actif : ne bloque pas (la carte dit déjà d’en créer un)', () => {
    expect(erreurEtapeQui({ nom: 'Ma campagne', personaId: null }, [])).toBeNull();
  });
});

describe('canalParDefaut : la première étape ouvre par une invitation si LinkedIn est connecté', () => {
  it('première étape, LinkedIn connecté : invitation', () => {
    expect(canalParDefaut(0, true)).toBe('linkedin_invite');
  });
  it('première étape, LinkedIn non connecté : email', () => {
    expect(canalParDefaut(0, false)).toBe('email');
  });
  it('une étape suivante reste un email, LinkedIn connecté ou non', () => {
    expect(canalParDefaut(1, true)).toBe('email');
    expect(canalParDefaut(3, false)).toBe('email');
  });
});

describe('ajouterEtapeALaSequence : la nouvelle étape s’ouvre', () => {
  it('l’étape à ouvrir est la nouvelle, pas la précédente', () => {
    const avant = [etape('a'), etape('b')];
    const { etapes, cleOuverte } = ajouterEtapeALaSequence(avant, false, 1_000);
    expect(etapes).toHaveLength(3);
    expect(cleOuverte).toBe(etapes[2]!.cle);
    expect(avant.map((e) => e.cle)).not.toContain(cleOuverte);
  });
  it('deux ajouts dans la même milliseconde ne partagent pas de clé', () => {
    const premier = ajouterEtapeALaSequence([], false, 5);
    const second = ajouterEtapeALaSequence(premier.etapes, false, 5);
    expect(second.cleOuverte).not.toBe(premier.cleOuverte);
  });
  it('dans une séquence vide avec LinkedIn connecté, la nouvelle étape est une invitation', () => {
    expect(ajouterEtapeALaSequence([], true, 1).etapes[0]!.canal).toBe('linkedin_invite');
    expect(ajouterEtapeALaSequence([], false, 1).etapes[0]!.canal).toBe('email');
  });
  it('rendue avec cette clé ouverte, la pilule de la nouvelle étape est « en cours » et son formulaire est affiché', () => {
    const { etapes, cleOuverte } = ajouterEtapeALaSequence([etape('a')], false, 1);
    const html = renderToStaticMarkup(
      <EtapeSequence
        etapes={etapes}
        onChoisirModele={() => {}}
        onAjouterEtape={() => {}}
        onModifierEtape={() => {}}
        onSupprimerEtape={() => {}}
        etapeOuverte={cleOuverte}
        onOuvrirEtape={() => {}}
        disabled={false}
        libelles={LIBELLES_SEQUENCE}
      />,
    );
    expect(html).toContain('class="pilule en-cours"');
    expect(html).toContain('2 · Étape');
    // Étape 2 ouverte : son champ « délai » est là, celui de la première étape (envoi immédiat) non.
    expect(html).toContain('Délai');
    expect(html).not.toContain('Envoyée au lancement');
  });
});

describe('premiereEtapeIncomplete : une étape vide ne passe pas', () => {
  it('une séquence complète ne bloque rien', () => {
    expect(premiereEtapeIncomplete([etape('a'), etape('b', { canal: 'linkedin_invite', sujet: '', corps: '' })])).toBeNull();
  });
  it('un email vide est repéré avec son rang et sa clé', () => {
    expect(premiereEtapeIncomplete([etape('a'), etape('b', { sujet: '', corps: '' })])).toEqual({
      motif: 'emailVide',
      rang: 2,
      cle: 'b',
    });
  });
  it('un email sans objet, un email sans corps : deux motifs distincts', () => {
    expect(premiereEtapeIncomplete([etape('a', { sujet: '   ' })])?.motif).toBe('emailObjet');
    expect(premiereEtapeIncomplete([etape('a', { corps: '\n ' })])?.motif).toBe('emailCorps');
  });
  it('un message LinkedIn sans texte est repéré, une invitation sans texte non', () => {
    expect(premiereEtapeIncomplete([etape('a', { canal: 'linkedin_message', sujet: '', corps: '' })])?.motif).toBe(
      'messageLinkedinCorps',
    );
    expect(premiereEtapeIncomplete([etape('a', { canal: 'linkedin_invite', sujet: '', corps: '' })])).toBeNull();
  });
  it('c’est la première étape incomplète qui est rendue', () => {
    expect(premiereEtapeIncomplete([etape('a', { corps: '' }), etape('b', { sujet: '' })])?.cle).toBe('a');
  });
});

const LIBELLES_SEQUENCE: EtapeSequenceLibelles = {
  partirDe: 'Partir de',
  modeleVideNom: 'Vide',
  modeleVideDescription: 'Écrire chaque étape soi-même.',
  apercu: 'Aperçu',
  ajouterEtape: '+ Ajouter une étape',
  etape: 'Étape',
  canal: 'Canal',
  canalEmail: 'Email',
  canalLinkedinInvite: 'Invitation LinkedIn',
  canalLinkedinMessage: 'Message LinkedIn',
  inviteSansNote: 'L’invitation part sans note.',
  messageApresInvitation: 'HINT-169 : message réservé aux personnes ayant accepté.',
  objet: 'Objet',
  corps: 'Corps',
  delai: 'Délai',
  delaiSuffixe: 'jours',
  delaiPilule: (n: number) => `+${n} j`,
  envoiImmediat: 'Envoyée au lancement de la campagne.',
  supprimer: 'Supprimer',
  variablesAide: 'Variables.',
  vide: 'Aucune étape.',
};

function rendreSequence(etapes: readonly EtapeSequenceEtape[], ouverte: string): string {
  return renderToStaticMarkup(
    <EtapeSequence
      etapes={etapes}
      onChoisirModele={() => {}}
      onAjouterEtape={() => {}}
      onModifierEtape={() => {}}
      onSupprimerEtape={() => {}}
      etapeOuverte={ouverte}
      onOuvrirEtape={() => {}}
      disabled={false}
      libelles={LIBELLES_SEQUENCE}
    />,
  );
}

describe('EtapeSequence : l’indication #169 sous un message LinkedIn', () => {
  it('un message LinkedIn ouvert porte l’indication', () => {
    const html = rendreSequence([etape('a', { canal: 'linkedin_invite' }), etape('b', { canal: 'linkedin_message' })], 'b');
    expect(html).toContain('HINT-169');
  });
  it('ni une invitation, ni un email, ni un message fermé ne la portent', () => {
    expect(rendreSequence([etape('a', { canal: 'linkedin_invite' })], 'a')).not.toContain('HINT-169');
    expect(rendreSequence([etape('a')], 'a')).not.toContain('HINT-169');
    expect(rendreSequence([etape('a'), etape('b', { canal: 'linkedin_message' })], 'a')).not.toContain('HINT-169');
  });
});

describe('EtapeQui : bornes du plafond de contacts par jour', () => {
  const LIBELLES: EtapeQuiLibelles = {
    nom: 'Nom',
    nomPlaceholder: '',
    personaTitre: 'Qui ?',
    personaVide: 'Aucun',
    personaNouveau: '+',
    personaNouveauAide: '',
    scoreMin: 'Score',
    scoreMinSuffixe: '/ 100',
    scoreMinAide: '',
    plafondJour: 'Nouveaux contacts par jour',
    plafondJourSuffixe: 'contacts',
    plafondJourAide: '',
  };

  it('min 1 et max 10000 (le contrat), jamais un max inférieur au min', () => {
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
    const champ = /<input[^>]*id="assistant-qui-plafond-jour"[^>]*>/.exec(html)?.[0] ?? '';
    const min = Number(/min="(\d+)"/.exec(champ)?.[1]);
    const max = Number(/max="(\d+)"/.exec(champ)?.[1]);
    expect(min).toBe(1);
    expect(max).toBe(PLAFOND_JOUR_MAX);
    expect(max).toBeGreaterThan(min);
  });

  it('sans persona présélectionné, aucun bouton persona n’est enfoncé', () => {
    const html = renderToStaticMarkup(
      <EtapeQui
        nom=""
        onNomChange={() => {}}
        personas={[{ id: 'p1', nom: 'A' }, { id: 'p2', nom: 'B' }]}
        personaId={personaInitial([{ id: 'p1', nom: 'A' }, { id: 'p2', nom: 'B' }])}
        onPersonaIdChange={() => {}}
        scoreMin="70"
        onScoreMinChange={() => {}}
        plafondJour="30"
        onPlafondJourChange={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).not.toContain('aria-pressed="true"');
  });
});

describe('EtapeEnvoi : la relecture montre la valeur reçue', () => {
  it('le champ porte le défaut de l’organisation et l’aide dit où relire', () => {
    const libelles: EtapeEnvoiLibelles = {
      boitesTitre: '',
      boitesVide: '',
      boitesAucuneActive: '',
      relecture: 'Relecture',
      relectureSuffixe: 'envois',
      relectureAide: 'Vous les relirez dans l’onglet « File du jour ».',
      recapTitre: '',
      recapPersona: '',
      recapSources: '',
      recapSequence: '',
      recapEnvoi: '',
      recapPremierPassage: '',
      recapPremierPassageValeur: '',
      erreurLancement: '',
    };
    const html = renderToStaticMarkup(
      <EtapeEnvoi
        boites={[]}
        afficherBoites={false}
        boiteIdsDesactivees={new Set()}
        onToggleBoite={() => {}}
        aucuneBoiteActive={false}
        relecture={relectureInitiale(0)}
        onRelectureChange={() => {}}
        disabled={false}
        recapitulatif={{ persona: '-', sources: '-', sequence: '-', envoi: '-' }}
        manques={[]}
        libelles={libelles}
      />,
    );
    expect(html).toMatch(/id="assistant-envoi-relecture"[^>]*value="0"|value="0"[^>]*id="assistant-envoi-relecture"/);
    expect(html).toContain('File du jour');
  });
});

describe('un email rédigé puis basculé en invitation LinkedIn', () => {
  const redige = etape('a', { sujet: 'Objet rédigé', corps: 'Bonjour {{prenom}}' });

  it('appliquerModificationEtape vide l\u2019objet et le corps au passage à l\u2019invitation', () => {
    const suivante = appliquerModificationEtape(redige, { canal: 'linkedin_invite' });
    expect(suivante).toMatchObject({ canal: 'linkedin_invite', sujet: '', corps: '' });
  });

  it('le passage à un message LinkedIn ou à un email garde le texte écrit', () => {
    expect(appliquerModificationEtape(redige, { canal: 'linkedin_message' }).corps).toBe('Bonjour {{prenom}}');
    expect(appliquerModificationEtape(redige, { delaiJours: 4 })).toMatchObject({ corps: 'Bonjour {{prenom}}', delaiJours: 4 });
  });

  it('modifier le texte d\u2019une invitation ne le fait pas reparaître : le canal décide', () => {
    const invitation = etape('i', { canal: 'linkedin_invite', sujet: '', corps: '' });
    expect(appliquerModificationEtape(invitation, { corps: 'Texte' }).corps).toBe('');
  });

  it('même si l\u2019état garde un corps, l\u2019entrée envoyée au serveur n\u2019en porte pas et passe son vrai schéma', () => {
    const entree = construireEntreeAssistant(
      {
        nom: 'Campagne',
        personaId: null,
        scoreMin: '70',
        plafondJour: '30',
        sources: [],
        etapes: [{ ...redige, canal: 'linkedin_invite' }, etape('b', { canal: 'linkedin_message', corps: 'Merci' })],
        relecture: '0',
        boiteIdsDesactivees: new Set(),
        boites: [],
      },
      false,
    );
    expect(() => schemaCreerCampagneComplete.parse(entree)).not.toThrow();
    // Preuve par retrait : l'ancien corps dans une invitation est bien refusé par ce schéma.
    expect(() =>
      schemaCreerCampagneComplete.parse({
        ...schemaCreerCampagneComplete.parse(entree),
        etapes: [{ canal: 'linkedin_invite', sujet: '', corps: 'Bonjour', delaiHeures: 0 }],
      }),
    ).toThrow();
  });
});
