import { Carte, CleValeur, Puce } from '../ui';
import Link from 'next/link';
import { IconeLinkedin } from '../ui/IconeLinkedin';
import { HREF_REGLAGES_LINKEDIN } from '../coquille/LigneMoteurLinkedin';
import type { PuceTon } from '../ui';

// Composant pur (aucun hook) : testable par `renderToStaticMarkup`, comme
// `CorpsReglagesCampagne` (apps/web/components/campagne/FormulaireReglagesCampagne.tsx).

export interface EtatMoteurLibelles {
  titre: string;
  enMarche: string;
  arrete: string;
  version: string;
  dernierPassage: string;
  prochainPassage: string;
  aucunPassage: string;
  derniereErreur: string;
  aucuneErreur: string;
  tachesEnAttente: string;
  aucuneTache: string;
  linkedin: string;
  purge: string;
}

export interface DerniereErreurMoteur {
  quand: string;
  libelle: string;
}

/** Ligne LinkedIn déjà composée (`composerLigneLinkedIn`), toujours présente : sans session, elle dit qu'il reste à l'ouvrir. */
export interface EtatLinkedin {
  ton: PuceTon;
  libelle: string;
  detail: string;
}

/** Passage de la purge de rétention, déjà composé : la promesse affichée aux personnes en dépend. */
export interface EtatPurgeAffiche {
  ton: PuceTon;
  libelle: string;
  /** Présent seulement quand la purge est en échec ou en retard : ce que ça change pour les personnes. */
  consequence: string | null;
}

export interface EtatMoteurProps {
  enMarche: boolean;
  version: string | null;
  /** Déjà formaté (`lib/dates.ts`, fuseau de l'organisation) — ce composant ne formate aucune date. */
  dernierPassage: string | null;
  prochainPassage: string | null;
  derniereErreur: DerniereErreurMoteur | null;
  /** Déjà composé par l'appelant (« 136 scorings · 2 enrichissements ») — `null` si rien n'attend. */
  tachesEnAttenteTexte: string | null;
  linkedin?: EtatLinkedin | null;
  purge?: EtatPurgeAffiche | null;
  libelles: EtatMoteurLibelles;
}

export function EtatMoteur({
  enMarche,
  version,
  dernierPassage,
  prochainPassage,
  derniereErreur,
  tachesEnAttenteTexte,
  linkedin,
  purge,
  libelles,
}: EtatMoteurProps) {
  return (
    <Carte titre={libelles.titre}>
      <div className="jr-etat-entete">
        <Puce ton={enMarche ? 'bon' : 'erreur'} point>
          {enMarche ? libelles.enMarche : libelles.arrete}
        </Puce>
        {version && <span className="jr-secondaire jr-petit">{libelles.version.replace('{version}', version)}</span>}
      </div>
      <CleValeur libelle={libelles.dernierPassage} valeur={dernierPassage ?? libelles.aucunPassage} />
      <CleValeur libelle={libelles.prochainPassage} valeur={prochainPassage ?? libelles.aucunPassage} />
      <CleValeur
        libelle={libelles.derniereErreur}
        valeur={
          derniereErreur ? (
            <span className="jr-texte-erreur">
              {derniereErreur.quand} · {derniereErreur.libelle}
            </span>
          ) : (
            libelles.aucuneErreur
          )
        }
      />
      <CleValeur libelle={libelles.tachesEnAttente} valeur={tachesEnAttenteTexte ?? libelles.aucuneTache} />
      {purge && (
        <CleValeur
          libelle={libelles.purge}
          valeur={
            <>
              <Puce ton={purge.ton} point>
                {purge.libelle}
              </Puce>
              {purge.consequence && <small className="jr-secondaire jr-etat-detail">{purge.consequence}</small>}
            </>
          }
        />
      )}
      {linkedin && (
        // Pas de « prochaine collecte » : la collecte est à la demande. Le logo garde sa couleur
        // de marque, l'état se dit par le libellé de la puce.
        <CleValeur
          libelle={
            <Link href={HREF_REGLAGES_LINKEDIN}>
              <IconeLinkedin className="jr-ico-li" /> {libelles.linkedin}
            </Link>
          }
          valeur={
            <>
              <Puce ton={linkedin.ton} point>
                {linkedin.libelle}
              </Puce>
              <small className="jr-secondaire jr-etat-detail">{linkedin.detail}</small>
            </>
          }
        />
      )}
    </Carte>
  );
}
