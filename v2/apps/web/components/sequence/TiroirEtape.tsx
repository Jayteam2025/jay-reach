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
  readonly apercu: { sujet: string; corps: string } | null;
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
 * Tiroir de création/édition d'une étape email (maquette `tiroir-etape.html`) :
 * objet, corps (textarea + variables à insérer au curseur — pas d'éditeur
 * riche, le rendu HTML se fait côté envoi comme aujourd'hui), délai,
 * aperçu rendu et envoi de test.
 */
export function TiroirEtape({ campagneId, etape, apercu }: TiroirEtapeProps) {
  const t = useTranslations('campagne.sequence');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | undefined>(undefined);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const initial = heuresVersUnite(etape?.delaiHeures ?? 0);
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
        sujet,
        corps,
        delaiHeures,
      });
      if (res.ok) {
        router.refresh();
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
        router.refresh();
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

  const puces = etape
    ? [
        <Puce key="canal">{t('drawer.channelEmail')}</Puce>,
        <Puce key="stats" ton="bon">
          {t('drawer.stats', { passes: etape.passes, repondus: etape.repondusTotal })}
        </Puce>,
      ]
    : [<Puce key="canal">{t('drawer.channelEmail')}</Puce>];

  return (
    <Tiroir
      ouvert
      taille="large"
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={etape ? t('drawer.titleEdit', { n: etape.position, titre: etape.titre }) : t('drawer.titleNew')}
      icone={<TuileLogo marque="email" taille="grande" />}
      puces={puces}
      pied={
        <>
          <div className="jr-carte-h-actions">
            {etape && (
              <Bouton variante="danger" onClick={supprimer} disabled={pending}>
                {t('drawer.delete')}
              </Bouton>
            )}
            {etape && (
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
            <span>{t('drawer.channelEmail')}</span>
          </Champ>
          <div>
            <span className="jr-libelle">{t('drawer.delay')}</span>
            <div className="ligne">
              <Champ>
                <input
                  type="number"
                  min={0}
                  value={delaiValeur}
                  onChange={(e) => setDelaiValeur(e.target.value)}
                />
              </Champ>
              <Champ>
                <select value={delaiUnite} onChange={(e) => setDelaiUnite(e.target.value as 'heures' | 'jours')}>
                  <option value="heures">{t('drawer.delayUnitHours')}</option>
                  <option value="jours">{t('drawer.delayUnitDays')}</option>
                </select>
              </Champ>
            </div>
            <div className="jr-aide">{t('drawer.delayHint')}</div>
          </div>
        </div>

        <Champ libelle={t('drawer.subject')}>
          <input value={sujet} onChange={(e) => setSujet(e.target.value)} />
        </Champ>

        <div>
          <span className="jr-libelle">{t('drawer.body')}</span>
          <Champ>
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

        {apercu && <ApercuMessage sujet={apercu.sujet} corps={apercu.corps} />}

        {etape && <p className="jr-aide">{t('drawer.testNote')}</p>}
      </div>
    </Tiroir>
  );
}
