import { Carte, CleValeur, Puce } from '../ui';

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
}

export interface DerniereErreurMoteur {
  quand: string;
  libelle: string;
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
  libelles: EtatMoteurLibelles;
}

export function EtatMoteur({
  enMarche,
  version,
  dernierPassage,
  prochainPassage,
  derniereErreur,
  tachesEnAttenteTexte,
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
    </Carte>
  );
}
