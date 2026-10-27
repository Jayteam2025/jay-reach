import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { CarteFournisseur, type CarteFournisseurProps } from './CarteFournisseur';

// L'écriture n'est pas le sujet : ce test juge ce que la carte MONTRE.
vi.mock('../../app/actions/providers', () => ({
  actionEnregistrerCle: async () => ({ ok: true }),
  actionModifierConfigFournisseur: async () => ({ ok: true }),
  actionTesterFournisseur: async () => ({ ok: true }),
}));

const f = fr.reglages.fournisseurs;
const libelles: CarteFournisseurProps['libelles'] = {
  champCle: f.champCle,
  remplacer: f.remplacer,
  enregistrer: f.enregistrer,
  annuler: f.annuler,
  tester: f.tester,
  enregistrementEnCours: f.enregistrementEnCours,
  placeholderSecret: f.placeholderSecret,
  reglagesTitre: f.reglagesTitre,
  enregistrerReglages: f.enregistrerReglages,
  detailsTechniques: f.detailsTechniques,
};

function carte(sur: Partial<CarteFournisseurProps> = {}) {
  return renderToStaticMarkup(
    <CarteFournisseur
      providerId="francetravail"
      nom="France Travail"
      description="Offres de l'agence publique"
      tuile={{ marque: 'lettre', lettre: 'F' }}
      etat={{ ton: 'bon', texte: 'Clé valide' }}
      champs={[]}
      champsConfig={[]}
      presente
      masque={{ identifiant: null, masque: '••••••••••••abcd' }}
      infos={[]}
      peutModifier
      libelles={libelles}
      {...sur}
    />,
  );
}

/** Ce qui se lit sans déplier : tout ce qui précède le premier `<details`. */
function partieVisible(html: string): string {
  const i = html.indexOf('<details');
  return i === -1 ? html : html.slice(0, i);
}

describe('la carte d’un fournisseur', () => {
  it('l’identifiant de connexion (client_id, tenant_id) n’est lisible que sous « Détails techniques », replié', () => {
    const html = carte({ masque: { identifiant: 'client_id PAR-jay-1234abcd', masque: '••••••••••••abcd' } });
    expect(html).toContain('client_id PAR-jay-1234abcd');
    const debut = html.indexOf('<details');
    expect(debut).toBeGreaterThan(-1);
    expect(html.slice(debut)).toContain(libelles.detailsTechniques);
    expect(html.slice(debut, html.indexOf('>', debut))).not.toContain('open');
    expect(partieVisible(html)).not.toContain('PAR-jay-1234abcd');
    // La clé masquée, elle, se lit toujours.
    expect(partieVisible(html)).toContain('••••••••••••abcd');
  });

  it('sans identifiant, aucun repli technique inutile', () => {
    expect(carte()).not.toContain('<details');
  });

  it('les identifiants bruts de modèle sont dans les détails techniques, le nom lisible en information', () => {
    const html = carte({
      providerId: 'anthropic',
      nom: 'Anthropic',
      infos: [{ libelle: f.modeleLeger, valeur: 'Claude Haiku 4.5' }],
      champsConfig: [
        {
          name: 'model_fast',
          libelle: 'Modèle (tâches légères) · défaut Haiku',
          valeurActuelle: 'claude-haiku-4-5-20251001',
          aide: 'Défaut : Claude Haiku 4.5.',
          technique: true,
        },
      ],
    });
    const visible = partieVisible(html);
    expect(visible).toContain('Claude Haiku 4.5');
    expect(visible).not.toContain('claude-haiku-4-5-20251001');
    expect(html.slice(html.indexOf('<details'))).toContain('claude-haiku-4-5-20251001');
  });

  it('un réglage ordinaire reste visible, hors des détails techniques', () => {
    const html = carte({
      providerId: 'salesblink',
      champsConfig: [{ name: 'sync_interval_min', libelle: 'Fréquence de relève (minutes)', valeurActuelle: '5' }],
    });
    expect(partieVisible(html)).toContain('Fréquence de relève (minutes)');
  });

  it('un fournisseur facultatif sans clé n’ouvre pas d’office le formulaire de saisie', () => {
    const champ = { name: 'api_token', libelle: 'Jeton d\'API', secret: true, required: true };
    const ouvert = carte({ providerId: 'anthropic', presente: false, champs: [champ] });
    expect(ouvert).toContain(libelles.placeholderSecret);
    const ferme = carte({ providerId: 'apify', presente: false, facultatif: true, champs: [champ] });
    expect(ferme).not.toContain(libelles.placeholderSecret);
    expect(ferme).toContain(libelles.remplacer);
  });

  it('un seul filet au-dessus des détails techniques : le bloc ne double pas celui du repli', () => {
    const seulTechnique = carte({ masque: { identifiant: 'client_id PAR-jay-1234abcd', masque: '••••' } });
    // Le repli porte son propre filet ; le bloc qui le contient n'en pose pas un second.
    expect(seulTechnique).not.toContain('border-top');
    const avecReglage = carte({
      providerId: 'salesblink',
      champsConfig: [{ name: 'sync_interval_min', libelle: 'Fréquence', valeurActuelle: '5' }],
      masque: { identifiant: 'client_id PAR-jay-1234abcd', masque: '••••' },
    });
    // Réglages visibles : le filet du bloc les sépare de la clé, celui du repli les sépare des détails.
    expect(avecReglage.match(/border-top/g)?.length).toBe(1);
  });
});
