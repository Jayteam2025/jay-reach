'use client';

/**
 * Écran de validation des posts collectés (variante A de la maquette `posts-a-valider`,
 * « la phrase est l'objet »).
 *
 * Ce qu'un opérateur relit, c'est la phrase TELLE QU'ELLE PARTIRA, et ce qui est variable s'édite
 * à l'intérieur de cette phrase : une valeur relue dans un champ à part se juge hors contexte, et
 * c'est là que passent les ratés. DEUX champs, pas un — le sujet du post et le nom de son auteur :
 * le nom affiché est ce qui part dans le message, et la capture ne sait pas toujours le lire. Sans
 * cette seconde édition, une fiche dont l'auteur manque est une impasse : la garde retient, la
 * validation ne débloque rien, et aucun écran ne permet de réparer.
 *
 * L'écran ne porte aucune logique métier : tout ce qui se compose (dates, phrases, échéances)
 * arrive déjà écrit du serveur, comme pour `TablePlafonds`.
 *
 * AUCUN bouton n'efface quoi que ce soit, ni à l'unité ni en lot. Rejeter est un drapeau
 * réversible (« Rouvrir »).
 */
import { useRef, useState, useTransition } from 'react';
import type { ChampAccroche } from '@jay-reach/core';
import { Bouton, Puce } from '../ui';
import { creerEnregistreurDeChamp, validerApresEnregistrement } from './enregistreur-champ';
import {
  actionCorrigerAuteur,
  actionCorrigerSujet,
  actionRejeterPost,
  actionReouvrirPost,
  actionValiderPost,
  actionValiderPosts,
} from '../../app/actions/posts';

/**
 * Un morceau de la phrase. `manquant` porte un libellé DÉJÀ composé (« date indisponible ») :
 * comme le reste de cet écran, le texte arrive écrit du serveur — c'est lui qui a la langue.
 */
export type MorceauEcran = { texte: string } | { champ: ChampAccroche } | { manquant: string };

export interface LignePostEcran {
  id: string;
  /** `null` : l'auteur n'a pas pu être lu, l'écran écrit « Auteur inconnu » et laisse l'écrire. */
  auteur: string | null;
  /** Déjà composé (« publié le 12/10 »). */
  publie: string;
  url: string;
  sujet: string | null;
  /** La phrase déjà résolue, découpée autour des champs que l'opérateur écrit lui-même. */
  morceaux: MorceauEcran[];
  etat: 'pending' | 'approved' | 'rejected';
  etatLibelle: string;
  /** Déjà composé (« jusqu'à 47 personnes attendent »), `null` quand la campagne ne nomme aucun post. */
  attente: string | null;
  /** `null` quand la campagne ne nomme aucun post : l'épargne de purge ne s'applique pas, rien à promettre. */
  echeance: string | null;
  tonEcheance: 'loin' | 'bientot' | 'urgent';
  etiquetteSujet: string;
  etiquetteAuteur: string;
}

export interface TablePostsProps {
  campagneId: string;
  lignes: LignePostEcran[];
  peutModifier: boolean;
  libelles: {
    auteurInconnu: string;
    voir: string;
    sujetInvite: string;
    auteurInvite: string;
    valider: string;
    rejeter: string;
    rouvrir: string;
    /** Déjà composé (« 3 posts attendent votre relecture »). */
    resume: string;
    /** Déjà composé (« jusqu'à 106 personnes n'entrent pas… »), vide quand rien n'est retenu. */
    personnes: string;
    /** « Tout valider (2) », ou `null` quand rien n'est validable en lot. */
    toutValider: string | null;
    /** Pourquoi « Tout valider » est inactif : un champ modifié n'est pas encore enregistré. */
    lotBloque: string;
    /** Ce qu'un morceau `manquant` veut dire, au survol : la capture n'a pas pu lire cette valeur. */
    manquantAide: string;
  };
}

