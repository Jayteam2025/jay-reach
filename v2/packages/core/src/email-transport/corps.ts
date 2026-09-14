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

/**
 * Décode les entités HTML courantes. `&amp;` en dernier : le décoder plus tôt
 * transformerait à tort une entité déjà échappée (`&amp;lt;`, qui affiche le
 * texte littéral « &lt; ») en caractère spécial.
 */
function decoderEntitesHtml(texte: string): string {
  return texte
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_correspondance, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_correspondance, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&amp;/gi, '&');
}

/**
 * HTML minimal SalesBlink → texte brut (sens inverse de `corpsPourSalesBlink`).
 * `GET /inbox` ne renvoie le corps d'une tâche qu'en HTML (`data.email.body`) ;
 * ce convertisseur volontairement simple (pas de parseur HTML complet) retire
 * `<style>`/`<script>` et leur contenu, convertit les sauts de bloc usuels
 * (`<br>`, `</p>`, `</div>`, `</li>`, `</tr>`) en saut de ligne, retire les
 * balises restantes, décode les entités HTML courantes puis compacte les
 * espaces et les lignes vides en trop.
 */
export function texteDepuisHtml(html: string): string {
  const sansStyleNiScript = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  const avecSautsDeLigne = sansStyleNiScript
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n');

  const sansBalises = avecSautsDeLigne.replace(/<[^>]+>/g, '');

  const decode = decoderEntitesHtml(sansBalises);

  return decode
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((ligne) => ligne.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
