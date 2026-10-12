/**
 * Chiffrement AES-256-GCM de la clé d'instance (`ENCRYPTION_KEY`), Web Crypto.
 *
 * Source unique (le réexport de `@jay-reach/providers` a été retiré : son import ne résolvait pas à
 * l'exécution, l'export map pointant vers le `.ts`). La clé est un secret de 32 octets, en hex (64 car.) ou
 * en base64 (44 car.). Chaque chiffrement tire un IV neuf ; le résultat est le base64 de
 * `IV || chiffré`.
 *
 * AUCUN message d'erreur ne porte la clé, le clair ni le chiffré : une erreur se reconnaît
 * à son `code`, jamais à son contenu.
 */
const ALGORITHME = 'AES-GCM';
const LONGUEUR_IV = 12;
const LONGUEUR_TAG = 128;

export type CodeErreurChiffrement = 'cle_absente' | 'cle_invalide' | 'charge_illisible';

const CONSEILS: Record<CodeErreurChiffrement, string> = {
  cle_absente: 'Définir ENCRYPTION_KEY (32 octets, base64 ou hex ; en générer une : openssl rand -base64 32).',
  cle_invalide:
    'ENCRYPTION_KEY doit faire exactement 32 octets, en base64 (44 caractères) ou en hex (64) ; en générer une : openssl rand -base64 32. Une phrase libre ne convient pas ici.',
  charge_illisible: 'Vérifier que ENCRYPTION_KEY est identique côté app et côté worker.',
};

export class ErreurChiffrement extends Error {
  constructor(public readonly code: CodeErreurChiffrement) {
    super(`Chiffrement : ${code}. ${CONSEILS[code]}`);
    this.name = 'ErreurChiffrement';
  }
}

function enOctets(valeur: string): Uint8Array<ArrayBuffer> {
  if (/^[0-9a-fA-F]{64}$/.test(valeur)) {
    const octets = new Uint8Array(32);
    for (let i = 0; i < 32; i++) octets[i] = parseInt(valeur.substring(i * 2, i * 2 + 2), 16);
    return octets;
  }
  try {
    return Uint8Array.from(atob(valeur), (c) => c.charCodeAt(0));
  } catch {
    throw new ErreurChiffrement('cle_invalide');
  }
}

async function lireCle(): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const valeur = process.env.ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!valeur) throw new ErreurChiffrement('cle_absente');
  const octets = enOctets(valeur);
  if (octets.length !== 32) throw new ErreurChiffrement('cle_invalide');
  return crypto.subtle.importKey('raw', octets, { name: ALGORITHME }, false, ['encrypt', 'decrypt']);
}

/** Chiffre un texte ; rend le base64 de `IV || chiffré`. */
export async function chiffrer(clair: string): Promise<string> {
  const cle = await lireCle();
  const iv = crypto.getRandomValues(new Uint8Array(LONGUEUR_IV));
  const chiffre = await crypto.subtle.encrypt(
    { name: ALGORITHME, iv, tagLength: LONGUEUR_TAG },
    cle,
    new TextEncoder().encode(clair),
  );
  const tout = new Uint8Array(LONGUEUR_IV + chiffre.byteLength);
  tout.set(iv, 0);
  tout.set(new Uint8Array(chiffre), LONGUEUR_IV);
  return btoa(String.fromCharCode(...tout));
}

/** Déchiffre ce que `chiffrer` a produit. Toute anomalie lève `charge_illisible`, sans détail. */
export async function dechiffrer(chiffre: string): Promise<string> {
  const cle = await lireCle();
  try {
    const tout = Uint8Array.from(atob(chiffre), (c) => c.charCodeAt(0));
    if (tout.length < LONGUEUR_IV + 16) throw new Error();
    const clair = await crypto.subtle.decrypt(
      { name: ALGORITHME, iv: tout.slice(0, LONGUEUR_IV), tagLength: LONGUEUR_TAG },
      cle,
      tout.slice(LONGUEUR_IV),
    );
    return new TextDecoder().decode(clair);
  } catch {
    throw new ErreurChiffrement('charge_illisible');
  }
}
