import { describe, it, expect, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { echeanceEtapeSuivante } from './scheduling.js';
import { poserEcheanceApresDepart, poserEcheanceDepuisDispatch } from './echeance.js';

const ENROLLMENT_ID = 'enrollment-1';
const CAMPAIGN_ID = 'campagne-1';

interface Reponse {
  readonly rows: unknown[];
  readonly rowCount: number;
}

interface Appel {
  readonly sql: string;
  readonly values: unknown[];
}

interface Gestionnaire {
  readonly motif: RegExp;
  readonly repondre: (values: unknown[]) => Reponse;
}

function ligne(rows: unknown[] = []): Reponse {
  return { rows, rowCount: rows.length };
}

/** Exécuteur factice (contrat `Executeur`, pas `pg`) : dispatché par motif de SQL. */
function creerExecuteurFactice(gestionnaires: Gestionnaire[]): { ex: Executeur; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    appels.push({ sql, values });
    const trouve = gestionnaires.find((g) => g.motif.test(sql));
    if (!trouve) {
      throw new Error(`requete non prevue par le test :\n${sql}`);
    }
    return trouve.repondre(values);
  });
  return { ex: { query } as unknown as Executeur, appels };
}

// Rang ordinal, pas `position` (issue #115) : lecture par `offset`/`limit`,
// jamais par égalité de valeur.
const DELAI_ETAPE_SUIVANTE = /select delay_hours from sequence_steps\s+where campaign_id = \$1\s+order by position asc\s+offset \$2\s+limit 1/i;
const POSE_ECHEANCE = /update enrollments\s+set next_action_at = \$2\s+where id = \$1/i;

describe('poserEcheanceApresDepart (issue #111)', () => {
  const MAINTENANT = new Date('2026-09-17T10:04:00.000Z');

  it('étape suivante trouvée : pose l’échéance avec le même jitter/graine que le core, renvoie true', async () => {
    const { ex, appels } = creerExecuteurFactice([
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 120 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);

    const ecrit = await poserEcheanceApresDepart(ex, { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 2 }, MAINTENANT);

    expect(ecrit).toBe(true);
    const requeteDelai = appels.find((a) => DELAI_ETAPE_SUIVANTE.test(a.sql));
    expect(requeteDelai).toBeDefined();
    // `currentStep` (rang ordinal) est passé tel quel comme `offset` : la
    // requête cherche le N-ième `delay_hours` par ordre de position, pas la
    // ligne dont `position = 2`.
    expect(requeteDelai!.values).toEqual([CAMPAIGN_ID, 2]);

    const pose = appels.find((a) => POSE_ECHEANCE.test(a.sql));
    expect(pose).toBeDefined();
    const attendu = echeanceEtapeSuivante(MAINTENANT.getTime(), ENROLLMENT_ID, 120);
    expect(pose!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);
    // Garde : jamais posée sur une inscription déjà repartie ailleurs.
    expect(pose!.sql).toMatch(/status = 'active'/i);
    expect(pose!.sql).toMatch(/next_action_at is null/i);
    expect(pose!.sql).toMatch(/current_step = \$3/i);
  });

  it('positions non contiguës (0, 10, 20) : le délai lu est celui du bon RANG, pas de la valeur `position` (issue #115)', async () => {
    // Une séquence dont les `position` valent 0, 10, 20 (déplacements,
    // suppressions d'étapes intermédiaires...) : le rang ordinal de l'étape 2
    // (troisième étape, `currentStep = 2`) doit lire son `delay_hours` par
    // OFFSET 2, jamais en cherchant `position = 2` (qui n'existe pas).
    const { ex, appels } = creerExecuteurFactice([
      {
        motif: DELAI_ETAPE_SUIVANTE,
        repondre: (values) => {
          const offset = values[1] as number;
          const parRang = [{ delay_hours: 0 }, { delay_hours: 48 }, { delay_hours: 168 }];
          return ligne(parRang[offset] ? [parRang[offset]] : []);
        },
      },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);

    await poserEcheanceApresDepart(ex, { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 2 }, MAINTENANT);

    const pose = appels.find((a) => POSE_ECHEANCE.test(a.sql));
    expect(pose).toBeDefined();
    const attendu = echeanceEtapeSuivante(MAINTENANT.getTime(), ENROLLMENT_ID, 168); // rang 2 -> delay_hours 168
    expect(pose!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);
  });

  it('dernière étape (aucune ligne trouvée en base) : n’écrit rien, renvoie false', async () => {
    const { ex, appels } = creerExecuteurFactice([{ motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([]) }]);

    const ecrit = await poserEcheanceApresDepart(ex, { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 5 }, MAINTENANT);

    expect(ecrit).toBe(false);
    expect(appels).toHaveLength(1); // seule la lecture du délai, aucune écriture
  });

  it('garde SQL respectée (inscription déjà repartie ailleurs) : renvoie false même avec une étape suivante', async () => {
    const { ex } = creerExecuteurFactice([
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 24 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 0 }) }, // garde SQL : 0 ligne affectée
    ]);

    const ecrit = await poserEcheanceApresDepart(ex, { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 1 }, MAINTENANT);

    expect(ecrit).toBe(false);
  });
});

