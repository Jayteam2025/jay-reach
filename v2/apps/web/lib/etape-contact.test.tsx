import { describe, expect, it, vi } from 'vitest';
import { texteEtape } from './etape-contact';

/**
 * `t` factice : renvoie une chaîne qui rend visible la clé ET les valeurs
 * reçues (`cle:{a=1,b=2}`), sans dépendre de next-intl — même esprit que les
 * tests de composants du dépôt qui passent leurs propres traductions
 * factices plutôt que de charger le vrai catalogue.
 */
function fauxT() {
  return vi.fn((cle: string, valeurs?: Record<string, string | number>) => {
    const suffixe = valeurs
      ? Object.entries(valeurs)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    return suffixe ? `${cle}:${suffixe}` : cle;
  });
}

describe('texteEtape', () => {
  it('sans inscription (`etape` null) : `null`, jamais de traduction demandée', () => {
    const t = fauxT();
    expect(texteEtape(null, 'en_sequence', 'En séquence', t)).toBeNull();
    expect(t).not.toHaveBeenCalled();
  });

  it('inscription en cours (`en_sequence`) : clé `step`, pas le libellé de fin', () => {
    const t = fauxT();
    const resultat = texteEtape(2, 'en_sequence', 'En séquence', t);
    expect(t).toHaveBeenCalledWith('step', { n: 2 });
    expect(t).not.toHaveBeenCalledWith('stepEnded', expect.anything());
    expect(resultat).toBe('step:n=2');
  });

  it('inscription `a_repondu` (vivante mais hors séquence active) : toujours la clé `step`', () => {
    const t = fauxT();
    texteEtape(1, 'a_repondu', 'A répondu', t);
    expect(t).toHaveBeenCalledWith('step', { n: 1 });
  });

  it('inscription `termine` (R81) : clé `stepEnded`, étape bornée + libellé de fin, jamais `step`', () => {
    const t = fauxT();
    const resultat = texteEtape(1, 'termine', 'Terminé', t);
    expect(t).toHaveBeenCalledWith('stepEnded', { n: 1, libelle: 'Terminé' });
    expect(t).not.toHaveBeenCalledWith('step', expect.anything());
    expect(resultat).toBe('stepEnded:n=1,libelle=Terminé');
  });

  it('inscription `ecarte` (R81) : clé `stepEnded` avec le libellé « Écarté »', () => {
    const t = fauxT();
    const resultat = texteEtape(3, 'ecarte', 'Écarté', t);
    expect(t).toHaveBeenCalledWith('stepEnded', { n: 3, libelle: 'Écarté' });
    expect(resultat).toBe('stepEnded:n=3,libelle=Écarté');
  });

  it('le libellé de fin ne disparaît pas silencieusement : un `termine` sans le bon appel casse le test', () => {
    // Garde-fou explicite demandé par la relecture (task-18-review-report.md,
    // Important 1) : si `STATUTS_FIN` perdait `termine` (régression), ce test
    // échouerait parce que `t('step', …)` serait appelé à la place.
    const t = fauxT();
    texteEtape(1, 'termine', 'Terminé', t);
    const clesAppelees = t.mock.calls.map((appel) => appel[0]);
    expect(clesAppelees).toEqual(['stepEnded']);
  });
});
