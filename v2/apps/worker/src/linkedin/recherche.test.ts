import { describe, expect, it, vi } from 'vitest';
import { ErreurCollecte } from './engageurs.js';
import type { Pilote } from './navigateur.js';
import { chercherPersonnes, extrairePersonnes, urlRecherche } from './recherche.js';

/** Pilote complet, dérivé du type réel : toute méthode non fournie lève au lieu de rendre `undefined`. */
function pilote(partiel: Partial<Pilote>): Pilote {
  const refuser = (nom: string) => async (): Promise<never> => {
    throw new Error(`pilote factice : ${nom} ne devrait pas être appelé`);
  };
  return {
    aller: partiel.aller ?? refuser('aller'),
    url: partiel.url ?? refuser('url'),
    saisir: partiel.saisir ?? refuser('saisir'),
    presserEntree: partiel.presserEntree ?? refuser('presserEntree'),
    texte: partiel.texte ?? refuser('texte'),
    attendre: partiel.attendre ?? refuser('attendre'),
    requete: partiel.requete ?? refuser('requete'),
    fermer: partiel.fermer ?? refuser('fermer'),
  };
}

/** Un résultat tel que la page le sert : un lien, un `aria-label`, puis nom, degré, intitulé, lieu. */
const resultat = (slug: string, nom: string, intitule: string, degre = '2e'): string =>
  `role="listitem"><a href="https://www.linkedin.com/in/${slug}/" aria-label="${nom}">` +
  `<span>${nom}</span><span>• ${degre}</span><span>${intitule}</span><span>Lille, France</span></a>`;

describe('extrairePersonnes', () => {
  it('n’accepte un lien de profil que s’il porte un aria-label, comme les résultats', () => {
    // Mesuré sur une page entière le 09/10 : 32 liens `/in/<nom>` pour 10 résultats, et AUCUN
    // des liens de navigation ne porte d'aria-label. C'est cette garde — pas le découpage — qui
    // fait tomber à zéro les 4 « résultats » que les pages 1 et 2 avaient en commun.
    const bruit =
      '<a href="https://www.linkedin.com/in/mon-profil/">moi</a>' +
      'role="listitem"><a class="x" href="https://www.linkedin.com/in/suggestion/"><span>Suggestion</span><span>Un intitulé</span></a>';
    expect(extrairePersonnes(bruit)).toEqual([]);
  });

  it('ne retient que les blocs de résultat, pas les liens de profil qui traînent dans la page', () => {
    // Mesuré le 09/10 : le document porte 23 liens `/in/<nom>` pour 10 résultats affichés, et
    // ce bruit est le MÊME d'une page à l'autre — d'où 4 « résultats » communs entre la page 1
    // et la page 2 avant correction. Découpé sur `role="listitem"`, le chevauchement tombe à zéro.
    const html =
      '<a href="https://www.linkedin.com/in/mon-profil/">moi</a>' +
      '<nav><a href="https://www.linkedin.com/in/suggestion-barre-laterale/">x</a></nav>' +
      resultat('ada-lemercier', 'Ada Lemercier', 'Directrice commerciale chez Acme') +
      resultat('bruno-valtier', 'Bruno Valtier', 'Directeur commercial chez Bêta');
    expect(extrairePersonnes(html).map((p) => p.nomPublic)).toEqual(['ada-lemercier', 'bruno-valtier']);
  });

  it('lit le nom, l’intitulé et reconstruit l’adresse du profil', () => {
    const [p] = extrairePersonnes(resultat('ada-lemercier', 'Ada Lemercier', 'Directrice commerciale chez Acme'));
    expect(p).toEqual({
      nomPublic: 'ada-lemercier',
      urlProfil: 'https://www.linkedin.com/in/ada-lemercier/',
      nom: 'Ada Lemercier',
      intitule: 'Directrice commerciale chez Acme',
    });
  });

  it('ne prend jamais le degré de relation pour un intitulé', () => {
    // Le degré s'intercale systématiquement entre le nom et l'intitulé. Sans ce filtre, une
    // personne sur deux serait scorée sur la chaîne « • 2e ».
    for (const degre of ['1er', '2e', '3e', '3e+', 'Hors réseau']) {
      const [p] = extrairePersonnes(resultat('ada-lemercier', 'Ada Lemercier', 'Directrice commerciale', degre));
      expect(p?.intitule).toBe('Directrice commerciale');
    }
  });

  it('ignore sans bruit un bloc qui n’est pas une personne', () => {
    // La liste porte aussi des encarts et des « voir tous les résultats » : 9 personnes pour
    // 10 `role="listitem"` sur une page mesurée. Les compter comme des échecs ferait passer
    // une page normale pour une page fautive.
    const html = 'role="listitem"><div>Annonce</div>' + resultat('ada-lemercier', 'Ada Lemercier', 'Directrice commerciale');
    expect(extrairePersonnes(html)).toHaveLength(1);
  });

  it('dédoublonne une même personne mise en lien deux fois dans sa carte', () => {
    const bloc =
      `role="listitem"><a href="https://www.linkedin.com/in/ada-lemercier/" aria-label="Ada Lemercier">` +
      `<span>Ada Lemercier</span><span>• 2e</span><span>Directrice commerciale</span></a>` +
      `<a href="https://www.linkedin.com/in/ada-lemercier/">photo</a>`;
    expect(extrairePersonnes(bloc)).toHaveLength(1);
  });

  it('rend une liste vide sur une page sans résultat, sans lever', () => {
    expect(extrairePersonnes('<html><body><main></main></body></html>')).toEqual([]);
  });
});

