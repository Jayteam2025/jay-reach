/**
 * Le nom d'un modèle de langage tel qu'un directeur commercial le lit : « claude-sonnet-5 » devient
 * « Claude Sonnet 5 », « claude-haiku-4-5-20251001 » devient « Claude Haiku 4.5 ». L'identifiant
 * brut, avec sa date de publication, reste réservé aux détails techniques.
 *
 * Un identifiant qui n'a pas la forme d'un modèle Claude (un modèle saisi à la main, d'un autre
 * éditeur) est rendu tel quel : mieux vaut un nom brut exact qu'un nom « lisible » inventé.
 */

const FAMILLES = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' } as const;
type Famille = keyof typeof FAMILLES;

function estFamille(nom: string): nom is Famille {
  return nom in FAMILLES;
}

// Forme actuelle : claude-<famille>-<majeur>[-<mineur>][-<date AAAAMMJJ>]
const FORME_ACTUELLE = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
// Forme historique : claude-<majeur>[-<mineur>]-<famille>[-<date AAAAMMJJ>] (claude-3-5-sonnet-20241022)
const FORME_HISTORIQUE = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)(?:-\d{8})?$/;

function composer(famille: string, majeur: string, mineur: string | undefined): string | null {
  if (!estFamille(famille)) return null;
  return `Claude ${FAMILLES[famille]} ${majeur}${mineur ? `.${mineur}` : ''}`;
}

export function libelleModele(identifiant: string): string {
  const id = identifiant.trim();
  const actuelle = FORME_ACTUELLE.exec(id);
  if (actuelle) return composer(actuelle[1]!, actuelle[2]!, actuelle[3]) ?? id;
  const historique = FORME_HISTORIQUE.exec(id);
  if (historique) return composer(historique[3]!, historique[1]!, historique[2]) ?? id;
  return id;
}
