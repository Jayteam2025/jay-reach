import { describe, expect, it } from 'vitest';
import type { SessionLinkedIn } from '@jay-reach/core';
import { ligneMoteurLinkedIn, phraseEtatSession, varianteDetailSession } from './linkedin-session-affichage';

const base: SessionLinkedIn = {
  etat: 'active',
  motif: null,
  connecteeLe: new Date('2026-10-02T09:00:00Z'),
  bloqueeLe: null,
  ipAttendue: '82.65.14.207',
  ipVue: '82.65.14.207',
  operateur: 'Free SAS',
  pays: 'France',
  derniereCollecte: new Date('2026-10-05T10:00:00Z'),
};

const bloquee = (motif: NonNullable<SessionLinkedIn['motif']>): SessionLinkedIn => ({
  ...base,
  etat: 'bloquee',
  motif,
  bloqueeLe: new Date('2026-10-05T11:42:00Z'),
});

// Une seule phrase par session : ce qui empêche réellement de collecter l'emporte sur l'état
// enregistré, jamais deux affirmations concurrentes (même règle que `puceEtatCompteLinkedIn`).
describe('phraseEtatSession', () => {
  it('aucune ligne en base : « absente », ton gris, la commande est proposée', () => {
    expect(phraseEtatSession(null)).toEqual({ ton: 'gris', cle: 'absente', avecCommande: true });
  });

  it('état « absente » : même phrase que l’absence de ligne', () => {
    expect(phraseEtatSession({ ...base, etat: 'absente', connecteeLe: null })).toEqual({
      ton: 'gris',
      cle: 'absente',
      avecCommande: true,
    });
  });

  it('active : « prête », ton bon, aucune commande à coller', () => {
    expect(phraseEtatSession(base)).toEqual({ ton: 'bon', cle: 'prete', avecCommande: false });
  });

  it('bloquée par une vérification (défi) : ton erreur, la commande est proposée', () => {
    expect(phraseEtatSession(bloquee('defi'))).toEqual({ ton: 'erreur', cle: 'defi', avecCommande: true });
  });

  it('bloquée par un cookie refusé : ton erreur, la commande est proposée', () => {
    expect(phraseEtatSession(bloquee('cookie_refuse'))).toEqual({ ton: 'erreur', cle: 'cookieRefuse', avecCommande: true });
  });

  it('bloquée par le disjoncteur : ton erreur, la commande est proposée', () => {
    expect(phraseEtatSession(bloquee('disjoncteur'))).toEqual({ ton: 'erreur', cle: 'disjoncteur', avecCommande: true });
  });

  it('révoquée par l’opérateur : ton gris (c’est son choix), la commande est proposée', () => {
    expect(phraseEtatSession(bloquee('revoquee'))).toEqual({ ton: 'gris', cle: 'revoquee', avecCommande: true });
  });

  it('sortie inattendue : ton erreur, PAS de commande (reconnecter ne corrige pas un proxy qui sort mal)', () => {
    expect(phraseEtatSession(bloquee('sortie_inattendue'))).toEqual({
      ton: 'erreur',
      cle: 'sortieInattendue',
      avecCommande: false,
    });
  });

  it('sortie inattendue l’emporte sur « active » : jamais « prête » à côté d’une sortie suspecte', () => {
    expect(phraseEtatSession({ ...base, etat: 'active', motif: 'sortie_inattendue' })).toEqual({
      ton: 'erreur',
      cle: 'sortieInattendue',
      avecCommande: false,
    });
  });

  it('chaque état rend UNE clé, et deux états différents ne partagent jamais la même', () => {
    const cles = [
      phraseEtatSession(null),
      phraseEtatSession(base),
      phraseEtatSession(bloquee('defi')),
      phraseEtatSession(bloquee('cookie_refuse')),
      phraseEtatSession(bloquee('disjoncteur')),
      phraseEtatSession(bloquee('revoquee')),
      phraseEtatSession(bloquee('sortie_inattendue')),
    ].map((p) => p.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });
});

// La ligne du pied de barre latérale dit l'état par son libellé : le logo, lui, ne change jamais
// de couleur (il n'apparaît donc pas dans ce que la fonction rend).
describe('ligneMoteurLinkedIn', () => {
  it('aucune ligne en base : rien à afficher', () => {
    expect(ligneMoteurLinkedIn(null)).toBeNull();
  });

  it('active : « prêt », ton bon, détail sur la dernière collecte', () => {
    expect(ligneMoteurLinkedIn(base)).toEqual({ ton: 'bon', cleLibelle: 'pret', cleDetail: 'derniereCollecte' });
  });

  it('active, jamais collectée : détail « aucune collecte »', () => {
    expect(ligneMoteurLinkedIn({ ...base, derniereCollecte: null })).toEqual({
      ton: 'bon',
      cleLibelle: 'pret',
      cleDetail: 'aucuneCollecte',
    });
  });

  it('bloquée : « arrêté », ton erreur, détail propre au motif', () => {
    expect(ligneMoteurLinkedIn(bloquee('defi'))).toEqual({ ton: 'erreur', cleLibelle: 'arrete', cleDetail: 'defi' });
    expect(ligneMoteurLinkedIn(bloquee('sortie_inattendue'))).toEqual({
      ton: 'erreur',
      cleLibelle: 'arrete',
      cleDetail: 'sortieInattendue',
    });
  });

  it('sortie inattendue l’emporte sur « active »', () => {
    expect(ligneMoteurLinkedIn({ ...base, etat: 'active', motif: 'sortie_inattendue' })?.cleLibelle).toBe('arrete');
  });

  it('absente : « aucune session », ton gris', () => {
    expect(ligneMoteurLinkedIn({ ...base, etat: 'absente', connecteeLe: null })).toEqual({
      ton: 'gris',
      cleLibelle: 'aucune',
      cleDetail: 'absente',
    });
  });

  it('révoquée par l’opérateur : ton gris, pas rouge', () => {
    expect(ligneMoteurLinkedIn(bloquee('revoquee'))).toEqual({ ton: 'gris', cleLibelle: 'arrete', cleDetail: 'revoquee' });
  });
});

// Le détail change de gabarit quand une donnée manque : jamais « Vue à null » ni « Dernière collecte : ».
describe('varianteDetailSession', () => {
  it('active avec une collecte : gabarit complet', () => {
    expect(varianteDetailSession(base)).toBe('detail');
  });

  it('active sans aucune collecte : gabarit « sans collecte »', () => {
    expect(varianteDetailSession({ ...base, derniereCollecte: null })).toBe('detailSansCollecte');
  });

  it('sortie inattendue avec IP et opérateur : gabarit complet', () => {
    expect(varianteDetailSession(bloquee('sortie_inattendue'))).toBe('detail');
  });

  it('sortie inattendue sans opérateur ni pays : gabarit « sans origine »', () => {
    expect(varianteDetailSession({ ...bloquee('sortie_inattendue'), operateur: null, pays: null })).toBe('detailSansOrigine');
  });

  it('sortie inattendue sans IP relevée : gabarit « sans IP », même si l’opérateur est connu', () => {
    expect(varianteDetailSession({ ...bloquee('sortie_inattendue'), ipVue: null })).toBe('detailSansIp');
  });

  it('les autres états n’ont qu’un gabarit', () => {
    expect(varianteDetailSession(null)).toBe('detail');
    expect(varianteDetailSession(bloquee('defi'))).toBe('detail');
  });
});
