import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { TablePosts, type LignePostEcran, type TablePostsProps } from './TablePosts';

// Les actions ne sont pas le sujet : ce test juge ce que l'écran MONTRE.
vi.mock('../../app/actions/posts', () => ({
  actionCorrigerSujet: async () => ({ ok: true }),
  actionRejeterPost: async () => ({ ok: true }),
  actionReouvrirPost: async () => ({ ok: true }),
  actionValiderPost: async () => ({ ok: true }),
  actionValiderPosts: async () => ({ ok: true }),
}));

/** Les libellés réels, lus sans cast : si une clé disparaît de `fr.json`, le typage le dit ici. */
const t = fr.campagne.posts;
const libelles: TablePostsProps['libelles'] = {
  auteurInconnu: t.ligne.auteurInconnu,
  voir: t.ligne.voir,
  sujetInvite: t.phrase.sujetInvite,
  valider: t.actions.valider,
  rejeter: t.actions.rejeter,
  rouvrir: t.actions.rouvrir,
  resume: '3 posts attendent votre relecture',
  personnes: '106 personnes n\'entrent pas en séquence tant que leur post n\'est pas validé',
  toutValider: 'Tout valider (2)',
};

function ligne(sur: Partial<LignePostEcran> = {}): LignePostEcran {
  return {
    id: 'p1',
    auteur: 'Christelle Moreau',
    publie: 'publié le 12/10',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
    sujet: 'l\'adoption du CRM par les commerciaux',
    avant: 'Je vous ai vu réagir au post de Christelle Moreau sur ',
    apres: '',
    etat: 'pending',
    etatLibelle: 'en attente',
    attente: '47 personnes attendent',
    echeance: 'effacées le 28/10',
    tonEcheance: 'loin',
    etiquetteSujet: 'Sujet du post de Christelle Moreau',
    ...sur,
  };
}

function rendu(lignes: LignePostEcran[], peutModifier = true) {
  return renderToStaticMarkup(
    <TablePosts campagneId="c1" lignes={lignes} peutModifier={peutModifier} libelles={libelles} />,
  );
}

describe('l\'écran des posts à valider', () => {
  it('montre la phrase telle qu\'elle partira, le sujet DANS la phrase', () => {
    const html = rendu([ligne()]);
    expect(html).toMatch(/« Je vous ai vu réagir au post de Christelle Moreau sur <\/span><span[^>]*jr-post-sujet[^>]*>l&#x27;adoption du CRM par les commerciaux<\/span><span class="fixe"> »/);
    expect(html).toContain('contentEditable="true"');
  });

  it('un post sans sujet affiche l\'invite à la place du sujet et désactive Valider', () => {
    const html = rendu([ligne({ sujet: null })]);
    expect(html).toContain(`data-invite="${t.phrase.sujetInvite}"`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
  });

  it('un post avec sujet peut être validé', () => {
    expect(rendu([ligne()])).not.toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
  });

  it('montre le décompte de personnes et l\'échéance en toutes lettres', () => {
    const html = rendu([ligne()]);
    expect(html).toContain('<span class="n">47</span> personnes attendent');
    expect(html).toContain('<span class="n">106</span> personnes');
    expect(html).toContain('effacées le 28/10');
  });

  it('colore l\'échéance selon ce qu\'elle exige', () => {
    expect(rendu([ligne({ tonEcheance: 'loin' })])).toContain('jr-post-echeance loin');
    expect(rendu([ligne({ tonEcheance: 'bientot' })])).toContain('jr-post-echeance bientot');
    expect(rendu([ligne({ tonEcheance: 'urgent' })])).toContain('jr-post-echeance urgent');
  });

  it('n\'a AUCUN bouton d\'effacement, ni unitaire ni en lot', () => {
    const html = rendu([ligne(), ligne({ id: 'p2' }), ligne({ id: 'p3', etat: 'rejected' })]);
    const boutons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(boutons.length).toBeGreaterThan(0);
    for (const b of boutons) expect(b).not.toMatch(/supprim|effac|delete|retir/i);
  });

  it('un post rejeté se rouvre et n\'est plus éditable', () => {
    const html = rendu([ligne({ etat: 'rejected', etatLibelle: 'rejeté' })]);
    expect(html).toContain('Rouvrir');
    expect(html).not.toContain('>Valider<');
    expect(html).toContain('contentEditable="false"');
  });

  it('offre la validation en lot avec son nombre, seulement pour ce qui est validable', () => {
    expect(rendu([ligne(), ligne({ id: 'p2' })])).toContain('Tout valider (2)');
    expect(rendu([ligne({ sujet: null })])).not.toContain('Tout valider');
  });

  it('en lecture seule, aucune action', () => {
    const html = rendu([ligne()], false);
    expect(html).not.toContain('>Valider<');
    expect(html).not.toContain('>Rejeter<');
    expect(html).toContain('contentEditable="false"');
  });

  it('écrit « Auteur inconnu » plutôt qu\'un trou', () => {
    expect(rendu([ligne({ auteur: null })])).toContain('Auteur inconnu');
  });
});