describe('urlRecherche', () => {
  it('encode les mots-clés et ne numérote pas la première page', () => {
    expect(urlRecherche('directeur commercial', 1)).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=directeur%20commercial',
    );
    expect(urlRecherche('directeur commercial', 3)).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=directeur%20commercial&page=3',
    );
  });
});

describe('chercherPersonnes', () => {
  const pages = (parPage: readonly (readonly [string, string][])[]): Pilote =>
    pilote({
      requete: async (url: string) => {
        const n = Number(/&page=(\d+)/.exec(url)?.[1] ?? '1');
        const lot = parPage[n - 1] ?? [];
        return { statut: 200, corps: lot.map(([slug, nom]) => resultat(slug, nom, 'Directrice commerciale')).join('') };
      },
    });

  const options = (personnesMax: number, requetes: number, dejaVus: string[] = []) => {
    let restantes = requetes;
    return {
      dejaVus: new Set(dejaVus),
      personnesMax,
      requetesRestantes: () => restantes,
      surRequete: async (): Promise<void> => {
        restantes -= 1;
      },
      pause: async (): Promise<void> => undefined,
    };
  };

  it('parcourt les pages jusqu’à épuiser les résultats', async () => {
    const r = await chercherPersonnes(
      pages([
        [['ada-lemercier', 'Ada Lemercier']],
        [['bruno-valtier', 'Bruno Valtier']],
        [],
      ]),
      'directeur commercial',
      options(50, 10),
    );
    expect(r.personnes.map((p) => p.nomPublic)).toEqual(['ada-lemercier', 'bruno-valtier']);
    expect(r.arret).toBe('fini');
  });

  it('s’arrête net au plafond de personnes', async () => {
    const r = await chercherPersonnes(
      pages([[['ada-lemercier', 'Ada'], ['bruno-valtier', 'Bruno'], ['cora-nivelle', 'Cora']]]),
      'directeur commercial',
      options(2, 10),
    );
    expect(r.personnes).toHaveLength(2);
    expect(r.arret).toBe('plafond');
  });

  it('saute les personnes déjà enregistrées pour cette source', async () => {
    // Une recherche rejouée demain revoit les mêmes personnes en tête : les relire coûterait le
    // plafond du jour sans ajouter personne.
    const r = await chercherPersonnes(
      pages([[['ada-lemercier', 'Ada'], ['bruno-valtier', 'Bruno']]]),
      'directeur commercial',
      options(50, 10, ['ada-lemercier']),
    );
    expect(r.personnes.map((p) => p.nomPublic)).toEqual(['bruno-valtier']);
  });

  it('une page qui n’apporte que du déjà-vu n’arrête pas le parcours', async () => {
    // Seule une page VIDE met fin aux résultats : les suivantes peuvent encore porter du neuf.
    const r = await chercherPersonnes(
      pages([[['ada-lemercier', 'Ada']], [['bruno-valtier', 'Bruno']], []]),
      'directeur commercial',
      options(50, 10, ['ada-lemercier']),
    );
    expect(r.personnes.map((p) => p.nomPublic)).toEqual(['bruno-valtier']);
  });

  it('rend « liste vide » quand la recherche ne donne rien', async () => {
    const r = await chercherPersonnes(pages([[]]), 'directeur commercial', options(50, 10));
    expect(r).toEqual({ personnes: [], arret: { type: 'liste_vide' } });
  });

  it('ne part pas du tout quand le budget est déjà épuisé', async () => {
    // `pilote({})` lève sur tout : si une requête partait malgré le plafond, le test tomberait
    // sur l'erreur du pilote plutôt que sur une assertion — c'est voulu.
    const r = await chercherPersonnes(pilote({}), 'directeur commercial', options(50, 0));
    expect(r).toEqual({ personnes: [], arret: 'plafond' });
  });

  it('refuse une recherche sans mot-clé, sans toucher au navigateur', async () => {
    await expect(chercherPersonnes(pilote({}), '   ', options(50, 10))).rejects.toBeInstanceOf(ErreurCollecte);
  });

  it('remonte une friction sur le statut', async () => {
    const p = pilote({ requete: async () => ({ statut: 999, corps: '' }) });
    await expect(chercherPersonnes(p, 'directeur commercial', options(50, 10))).rejects.toMatchObject({
      name: 'FrictionLinkedIn',
    });
  });

  it('respecte une pause entre deux pages, jamais avant la première', async () => {
    const pause = vi.fn(async () => undefined);
    const o = { ...options(50, 10), pause };
    await chercherPersonnes(pages([[['ada-lemercier', 'Ada']], [['bruno-valtier', 'Bruno']], []]), 'x', o);
    expect(pause).toHaveBeenCalledTimes(2); // avant la page 2 et la page 3, pas avant la 1
  });
});
