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
import { Bouton } from '../ui';
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

function Ligne({
  campagneId,
  ligne,
  peutModifier,
  libelles,
}: {
  campagneId: string;
  ligne: LignePostEcran;
  peutModifier: boolean;
  libelles: TablePostsProps['libelles'];
}) {
  const refSujet = useRef<HTMLSpanElement>(null);
  const [brouillon, setBrouillon] = useState(ligne.sujet ?? '');
  // Le dernier sujet envoyé au serveur : la perte de focus enregistre, et un clic sur « Valider »
  // juste après ne doit ni attendre cet enregistrement (le bouton se désactiverait sous le doigt)
  // ni l'envoyer deux fois. Les Server Actions s'exécutent dans l'ordre : la validation passe après.
  const dernierEnvoye = useRef(ligne.sujet ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = peutModifier && ligne.etat !== 'rejected';
  const sansSujet = brouillon.trim() === '';

  function lire(): string {
    return (refSujet.current?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Enregistre le sujet s'il a changé. Rend `false` si l'enregistrement a échoué. */
  async function enregistrerSujet(): Promise<boolean> {
    const sujet = lire();
    if (sujet === dernierEnvoye.current || sujet === '') return true;
    const precedent = dernierEnvoye.current;
    dernierEnvoye.current = sujet;
    const res = await actionCorrigerSujet(campagneId, ligne.id, sujet);
    if (!res.ok) {
      dernierEnvoye.current = precedent;
      setErreur(res.error);
    }
    return res.ok;
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
        <span className="jr-post-meta">{ligne.etatLibelle}</span>
        <a className="jr-post-lien" href={ligne.url} target="_blank" rel="noopener noreferrer">
          {libelles.voir}
        </a>
      </div>
      <p className="jr-post-phrase">
        <span className="fixe">« {ligne.avant}</span>
        <span
          ref={refSujet}
          className={`jr-post-sujet${sansSujet ? ' vide' : ''}${editable ? '' : ' fige'}`}
          contentEditable={editable && !pending}
          suppressContentEditableWarning
          role="textbox"
          aria-label={ligne.etiquetteSujet}
          data-invite={libelles.sujetInvite}
          onInput={() => setBrouillon(lire())}
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
                <Bouton onClick={() => simple(actionRejeterPost)} disabled={pending}>
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
          <span className="pousse">
            <Bouton taille="petit" onClick={toutValider} disabled={pending} aria-busy={pending}>
              {libelles.toutValider}
            </Bouton>
          </span>
        )}
      </div>
      {erreur && (
        <p className="jr-post-erreur" role="alert" style={{ padding: '0 24px' }}>
          {erreur}
        </p>
      )}
      {lignes.map((ligne) => (
        <Ligne key={ligne.id} campagneId={campagneId} ligne={ligne} peutModifier={peutModifier} libelles={libelles} />
      ))}
    </div>
  );
}
