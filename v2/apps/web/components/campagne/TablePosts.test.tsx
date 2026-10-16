import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { BarreLot, TablePosts, ligneValidable, type LignePostEcran, type TablePostsProps } from './TablePosts';

// Les actions ne sont pas le sujet : ce test juge ce que l'écran MONTRE.
vi.mock('../../app/actions/posts', () => ({
  actionCorrigerAuteur: async () => ({ ok: true }),
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
  auteurInvite: t.phrase.auteurInvite,
  valider: t.actions.valider,
  rejeter: t.actions.rejeter,
  rouvrir: t.actions.rouvrir,
  resume: '3 posts attendent votre relecture',
  personnes: 'jusqu\'à 106 personnes n\'entrent pas en séquence tant que leur post n\'est pas validé',
  toutValider: 'Tout valider (2)',
  lotBloque: t.bar.lotBloque,
  manquantAide: t.phrase.manquantAide,
};

/** La phrase par défaut, telle que la page la compose : l'auteur ET le sujet s'y écrivent. */
const MORCEAUX: LignePostEcran['morceaux'] = [
  { texte: 'Je vous ai vu réagir au post de ' },
  { champ: 'auteur' },
  { texte: ' sur ' },
  { champ: 'sujet' },
];

function ligne(sur: Partial<LignePostEcran> = {}): LignePostEcran {
  return {
    id: 'p1',
    auteur: 'Christelle Moreau',
    publie: 'publié le 12/10',
    url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
    sujet: 'l\'adoption du CRM par les commerciaux',
    morceaux: MORCEAUX,
    etat: 'pending',
    etatLibelle: 'en attente',
    attente: 'jusqu\'à 47 personnes attendent',
    echeance: 'effacées le 28/10',
    tonEcheance: 'loin',
    etiquetteSujet: 'Sujet du post de Christelle Moreau',
    etiquetteAuteur: 'Nom de l\'auteur du post, tel qu\'il partira',
    ...sur,
  };
}

/** L'apostrophe des libellés français sort échappée du rendu statique. */
const echappe = (texte: string) => texte.replace(/'/g, '&#x27;');

function rendu(lignes: LignePostEcran[], peutModifier = true) {
  return renderToStaticMarkup(
    <TablePosts campagneId="c1" lignes={lignes} peutModifier={peutModifier} libelles={libelles} />,
  );
}

describe('l\'écran des posts à valider', () => {
  it('montre la phrase telle qu\'elle partira, l\'auteur et le sujet DANS la phrase', () => {
    const html = rendu([ligne()]);
    expect(html).toContain('Je vous ai vu réagir au post de ');
    expect(html).toMatch(/jr-post-champ[^>]*>Christelle Moreau<\/span>/);
    expect(html).toMatch(/jr-post-champ[^>]*>l&#x27;adoption du CRM par les commerciaux<\/span>/);
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

describe('la validation en lot', () => {
  const rendre = (bloque: boolean) =>
    renderToStaticMarkup(
      <BarreLot libelles={libelles} lotBloque={libelles.lotBloque} bloque={bloque} pending={false} onToutValider={() => undefined} />,
    );

  it('est bloquée, avec une ligne qui dit pourquoi, tant qu\'un sujet modifié n\'est pas enregistré', () => {
    const html = rendre(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Tout valider \(2\)<\/button>/);
    // Le libellé lui-même (il ne doit nommer ni le sujet ni l'auteur, qui bloquent le lot tous
    // les deux) est jugé dans les trois langues par `packages/i18n/src/messages.test.ts`.
    expect(html).toContain(echappe(t.bar.lotBloque));
  });

  it('est active, sans explication, quand rien n\'est en cours d\'édition', () => {
    const html = rendre(false);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain('Enregistrez ou annulez');
  });
});

describe('la forme des lignes', () => {
  it('ne marque d\'une pastille que l\'exception : le rejet', () => {
    expect(rendu([ligne()])).not.toContain('jr-puce');
    const html = rendu([ligne({ etat: 'rejected', etatLibelle: 'rejeté' })]);
    expect(html).toMatch(/jr-puce[^>]*>rejeté</);
  });

  it('une seule action principale : Valider ; Rejeter et Tout valider sont discrets', () => {
    const html = rendu([ligne(), ligne({ id: 'p2' })]);
    expect(html.match(/jr-bouton principal/g)).toHaveLength(2); // un Valider par post
    expect(html).toMatch(/<button[^>]*class="jr-bouton discret"[^>]*>Rejeter</);
    expect(html).toMatch(/<button[^>]*class="jr-bouton discret petit"[^>]*>Tout valider/);
  });

  it('n\'a plus de style en ligne', () => {
    const source = readFileSync(new URL('./TablePosts.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/style=\{\{/);
  });
});

/**
 * Le nom de l'auteur est ce qui PART dans le message. Avant, la phrase affichait le jeton brut
 * `{{post_auteur}}` quand la capture n'avait pas su le lire, l'opérateur validait, et la garde
 * continuait de retenir ses personnes sans qu'aucun écran ne permette de réparer.
 */
describe('l\'auteur s\'écrit dans la phrase, comme le sujet', () => {
  it('ne montre JAMAIS le jeton brut : sans nom, c\'est l\'invite d\'édition', () => {
    const html = rendu([ligne({ auteur: null })]);
    expect(html).not.toContain('{{post_auteur}}');
    expect(html).toContain(`data-invite="${echappe(t.phrase.auteurInvite)}"`);
  });

  it('un auteur manquant interdit la validation quand la campagne le nomme', () => {
    expect(rendu([ligne({ auteur: null })])).toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
    expect(rendu([ligne({ auteur: null })])).not.toContain('Tout valider');
  });

  it('porte son étiquette d\'accessibilité propre, distincte de celle du sujet', () => {
    const html = rendu([ligne()]);
    expect(html).toContain('aria-label="Nom de l&#x27;auteur du post, tel qu&#x27;il partira"');
    expect(html).toContain('aria-label="Sujet du post de Christelle Moreau"');
  });

  it('une campagne qui ne nomme que l\'auteur n\'offre pas d\'écrire un sujet qui ne partira pas', () => {
    const html = rendu([
      ligne({ sujet: null, morceaux: [{ texte: 'Vu votre réaction au post de ' }, { champ: 'auteur' }, { texte: '.' }] }),
    ]);
    expect(html).not.toContain(`data-invite="${t.phrase.sujetInvite}"`);
    // Et « Valider » reste offert : le sujet ne partira pas, l'exiger serait du travail pour rien.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
  });

  it('une accroche sans aucun champ ne rend rien d\'éditable', () => {
    const html = rendu([ligne({ morceaux: [{ texte: 'Vu votre réaction à ce post.' }] })]);
    expect(html).not.toContain('contentEditable');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
  });
});

/**
 * La date de publication n'est pas une chaîne : elle n'a aucun champ dans la phrase. Quand la
 * capture ne l'a pas lue, l'écran affichait « votre réaction du {{post_date}} », comptait la ligne
 * validable — donc « Tout valider » la prenait — et le serveur répondait d'écrire dans la phrase
 * un champ qui n'existe pas. Trois défauts, une seule cause.
 */
describe('une valeur que la capture n\'a pas pu lire', () => {
  const SANS_DATE: LignePostEcran['morceaux'] = [
    { texte: 'votre réaction du ' },
    { manquant: 'date indisponible' },
    { texte: ' m\'a interpellé' },
  ];

  it('s\'affiche en toutes lettres, jamais en jeton brut', () => {
    const html = rendu([ligne({ morceaux: SANS_DATE })]);
    expect(html).not.toContain('{{');
    expect(html).toContain('date indisponible');
    expect(html).toContain(echappe(t.phrase.manquantAide));
  });

  it('n\'est pas éditable : rien à écrire, donc rien qui s\'écrive', () => {
    const html = rendu([ligne({ morceaux: SANS_DATE })]);
    expect(html).not.toContain('contentEditable');
  });

  it('sort la ligne de « Tout valider » : le serveur la refuserait à chaque passage', () => {
    expect(ligneValidable(ligne({ morceaux: SANS_DATE }))).toBe(false);
    expect(ligneValidable(ligne())).toBe(true);
    // Seule de son espèce, elle n'offre plus de validation en lot du tout.
    expect(rendu([ligne({ morceaux: SANS_DATE })])).not.toContain('Tout valider');
  });

  it('laisse son bouton Valider actif : c\'est la seule façon de lire pourquoi', () => {
    const html = rendu([ligne({ morceaux: SANS_DATE })]);
    expect(html).toMatch(/<button[^>]*>Valider<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Valider<\/button>/);
  });
});

/**
 * Sans accroche, la garde ne retient personne et l'épargne de purge n'existe pas : annoncer des
 * personnes bloquées et une date d'effacement enverrait l'opérateur valider des posts pour rien
 * (« une alerte fausse en éteint une vraie »). La page passe alors `null`.
 */
describe('ce que l\'écran n\'affirme pas', () => {
  it('sans accroche, ni attente ni échéance sur la ligne', () => {
    const html = rendu([ligne({ attente: null, echeance: null })]);
    expect(html).not.toContain('jr-post-attente');
    expect(html).not.toContain('jr-post-echeance');
    expect(html).not.toContain('effacées');
  });

  it('et rien dans la barre non plus quand aucune personne n\'est retenue', () => {
    const html = renderToStaticMarkup(
      <TablePosts campagneId="c1" lignes={[ligne()]} peutModifier libelles={{ ...libelles, personnes: '' }} />,
    );
    expect(html).not.toContain('n\'entrent pas en séquence');
  });
});
