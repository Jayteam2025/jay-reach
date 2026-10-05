'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bouton, Champ, Puce, Tiroir, TuileLogo } from '../ui';
import { actionEnregistrerEtape, actionEnvoyerTest, actionSupprimerEtape } from '../../app/actions/step-message';
import { ApercuMessage } from './ApercuMessage';

/** Étape existante à réécrire — `null` en création. */
export interface EtapeAModifier {
  readonly id: string;
  /** 1-based, pour le titre du tiroir. */
  readonly position: number;
  readonly titre: string;
  readonly canal: 'email' | 'linkedin';
  readonly sujet: string;
  readonly corps: string;
  readonly delaiHeures: number;
  readonly passes: number;
  readonly repondusTotal: number;
}

export interface TiroirEtapeProps {
  readonly campagneId: string;
  /** `null` en création : le formulaire crée une nouvelle étape en fin de séquence. */
  readonly etape: EtapeAModifier | null;
  /** Rendu déjà résolu (contact fictif) par `apercuEtape`, côté serveur — `null` sans message existant. */
  readonly apercu: { sujet: string; corps: string; variablesManquantes: string[] } | null;
  /**
   * Variables `liste_<colonne>` disponibles pour cette campagne
   * (`colonnesDeListeCampagne`, `packages/core`) — `[]` sans liste importée
   * reliée. Calculé côté serveur par la page (`sequence/page.tsx`).
   */
  readonly variablesListe: readonly string[];
}

export interface VariablesDeListeLibelles {
  /** « Colonnes de la liste importée » — au-dessus de la rangée de puces, quand `variablesListe` n'est pas vide. */
  listVariables: string;
  /** Seule ligne affichée quand `variablesListe` est vide — explique la convention `{{liste_<colonne>}}` sans rien à insérer. */
  listVariablesEmpty: string;
}

export interface VariablesDeListeProps {
  readonly variablesListe: readonly string[];
  readonly onInserer: (nom: string) => void;
  readonly libelles: VariablesDeListeLibelles;
}

/**
 * Partie pure du tiroir (même extraction que `PiedTiroirRelecture`,
 * `TiroirRelecture.tsx`) : sous la rangée de puces standard (`VARIABLES_INSERABLES`
 * ci-dessous), même kit visuel (`jr-puces variables`, `jr-puce variable`, clic
 * = insertion au curseur) — une campagne alimentée par une liste importée
 * propose aussi ses colonnes (`{{liste_poste}}`…) ; sans liste, une seule
 * ligne d'aide explique la convention plutôt que de rester silencieuse.
 */
export function VariablesDeListe({ variablesListe, onInserer, libelles }: VariablesDeListeProps) {
  if (variablesListe.length === 0) {
    return <div className="jr-aide">{libelles.listVariablesEmpty}</div>;
  }
  return (
    <>
      <div className="jr-aide">{libelles.listVariables}</div>
      <div className="jr-puces variables">
        {variablesListe.map((nom) => (
          <button key={nom} type="button" className="jr-puce variable" onClick={() => onInserer(nom)}>
            {`{{${nom}}}`}
          </button>
        ))}
      </div>
    </>
  );
}

/** Variables offertes à l'insertion (maquette `tiroir-etape.html`), cliquer insère `{{nom}}` au curseur. */
const VARIABLES_INSERABLES = [
  'prenom',
  'entreprise',
  'poste',
  'ville',
  'signal_titre',
  'signal_date',
  'lien_offre',
  'persona_angle',
] as const;

function heuresVersUnite(heures: number): { valeur: number; unite: 'heures' | 'jours' } {
  if (heures > 0 && heures % 24 === 0) return { valeur: heures / 24, unite: 'jours' };
  return { valeur: heures, unite: 'heures' };
}

