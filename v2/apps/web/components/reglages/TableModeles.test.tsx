import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { celluleEnvois } from './TableModeles';

/**
 * Faux traducteur (même esprit que `fabriquerT` dans
 * `sources/blocsCarteSource.test.tsx`) : ne résout pas la syntaxe ICU
 * `plural` (non nécessaire ici), renvoie la clé et les valeurs pour prouver
 * que le NOMBRE RÉEL passé par l'appelant atteint bien l'appel `t(...)`.
 */
function fauxT(cle: string, valeurs?: Record<string, number>): string {
  return `${cle}:${JSON.stringify(valeurs ?? {})}`;
}

/**
 * Tour de correction 1, important #2 : `ModeleMessage.envois` (comptage réel
 * sur `actions` dispatched/delivered) était calculé par `listerModeles` mais
 * jamais restitué à l'écran — `TableModeles.tsx` ne le lisait nulle part.
 * `celluleEnvois` est la cellule qui le fait, extraite en fonction pure pour
 * rester testable sans fournisseur `next-intl` (`useTranslations`).
 */
describe('celluleEnvois', () => {
  it('transmet le nombre réel d’envois au libellé traduit (186, pas un texte de la maquette)', () => {
    const html = renderToStaticMarkup(<>{celluleEnvois(fauxT, 186)}</>).replace(/&quot;/g, '"');
    expect(html).toContain('table.sentCount');
    expect(html).toContain('"n":186');
  });

  it('transmet zéro explicitement (un modèle jamais envoyé n’est pas masqué)', () => {
    const html = renderToStaticMarkup(<>{celluleEnvois(fauxT, 0)}</>).replace(/&quot;/g, '"');
    expect(html).toContain('"n":0');
  });
});
