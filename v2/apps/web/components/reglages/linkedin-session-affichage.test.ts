import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProchainEnvoi, SessionLinkedIn } from '@jay-reach/core';
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

// Le canal d'envoi est un SECOND fait sur le même écran, et il ne doit jamais contredire la
// phrase de session au-dessus. Il ne devine rien non plus : il traduit le verdict de
// `prochainEnvoiLinkedIn`, la fonction qui décide réellement quand le moteur enverra.
describe('phraseEtatEnvoi', () => {
  const MAINTENANT = new Date('2026-10-07T14:00:00Z');
  const creneau = (quand: Date): ProchainEnvoi => ({ quand, motif: null, raison: 'envoi' });
  // PAS de `as` ici : c'est un `as` qui a laissé passer `hors_fenetre` et `cap_7_days`, deux
  // motifs qui n'existent pas. Le paramètre est typé par le cœur, donc un nom inventé ne
  // compile plus — et le test redevient la garde qu'il prétendait être.
  const refus = (motif: Exclude<ProchainEnvoi['motif'], null>): ProchainEnvoi => ({ quand: null, motif });

  it('créneau déjà échu : prêt à envoyer', () => {
    expect(phraseEtatEnvoi(base, creneau(MAINTENANT), MAINTENANT)).toEqual({ ton: 'bon', cle: 'pret' });
  });

  it('créneau à venir : annoncé, pas présenté comme prêt', () => {
    expect(phraseEtatEnvoi(base, creneau(new Date('2026-10-07T14:12:00Z')), MAINTENANT)).toEqual({
      ton: 'bon',
      cle: 'planifie',
    });
  });

  // Une ligne restée en cours fait rendre `{quand: maintenant}` par le moteur, pour qu'il passe
  // la réparer. Sans le drapeau `reprise`, l'écran disait « Prêt à envoyer » un dimanche à 3 h.
  it('reprise d une ligne coincée : jamais « prêt à envoyer »', () => {
    expect(phraseEtatEnvoi(base, { quand: MAINTENANT, motif: null, raison: 'reparation' }, MAINTENANT)).toEqual({
      ton: 'attention',
      cle: 'reprise',
    });
  });

  it('canal en pause : ton attention', () => {
    expect(phraseEtatEnvoi(base, refus('canal_en_pause'), MAINTENANT)).toEqual({ ton: 'attention', cle: 'enPause' });
  });

  it('file vide : rien à envoyer, et ce n est pas une alerte', () => {
    expect(phraseEtatEnvoi(base, refus('file_vide'), MAINTENANT)).toEqual({ ton: 'bon', cle: 'rienAEnvoyer' });
  });

  // « rien dans la file » serait faux : une action est partie et n'a pas encore rendu la main.
  it('une action en vol se dit comme telle, pas comme une file vide', () => {
    expect(phraseEtatEnvoi(base, refus('action_en_cours'), MAINTENANT)).toEqual({ ton: 'bon', cle: 'enVol' });
  });

  // Le défaut que cette refonte corrige : la nuit, le week-end et plafond atteint, la première
  // version affichait « Prêt à envoyer » — soit la majorité des heures de la semaine. Et chaque
  // motif a sa phrase : « hors fenêtre » et « plafond atteint » n'appellent pas la même action.
  it('hors fenêtre horaire ou jour non coché : son propre libellé', () => {
    expect(phraseEtatEnvoi(base, refus('outside_window'), MAINTENANT)).toEqual({
      ton: 'attention',
      cle: 'horsFenetre',
    });
  });

  it.each(['daily_cap_reached', 'weekly_cap_reached'] as const)('plafond atteint (%s) : son propre libellé', (motif) => {
    expect(phraseEtatEnvoi(base, refus(motif), MAINTENANT)).toEqual({ ton: 'attention', cle: 'plafondAtteint' });
  });

  // En mode manuel, des actions ATTENDENT et ne partiront jamais : « aucune action en attente »,
  // en vert, serait doublement faux. L'état est impossible en base depuis la migration
  // 20260831160000, la branche existe par précaution des deux côtés.
  it('mode manuel : canal bloqué, jamais « rien à envoyer »', () => {
    expect(phraseEtatEnvoi(base, refus('manual_mode'), MAINTENANT)).toEqual({ ton: 'gris', cle: 'canalBloque' });
  });

  it('aucune session : la conséquence, en ton neutre — la raison est déjà dite au-dessus', () => {
    expect(phraseEtatEnvoi(null, refus('session_inactive'), MAINTENANT)).toEqual({ ton: 'gris', cle: 'canalBloque' });
  });

  // La session l'emporte sur tout verdict de rythme : LinkedIn a réclamé une vérification, et
  // afficher un créneau ferait croire que l'envoi repart tout seul.
  it('session bloquée : la session l emporte, même avec un créneau calculé', () => {
    expect(phraseEtatEnvoi(bloquee('defi'), creneau(MAINTENANT), MAINTENANT)).toEqual({ ton: 'gris', cle: 'canalBloque' });
  });

  // `sortie_inattendue` : la session EST ouverte, c'est la sortie réseau qui ne l'est pas. Le
  // libellé ne doit donc pas parler de session, sinon il contredit la ligne du dessus.
  it('sortie inattendue : canal bloqué, sans nommer la session', () => {
    expect(phraseEtatEnvoi(bloquee('sortie_inattendue'), creneau(MAINTENANT), MAINTENANT)).toEqual({
      ton: 'gris',
      cle: 'canalBloque',
    });
  });
});

describe('clés de traduction du canal d envoi', () => {
  const LANGUES = ['fr', 'en', 'nl'] as const;
  const CLES: CleEtatEnvoi[] = ['pret', 'planifie', 'reprise', 'enPause', 'rienAEnvoyer', 'enVol', 'horsFenetre', 'plafondAtteint', 'canalBloque'];

  it.each(LANGUES)('%s : chaque état a sa phrase, et la pause nomme sa date', (langue) => {
    type BlocEnvoi = Record<string, { phrase?: string } | string | undefined>;
    const messages = JSON.parse(
      readFileSync(join(__dirname, `../../../../packages/i18n/src/messages/${langue}.json`), 'utf8'),
    ) as { reglages?: { linkedin?: { envoi?: BlocEnvoi } } };
    const envoi = messages.reglages?.linkedin?.envoi ?? {};
    for (const cle of CLES) {
      expect(typeof (envoi[cle] as { phrase?: string } | undefined)?.phrase, `${langue} > ${cle}`).toBe('string');
    }
    // Une pause sans échéance ne dit pas à l'opérateur quand revenir.
    // Une pause ou un créneau sans date ne dit pas à l'opérateur quand revenir.
    for (const cle of ['enPause', 'planifie'] as const) {
      expect(String((envoi[cle] as { phrase?: string } | undefined)?.phrase), `${langue} > ${cle}`).toContain('{quand}');
    }
  });
});
