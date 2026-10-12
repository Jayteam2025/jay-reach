import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { TablePlafonds, type LignePlafond } from './TablePlafonds';

// L'écriture n'est pas le sujet : ce test juge ce que la table MONTRE.
vi.mock('../../app/actions/plafonds', () => ({
  actionEcrireReglage: async () => ({ ok: true }),
}));

/** Les libellés réels, lus sans cast : si une clé disparaît de `fr.json`, le typage le dit ici. */
const t = fr.reglages.plafonds.table;
const libelles = {
  colReglage: t.colReglage,
  colAujourdhui: t.colAujourdhui,
  colValeur: t.colValeur,
  colDefaut: t.colDefaut,
  colRepli: t.colRepli,
  colModifie: t.colModifie,
  modifier: t.modifier,
  enregistrer: t.enregistrer,
  annuler: t.annuler,
  aucunRepli: t.aucunRepli,
  erreurNombre: t.erreurNombre,
  sansObjet: t.sansObjet,
  arrete: t.arrete,
};

/** Un réglage quelconque : chaque test ne surcharge que ce qu'il vient prouver. */
function ligne(sur: Partial<LignePlafond> = {}): LignePlafond {
  return {
    cle: 'scoring_par_jour',
    nom: 'Scoring par jour',
    description: 'Fiches scorées par jour.',
    valeur: 300,
    defaut: 300,
    repli: 'SCORE_DAILY_CAP',
    modifie: 'jamais',
    type: 'nombre',
    ...sur,
  };
}

function rendu(lignes: LignePlafond[]) {
  return renderToStaticMarkup(<TablePlafonds lignes={lignes} peutModifier libelles={libelles} />);
}

describe('la table des plafonds', () => {
  it('montre la consommation du jour avant la valeur réglée', () => {
    const html = rendu([
      ligne({ consommation: { texte: '12 sur 300', pourcentage: 4, ton: 'normal' } }),
    ]);
    expect(html).toContain('12 sur 300');
    // C'est tout l'objet du chantier : un plafond seul ne dit pas s'il est sur le point de
    // bloquer, donc ce qui est consommé se lit en premier.
    expect(html.indexOf(libelles.colAujourdhui)).toBeLessThan(html.indexOf(libelles.colValeur));
    expect(html.indexOf('12 sur 300')).toBeLessThan(html.indexOf('300<'));
    expect(html).not.toContain(libelles.sansObjet);
  });

  it('un réglage qui ne se consomme pas le dit, plutôt que de laisser une case vide', () => {
    const html = rendu([ligne({ cle: 'score_min_defaut', valeur: 70, consommation: null })]);
    expect(html).toContain(libelles.sansObjet);
  });

  it('un plafond de volume à zéro se voit et se dit', () => {
    const html = rendu([ligne({ valeur: 0, arrete: true })]);
    expect(html).toContain(libelles.arrete);
    expect(html).toContain('jr-valeur-arretee');
  });

  it('un zéro qui n’arrête rien reste muet', () => {
    // `relecture_premiers_envois_defaut` vaut zéro PAR DÉFAUT : le signaler ferait crier l'écran
    // sur une organisation parfaitement saine.
    const html = rendu([ligne({ cle: 'relecture_premiers_envois_defaut', valeur: 0, arrete: false })]);
    expect(html).not.toContain(libelles.arrete);
    expect(html).not.toContain('jr-valeur-arretee');
  });
});
