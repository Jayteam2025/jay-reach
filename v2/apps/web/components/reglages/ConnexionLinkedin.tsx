'use client';

/**
 * La connexion du compte LinkedIn depuis l'écran (lot 5). Avant, cette carte affichait une commande
 * à taper dans un terminal du serveur : l'opérateur ne pouvait pas brancher son propre compte.
 *
 * Le mot de passe part dans le corps d'une action serveur (HTTPS), le serveur s'en sert aussitôt
 * puis l'oublie — rien en base, rien dans un journal, rien dans une URL. Ce composant n'en garde
 * aucune copie : il vide son état dès l'envoi.
 *
 * Le relevé d'étapes reprend l'élément signature du système de design (une ligne par étape, durée en
 * mono, étape en cours en accent). Ce n'est pas décoratif : l'utilisateur vient de confier son mot
 * de passe, il doit voir ce que le serveur en fait, seconde après seconde.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { Demande, EtapeConnexion } from '@jay-reach/core';
import {
  actionAnnulerConnexion,
  actionDemanderConnexion,
  actionDemanderDeconnexion,
  actionLireDemandeEnCours,
  actionRepondreDefi,
  type ResultatConnexion,
} from '../../app/actions/linkedin-connexion';

/**
 * La fenêtre de saisie du code, côté web. Elle doit rester égale à `FENETRE_CODE_WEB_MS`
 * (`apps/worker/src/linkedin/dependances-web.ts`) : l'écran annonce ce que le worker applique.
 */
const FENETRE_CODE_MS = 5 * 60_000;

/** L'ordre réel du parcours. La base borne `etape` à ces six valeurs (migration 20261012150000). */
const ETAPES: readonly EtapeConnexion[] = [
  'recue',
  'sortie_controlee',
  'navigateur_ouvert',
  'identifiants_transmis',
  'code_demande',
  'session_active',
];

/** Une demande vit tant qu'elle n'est ni réussie ni échouée. */
function enCours(d: Demande | null): boolean {
  return d !== null && d.statut !== 'reussi' && d.statut !== 'echec';
}

export interface ConnexionLinkedinProps {
  /** Une session LinkedIn est ouverte sur le serveur. */
  sessionActive: boolean;
  /** L'état de départ, lu côté serveur : évite d'afficher « aucune connexion » puis de se corriger. */
  demandeInitiale: Demande | null;
  /** Seuls `admin` et `owner` peuvent brancher ou débrancher un compte. */
  peutModifier: boolean;
  libelles: {
    connecter: string;
    reconnecter: string;
    deconnecter: string;
    annuler: string;
    valider: string;
    identifiant: string;
    motDePasse: string;
    code: string;
    codeAide: string;
    tempsRestant: string;
    modaleTitre: string;
    avertissementSortie: string;
    avertissementRemplace: string;
    avertissementMotDePasse: string;
    enCours: string;
    etapes: Record<EtapeConnexion, string>;
    motifs: Record<string, string>;
    erreurs: Record<string, string>;
  };
}

