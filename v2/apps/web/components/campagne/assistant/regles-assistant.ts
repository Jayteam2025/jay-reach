/**
 * Les règles de l'assistant de création de campagne, séparées du rendu pour rester testables sans DOM.
 *
 * Sans `'use client'` : la page serveur (`campaigns/new/page.tsx`) peut en lire sans franchir la
 * frontière (voir `lib/frontiere-client-serveur.test.ts`). Les types viennent des composants client,
 * mais un `import type` s'efface à la compilation : il ne tire aucun code client côté serveur.
 */
import type { EtapeSequenceEtape, CanalEtape } from './EtapeSequence';
import type { PersonaOptionAssistant } from './EtapeQui';

/**
 * Un seul persona actif : c'est forcément celui-là, on le présélectionne. Plusieurs : aucun n'est
 * présélectionné. Le premier de la liste n'est pas « le sien » pour celui qui crée la campagne, et il a
 * fini par partir tel quel (« Commercial Terrain » choisi sans que personne l'ait voulu).
 */
export function personaInitial(personas: readonly PersonaOptionAssistant[]): string | null {
  return personas.length === 1 ? personas[0]!.id : null;
}

/** La relecture des premiers envois démarre au défaut de l'organisation (Réglages › Plafonds), pas à une valeur propre à l'assistant. */
export function relectureInitiale(defautOrganisation: number): string {
  return String(Number.isFinite(defautOrganisation) && defautOrganisation > 0 ? Math.floor(defautOrganisation) : 0);
}

/**
 * Canal d'une étape ajoutée. La PREMIÈRE étape d'une séquence ouvre par une invitation LinkedIn quand un
 * compte LinkedIn est connecté (c'est ce que fait un commercial : on se connecte avant d'écrire), sinon par un
 * email. Les suivantes restent des emails, comme avant.
 */
export function canalParDefaut(nombreEtapesExistantes: number, linkedinConnecte: boolean): CanalEtape {
  return nombreEtapesExistantes === 0 && linkedinConnecte ? 'linkedin_invite' : 'email';
}

/**
 * Ajoute une étape en fin de séquence ET dit laquelle ouvrir : la nouvelle. Le formulaire restait sur
 * l'étape précédente, et l'opérateur croyait que rien ne s'était passé.
 */
export function ajouterEtapeALaSequence(
  etapes: readonly EtapeSequenceEtape[],
  linkedinConnecte: boolean,
  maintenant: number,
): { etapes: readonly EtapeSequenceEtape[]; cleOuverte: string } {
  const cle = `manuel-${maintenant}-${etapes.length}`;
  const nouvelle: EtapeSequenceEtape = {
    cle,
    canal: canalParDefaut(etapes.length, linkedinConnecte),
    sujet: '',
    corps: '',
    delaiJours: 2,
  };
  return { etapes: [...etapes, nouvelle], cleOuverte: cle };
}

export type MotifEtapeIncomplete = 'emailVide' | 'emailObjet' | 'emailCorps' | 'messageLinkedinCorps';

export interface EtapeIncomplete {
  readonly motif: MotifEtapeIncomplete;
  /** Rang affiché à l'opérateur : 1 pour la première étape. */
  readonly rang: number;
  readonly cle: string;
}

/**
 * La première étape qui ne pourrait pas partir : un email sans objet ou sans corps, un message LinkedIn
 * sans texte. Une invitation n'a pas de texte à écrire (elle part sans note). Sans ce contrôle, une étape
 * vide s'ajoutait sans erreur, et le moteur la refusait à l'envoi (`message_vide`) en mettant la personne en pause.
 */
export function premiereEtapeIncomplete(etapes: readonly EtapeSequenceEtape[]): EtapeIncomplete | null {
  for (const [index, etape] of etapes.entries()) {
    const rang = index + 1;
    const sansObjet = etape.sujet.trim() === '';
    const sansCorps = etape.corps.trim() === '';
    if (etape.canal === 'email') {
      if (sansObjet && sansCorps) return { motif: 'emailVide', rang, cle: etape.cle };
      if (sansObjet) return { motif: 'emailObjet', rang, cle: etape.cle };
      if (sansCorps) return { motif: 'emailCorps', rang, cle: etape.cle };
    } else if (etape.canal === 'linkedin_message' && sansCorps) {
      return { motif: 'messageLinkedinCorps', rang, cle: etape.cle };
    }
  }
  return null;
}

export type ErreurEtapeQui = 'nom' | 'persona';

/**
 * Ce qui empêche de quitter l'étape « Qui ». Le persona est un choix obligatoire dès qu'il y en a un à
 * choisir ; sans aucun persona actif, la carte dit déjà d'en créer un et la création reste possible.
 */
export function erreurEtapeQui(
  etat: { nom: string; personaId: string | null },
  personas: readonly PersonaOptionAssistant[],
): ErreurEtapeQui | null {
  if (!etat.nom.trim()) return 'nom';
  if (personas.length > 0 && !etat.personaId) return 'persona';
  return null;
}

/**
 * Applique une modification à une étape. Passer à « Invitation LinkedIn » vide l'objet et le corps : une
 * invitation part sans note, et le serveur refuse (« Une invitation part sans note ») un corps resté là
 * depuis un email déjà rédigé. Ce qu'on a écrit pour l'email est perdu en changeant de canal : l'écran
 * ne montre plus de champ à corriger, il ne doit donc rien en garder en cachette.
 */
export function appliquerModificationEtape(
  etape: EtapeSequenceEtape,
  patch: Partial<Omit<EtapeSequenceEtape, 'cle'>>,
): EtapeSequenceEtape {
  const suivante = { ...etape, ...patch };
  return suivante.canal === 'linkedin_invite' ? { ...suivante, sujet: '', corps: '' } : suivante;
}
