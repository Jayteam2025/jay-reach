import { Carte, CleValeur, Puce } from '../ui';
import { IconeLinkedin } from '../ui/IconeLinkedin';
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
}

export interface DerniereErreurMoteur {
  quand: string;
  libelle: string;
}

/** Ligne LinkedIn déjà composée (`composerLigneLinkedIn`) — absente tant qu'aucune session n'a existé. */
export interface EtatLinkedin {
  ton: PuceTon;
  libelle: string;
  detail: string;
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
  /** `null` : aucune session LinkedIn n'a jamais existé, pas de ligne. */
  linkedin?: EtatLinkedin | null;
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
      {linkedin && (
        // Pas de « prochaine collecte » : la collecte est à la demande. Le logo garde sa couleur
        // de marque, l'état se dit par le libellé de la puce.
        <CleValeur
          libelle={
            <>
              <IconeLinkedin className="jr-ico-li" /> {libelles.linkedin}
            </>
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
