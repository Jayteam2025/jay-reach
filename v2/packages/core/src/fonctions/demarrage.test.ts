import { describe, expect, it } from 'vitest';
import { alertesSansDoublonDemarrage, lireDemarrage, type Demarrage } from './demarrage.js';
import type { Alerte } from './aujourdhui.js';
import type { Contexte } from './contexte.js';

/**
 * Le SQL lui-même est éprouvé contre une vraie base par `test/pg-verify/demarrage.sh` : un pool
 * factice ne prouve rien d'une requête. Ces tests-ci portent sur la LECTURE des comptes — ce qui
 * compte comme fait, ce qui compte comme cassé, et quand le bloc s'efface.
 */
function contexte(ligne: Record<string, unknown>): Contexte {
  return {
    organisationId: 'org-1',
    role: 'admin',
    ex: { query: async () => ({ rows: [ligne] }) },
  } as unknown as Contexte;
}

const toutBranche = {
  cles: 7,
  boites: 3,
  personas: 2,
  linkedin_statut: 'active',
  linkedin_motif: null,
  sources: 2,
  campagnes: 1,
};

describe('la liste de démarrage', () => {
  it('neuve, elle ne coche rien et compte zéro sur six', async () => {
    const d = await lireDemarrage(
      contexte({ cles: 0, boites: 0, personas: 0, linkedin_statut: null, linkedin_motif: null, sources: 0, campagnes: 0 }),
    );
    expect(d.faites).toBe(0);
    expect(d.total).toBe(6);
    expect(d.terminee).toBe(false);
    expect(d.lignes.every((l) => !l.faite && !l.casse)).toBe(true);
  });

  it('tout branché, elle se déclare terminée — l’écran ne l’affichera plus', async () => {
    const d = await lireDemarrage(contexte(toutBranche));
    expect(d.faites).toBe(6);
    expect(d.terminee).toBe(true);
  });

  it('elle rend les comptes mesurés, jamais un chiffre inventé', async () => {
    const d = await lireDemarrage(contexte(toutBranche));
    const par = Object.fromEntries(d.lignes.map((l) => [l.cle, l.compte]));
    expect(par.fournisseurs).toBe(7);
    expect(par.boites).toBe(3);
    expect(par.persona).toBe(2);
    expect(par.source).toBe(2);
    expect(par.campagne).toBe(1);
    // Le compte LinkedIn est unique par instance : il ne se compte pas, il est là ou il n'est pas.
    expect(par.linkedin).toBeNull();
  });

  // C'est ce qui distingue un diagnostic d'un tutoriel : une session branchée puis bloquée n'est
  // pas la même chose qu'une session jamais branchée, et la ligne doit le dire.
  it('une session LinkedIn bloquée est cassée, pas « jamais branchée »', async () => {
    const d = await lireDemarrage(
      contexte({ ...toutBranche, linkedin_statut: 'bloquee', linkedin_motif: 'defi' }),
    );
    const li = d.lignes.find((l) => l.cle === 'linkedin');
    expect(li?.faite).toBe(false);
    expect(li?.casse).toBe(true);
    expect(d.terminee).toBe(false);
  });

  // Une déconnexion volontaire n'est pas une panne : l'accueil ne doit pas annoncer « un
  // branchement a lâché » parce que l'opérateur vient de cliquer « Déconnecter ».
  it('une session révoquée à la demande n’est pas annoncée comme cassée', async () => {
    // L'état réel qu'écrit `bloquerSessionLinkedIn` : le statut vaut `bloquee` comme pour une
    // panne, et seul le motif dit que c'est un choix. Un test sur un statut `revoquee` passerait
    // en prouvant le contraire de la vérité — la contrainte du schéma l'interdit.
    const d = await lireDemarrage(
      contexte({ ...toutBranche, linkedin_statut: 'bloquee', linkedin_motif: 'revoquee' }),
    );
    const li = d.lignes.find((l) => l.cle === 'linkedin');
    expect(li?.faite).toBe(false);
    expect(li?.casse).toBe(false);
  });

  it('une session jamais ouverte n’est pas cassée, elle est seulement à faire', async () => {
    const d = await lireDemarrage(contexte({ ...toutBranche, linkedin_statut: null, linkedin_motif: null }));
    const li = d.lignes.find((l) => l.cle === 'linkedin');
    expect(li?.faite).toBe(false);
    expect(li?.casse).toBe(false);
  });

  it('une campagne en pause ou archivée ne compte pas comme lancée', async () => {
    const d = await lireDemarrage(contexte({ ...toutBranche, campagnes: 0 }));
    expect(d.lignes.find((l) => l.cle === 'campagne')?.faite).toBe(false);
    expect(d.terminee).toBe(false);
  });
});

describe('la subordination des alertes', () => {
  const alertes: Alerte[] = [
    { type: 'canal_sans_expediteur', texte: 'Aucun message LinkedIn ne peut partir.', lien: '/settings/senders' },
    { type: 'pause_envoi', texte: 'Les envois sont en pause.', lien: '/settings/engine' },
  ];
  const visible = { terminee: false } as Demarrage;
  const effacee = { terminee: true } as Demarrage;

  // Deux fois la même phrase au même endroit, et on cesse de les lire : c'est ainsi qu'une
  // alerte vraie finit par être ignorée.
  it('tant que la liste est à l’écran, l’alerte qui redirait sa ligne LinkedIn s’efface', () => {
    const gardees = alertesSansDoublonDemarrage(alertes, visible);
    expect(gardees.map((a) => a.type)).toEqual(['pause_envoi']);
  });

  it('une fois la liste disparue, l’alerte reprend son rôle', () => {
    const gardees = alertesSansDoublonDemarrage(alertes, effacee);
    expect(gardees).toHaveLength(2);
  });

  it('elle ne touche à aucune autre alerte', () => {
    const autres: Alerte[] = [{ type: 'moteur_silencieux', texte: 'x', lien: '/' }];
    expect(alertesSansDoublonDemarrage(autres, visible)).toEqual(autres);
  });
});
