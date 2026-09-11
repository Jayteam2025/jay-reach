/**
 * Rendu du texte de Jay Reach vers ce que SalesBlink conserve tel quel.
 * SalesBlink n'interprète pas de Markdown ni de mise en forme riche : un
 * HTML minimal (`<p>`, `<br>`) est le seul moyen de préserver les paragraphes
 * et les sauts de ligne du texte rendu par le séquenceur.
 */

/** Échappe les caractères qui casseraient le HTML minimal produit ici. */
function echapper(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Texte rendu par Jay Reach → HTML minimal que SalesBlink conserve : `<p>` par
 * paragraphe (séparé par une ou plusieurs lignes vides), `<br>` par saut
 * simple, texte échappé. Une URL nue n'est jamais transformée en lien : ce
 * n'est pas le rôle de ce rendu, et SalesBlink l'affiche très bien telle quelle.
 */
export function corpsPourSalesBlink(texte: string): string {
  const normalise = texte.replace(/\r\n/g, '\n');
  const paragraphes = normalise
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphes.map((p) => `<p>${echapper(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Longueur maximale d'un objet d'email : au-delà, les clients de messagerie le tronquent de toute façon. */
const LONGUEUR_MAX_OBJET = 200;

/** Objet : une ligne, sans saut, 200 caractères maximum. */
export function objetPourSalesBlink(texte: string): string {
  const uneLigne = texte
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0)
    .join(' ');
  return uneLigne.slice(0, LONGUEUR_MAX_OBJET);
}
