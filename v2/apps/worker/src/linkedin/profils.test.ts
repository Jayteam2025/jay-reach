import { describe, expect, it, vi } from 'vitest';
import { ErreurCollecte, type Budget } from './engageurs.js';
import type { Pilote } from './navigateur.js';
import {
  adresseActivite,
  adresseDeProfil,
  estPageIntrouvable,
  estUrnDeProfil,
  extrairePostsDeProfil,
  identifiantDeProfil,
  resoudreNomPublic,
  trouverPostsDeProfil,
} from './profils.js';

/**
 * Un pilote complet, dérivé du type réel : toute méthode non fournie lève, au lieu de rendre
 * `undefined` et de faire passer un test pour une raison qui n'existe pas en production.
 */
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

const budget = (postsRestants: number, requetesRestantes: number): Budget => ({
  postsRestants,
  requetesRestantes,
});

describe('extrairePostsDeProfil', () => {
  it('ne retient QUE les posts mis en lien, pas les URN qui traînent dans le document', () => {
    // Mesuré le 09/10 sur trois profils réels : le document fait ~14 Mo et porte des milliers
    // d'`urn:li:activity:` de traçage (5172 sur l'un d'eux) plus une vingtaine d'`urn:li:share:`
    // venus d'ailleurs, pour 1 ou 2 posts réellement publiés. Compter les URN bruts donnerait
    // quinze faux posts sur dix-sept — et chacun coûterait une lecture d'engageurs.
    const html = `
      <script>{"trackingId":"urn:li:activity:111","other":"urn:li:activity:222"}</script>
      <div data-x="urn:li:share:333"></div>
      <a href="https://www.linkedin.com/feed/update/urn:li:share:7470750519892971520/">post</a>
      <span>urn:li:activity:444 urn:li:activity:555</span>
      <a href="https://www.linkedin.com/feed/update/urn:li:share:7440054583508271104/">post</a>
      <script>"urn:li:ugcPost:666"</script>
    `;
    expect(extrairePostsDeProfil(html)).toEqual([
      'urn:li:share:7470750519892971520',
      'urn:li:share:7440054583508271104',
    ]);
  });

  it('accepte les trois types de post qu’un lien peut porter', () => {
    const html = `
      <a href="/feed/update/urn:li:share:1/">a</a>
      <a href="/feed/update/urn:li:activity:2/">b</a>
      <a href="/feed/update/urn:li:ugcPost:3/">c</a>
    `;
    expect(extrairePostsDeProfil(html)).toEqual([
      'urn:li:share:1',
      'urn:li:activity:2',
      'urn:li:ugcPost:3',
    ]);
  });

  it('dédoublonne un post mis en lien plusieurs fois (image, titre et horodatage pointent le même)', () => {
    const html = `
      <a href="/feed/update/urn:li:share:9/">image</a>
      <a href="/feed/update/urn:li:share:9/">titre</a>
    `;
    expect(extrairePostsDeProfil(html)).toEqual(['urn:li:share:9']);
  });

  it('rend une liste vide sur une coquille, sans lever', () => {
    expect(extrairePostsDeProfil('<html><body><nav></nav><footer></footer></body></html>')).toEqual([]);
  });
});

describe('lecture d’une adresse de profil', () => {
  it('lit le nom public comme l’URN, et refuse ce qui n’est pas un profil LinkedIn', () => {
    expect(identifiantDeProfil('https://www.linkedin.com/in/prenom-nom-123/')).toBe('prenom-nom-123');
    expect(identifiantDeProfil('https://fr.linkedin.com/in/ACoAAExemple?utm=x')).toBe('ACoAAExemple');
    expect(identifiantDeProfil('https://exemple.test/in/quelquun')).toBeNull();
    expect(identifiantDeProfil('https://www.linkedin.com/company/une-societe/')).toBeNull();
  });

  it('reconnaît un URN et reconstruit les adresses plutôt que de reprendre la saisie', () => {
    expect(estUrnDeProfil('ACoAABCDEF')).toBe(true);
    expect(estUrnDeProfil('prenom-nom')).toBe(false);
    expect(adresseDeProfil('prenom nom')).toBe('https://www.linkedin.com/in/prenom%20nom/');
    expect(adresseActivite('prenom-nom')).toBe('https://www.linkedin.com/in/prenom-nom/recent-activity/all/');
  });

  it('reconnaît la page « ce membre n’existe pas »', () => {
    expect(estPageIntrouvable('https://www.linkedin.com/404/')).toBe(true);
    expect(estPageIntrouvable('https://www.linkedin.com/in/prenom-nom/')).toBe(false);
  });
});

