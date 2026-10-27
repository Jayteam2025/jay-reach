/**
 * Réparation du texte reçu dont l'UTF-8 a été relu en Windows-1252 (« PrÃ©servez », « EnvoyÃ© »).
 *
 * Constat du 27/10 : un message du 14/10 était stocké ainsi, tel que Microsoft Graph le livre (notre
 * lecture décode la réponse HTTP en UTF-8, donc rien chez nous ne relit de l'UTF-8 en latin-1 : le
 * défaut est dans le message reçu, un des systèmes par lesquels il a transité). Le même message mêlait
 * du texte juste (« é », « à » corrects) et du texte abîmé : on ne peut donc jamais décoder le message
 * entier, seulement les séquences qui ont la forme exacte d'un caractère UTF-8 relu octet par octet.
 *
 * Une séquence n'est réparée que si :
 *  - elle commence par l'un des cinq caractères qui ouvrent les séquences du français (« Â » « Ã »
 *    « Å » : lettres latines et signes U+0080-U+017F ; « â » : ponctuation « ’ “ … — € » ; « ð » : emoji) ;
 *  - elle a le nombre exact de caractères de suite (un octet de suite se lit U+0080-U+00BF, ou l'un des
 *    caractères que Windows-1252 met à la place des octets 0x80-0x9F) ;
 *  - et ses octets forment de l'UTF-8 valide.
 * Sinon elle reste telle quelle. Un texte déjà juste n'a aucune de ces séquences : la fonction le rend
 * inchangé, et rejouée sur son propre résultat elle ne change plus rien.
 */

/** Windows-1252, octets 0x80-0x9F : le caractère que l'on lit à la place. Les cinq octets non définis (0x81, 0x8D, 0x8F, 0x90, 0x9D) se lisent U+0081 etc., comme n'importe quel octet < 0xA0. */
const WINDOWS_1252_HAUT: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Un caractère de suite : U+0080-U+00BF, ou un des caractères de `WINDOWS_1252_HAUT`. */
const SUITE = `[\\u0080-\\u00BF${Object.keys(WINDOWS_1252_HAUT).join('')}]`;

/** Une séquence UTF-8 relue en Windows-1252 : 2 octets (Â Ã Å), 3 (â) ou 4 (ð). */
const SEQUENCE_ABIMEE = new RegExp(`[\\u00C2\\u00C3\\u00C5]${SUITE}|\\u00E2${SUITE}{2}|\\u00F0${SUITE}{3}`, 'g');

function versOctet(caractere: string): number {
  return WINDOWS_1252_HAUT[caractere] ?? caractere.charCodeAt(0);
}

/** Décodage strict : lève sur de l'UTF-8 invalide au lieu de fabriquer des « � ». */
const DECODEUR = new TextDecoder('utf-8', { fatal: true });

export function reparerMojibake(texte: string): string {
  return texte.replace(SEQUENCE_ABIMEE, (sequence) => {
    try {
      return DECODEUR.decode(Uint8Array.from(sequence, versOctet));
    } catch {
      return sequence;
    }
  });
}
