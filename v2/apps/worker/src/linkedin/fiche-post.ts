/**
 * La fiche d'un post LinkedIn : qui l'a écrit, de quoi il parle, quand il est paru.
 *
 * Sert l'accroche qui NOMME le post (« je vous ai vu réagir au post de Christelle sur… »).
 *
 * **Rien de ce qui suit n'a été confronté à une page vivante** : la session LinkedIn de
 * production ne sort que par son proxy, et aucune mesure n'a pu être faite depuis le poste de
 * développement. Les formes lues viennent du code existant (`profils.ts`, `posts.ts`,
 * `engageurs.ts`) et de ce que LinkedIn publie sur ses pages de post (JSON-LD, `<title>`,
 * métadonnées OpenGraph). Chaque endroit où la page est lue est isolé dans la section
 * `LECTURE DE LA PAGE` : corriger une forme réelle se fait là, et nulle part ailleurs.
 *
 * **Ne lève jamais.** Une page illisible rend une fiche aux champs nuls : l'appelant décide
 * alors de ne pas nommer le post, il n'a pas à rattraper une exception.
 */
import { z } from 'zod';
import { frictionDeLUrl, urnDActivite } from './engageurs.js';
import type { Pilote } from './navigateur.js';

export type AuteurDePost = {
  kind: 'person' | 'page';
  nom: string;
  nomAffiche: string;
  nomPublic: string | null;
  url: string | null;
};
export type FichePost = {
  urn: string | null;
  url: string;
  auteur: AuteurDePost | null;
  texte: string | null;
  date: Date | null;
};

/** Longueur maximale du texte gardé : assez pour nommer le sujet, pas pour stocker le post. */
export const TEXTE_MAX = 1_200;

/** Le prénom d'une personne, le nom entier d'une page. */
export function nomAffichePourAuteur(kind: 'person' | 'page', nom: string): string {
  const propre = nom.trim().replace(/\s+/g, ' ');
  if (kind === 'page') return propre;
  return propre.split(' ')[0] ?? '';
}

// ---------------------------------------------------------------------------------------------
// Identifiant d'activité -> date
// ---------------------------------------------------------------------------------------------

const DEBUT_LINKEDIN_MS = Date.UTC(2003, 0, 1);

/**
 * La date de publication portée par l'identifiant d'un post : les 41 bits de poids fort sont un
 * horodatage en millisecondes (identifiants de type « flocon »). DÉDUIT, jamais mesuré ici ; on
 * refuse tout résultat hors de [2003, demain], ce qui écarte un identifiant d'un autre format
 * plutôt que de rendre une date fausse.
 */
export function dateDeLActivite(urn: string): Date | null {
  const m = /^urn:li:(?:activity|ugcPost|share):(\d+)$/.exec(urn);
  if (!m?.[1]) return null;
  const ms = Number(BigInt(m[1]) >> 22n);
  if (!Number.isFinite(ms) || ms < DEBUT_LINKEDIN_MS || ms > Date.now() + 86_400_000) return null;
  return new Date(ms);
}

// ---------------------------------------------------------------------------------------------
// LECTURE DE LA PAGE : tout ce qui suppose une forme du HTML est ici
// ---------------------------------------------------------------------------------------------

const SchemaAuteurLd = z.object({
  '@type': z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
});
const SchemaPostLd = z.object({
  '@type': z.union([z.string(), z.array(z.string())]).optional(),
  articleBody: z.string().optional(),
  text: z.string().optional(),
  datePublished: z.string().optional(),
  author: z.union([SchemaAuteurLd, z.array(SchemaAuteurLd)]).optional(),
});
type PostLd = z.infer<typeof SchemaPostLd>;

function decoderEntites(texte: string): string {
  return texte
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Premier bloc JSON-LD qui décrit un post (directement, en tableau ou dans `@graph`). */
function postDuJsonLd(html: string): PostLd | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let brut: unknown;
    try {
      brut = JSON.parse(m[1] ?? '');
    } catch {
      continue;
    }
    const candidats: unknown[] = Array.isArray(brut) ? brut : [brut];
    for (const c of [...candidats]) {
      const graphe = (c as { '@graph'?: unknown } | null)?.['@graph'];
      if (Array.isArray(graphe)) candidats.push(...(graphe as unknown[]));
    }
    for (const c of candidats) {
      const lu = SchemaPostLd.safeParse(c);
      if (!lu.success) continue;
      const type = lu.data['@type'];
      const types = Array.isArray(type) ? type : type === undefined ? [] : [type];
      if (types.some((t) => /Posting|Article/i.test(t)) || lu.data.author !== undefined) return lu.data;
    }
  }
  return null;
}

function metaContenu(html: string, propriete: string): string | null {
  const balises = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const b of balises) {
    if (!new RegExp(`(?:property|name)=["']${propriete}["']`, 'i').test(b)) continue;
    const contenu = /content=(?:"([^"]*)"|'([^']*)')/i.exec(b);
    const valeur = contenu?.[1] ?? contenu?.[2];
    if (valeur !== undefined && valeur.trim() !== '') return decoderEntites(valeur);
  }
  return null;
}

/** Le nom de l'auteur d'après `<title>` : « Nom sur LinkedIn : début du post » (ou « on LinkedIn: »). */
function nomDuTitre(html: string): string | null {
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (titre === undefined) return null;
  const m = /^\s*([^:|]{2,120}?)\s+(?:sur|on)\s+LinkedIn\b/i.exec(decoderEntites(titre));
  return m?.[1]?.trim() || null;
}

