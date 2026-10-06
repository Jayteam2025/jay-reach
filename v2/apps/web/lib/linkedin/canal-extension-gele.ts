/**
 * CANAL EXTENSION GELE (lot 4a, tache 10, 06/10/2026).
 *
 * Le travail LinkedIn s'execute cote serveur (session en ligne de commande,
 * proxy residentiel dedie, plafonds, trace par requete). Les cinq routes
 * `/api/extension/linkedin/*` servaient l'extension navigateur, qui agissait
 * depuis l'IP personnelle de l'operateur, sans plafond ni trace. Une copie
 * d'extension deja chargee en local ne se met pas a jour toute seule : c'est
 * donc ICI, cote serveur, que la porte se ferme pour de bon.
 *
 * Les routes refusent tout, meme avec un jeton valide, AVANT de lire le corps
 * ou d'ouvrir la base. Le code d'origine reste en place derriere la garde
 * (regle 1 de v2/CLAUDE.md). Pour reveiller : passer CANAL_EXTENSION_GELE a
 * false et degeler l'extension (voir apps/extension/background.js). Le test
 * canal-extension-gele.test.ts rougira, c'est voulu.
 */
export const CANAL_EXTENSION_GELE = true;

/** Reponse de refus : 410 Gone, rien n'est delivre ni accepte. */
export function refusCanalGele(): Response | null {
  if (!CANAL_EXTENSION_GELE) return null;
  return Response.json({ error: 'canal_gele' }, { status: 410 });
}