describe('poserEcheanceDepuisDispatch (rattrapage, tour de correction 1)', () => {
  const PARAMS = { enrollmentId: ENROLLMENT_ID, campaignId: CAMPAIGN_ID, currentStep: 2 } as const;

  it('dispatched_at en objet `Date` (forme réelle renvoyée par `pg`) : pose l’échéance depuis CET instant, pas `now`', async () => {
    const dispatchedAt = new Date('2026-09-10T10:04:00.000Z'); // « J », pas « maintenant »
    const { ex, appels } = creerExecuteurFactice([
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 120 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);

    const ecrit = await poserEcheanceDepuisDispatch(ex, PARAMS, dispatchedAt);

    expect(ecrit).toBe(true);
    const pose = appels.find((a) => POSE_ECHEANCE.test(a.sql));
    const attendu = echeanceEtapeSuivante(dispatchedAt.getTime(), ENROLLMENT_ID, 120);
    expect(pose!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);
  });

  it('dispatched_at en chaîne ISO : même résultat qu’en `Date` (`versInstant` accepte les deux)', async () => {
    const dispatchedAtIso = '2026-09-10T10:04:00.000Z';
    const { ex: exDate } = creerExecuteurFactice([
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 120 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);
    const { ex: exChaine, appels: appelsChaine } = creerExecuteurFactice([
      { motif: DELAI_ETAPE_SUIVANTE, repondre: () => ligne([{ delay_hours: 120 }]) },
      { motif: POSE_ECHEANCE, repondre: () => ({ rows: [], rowCount: 1 }) },
    ]);

    await poserEcheanceDepuisDispatch(exDate, PARAMS, new Date(dispatchedAtIso));
    await poserEcheanceDepuisDispatch(exChaine, PARAMS, dispatchedAtIso);

    const poseChaine = appelsChaine.find((a) => POSE_ECHEANCE.test(a.sql));
    const attendu = echeanceEtapeSuivante(new Date(dispatchedAtIso).getTime(), ENROLLMENT_ID, 120);
    expect(poseChaine!.values).toEqual([ENROLLMENT_ID, new Date(attendu!).toISOString(), 2]);
  });

  it('dispatched_at absent ou invalide : `false` sans la moindre requête (jamais d’échéance depuis un instant inventé)', async () => {
    const { ex: exNull, appels: appelsNull } = creerExecuteurFactice([]);
    const { ex: exInvalide, appels: appelsInvalide } = creerExecuteurFactice([]);

    const ecritNull = await poserEcheanceDepuisDispatch(exNull, PARAMS, null);
    const ecritInvalide = await poserEcheanceDepuisDispatch(exInvalide, PARAMS, 'pas-une-date');

    expect(ecritNull).toBe(false);
    expect(ecritInvalide).toBe(false);
    expect(appelsNull).toHaveLength(0);
    expect(appelsInvalide).toHaveLength(0);
  });
});
