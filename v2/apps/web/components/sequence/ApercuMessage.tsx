import { useTranslations } from 'next-intl';

export interface ApercuMessageProps {
  /** Rendu déjà résolu par `apercuEtape` (variables remplacées) — jamais recalculé côté client. */
  readonly sujet: string;
  readonly corps: string;
  /** `apercuEtape(...).variablesManquantes` (C5) : non vide → l'envoi sera bloqué tant qu'elles manquent, même mécanique qu'`apercuEnvoi` (`file-du-jour.ts`). */
  readonly variablesManquantes: string[];
}

/**
 * Panneau « Aperçu » du tiroir d'étape (maquette `tiroir-etape.html`) : montre
 * l'email tel qu'il sortirait, rendu pour un contact fictif (aucune personne
 * réelle) puisque l'écran n'a pas de sélecteur de contact.
 *
 * N'utilise pas le composant `Message` du kit (`components/ui`) : celui-ci
 * porte un émetteur et une date réels, qu'un aperçu de gabarit n'a pas — les
 * inventer laisserait croire à un envoi daté qui n'existe pas. L'avertissement
 * de variables manquantes reprend en revanche le même bandeau que
 * `TiroirRelecture` (`.jr-bandeau.attention`).
 */
export function ApercuMessage({ sujet, corps, variablesManquantes }: ApercuMessageProps) {
  const t = useTranslations('campagne.sequence');
  if (!corps) return null;

  return (
    <>
      <h4>
        {t('drawer.preview')}
        <span>{t('drawer.previewCaption')}</span>
      </h4>
      <div className="jr-message sortant">
        {variablesManquantes.length > 0 && (
          <div className="jr-bandeau attention">
            {t('preview.missing', { n: variablesManquantes.length, liste: variablesManquantes.join(', ') })}
          </div>
        )}
        <div className="corps">
          {sujet && <b className="jr-message-objet">{sujet}</b>}
          {corps}
        </div>
      </div>
    </>
  );
}
