/**
 * Contrôle de l'IP de sortie du navigateur LinkedIn (lot 4a).
 *
 * Aucun appel réseau ici : la relève est injectée. Elle doit être exécutée PAR
 * le navigateur (tâche 3), jamais par le worker, dont l'IP publique est celle du
 * VPS : mesurée depuis le worker, l'IP vue égalerait l'IP attendue figée à la
 * première connexion et le contrôle dirait « conforme » à chaque passage.
 */
import type { Contexte } from './contexte.js';
import { bloquerSessionLinkedIn } from './linkedin-session.js';

export type Sortie = { ip: string; operateur?: string; pays?: string };

/** Titulaire de l'IP selon le registre (RDAP) : le pays n'y est qu'une déclaration, l'adresse dit où il est. */
export type Titulaire = { nom?: string; paysDeclare?: string; adresses: string[] };

/**
 * Les bases de géolocalisation recopient le pays déclaré par le titulaire : trois
 * d'entre elles disaient « France, Paris » pour une IP dont le titulaire est à
 * Sofia (mesuré le 07/10). LinkedIn lui-même hésite — son courriel de nouvel
 * appareil disait Sofia, sa page des sessions actives Saint-Denis — donc on
 * n'affirme rien sur ce qu'il retient. Seul l'écart entre le pays déclaré et
 * l'adresse du titulaire est un fait. Information pour l'opérateur, jamais un blocage.
 *
 * Faux positif possible : une adresse qui ne mentionne aucun pays. Il coûte une
 * ligne d'information, on ne cherche pas à l'éviter.
 */
export function desaccordDeTitulaire(t: Titulaire | null): string | null {
  const code = t?.paysDeclare?.trim().toUpperCase();
  if (!t || !code || !/^[A-Z]{2}$/.test(code) || t.adresses.length === 0) return null;
  let nomEn: string | undefined;
  try {
    nomEn = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
  } catch {
    nomEn = undefined;
  }
  const texte = t.adresses.join(' ').toLowerCase();
  if (new RegExp(`\\b${code.toLowerCase()}\\b`).test(texte)) return null;
  if (nomEn && texte.includes(nomEn.toLowerCase())) return null;
  let nomFr = code;
  try {
    nomFr = new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code;
  } catch {
    // Le code seul suffit à la phrase.
  }
  return `le titulaire déclare le pays ${nomFr} mais son adresse est « ${t.adresses[0]} » : LinkedIn pourrait situer la connexion ailleurs`;
}

/**
 * Compare la sortie observée à l'IP attendue et bloque la session si elles
 * diffèrent. Seule l'égalité des IP décide ; l'opérateur et le pays sont
 * informatifs. Sans IP attendue (première connexion), rien à comparer : ok.
 *
 * Si la relève échoue, la sortie n'est pas établie : le passage échoue avec une
 * erreur générique, sans toucher à la session (le motif `sortie_inattendue`
 * affirmerait une IP qu'on n'a pas vue ; les échecs répétés relèvent du
 * disjoncteur). L'erreur d'origine peut porter l'URL du proxy avec ses
 * identifiants : elle n'est ni consignée ni chaînée en `cause`.
 */
export async function verifierSortie(
  ctx: Contexte,
  attendue: string | null,
  releve: () => Promise<Sortie>,
): Promise<{ ok: boolean; sortie: Sortie }> {
  let sortie: Sortie;
  try {
    sortie = await releve();
  } catch {
    throw new Error('Relève de la sortie LinkedIn impossible');
  }
  const ok = attendue === null || sortie.ip === attendue;
  if (!ok) await bloquerSessionLinkedIn(ctx, 'sortie_inattendue');
  return { ok, sortie };
}