/** Les champs que la phrase de CETTE campagne rend éditables : ceux-là seuls partiront. */
function champsDeLaLigne(ligne: LignePostEcran): ChampAccroche[] {
  return ligne.morceaux.flatMap((m) => ('champ' in m ? [m.champ] : []));
}

/**
 * Un post se valide en lot quand il attend sa relecture ET que tous les champs que la campagne
 * écrit sont remplis. « Tous », et pas « le sujet » : une campagne qui nomme l'auteur sans le
 * sujet se valide sur l'auteur, et le serveur refuserait l'inverse.
 *
 * Une variable que la campagne écrit, qui manque, et que l'opérateur ne peut PAS écrire (la date
 * de publication) exclut la ligne du lot : le serveur la refuserait, « Tout valider » s'arrête au
 * premier refus, et rien de ce que l'opérateur peut faire ne la débloquerait. Son bouton
 * « Valider » à elle reste actif, lui : c'est la seule façon de lire pourquoi.
 */
export function ligneValidable(ligne: LignePostEcran): boolean {
  if (ligne.etat !== 'pending') return false;
  if (ligne.morceaux.some((m) => 'manquant' in m)) return false;
  return champsDeLaLigne(ligne).every((c) => ((c === 'auteur' ? ligne.auteur : ligne.sujet) ?? '').trim() !== '');
}

/** Met en mono les nombres d'un texte déjà composé : le design réserve le mono à ce qui est mesuré. */
function Chiffres({ texte }: { texte: string }) {
  return (
    <>
      {texte.split(/(\d+)/).map((morceau, i) =>
        i % 2 === 1 ? (
          <span key={i} className="n">
            {morceau}
          </span>
        ) : (
          morceau
        ),
      )}
    </>
  );
}

/**
 * « Tout valider » et, quand il est bloqué, la ligne qui dit pourquoi : un bouton désactivé sans
 * explication est un silence. Il l'est tant qu'un champ modifié n'est pas enregistré, sinon c'est
 * l'ancienne valeur qui partirait, sans que l'opérateur puisse s'en apercevoir.
 */
export function BarreLot({
  libelles,
  lotBloque,
  bloque,
  pending,
  onToutValider,
}: {
  libelles: TablePostsProps['libelles'];
  lotBloque: string;
  bloque: boolean;
  pending: boolean;
  onToutValider: () => void;
}) {
  return (
    <span className="pousse jr-posts-lot">
      {bloque && <small className="jr-secondaire">{lotBloque}</small>}
      <Bouton taille="petit" variante="discret" onClick={onToutValider} disabled={pending || bloque} aria-busy={pending}>
        {libelles.toutValider}
      </Bouton>
    </span>
  );
}

/**
 * Un champ d'accroche : ce que l'opérateur écrit DANS la phrase.
 *
 * Deux appels fixes par ligne (l'auteur, le sujet), jamais dans une boucle : l'ordre des hooks ne
 * doit pas dépendre de ce que la campagne écrit.
 */
