import { BarreProgression } from '../ui';

export interface CarteEnvoisProps {
  libelle: string;
  /** Messages réellement partis aujourd'hui (pour un email : envoyés par le transporteur, pas remis). */
  partis: number;
  /** Remis ou planifiés pour aujourd'hui, pas encore partis. */
  enFile: number;
  plafond: number;
  /** Rendus par l'écran (pluriels ICU) : « 0 parti », « 47 en file », « Aucun envoi ». */
  libellePartis: string;
  libelleEnFile: string;
  libelleAucun: string;
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
}: CarteEnvoisProps) {
  const plafondAtteint = plafond > 0 && partis >= plafond;
  const base = plafondAtteint ? partis + enFile : plafond;
  const part = (n: number) => (base > 0 ? (n / base) * 100 : 0);
  const placeRestante = Math.max(0, base - partis);
  const ton = plafondAtteint ? 'erreur' : plafond > 0 && partis >= plafond * 0.9 ? 'attention' : 'normal';

  return (
    <div className="jr-carte">
      <div className="jr-envois-tete">
        <span>{libelle}</span>
        <span className="jr-plafond">/ {plafond}</span>
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
