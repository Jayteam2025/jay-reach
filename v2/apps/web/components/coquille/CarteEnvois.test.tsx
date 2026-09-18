import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CarteEnvois } from './CarteEnvois';

/** Largeurs des deux segments de la barre, dans l'ordre : ce qui est parti, ce qui attend. */
function segments(html: string): number[] {
  return [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

function rendre(partis: number, enFile: number, plafond: number): string {
  return renderToStaticMarkup(
    <CarteEnvois
      libelle="Envois du jour"
      partis={partis}
      enFile={enFile}
      plafond={plafond}
      libellePartis={`${partis} partis`}
      libelleEnFile={`${enFile} en file`}
      libelleAucun="Aucun envoi"
    />,
  );
}

describe('CarteEnvois — les six états de la maquette validée (18/09)', () => {
  it('1. rien parti, la file remplit sa part du plafond', () => {
    const html = rendre(0, 47, 135);
    expect(html).toContain('0 partis');
    expect(html).toContain('47 en file');
    const [parti, file] = segments(html);
    expect(parti).toBe(0);
    expect(file).toBeCloseTo((47 / 135) * 100, 1);
    expect(html).not.toContain('erreur');
  });

  it('2. journée en cours : les deux segments se suivent', () => {
    const [parti, file] = segments(rendre(82, 12, 135));
    expect(parti).toBeCloseTo((82 / 135) * 100, 1);
    expect(file).toBeCloseTo((12 / 135) * 100, 1);
  });

  it('3. tout parti, rien en attente : pas de second segment ni de mention de file', () => {
    const html = rendre(118, 0, 135);
    expect(html).toContain('118 partis');
    expect(html).not.toContain('en file');
    expect(segments(html)).toHaveLength(1);
  });

  it("4. rien du tout : le texte le dit, la barre reste vide", () => {
    const html = rendre(0, 0, 135);
    expect(html).toContain('Aucun envoi');
    expect(html).not.toContain('partis');
    // Un segment peut être rendu, mais à largeur nulle : la barre ne montre rien.
    expect(segments(html).every((largeur) => largeur === 0)).toBe(true);
  });

  it('5. plafond atteint : ton erreur, et la barre se répartit sur le total engagé', () => {
    const html = rendre(135, 9, 135);
    expect(html).toContain('erreur');
    const [parti, file] = segments(html);
    // Base = 144 (135 + 9), pas 135 : sans ça le segment en file n'aurait aucune place.
    expect(parti).toBeCloseTo((135 / 144) * 100, 1);
    expect(file).toBeCloseTo((9 / 144) * 100, 1);
  });

  it("6. file plus grande que la place restante : elle est écrêtée au plafond", () => {
    const largeurs = segments(rendre(1284, 127, 1350));
    expect(largeurs).toHaveLength(2);
    const [parti = 0, file = 0] = largeurs;
    expect(parti).toBeCloseTo((1284 / 1350) * 100, 1);
    // 127 en file mais seulement 66 places sous le plafond : le segment s'arrête là.
    expect(file).toBeCloseTo((66 / 1350) * 100, 1);
    expect(parti + file).toBeCloseTo(100, 1);
  });

  it("un plafond à zéro ne fait pas diviser par zéro", () => {
    const html = rendre(0, 0, 0);
    expect(html).toContain('Aucun envoi');
    expect(html).not.toContain('NaN');
  });
});
