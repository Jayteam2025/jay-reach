/**
 * Annotation de la marche « Emails partis » de l'entonnoir de campagne (F13,
 * décision du 18/09). `tauxLivres` (le pourcentage affiché juste avant) se
 * lit sur les emails ENGAGÉS (remis + réellement partis, `EntonnoirCommun.
 * enAttenteEnvoi`), pas sur la marche du dessus — sans le dire, rien
 * n'indique au lecteur de quoi ce pourcentage est la part. Le complément
 * (« N en attente d'envoi ») le dit dans le vocabulaire déjà fixé ailleurs,
 * jamais le mot « engagés » qui n'existe nulle part à l'écran (décision du
 * coordinateur, pas la mienne : « engagés » nous est propre).
 *
 * Absente quand le complément est nul : une campagne où tout est réellement
 * parti ne doit pas afficher « 0 en attente d'envoi ». Extrait en fonction
 * pure (testable) — seule cette marche est annotée ainsi, « Réponses » se
 * lit par convention comme la part de la marche précédente, ce qui reste
 * juste (décision du coordinateur).
 */
export function tauxLivresAffiche(
  pourcentage: string,
  enAttenteEnvoi: number,
  t: (cle: string, valeurs: { n: number }) => string,
): string {
  return enAttenteEnvoi > 0 ? `${pourcentage} ${t('overview.funnel.awaitingSendSuffix', { n: enAttenteEnvoi })}` : pourcentage;
}
