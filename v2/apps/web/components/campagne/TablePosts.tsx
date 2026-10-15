'use client';

/**
 * Écran de validation des posts collectés (variante A de la maquette `posts-a-valider`,
 * « la phrase est l'objet »).
 *
 * Ce qu'un opérateur relit, c'est la phrase TELLE QU'ELLE PARTIRA, et le sujet s'édite à
 * l'intérieur de cette phrase : un sujet relu dans un champ à part se juge hors contexte, et c'est
 * là que passent les ratés. L'écran ne porte aucune logique métier : tout ce qui se compose
 * (dates, phrases, échéances) arrive déjà écrit du serveur, comme pour `TablePlafonds`.
 *
 * AUCUN bouton n'efface quoi que ce soit, ni à l'unité ni en lot. Rejeter est un drapeau
 * réversible (« Rouvrir »).
 */
import { useRef, useState, useTransition } from 'react';
import { Bouton, Puce } from '../ui';
import { creerEnregistreurSujet } from './enregistreur-sujet';
import {
  actionCorrigerSujet,
  actionRejeterPost,
  actionReouvrirPost,
  actionValiderPost,
  actionValiderPosts,
} from '../../app/actions/posts';

export interface LignePostEcran {
  id: string;
  /** `null` : l'auteur n'a pas pu être lu, l'écran écrit « Auteur inconnu ». */
  auteur: string | null;
  /** Déjà composé (« publié le 12/10 »). */
  publie: string;
  url: string;
  sujet: string | null;
  /** La phrase autour du sujet, déjà résolue pour ce post. */
  avant: string;
  apres: string;
  etat: 'pending' | 'approved' | 'rejected';
  etatLibelle: string;
  /** Déjà composé (« 47 personnes attendent »). */
  attente: string;
  echeance: string;
  tonEcheance: 'loin' | 'bientot' | 'urgent';
  etiquetteSujet: string;
}

export interface TablePostsProps {
  campagneId: string;
  lignes: LignePostEcran[];
  peutModifier: boolean;
  libelles: {
    auteurInconnu: string;
    voir: string;
    sujetInvite: string;
    valider: string;
    rejeter: string;
    rouvrir: string;
    /** Déjà composé (« 3 posts attendent votre relecture »). */
    resume: string;
    /** Déjà composé (« 106 personnes n'entrent pas… »), vide quand aucune personne n'attend. */
    personnes: string;
    /** « Tout valider (2) », ou `null` quand rien n'est validable en lot. */
    toutValider: string | null;
    /** Pourquoi « Tout valider » est inactif : un sujet modifié n'est pas encore enregistré. */
    lotBloque: string;
  };
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
 * explication est un silence. Il l'est tant qu'un sujet modifié n'est pas enregistré, sinon c'est
 * l'ancien sujet qui partirait, sans que l'opérateur puisse s'en apercevoir.
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
      <Bouton taille="petit" className="discret" onClick={onToutValider} disabled={pending || bloque} aria-busy={pending}>
        {libelles.toutValider}
      </Bouton>
    </span>
  );
}

/**
 * L'auteur et le sujet sont les deux parties variables de l'accroche : le sujet se distingue par
 * son soulignement d'édition, l'auteur n'a que la graisse.
 */
function avecAuteurEnGras(avant: string, auteur: string | null) {
  const i = auteur ? avant.indexOf(auteur) : -1;
  if (!auteur || i < 0) return avant;
  return (
    <>
      {avant.slice(0, i)}
      <b>{auteur}</b>
      {avant.slice(i + auteur.length)}
    </>
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
  /** Dit au parent si ce sujet porte une modification que le serveur n'a pas encore. */
  surEdition: (id: string, enCours: boolean) => void;
}) {
  const refSujet = useRef<HTMLSpanElement>(null);
  const [brouillon, setBrouillon] = useState(ligne.sujet ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = peutModifier && ligne.etat !== 'rejected';
  const sansSujet = brouillon.trim() === '';

  function lire(): string {
    return (refSujet.current?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  // Le sujet n'est confirmé qu'APRÈS la réponse du serveur (voir `enregistreur-sujet.ts`) : un clic
  // sur « Valider » attend l'enregistrement en vol et ne valide pas s'il a échoué.
  const [enregistreur] = useState(() =>
    creerEnregistreurSujet({
      confirmeInitial: ligne.sujet ?? '',
      lire,
      envoyer: async (sujet) => {
        const res = await actionCorrigerSujet(campagneId, ligne.id, sujet);
        return res.ok ? null : res.error;
      },
      surErreur: setErreur,
    }),
  );

  async function enregistrerSujet(): Promise<boolean> {
    const ok = await enregistreur.enregistrer();
    surEdition(ligne.id, lire() !== enregistreur.confirme());
    return ok;
  }

  function surPerte() {
    setErreur(null);
    void enregistrerSujet();
  }

  function valider() {
    setErreur(null);
    startTransition(async () => {
      if (!(await enregistrerSujet())) return;
      const res = await actionValiderPost(campagneId, ligne.id);
      if (!res.ok) setErreur(res.error);
    });
  }

  function simple(action: typeof actionRejeterPost) {
    setErreur(null);
    startTransition(async () => {
      const res = await action(campagneId, ligne.id);
      if (!res.ok) setErreur(res.error);
    });
  }

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
        <span className="fixe">« {avecAuteurEnGras(ligne.avant, ligne.auteur)}</span>
        <span
          ref={refSujet}
          className={`jr-post-sujet${sansSujet ? ' vide' : ''}${editable ? '' : ' fige'}`}
          contentEditable={editable && !pending}
          suppressContentEditableWarning
          role="textbox"
          aria-label={ligne.etiquetteSujet}
          data-invite={libelles.sujetInvite}
          onInput={() => {
            setBrouillon(lire());
            surEdition(ligne.id, lire() !== enregistreur.confirme());
          }}
          onBlur={surPerte}
          onKeyDown={(e) => {
            // Le sujet tient sur une ligne : Entrée valide la saisie au lieu de couper la phrase.
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        >
          {ligne.sujet}
        </span>
        <span className="fixe">{ligne.apres} »</span>
      </p>
      <div className="jr-post-pied">
        <span className="jr-post-attente">
          <Chiffres texte={ligne.attente} />
        </span>
        <span className={`jr-post-echeance ${ligne.tonEcheance}`}>{ligne.echeance}</span>
        {peutModifier && (
          <span className="jr-post-actions">
            {ligne.etat === 'rejected' ? (
              <Bouton onClick={() => simple(actionReouvrirPost)} disabled={pending}>
                {libelles.rouvrir}
              </Bouton>
            ) : (
              <>
                <Bouton className="discret" onClick={() => simple(actionRejeterPost)} disabled={pending}>
                  {libelles.rejeter}
                </Bouton>
                {ligne.etat === 'pending' && (
                  <Bouton variante="principal" onClick={valider} disabled={pending || sansSujet} aria-busy={pending}>
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
  function surEdition(id: string, enCours: boolean) {
    setEnEdition((courant) => {
      if (courant.has(id) === enCours) return courant;
      const suivant = new Set(courant);
      if (enCours) suivant.add(id);
      else suivant.delete(id);
      return suivant;
    });
  }
  // Seuls les posts en attente ET déjà pourvus d'un sujet enregistré se valident en lot.
  const validables = lignes.filter((l) => l.etat === 'pending' && (l.sujet ?? '').trim() !== '').map((l) => l.id);

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
