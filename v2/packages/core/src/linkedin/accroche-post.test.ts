/**
 * La partie PURE de la garde d'accroche : ce que le harnais `pg-verify` ne peut pas prouver,
 * parce qu'elle ne dépend d'aucune donnée — la couverture de la liste des exigences, et la
 * dérivation du motif depuis `VARIABLES_DE_POST`.
 *
 * Le comportement SQL, lui, est prouvé sur un vrai Postgres (`test/pg-verify/accroche-post.mjs`,
 * sections 17 à 23) : une assertion sur une chaîne de SQL ne prouverait que la chaîne.
 */
import { describe, expect, it } from 'vitest';
import { VARIABLES_DE_POST } from '../messages/variables.js';
import {
  EXIGENCES_VARIABLE_DE_POST,
  MOTIF_SQL_VARIABLE_DE_POST,
  sqlCampagneEcritVariableDePost,
  sqlFichePostUtilisable,
} from './accroche-post.js';

describe('EXIGENCES_VARIABLE_DE_POST', () => {
  /**
   * Une variable de post SANS exigence serait gardée (la campagne « nomme le post ») mais jamais
   * vérifiée : la personne entrerait en séquence et son action serait bloquée à l'envoi sur une
   * variable manquante, c'est-à-dire le silence que ce lot supprime. Une exigence SANS variable
   * retiendrait, elle, sur un champ que personne n'écrit.
   */
  it('couvre exactement les variables de post, ni plus ni moins', () => {
    expect(new Set(EXIGENCES_VARIABLE_DE_POST.map((e) => e.variable))).toEqual(new Set(VARIABLES_DE_POST));
    expect(EXIGENCES_VARIABLE_DE_POST).toHaveLength(VARIABLES_DE_POST.size);
  });

  /** `post_auteur` lit le nom AFFICHÉ : `author_name` peut valoir un identifiant technique de page. */
  it('post_auteur regarde author_display_name, jamais author_name', () => {
    const exigence = EXIGENCES_VARIABLE_DE_POST.find((e) => e.variable === 'post_auteur');
    const sql = exigence?.colonneRenseignee('fp') ?? '';
    expect(sql).toContain('fp.author_display_name');
    expect(sql).not.toContain('author_name,');
    expect(sql.replace(/author_display_name/g, '')).not.toContain('author_name');
  });

  it('chaque exigence porte sur l’alias qu’on lui donne', () => {
    for (const e of EXIGENCES_VARIABLE_DE_POST) {
      expect(e.colonneRenseignee('abc')).toContain('abc.');
    }
  });
});

describe('MOTIF_SQL_VARIABLE_DE_POST', () => {
  /** Le motif est dérivé de la liste, jamais recopié : une cinquième variable est gardée d’office. */
  it('nomme chacune des variables de post', () => {
    for (const nom of VARIABLES_DE_POST) expect(MOTIF_SQL_VARIABLE_DE_POST).toContain(nom);
  });

  /**
   * Le motif Postgres et le jeton JS doivent reconnaître les mêmes écritures. Vérifié par une
   * traduction minimale (Postgres comprend `\\s`, `\\{`, `\\|` comme JavaScript ici) : ce n’est
   * pas Postgres qui tourne, c’est la FORME du motif qu’on éprouve.
   */
  it('reconnaît les écritures tolérées, et pas une variable qui n’en est pas une', () => {
    const re = new RegExp(MOTIF_SQL_VARIABLE_DE_POST, 'i');
    expect(re.test('bonjour {{post_auteur}}')).toBe(true);
    expect(re.test('{{ post_sujet }}')).toBe(true);
    expect(re.test('{{post_url|https://exemple.fr}}')).toBe(true);
    expect(re.test('{{POST_DATE}}')).toBe(true);
    expect(re.test('{{prenom}} {{entreprise}}')).toBe(false);
    expect(re.test('post_auteur sans accolades')).toBe(false);
  });
});

describe('sqlFichePostUtilisable', () => {
  /**
   * La garde n’exige QUE les variables écrites : chaque exigence est donc gardée par la question
   * « la campagne écrit-elle cette variable ? ». Sans cette condition, une campagne qui ne cite
   * que `{{post_url}}` attendrait un auteur affiché et un sujet qu’elle n’écrit pas.
   */
  it('subordonne chaque exigence à la variable correspondante', () => {
    const sql = sqlFichePostUtilisable('c.id', 's');
    for (const e of EXIGENCES_VARIABLE_DE_POST) {
      expect(sql).toContain(`not ${sqlCampagneEcritVariableDePost('c.id', e.variable)}`);
      expect(sql).toContain(e.colonneRenseignee('fp_ap'));
    }
  });

  it('exige la relecture humaine, quelles que soient les variables écrites', () => {
    expect(sqlFichePostUtilisable('c.id', 's')).toContain("review_status = 'approved'");
  });

  it('filtre la fiche par organisation : celle d’une autre organisation ne vaut rien', () => {
    expect(sqlFichePostUtilisable('c.id', 's')).toContain('fp_ap.organization_id = s.organization_id');
  });
});
