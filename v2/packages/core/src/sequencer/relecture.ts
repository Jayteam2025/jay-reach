/**
 * Relecture des premiers envois d'une étape (spec lot 2, réglage
 * `campaigns.entry_rules.relecturePremiersEnvois` / défaut d'organisation
 * `relecture_premiers_envois_defaut`) — I2, revue finale du 17/09 : le
 * réglage s'écrivait dans les trois écrans concernés sans jamais être lu par
 * le tick, qui ne décidait la relecture que via `approval_policy`. Pure :
 * le worker compte les envois déjà partis pour l'étape et fournit le seuil
 * déjà résolu (campagne, sinon défaut d'organisation).
 */
export interface RelectureRequiseInput {
  /** Nombre des premiers envois de l'étape soumis à relecture. 0 = tout part sans relecture. */
  readonly seuil: number;
  /** Nombre d'actions de CETTE étape déjà réellement parties (dispatched/delivered). */
  readonly dejaPartis: number;
}

/** Cette action doit-elle passer par la File du jour (`pending_approval`) avant de partir ? */
export function relectureRequise({ seuil, dejaPartis }: RelectureRequiseInput): boolean {
  return seuil > 0 && dejaPartis < seuil;
}