export function ConnexionLinkedin({
  sessionActive,
  demandeInitiale,
  peutModifier,
  libelles,
}: ConnexionLinkedinProps) {
  const [demande, setDemande] = useState<Demande | null>(demandeInitiale);
  const [modaleOuverte, setModaleOuverte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [restant, setRestant] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);

  function afficherErreur<T>(res: ResultatConnexion<T>): res is Extract<ResultatConnexion<T>, { ok: false }> {
    if (res.ok) return false;
    // Le serveur rend un code stable ; son `error` est un repli, et ne porte jamais de secret.
    setErreur(libelles.erreurs[res.code] ?? res.error);
    return true;
  }

  /**
   * Sondage de l'état, et non chargement de données : une demande change côté worker, sur une autre
   * machine, sans rien pour nous prévenir. Il s'arrête de lui-même dès que la demande est close.
   */
  useEffect(() => {
    if (!enCours(demande)) return;
    const id = setInterval(async () => {
      const res = await actionLireDemandeEnCours();
      if (!res.ok) return;
      // Quand la demande se clôt, l'action revalide elle-même l'écran côté serveur : sans cela,
      // la page réafficherait « Connecter mon compte » juste après une connexion réussie, au seul
      // moment où l'utilisateur attend une confirmation.
      setDemande(res.valeur);
    }, 2000);
    return () => clearInterval(id);
  }, [demande]);

  /** Le temps qu'il reste pour saisir le code, en secondes. C'est une vraie limite, pas un décor. */
  useEffect(() => {
    if (demande?.statut !== 'code_demande') {
      setRestant(null);
      return;
    }
    // `expireLe` borne la demande entière (15 min). La saisie du code, elle, dispose de la
    // fenêtre que le worker applique, et c'est elle qu'il faut annoncer.
    const fin = Math.min(new Date(demande.expireLe).getTime(), Date.now() + FENETRE_CODE_MS);
    const tic = () => setRestant(Math.max(0, Math.round((fin - Date.now()) / 1000)));
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [demande]);

  const soumettre = useCallback(
    (ev: React.FormEvent<HTMLFormElement>) => {
      ev.preventDefault();
      setErreur(null);
      const data = new FormData(ev.currentTarget);
      const entree = {
        identifiant: String(data.get('identifiant') ?? ''),
        motDePasse: String(data.get('motDePasse') ?? ''),
      };
      // Le formulaire est vidé avant même la réponse : rien ne doit rester dans le DOM.
      formulaire.current?.reset();
      startTransition(async () => {
        const res = await actionDemanderConnexion(entree);
        if (afficherErreur(res)) return;
        setModaleOuverte(false);
        const suite = await actionLireDemandeEnCours();
        if (suite.ok) setDemande(suite.valeur);
      });
    },
    [libelles],
  );

  function envoyerCode() {
    if (!demande) return;
    setErreur(null);
    const saisi = code;
    setCode('');
    startTransition(async () => {
      const res = await actionRepondreDefi(demande.id, saisi);
      if (afficherErreur(res)) return;
    });
  }

  function annuler() {
    if (!demande) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAnnulerConnexion(demande.id);
      if (afficherErreur(res)) return;
      const suite = await actionLireDemandeEnCours();
      if (suite.ok) setDemande(suite.valeur);
    });
  }

  function deconnecter() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionDemanderDeconnexion();
      if (afficherErreur(res)) return;
    });
  }

  if (!peutModifier) return null;

  const active = enCours(demande);
  const courante = demande?.etape ?? null;
  const rangCourant = courante ? ETAPES.indexOf(courante) : -1;

  return (
    <div className="jr-session-action">
      {erreur && (
        <p className="jr-texte-erreur jr-etat-detail" role="alert">
          {erreur}
        </p>
      )}

      {active && (
        <>
          <p className="jr-session-detail">{libelles.enCours}</p>
          <ol className="jr-releve">
            {ETAPES.map((etape, rang) => {
              const etat = rang < rangCourant ? 'faite' : rang === rangCourant ? 'encours' : 'avenir';
              return (
                <li key={etape} className={`jr-releve-ligne jr-releve-ligne--${etat}`}>
                  {libelles.etapes[etape]}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {demande?.statut === 'code_demande' && (
        <div className="jr-connexion-code">
          <label htmlFor="jr-code-linkedin">{libelles.code}</label>
          <div className="jr-champ">
            <input
              id="jr-code-linkedin"
              className="mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={pending}
            />
          </div>
          <p className="jr-session-detail">
            {libelles.codeAide}
            {restant !== null && (
              <>
                {' '}
                <span className="mono">
                  {libelles.tempsRestant.replace(
                    '{temps}',
                    `${Math.floor(restant / 60)} min ${String(restant % 60).padStart(2, '0')} s`,
                  )}
                </span>
              </>
            )}
          </p>
          <div className="jr-session-boutons">
            <button type="button" className="jr-bouton" onClick={envoyerCode} disabled={pending || code === ''}>
              {libelles.valider}
            </button>
            <button type="button" className="jr-bouton" onClick={annuler} disabled={pending}>
              {libelles.annuler}
            </button>
          </div>
        </div>
      )}

      {active && demande?.statut !== 'code_demande' && (
        <div className="jr-session-boutons">
          <button type="button" className="jr-bouton" onClick={annuler} disabled={pending}>
            {libelles.annuler}
          </button>
        </div>
      )}

      {/* Une demande close sur un échec : on dit le motif, puis on propose de recommencer. */}
      {demande?.statut === 'echec' && demande.motif && (
        <p className="jr-session-detail">{libelles.motifs[demande.motif] ?? demande.motif}</p>
      )}

      {!active && (
        <div className="jr-session-boutons">
          {sessionActive ? (
            <button type="button" className="jr-bouton" onClick={deconnecter} disabled={pending}>
              {libelles.deconnecter}
            </button>
          ) : (
            <button
              type="button"
              className="jr-bouton principal"
              onClick={() => {
                setErreur(null);
                setModaleOuverte(true);
              }}
              disabled={pending}
            >
              {demande?.statut === 'echec' ? libelles.reconnecter : libelles.connecter}
            </button>
          )}
        </div>
      )}

      {modaleOuverte && (
        <>
          <div className="jr-voile" onClick={() => setModaleOuverte(false)} />
          <aside className="jr-tiroir" role="dialog" aria-modal="true" aria-labelledby="jr-connexion-titre">
            <div className="entete">
              <h2 id="jr-connexion-titre">{libelles.modaleTitre}</h2>
              <button
                type="button"
                className="fermer"
                aria-label={libelles.annuler}
                onClick={() => setModaleOuverte(false)}
              >
                &times;
              </button>
            </div>
            <div className="corps">
            {/* L'ordre compte : l'alerte de LinkedIn arrive par courriel dans la minute, et sans
                cette phrase l'utilisateur change son mot de passe par réflexe — la session tombe. */}
            <div className="jr-avertissement">
              <p>{libelles.avertissementSortie}</p>
              {sessionActive && <p className="jr-secondaire">{libelles.avertissementRemplace}</p>}
              <p className="jr-secondaire">{libelles.avertissementMotDePasse}</p>
            </div>
            <form ref={formulaire} onSubmit={soumettre}>
              <label htmlFor="jr-identifiant-linkedin">{libelles.identifiant}</label>
              <div className="jr-champ">
                <input
                  id="jr-identifiant-linkedin"
                  name="identifiant"
                  type="email"
                  autoComplete="username"
                  required
                  disabled={pending}
                />
              </div>
              <label htmlFor="jr-motdepasse-linkedin">{libelles.motDePasse}</label>
              <div className="jr-champ">
                <input
                  id="jr-motdepasse-linkedin"
                  name="motDePasse"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={pending}
                />
              </div>
              <div className="jr-session-boutons">
                <button type="submit" className="jr-bouton principal" disabled={pending}>
                  {libelles.connecter}
                </button>
                <button
                  type="button"
                  className="jr-bouton"
                  onClick={() => setModaleOuverte(false)}
                  disabled={pending}
                >
                  {libelles.annuler}
                </button>
              </div>
              </form>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