/** Une adresse de profil ou de page : le type, le nom public, et l'adresse canonique reconstruite. */
function identiteDeLien(lien: string): { kind: 'person' | 'page'; nomPublic: string; url: string } | null {
  const m = /linkedin\.com\/(in|company|showcase)\/([^/?#"'\s<>]+)/i.exec(lien);
  const type = m?.[1]?.toLowerCase();
  const brut = m?.[2];
  if (type === undefined || brut === undefined) return null;
  let nomPublic = brut;
  try {
    nomPublic = decodeURIComponent(brut);
  } catch {
    // garder la forme brute
  }
  const kind = type === 'in' ? 'person' : 'page';
  const segment = type === 'in' ? 'in' : type === 'showcase' ? 'showcase' : 'company';
  return { kind, nomPublic, url: `https://www.linkedin.com/${segment}/${encodeURIComponent(nomPublic)}/` };
}

/**
 * Repli quand le JSON-LD manque : parmi les liens de profil ou de page du corps, celui dont la
 * position est la plus proche d'une mention du nom. Même piège que celui des profils suggérés
 * (`profils.ts`) : le PREMIER lien du document n'est pas forcément l'auteur.
 */
function lienLePlusProcheDuNom(html: string, nom: string): ReturnType<typeof identiteDeLien> {
  const corps = html.replace(/<head[\s\S]*?<\/head>/i, '');
  const liens = [...corps.matchAll(/href=["']([^"']*linkedin\.com\/(?:in|company|showcase)\/[^"']*)["']/gi)];
  const mentions: number[] = [];
  const bas = corps.toLowerCase();
  const cible = nom.toLowerCase();
  for (let i = bas.indexOf(cible); i !== -1; i = bas.indexOf(cible, i + 1)) mentions.push(i);
  let meilleur: { id: ReturnType<typeof identiteDeLien>; distance: number } | null = null;
  for (const l of liens) {
    const id = identiteDeLien(l[1] ?? '');
    if (id === null) continue;
    for (const pos of mentions) {
      const distance = Math.abs((l.index ?? 0) - pos);
      if (meilleur === null || distance < meilleur.distance) meilleur = { id, distance };
    }
  }
  return meilleur?.id ?? null;
}

function auteurDuHtml(html: string, ld: PostLd | null): AuteurDePost | null {
  const brut = Array.isArray(ld?.author) ? ld.author[0] : ld?.author;
  const nom = (brut?.name?.trim() || nomDuTitre(html)) ?? null;
  if (nom === null || nom === '') return null;

  const parLien = brut?.url ? identiteDeLien(brut.url) : null;
  const identite = parLien ?? lienLePlusProcheDuNom(html, nom);
  const typeLd = brut?.['@type']?.toLowerCase();
  const kind = typeLd === 'organization' ? 'page' : typeLd === 'person' ? 'person' : (identite?.kind ?? null);
  // Sans type sûr, on ne devine pas : nommer une page par son « prénom » ferait un message absurde.
  if (kind === null) return null;
  return {
    kind,
    nom,
    nomAffiche: nomAffichePourAuteur(kind, nom),
    nomPublic: identite?.nomPublic ?? null,
    url: identite?.url ?? null,
  };
}

function texteDuHtml(html: string, ld: PostLd | null): string | null {
  const brut = ld?.articleBody ?? ld?.text ?? metaContenu(html, 'og:description') ?? metaContenu(html, 'description');
  const propre = brut?.replace(/\s+/g, ' ').trim();
  if (!propre) return null;
  return propre.length > TEXTE_MAX ? propre.slice(0, TEXTE_MAX).trimEnd() : propre;
}

function dateDuHtml(html: string, ld: PostLd | null, urn: string | null): Date | null {
  for (const brut of [ld?.datePublished, metaContenu(html, 'article:published_time')]) {
    if (brut === undefined || brut === null) continue;
    const d = new Date(brut);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return urn === null ? null : dateDeLActivite(urn);
}

/** Lecture pure d'une page déjà chargée. Ne lève jamais. */
export function lireFicheDuHtml(html: string, url: string): FichePost {
  const fiche: FichePost = { urn: urnDActivite(url), url, auteur: null, texte: null, date: null };
  try {
    // L'URN de la page, quand l'adresse n'en portait pas (lien raccourci, redirection).
    fiche.urn ??= /urn:li:(activity|ugcPost|share):\d+/.exec(html)?.[0] ?? null;
    const ld = postDuJsonLd(html);
    fiche.auteur = auteurDuHtml(html, ld);
    fiche.texte = texteDuHtml(html, ld);
    fiche.date = dateDuHtml(html, ld, fiche.urn);
  } catch {
    // contrat : une page illisible rend ce qui a été lu avant, jamais une exception
  }
  return fiche;
}

// ---------------------------------------------------------------------------------------------

/**
 * Charge la page du post et en lit la fiche.
 *
 * Deux requêtes vers LinkedIn : la navigation (qui pose le contexte same-origin et révèle une
 * friction) puis la lecture du document, car `Pilote` n'expose pas le HTML courant. L'appelant
 * qui est déjà sur la page (`lireEngageurs`) compte cette requête dans son budget.
 */
export async function lireFichePost(pilote: Pilote, url: string): Promise<FichePost> {
  const vide: FichePost = { urn: urnDActivite(url), url, auteur: null, texte: null, date: null };
  try {
    await pilote.aller(url);
    if (frictionDeLUrl(await pilote.url())) return vide;
    const rep = await pilote.requete(url);
    if (rep.statut < 200 || rep.statut >= 300) return vide;
    return lireFicheDuHtml(rep.corps, url);
  } catch {
    return vide;
  }
}