describe('resoudreNomPublic', () => {
  it('rend le nom public vers lequel l’URN a redirigé', async () => {
    const aller = vi.fn(async () => undefined);
    const nom = await resoudreNomPublic(
      pilote({ aller, url: async () => 'https://www.linkedin.com/in/prenom-nom/?isSelfProfile=false' }),
      'https://www.linkedin.com/in/ACoAAExemple/',
    );
    expect(nom).toBe('prenom-nom');
    expect(aller).toHaveBeenCalledWith('https://www.linkedin.com/in/ACoAAExemple/');
  });

  it('dit que le profil n’existe plus quand LinkedIn répond par sa page 404', async () => {
    // C'est la seule façon de le savoir : la page d'activité d'un profil disparu rend une
    // coquille, SANS rediriger. Sans ce contrôle on annoncerait « aucun post » sur une adresse
    // périmée, et l'opérateur chercherait pourquoi son créateur ne publie plus.
    await expect(
      resoudreNomPublic(
        pilote({ aller: async () => undefined, url: async () => 'https://www.linkedin.com/404/' }),
        'https://www.linkedin.com/in/profil-supprime/',
      ),
    ).rejects.toMatchObject({ name: 'ProfilIntrouvable' });
  });

  it('refuse un URN resté un URN après la redirection', async () => {
    await expect(
      resoudreNomPublic(
        pilote({ aller: async () => undefined, url: async () => 'https://www.linkedin.com/in/ACoAAExemple/' }),
        'https://www.linkedin.com/in/ACoAAExemple/',
      ),
    ).rejects.toMatchObject({ name: 'ProfilSansNomPublic' });
  });

  it('remonte une friction lue sur l’URL d’arrivée', async () => {
    await expect(
      resoudreNomPublic(
        pilote({ aller: async () => undefined, url: async () => 'https://www.linkedin.com/checkpoint/challenge/' }),
        'https://www.linkedin.com/in/prenom-nom/',
      ),
    ).rejects.toMatchObject({ name: 'FrictionLinkedIn' });
  });

  it('refuse une adresse qui n’est pas un profil, sans toucher au navigateur', async () => {
    await expect(
      resoudreNomPublic(pilote({}), 'https://exemple.test/in/quelquun'),
    ).rejects.toBeInstanceOf(ErreurCollecte);
  });
});

describe('trouverPostsDeProfil', () => {
  const activite = (urns: readonly string[]): string =>
    urns.map((u) => `<a href="https://www.linkedin.com/feed/update/${u}/">p</a>`).join('');

  function piloteProfil(html: string): Pilote {
    return pilote({
      aller: async () => undefined,
      url: async () => 'https://www.linkedin.com/in/prenom-nom/',
      requete: async () => ({ statut: 200, corps: html }),
    });
  }

  it('rend les posts du profil et compte UNE requête par appel réseau', async () => {
    const surRequete = vi.fn(async () => undefined);
    const r = await trouverPostsDeProfil(
      piloteProfil(activite(['urn:li:share:1', 'urn:li:share:2'])),
      'https://www.linkedin.com/in/ACoAAExemple/',
      { dejaTraites: new Set(), budget: budget(10, 10), surRequete },
    );
    expect(r).toEqual({ urns: ['urn:li:share:1', 'urn:li:share:2'], arret: 'fini' });
    // Deux requêtes, pas plus : la résolution, puis l'activité.
    expect(surRequete).toHaveBeenCalledTimes(2);
  });

  it('saute les posts déjà traités', async () => {
    const r = await trouverPostsDeProfil(
      piloteProfil(activite(['urn:li:share:1', 'urn:li:share:2'])),
      'https://www.linkedin.com/in/prenom-nom/',
      { dejaTraites: new Set(['urn:li:share:1']), budget: budget(10, 10), surRequete: async () => undefined },
    );
    expect(r.urns).toEqual(['urn:li:share:2']);
  });

  it('s’arrête net au plafond de posts du jour', async () => {
    const r = await trouverPostsDeProfil(
      piloteProfil(activite(['urn:li:share:1', 'urn:li:share:2', 'urn:li:share:3'])),
      'https://www.linkedin.com/in/prenom-nom/',
      { dejaTraites: new Set(), budget: budget(2, 10), surRequete: async () => undefined },
    );
    expect(r).toEqual({ urns: ['urn:li:share:1', 'urn:li:share:2'], arret: 'plafond' });
  });

  it('ne part pas du tout quand le budget est déjà épuisé', async () => {
    const surRequete = vi.fn(async () => undefined);
    // `pilote({})` lève sur tout : si une requête partait malgré le plafond, le test tomberait
    // sur l'erreur du pilote plutôt que sur une assertion — c'est voulu.
    const r = await trouverPostsDeProfil(pilote({}), 'https://www.linkedin.com/in/prenom-nom/', {
      dejaTraites: new Set(),
      budget: budget(0, 10),
      surRequete,
    });
    expect(r).toEqual({ urns: [], arret: 'plafond' });
    expect(surRequete).not.toHaveBeenCalled();
  });

  it('rend « liste vide » pour un profil qui existe mais ne publie pas', async () => {
    const r = await trouverPostsDeProfil(piloteProfil('<html></html>'), 'https://www.linkedin.com/in/prenom-nom/', {
      dejaTraites: new Set(),
      budget: budget(10, 10),
      surRequete: async () => undefined,
    });
    expect(r).toEqual({ urns: [], arret: { type: 'liste_vide' } });
  });

  it('remonte une friction sur le statut de la page d’activité', async () => {
    const p = pilote({
      aller: async () => undefined,
      url: async () => 'https://www.linkedin.com/in/prenom-nom/',
      requete: async () => ({ statut: 999, corps: '' }),
    });
    await expect(
      trouverPostsDeProfil(p, 'https://www.linkedin.com/in/prenom-nom/', {
        dejaTraites: new Set(),
        budget: budget(10, 10),
        surRequete: async () => undefined,
      }),
    ).rejects.toMatchObject({ name: 'FrictionLinkedIn' });
  });
});
