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
import { sansRepliVide } from '../fonctions/posts.js';
import {
  retenuesAAfficher,
  type RetenuesParPost,
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
    expect(re.test('{{POST_DATE}}')).toBe(true);
    expect(re.test('{{prenom}} {{entreprise}}')).toBe(false);
    expect(re.test('post_auteur sans accolades')).toBe(false);
  });

  /**
   * Un repli ne dispense PAS de faire relire le post. « j'ai vu votre réaction à ce post :
   * {{post_url|https://www.linkedin.com/feed/}} » envoie l'adresse RÉELLE du post — `url` est
   * renseignée dès la création de la fiche, le repli ne sert jamais — et il suffirait pourtant à
   * désactiver toute la relecture humaine sans que l'opérateur le sache.
   */
  it('reconnaît une variable de post ÉCRITE AVEC UN REPLI : la relecture reste exigée', () => {
    const re = new RegExp(MOTIF_SQL_VARIABLE_DE_POST, 'i');
    expect(re.test('à ce post : {{post_url|https://www.linkedin.com/feed/}}')).toBe(true);
    expect(re.test('{{ post_date | le 12 octobre }}')).toBe(true);
  });
});

/**
 * L'autre question : ce qu'il faut EXIGER de la fiche. Là, un repli dispense — la variable se
 * résout, le message part, et retenir la personne gèlerait indéfiniment un envoi correct.
 */
describe('sqlCampagneEcritVariableDePost', () => {
  /** Ce que le motif de CETTE question reconnaît, lu comme une expression régulière. */
  const ecrit = (corps: string, variable = 'post_date'): boolean => {
    const sql = sqlCampagneEcritVariableDePost('$1::uuid', variable);
    const motif = /~\* '([^']+)'/.exec(sql)?.[1] ?? '';
    return new RegExp(motif, 'i').test(corps);
  };

  it('une variable à repli n’est pas « écrite » : rien n’est exigé de la fiche', () => {
    expect(ecrit('{{post_date}}')).toBe(true);
    expect(ecrit('{{ POST_DATE }}')).toBe(true);
    expect(ecrit('{{post_date|le 12 octobre}}')).toBe(false);
    expect(ecrit('{{ post_date | le 12 octobre }}')).toBe(false);
    // Écrite des DEUX façons, elle reste écrite : l’une des deux partira sans repli.
    expect(ecrit('{{post_date|le 12 octobre}} puis {{post_date}}')).toBe(true);
  });

  /**
   * Un repli VIDE n'est pas un repli : `renderTemplate` rendrait une chaîne vide, donc un blanc
   * dans un envoi, ce que le dépôt interdit. Il se lit comme une absence de repli — et l'écran
   * doit le lire pareil, sans quoi il afficherait le trou et compterait la ligne validable.
   */
  it('un repli VIDE se lit comme une absence de repli, des deux côtés', () => {
    for (const corps of ['{{post_date|}}', '{{ post_date |  }}']) {
      expect(ecrit(corps)).toBe(true);
      expect(sansRepliVide(corps)).toMatch(/^\{\{\s*post_date\s*\}\}$/);
    }
    // Un repli RÉEL, lui, n'est pas touché par la normalisation de l'écran.
    expect(sansRepliVide('{{post_date|le 12 octobre}}')).toBe('{{post_date|le 12 octobre}}');
  });

  /** Les deux lectures doivent rester jumelles : même verdict sur les mêmes écritures. */
  it('la lecture de l’écran et celle de la garde s’accordent', () => {
    for (const corps of ['{{post_date}}', '{{post_date|}}', '{{ post_date | }}', '{{post_date|le 12 octobre}}', '{{post_date| x}}']) {
      // L'écran « voit » la variable à compléter quand le jeton survit à la normalisation sans repli.
      const vuParLEcran = /\{\{\s*post_date\s*\}\}/i.test(sansRepliVide(corps));
      expect(vuParLEcran).toBe(ecrit(corps));
    }
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

/**
 * Le quantificateur du moteur reporté sur l'écran. La tâche qui l'a posé pour la garde, le gel et
 * l'épargne ne l'avait pas reporté sur l'affichage : l'écran annonçait une rétention et une date
 * d'effacement qui ne valaient pas pour la campagne regardée.
 */
describe('ce que l\'écran a le droit d\'affirmer', () => {
  const retenues: RetenuesParPost = {
    nommeUnPost: true,
    aUneSourceDePost: false,
    enAttenteDeValidation: 106,
    sansPost: 12,
    postInexploitable: 4,
  };

  it('dit tout ce que la garde retient quand la campagne nomme le post', () => {
    expect(retenuesAAfficher(retenues)).toEqual({
      sansSource: true,
      sansPost: 12,
      postInexploitable: 4,
      enAttenteDeValidation: 106,
      echeances: true,
      relecture: true,
    });
  });

  it('n\'affirme RIEN quand la campagne ne nomme aucun post : rien n\'est retenu, rien n\'est épargné', () => {
    expect(retenuesAAfficher({ ...retenues, nommeUnPost: false })).toEqual({
      sansSource: false,
      sansPost: 0,
      postInexploitable: 0,
      enAttenteDeValidation: 0,
      echeances: false,
      // Le travail de relecture ne s'annonce pas non plus : « N posts attendent votre relecture »
      // enverrait l'opérateur valider des posts qui ne débloquent personne.
      relecture: false,
    });
  });

  it('ne signale la source manquante que lorsqu\'il y en a vraiment une à brancher', () => {
    expect(retenuesAAfficher({ ...retenues, aUneSourceDePost: true }).sansSource).toBe(false);
  });
});
