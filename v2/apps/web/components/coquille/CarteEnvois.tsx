import { BarreProgression } from '../ui';

export interface CarteEnvoisProps {
  libelle: string;
  /** Emails remis au transporteur aujourd'hui : ce qui a consommé le quota. */
  partis: number;
  /** Emails prévus aujourd'hui, pas encore remis : ce qui le consommera avant ce soir. */
  enFile: number;
  /**
   * `null` = aucune limite réglée, et surtout pas zéro : `senders.daily_quota` est nullable, et
   * le moteur lit ce NULL comme « pas de limite » (`quotaSenderRestant`,
   * `apps/worker/src/handlers/sequence.ts`) là où zéro vaut pause.
   */
  plafond: number | null;
  /** Rendus par l'écran (pluriels ICU) : « 0 remis », « 47 en file », « Aucun envoi ». */
  libellePartis: string;
  libelleEnFile: string;
  libelleAucun: string;
  /** Le coin droit : « / 135 », « sans limite » ou « en pause » — rendu par l'écran (ICU `select`). */
  libellePlafond: string;
}

/**
 * Deux chiffres dans une seule jauge (maquette validée le 18/09) : ce qui est parti et ce qui
 * attend. Les afficher séparément laissait croire que tout était parti — un message remis à
 * SalesBlink à 4 h du matin n'est envoyé que dans la fenêtre de sa boîte, parfois des jours plus
 * tard.
 *
 * Répartition de la barre : tant que les partis tiennent sous le plafond, celui-ci est la base et
 * le segment en file n'occupe que la place restante ; une fois le plafond atteint, la base devient
 * le total engagé (partis + file), pour que la barre dise « il y en a plus que prévu » plutôt que
 * de rester saturée sans rien montrer de la file.
 *
 * Même remarque que `CarteMoteur` : carte à plat, sans `.jr-corps`.
 */
export function CarteEnvois({
  libelle,
  partis,
  enFile,
  plafond,
  libellePartis,
  libelleEnFile,
  libelleAucun,
  libellePlafond,
}: CarteEnvoisProps) {
  // Sans limite réglée, il n'y a aucune proportion à montrer : barre vide et ton neutre. Une
  // barre pleine, ou une alerte, annoncerait une limite que le moteur ne respecte pas.
  const sansLimite = plafond === null;
  const plafondAtteint = plafond !== null && plafond > 0 && partis >= plafond;
  const base = sansLimite ? 0 : plafondAtteint ? partis + enFile : plafond;
  const part = (n: number) => (base > 0 ? (n / base) * 100 : 0);
  const placeRestante = Math.max(0, base - partis);
  // En pause (plafond à zéro) avec des envois déjà partis : anomalie, ton d'erreur — même règle
  // que `tonJauge` (`lib/plafonds-affichage.ts`), qui sert les trois autres écrans.
  const ton = plafondAtteint || (plafond === 0 && partis > 0)
    ? 'erreur'
    : plafond !== null && plafond > 0 && partis >= plafond * 0.9
      ? 'attention'
      : 'normal';

  return (
    <div className="jr-carte">
      <div className="jr-envois-tete">
        <span>{libelle}</span>
        <span className="jr-plafond">{libellePlafond}</span>
      </div>
      {partis === 0 && enFile === 0 ? (
        <div className="jr-envois-vide">{libelleAucun}</div>
      ) : (
        <div className="jr-envois-chiffres">
          {libellePartis}
          {enFile > 0 ? (
            <>
              {' · '}
              <span className="jr-file">{libelleEnFile}</span>
            </>
          ) : null}
        </div>
      )}
      <BarreProgression valeur={part(partis)} secondaire={part(Math.min(enFile, placeRestante))} ton={ton} />
    </div>
  );
}