/**
 * Tiroir de création/édition d'une étape, email ou LinkedIn (maquette
 * `tiroir-etape.html`, canal étendu par R48 : une campagne réelle alterne
 * déjà les deux) : canal, objet (email seulement), corps (textarea +
 * variables à insérer au curseur — pas d'éditeur riche, le rendu HTML se fait
 * côté envoi comme aujourd'hui), délai, aperçu rendu et envoi de test (email
 * seulement — une invitation/message LinkedIn s'exécute côté serveur, lot 4).
 */
export function TiroirEtape({ campagneId, etape, apercu, variablesListe }: TiroirEtapeProps) {
  const t = useTranslations('campagne.sequence');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | undefined>(undefined);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const initial = heuresVersUnite(etape?.delaiHeures ?? 0);
  const [canal, setCanal] = useState<'email' | 'linkedin'>(etape?.canal ?? 'email');
  const [sujet, setSujet] = useState(etape?.sujet ?? '');
  const [corps, setCorps] = useState(etape?.corps ?? '');
  const [delaiValeur, setDelaiValeur] = useState(String(initial.valeur));
  const [delaiUnite, setDelaiUnite] = useState<'heures' | 'jours'>(initial.unite);
  const corpsRef = useRef<HTMLTextAreaElement>(null);

  function fermer() {
    router.push('?', { scroll: false });
  }

  function inserVariable(nom: string) {
    const jeton = `{{${nom}}}`;
    const zone = corpsRef.current;
    if (!zone) {
      setCorps((c) => c + jeton);
      return;
    }
    const debut = zone.selectionStart ?? corps.length;
    const fin = zone.selectionEnd ?? corps.length;
    const suivant = `${corps.slice(0, debut)}${jeton}${corps.slice(fin)}`;
    setCorps(suivant);
    requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(debut + jeton.length, debut + jeton.length);
    });
  }

  function enregistrer() {
    setErreur(null);
    setIssues(undefined);
    const delaiHeures = delaiUnite === 'jours' ? Number(delaiValeur || 0) * 24 : Number(delaiValeur || 0);
    startTransition(async () => {
      const res = await actionEnregistrerEtape(campagneId, {
        etapeId: etape?.id,
        canal,
        sujet,
        corps,
        delaiHeures,
      });
      if (res.ok) {
        fermer();
      } else {
        setErreur(res.error);
        setIssues(res.issues);
      }
    });
  }

  function supprimer() {
    if (!etape) return;
    if (typeof window !== 'undefined' && !window.confirm(t('drawer.deleteConfirm'))) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionSupprimerEtape(campagneId, etape.id);
      if (res.ok) {
        fermer();
      } else {
        setErreur(res.error);
      }
    });
  }

  function envoyerTest() {
    if (!etape) return;
    setErreur(null);
    setTestMessage(null);
    startTransition(async () => {
      const res = await actionEnvoyerTest(campagneId, etape.id);
      if (res.ok) setTestMessage(t('drawer.testSent'));
      else setErreur(res.error);
    });
  }

  const libelleCanal = t(canal === 'linkedin' ? 'drawer.channelLinkedin' : 'drawer.channelEmail');
  const puces = [
    <Puce key="canal">{libelleCanal}</Puce>,
    ...(etape
      ? [
          <Puce key="stats" ton="bon">
            {t('drawer.stats', { passes: etape.passes, repondus: etape.repondusTotal })}
          </Puce>,
        ]
      : []),
  ];

  return (
    <Tiroir
      ouvert
      taille="large"
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={etape ? t('drawer.titleEdit', { n: etape.position, titre: etape.titre }) : t('drawer.titleNew')}
      icone={<TuileLogo marque={canal === 'linkedin' ? 'linkedin' : 'email'} taille="grande" />}
      puces={puces}
      pied={
        <>
          <div className="jr-carte-h-actions">
            {etape && (
              <Bouton variante="danger" onClick={supprimer} disabled={pending}>
                {t('drawer.delete')}
              </Bouton>
            )}
            {etape && canal === 'email' && (
              <Bouton onClick={envoyerTest} disabled={pending}>
                {t('drawer.sendTest')}
              </Bouton>
            )}
          </div>
          <div className="jr-carte-h-actions">
            <Bouton onClick={fermer} disabled={pending}>
              {t('drawer.cancel')}
            </Bouton>
            <Bouton variante="principal" onClick={enregistrer} disabled={pending}>
              {etape ? t('drawer.save') : t('drawer.create')}
            </Bouton>
          </div>
        </>
      }
    >
      <div className="jr-formulaire">
        <div className="ligne">
          <Champ libelle={t('drawer.channel')}>
            <select value={canal} onChange={(e) => setCanal(e.target.value as 'email' | 'linkedin')}>
              <option value="email">{t('drawer.channelEmail')}</option>
              <option value="linkedin">{t('drawer.channelLinkedin')}</option>
            </select>
          </Champ>
          <div>
            {/* Le <span> ci-dessous reste purement visuel (un seul groupe pour les deux champs,
                sur la même ligne) : chaque contrôle reçoit son propre `aria-label` (tour de
                correction F6, point 26) plutôt qu'un `label[for]` par-dessus la mise en page en
                grille des deux `Champ` — les poser côte à côte avec des hauteurs de libellé
                différentes les aurait désalignés verticalement. */}
            <span className="jr-libelle">{t('drawer.delay')}</span>
            <div className="ligne">
              <Champ>
                <input
                  type="number"
                  min={0}
                  aria-label={t('drawer.delay')}
                  value={delaiValeur}
                  onChange={(e) => setDelaiValeur(e.target.value)}
                />
              </Champ>
              <Champ>
                <select
                  aria-label={t('drawer.delayUnit')}
                  value={delaiUnite}
                  onChange={(e) => setDelaiUnite(e.target.value as 'heures' | 'jours')}
                >
                  <option value="heures">{t('drawer.delayUnitHours')}</option>
                  <option value="jours">{t('drawer.delayUnitDays')}</option>
                </select>
              </Champ>
            </div>
            <div className="jr-aide">{t('drawer.delayHint')}</div>
          </div>
        </div>

        {canal === 'email' && (
          <Champ libelle={t('drawer.subject')}>
            <input value={sujet} onChange={(e) => setSujet(e.target.value)} />
          </Champ>
        )}

        <div>
          {/* `Champ` porte désormais son propre libellé (tour de correction F6, point 26) : le
              `<textarea>` avait un id (`useId()`) mais aucun `label[for]` réel, seulement ce
              `<span>` visuel juste au-dessus. */}
          <Champ libelle={t('drawer.body')}>
            <textarea
              ref={corpsRef}
              rows={9}
              value={corps}
              onChange={(e) => setCorps(e.target.value)}
            />
          </Champ>
          <div className="jr-aide">{t('drawer.bodyHint')}</div>
          <div className="jr-puces variables">
            {VARIABLES_INSERABLES.map((nom) => (
              <button
                key={nom}
                type="button"
                className="jr-puce variable"
                onClick={() => inserVariable(nom)}
              >
                {`{{${nom}}}`}
              </button>
            ))}
          </div>
          <VariablesDeListe
            variablesListe={variablesListe}
            onInserer={inserVariable}
            libelles={{ listVariables: t('drawer.listVariables'), listVariablesEmpty: t('drawer.listVariablesEmpty') }}
          />
        </div>

        {issues && issues.length > 0 && (
          <div className="jr-notification erreur" role="alert">
            {issues.join(' ')}
          </div>
        )}
        {erreur && (!issues || issues.length === 0) && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
        {testMessage && <div className="jr-notification bon">{testMessage}</div>}

        {apercu && (
          <ApercuMessage sujet={apercu.sujet} corps={apercu.corps} variablesManquantes={apercu.variablesManquantes} />
        )}

        {etape && canal === 'email' && <p className="jr-aide">{t('drawer.testNote')}</p>}
      </div>
    </Tiroir>
  );
}
