import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionLinkedIn } from '@jay-reach/core';
import { ligneMoteurLinkedIn, phraseEtatEnvoi, phraseEtatSession, varianteDetailSession, type CleEtatEnvoi, type CleEtatSession } from './linkedin-session-affichage';

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
  envoiPauseJusqua: null,
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
  it('aucune ligne en base : la ligne est AFFICHÉE, « aucune session », ton gris (le canal ne disparaît pas)', () => {
    expect(ligneMoteurLinkedIn(null)).toEqual({ ton: 'gris', cleLibelle: 'aucune', cleDetail: 'absente' });
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
    expect(ligneMoteurLinkedIn({ ...base, etat: 'active', motif: 'sortie_inattendue' }).cleLibelle).toBe('arrete');
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

// Une clé absente du catalogue afficherait son chemin brut à l'écran, et le garde-fou des clés ne
// voit pas les clés construites (`etat.${cle}.${variante}`) : on les énumère ici contre fr.json.
describe('clés de traduction construites dynamiquement', () => {
  const fr = JSON.parse(
    readFileSync(join(__dirname, '../../../../packages/i18n/src/messages/fr.json'), 'utf8'),
  ) as Record<string, Record<string, Record<string, unknown>>>;
  const lire = (chemin: string): unknown => chemin.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], fr);

  const CLES: CleEtatSession[] = ['absente', 'prete', 'defi', 'cookieRefuse', 'disjoncteur', 'revoquee', 'sortieInattendue'];
  const VARIANTES = ['detail', 'detailSansCollecte', 'detailSansOrigine', 'detailSansIp'] as const;

  it.each(CLES)('reglages.linkedin.etat.%s a sa phrase et son détail', (cle) => {
    expect(typeof lire(`reglages.linkedin.etat.${cle}.phrase`)).toBe('string');
    expect(typeof lire(`reglages.linkedin.etat.${cle}.detail`)).toBe('string');
  });

  it('chaque variante que varianteDetailSession peut rendre existe pour la clé qui l’emploie', () => {
    const cas: Array<[SessionLinkedIn | null, CleEtatSession]> = [
      [base, 'prete'],
      [{ ...base, derniereCollecte: null }, 'prete'],
      [bloquee('sortie_inattendue'), 'sortieInattendue'],
      [{ ...bloquee('sortie_inattendue'), operateur: null, pays: null }, 'sortieInattendue'],
      [{ ...bloquee('sortie_inattendue'), ipVue: null }, 'sortieInattendue'],
      [null, 'absente'],
      [bloquee('defi'), 'defi'],
    ];
    for (const [session, cle] of cas) {
      const variante = varianteDetailSession(session);
      expect(VARIANTES).toContain(variante);
      expect(typeof lire(`reglages.linkedin.etat.${cle}.${variante}`), `${cle}.${variante}`).toBe('string');
    }
  });

  it.each([
    ['pret', 'aucuneCollecte'],
    ['arrete', 'defi'],
    ['aucune', 'absente'],
  ])('coquille.linkedin.libelle.%s existe', (libelle) => {
    expect(typeof lire(`coquille.linkedin.libelle.${libelle}`)).toBe('string');
  });

  it.each(['derniereCollecte', 'aucuneCollecte', 'absente', ...CLES.filter((c) => c !== 'absente' && c !== 'prete')])(
    'coquille.linkedin.detail.%s existe',
    (detail) => {
      expect(typeof lire(`coquille.linkedin.detail.${detail}`)).toBe('string');
    },
  );

  it.each(['collectNowDraft', 'collectNowUnsaved', 'collectNowInactive', 'collectNowPaused'])(
    'campagne.sources.drawer.%s existe (clé d’aide de « Collecter maintenant »)',
    (cle) => {
      expect(typeof lire(`campagne.sources.drawer.${cle}`)).toBe('string');
    },
  );
});

// Le canal d'envoi est un SECOND fait sur le même écran. Il ne doit jamais contredire la
// phrase de session au-dessus de lui : d'où la hiérarchie, vérifiée ici cas par cas.
describe('phraseEtatEnvoi', () => {
  const MAINTENANT = new Date('2026-10-07T14:00:00Z');

  it('session prête, aucune pause : prêt à envoyer', () => {
    expect(phraseEtatEnvoi(base, MAINTENANT)).toEqual({ ton: 'bon', cle: 'pret' });
  });

  it('session prête, pause encore à venir : en pause, ton attention', () => {
    const session = { ...base, envoiPauseJusqua: new Date('2026-10-08T07:00:00Z') };
    expect(phraseEtatEnvoi(session, MAINTENANT)).toEqual({ ton: 'attention', cle: 'enPause' });
  });

  it('session prête, pause échue : de nouveau prêt', () => {
    const session = { ...base, envoiPauseJusqua: new Date('2026-10-07T13:59:59Z') };
    expect(phraseEtatEnvoi(session, MAINTENANT)).toEqual({ ton: 'bon', cle: 'pret' });
  });

  it('aucune session : la conséquence, en ton neutre — la raison est déjà dite au-dessus', () => {
    expect(phraseEtatEnvoi(null, MAINTENANT)).toEqual({ ton: 'gris', cle: 'sessionRequise' });
  });

  // Le cas qui justifie la hiérarchie : LinkedIn a réclamé une vérification APRÈS avoir
  // renvoyé un 429, donc la ligne porte les deux. Afficher « en pause jusqu'à 7 h » ferait
  // croire que l'envoi repart tout seul demain matin, alors qu'il faut rouvrir la session
  // à la main. La session l'emporte, toujours.
  it('session bloquée ET pause posée : la session l emporte, jamais « en pause »', () => {
    const session = { ...bloquee('defi'), envoiPauseJusqua: new Date('2026-10-08T07:00:00Z') };
    expect(phraseEtatEnvoi(session, MAINTENANT)).toEqual({ ton: 'gris', cle: 'sessionRequise' });
  });

  it('sortie inattendue ET pause posée : la sortie l emporte aussi', () => {
    const session = { ...bloquee('sortie_inattendue'), envoiPauseJusqua: new Date('2026-10-08T07:00:00Z') };
    expect(phraseEtatEnvoi(session, MAINTENANT)).toEqual({ ton: 'gris', cle: 'sessionRequise' });
  });
});

describe('clés de traduction du canal d envoi', () => {
  const LANGUES = ['fr', 'en', 'nl'] as const;
  const CLES: CleEtatEnvoi[] = ['pret', 'enPause', 'sessionRequise'];

  it.each(LANGUES)('%s : chaque état a sa phrase, et la pause nomme sa date', (langue) => {
    const messages = JSON.parse(
      readFileSync(join(__dirname, `../../../../packages/i18n/src/messages/${langue}.json`), 'utf8'),
    ) as Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>>;
    const envoi = messages.reglages.linkedin.envoi;
    for (const cle of CLES) {
      expect(typeof envoi[cle].phrase, `${langue} > ${cle}`).toBe('string');
    }
    // Une pause sans échéance ne dit pas à l'opérateur quand revenir.
    expect(String(envoi.enPause.phrase), `${langue} > enPause`).toContain('{quand}');
    expect(typeof envoi.volume, `${langue} > volume`).toBe('string');
    expect(typeof envoi.volumeLien, `${langue} > volumeLien`).toBe('string');
  });
});