function useChampAccroche(opts: {
  cle: string;
  valeurInitiale: string | null;
  envoyer: (valeur: string) => Promise<string | null>;
  surErreur: (message: string | null) => void;
  surEdition: (cle: string, enCours: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [brouillon, setBrouillon] = useState(opts.valeurInitiale ?? '');
  const lire = (): string => (ref.current?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // La valeur n'est confirmée qu'APRÈS la réponse du serveur (voir `enregistreur-champ.ts`) : un
  // clic sur « Valider » attend les enregistrements en vol et ne valide pas s'ils ont échoué.
  const [enregistreur] = useState(() =>
    creerEnregistreurDeChamp({
      confirmeInitial: opts.valeurInitiale ?? '',
      lire,
      envoyer: opts.envoyer,
      surErreur: (m) => opts.surErreur(m),
    }),
  );
  const signaler = () => opts.surEdition(opts.cle, lire() !== enregistreur.confirme());
  return {
    ref,
    enregistreur,
    signaler,
    vide: brouillon.trim() === '',
    valeurInitiale: opts.valeurInitiale ?? '',
    onInput: () => {
      setBrouillon(lire());
      signaler();
    },
    onBlur: () => {
      opts.surErreur(null);
      void enregistreur.enregistrer().then(signaler);
    },
  };
}

type ChampAccrocheRendu = ReturnType<typeof useChampAccroche>;

/** Le rendu d'un champ éditable dans la phrase. Aucune logique : l'état vit dans le hook. */
function Champ({
  champ,
  etiquette,
  invite,
  editable,
  pending,
}: {
  champ: ChampAccrocheRendu;
  etiquette: string;
  invite: string;
  editable: boolean;
  pending: boolean;
}) {
  return (
    <span
      ref={champ.ref}
      className={`jr-post-champ${champ.vide ? ' vide' : ''}${editable ? '' : ' fige'}`}
      contentEditable={editable && !pending}
      suppressContentEditableWarning
      role="textbox"
      aria-label={etiquette}
      data-invite={invite}
      onInput={champ.onInput}
      onBlur={champ.onBlur}
      onKeyDown={(e) => {
        // Le champ tient sur une ligne : Entrée valide la saisie au lieu de couper la phrase.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    >
      {champ.valeurInitiale}
    </span>
  );
}

function Ligne({
  campagneId,
  ligne,
  peutModifier,
  libelles,
  surEdition,
}: {
  campagneId: string;
  ligne: LignePostEcran;
  peutModifier: boolean;
  libelles: TablePostsProps['libelles'];
  /** Dit au parent si un champ de cette ligne porte une modification que le serveur n'a pas encore. */
  surEdition: (cle: string, enCours: boolean) => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = peutModifier && ligne.etat !== 'rejected';

  const auteur = useChampAccroche({
    cle: `${ligne.id}:auteur`,
    valeurInitiale: ligne.auteur,
    envoyer: async (valeur) => {
      const res = await actionCorrigerAuteur(campagneId, ligne.id, valeur);
      return res.ok ? null : res.error;
    },
    surErreur: setErreur,
    surEdition,
  });
  const sujet = useChampAccroche({
    cle: `${ligne.id}:sujet`,
    valeurInitiale: ligne.sujet,
    envoyer: async (valeur) => {
      const res = await actionCorrigerSujet(campagneId, ligne.id, valeur);
      return res.ok ? null : res.error;
    },
    surErreur: setErreur,
    surEdition,
  });
  const champs = { auteur, sujet };
  const presents = champsDeLaLigne(ligne);
  // Un champ que la campagne écrit et qui reste vide interdit la validation : le serveur la
  // refuserait, et un bouton qui part pour rien est pire qu'un bouton inactif.
  const incomplet = presents.some((c) => champs[c].vide);

  function valider() {
    setErreur(null);
    startTransition(async () => {
      await validerApresEnregistrement({
        enregistreurs: presents.map((c) => champs[c].enregistreur),
        valider: async () => {
          const res = await actionValiderPost(campagneId, ligne.id);
          return res.ok ? null : res.error;
        },
        surErreur: setErreur,
      });
      for (const c of presents) champs[c].signaler();
    });
  }

  function simple(action: typeof actionRejeterPost) {
    setErreur(null);
    startTransition(async () => {
      const res = await action(campagneId, ligne.id);
      if (!res.ok) setErreur(res.error);
    });
  }

  const etiquette: Record<ChampAccroche, string> = { auteur: ligne.etiquetteAuteur, sujet: ligne.etiquetteSujet };
  const invite: Record<ChampAccroche, string> = { auteur: libelles.auteurInvite, sujet: libelles.sujetInvite };

  return (
    <div className={`jr-post${ligne.etat === 'rejected' ? ' rejete' : ''}`}>
      <div className="jr-post-entete">
        <span className="jr-post-auteur">{ligne.auteur ?? libelles.auteurInconnu}</span>
        <span className="jr-post-meta">{ligne.publie}</span>
        {/* Une marque pour ce qui sort de la norme, rien pour la norme : un « en attente » sur
            chaque ligne d'un écran où tout attend ne dit rien. Le rejet, lui, explique le texte barré. */}
        {ligne.etat === 'rejected' && <Puce ton="gris">{ligne.etatLibelle}</Puce>}
        <a className="jr-post-lien" href={ligne.url} target="_blank" rel="noopener noreferrer">
          {libelles.voir}
        </a>
      </div>
      <p className="jr-post-phrase">
        <span className="fixe">« </span>
        {ligne.morceaux.map((m, i) =>
          'champ' in m ? (
            <Champ
              key={i}
              champ={champs[m.champ]}
              etiquette={etiquette[m.champ]}
              invite={invite[m.champ]}
              editable={editable}
              pending={pending}
            />
          ) : 'manquant' in m ? (
            /* Ni un champ, ni du texte : une valeur que la capture n'a pas pu lire. Le jeton brut
               (« votre réaction du {{post_date}} ») s'affichait ici, dans une phrase où rien ne
               permettait de le corriger. */
            <span key={i} className="jr-post-manquant" title={libelles.manquantAide}>
              {m.manquant}
            </span>
          ) : (
            <span key={i} className="fixe">
              {m.texte}
            </span>
          ),
        )}
        <span className="fixe"> »</span>
      </p>
      <div className="jr-post-pied">
        {ligne.attente !== null && (
          <span className="jr-post-attente">
            <Chiffres texte={ligne.attente} />
          </span>
        )}
        {ligne.echeance !== null && <span className={`jr-post-echeance ${ligne.tonEcheance}`}>{ligne.echeance}</span>}
        {peutModifier && (
          <span className="jr-post-actions">
            {ligne.etat === 'rejected' ? (
              <Bouton onClick={() => simple(actionReouvrirPost)} disabled={pending}>
                {libelles.rouvrir}
              </Bouton>
            ) : (
              <>
                <Bouton variante="discret" onClick={() => simple(actionRejeterPost)} disabled={pending}>
                  {libelles.rejeter}
                </Bouton>
                {ligne.etat === 'pending' && (
                  <Bouton variante="principal" onClick={valider} disabled={pending || incomplet} aria-busy={pending}>
                    {libelles.valider}
                  </Bouton>
                )}
              </>
            )}
          </span>
        )}
      </div>
      {erreur && (
        <p className="jr-post-erreur" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}

export function TablePosts({ campagneId, lignes, peutModifier, libelles }: TablePostsProps) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [enEdition, setEnEdition] = useState<ReadonlySet<string>>(new Set());
  function surEdition(cle: string, enCours: boolean) {
    setEnEdition((courant) => {
      if (courant.has(cle) === enCours) return courant;
      const suivant = new Set(courant);
      if (enCours) suivant.add(cle);
      else suivant.delete(cle);
      return suivant;
    });
  }
  // Seuls les posts en attente ET déjà pourvus de tout ce que la campagne écrit se valident en lot.
  const validables = lignes.filter(ligneValidable).map((l) => l.id);

  function toutValider() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionValiderPosts(campagneId, validables);
      if (!res.ok) setErreur(res.error);
    });
  }

  return (
    <div className="jr-carte">
      <div className="jr-posts-barre">
        <span>
          <Chiffres texte={libelles.resume} />
          {libelles.personnes !== '' && (
            <>
              {' · '}
              <Chiffres texte={libelles.personnes} />
            </>
          )}
        </span>
        {peutModifier && libelles.toutValider !== null && validables.length > 0 && (
          <BarreLot libelles={libelles} lotBloque={libelles.lotBloque} bloque={enEdition.size > 0} pending={pending} onToutValider={toutValider} />
        )}
      </div>
      {erreur && (
        <p className="jr-post-erreur jr-posts-erreur-lot" role="alert">
          {erreur}
        </p>
      )}
      {lignes.map((ligne) => (
        <Ligne
          key={ligne.id}
          campagneId={campagneId}
          ligne={ligne}
          peutModifier={peutModifier}
          libelles={libelles}
          surEdition={surEdition}
        />
      ))}
    </div>
  );
}
