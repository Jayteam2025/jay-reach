'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createSender, updateSender } from '../../actions/senders';

export type SenderKind = 'email' | 'linkedin' | 'postal';

/**
 * Dernière santé relevée chez le transport email (SalesBlink), écrite par la
 * relève périodique du worker. `sending_enabled` est le champ miroir lu par
 * le handler d'envoi et par la garde d'activation ; `derniereErreur` vient de
 * `GET /senders/{id}/health` et n'est renseignée que si un dernier échec a
 * été relevé.
 */
export interface ProviderState {
  readonly connectee?: boolean;
  readonly envoiActif?: boolean;
  readonly receptionActive?: boolean;
  readonly sante?: number | null;
  readonly derniereErreur?: { app: string; message: string; a: string } | null;
  readonly sending_enabled?: boolean;
  readonly receiving_enabled?: boolean;
}

export interface SenderRow {
  readonly id: string;
  readonly kind: SenderKind;
  readonly identity: string;
  readonly display_name: string | null;
  readonly daily_quota: number | null;
  readonly hourly_quota: number | null;
  readonly is_active: boolean;
  readonly business_hours: unknown;
  readonly timezone: string | null;
  /** Boîte SalesBlink reliée (son `id` chez SalesBlink), ou `null`. */
  readonly provider_ref: string | null;
  readonly provider_state: ProviderState | null;
}

/** Une boîte du workspace SalesBlink, telle que proposée par le sélecteur. */
export interface BoiteSalesBlinkOption {
  readonly id: string;
  readonly email: string;
  readonly nom: string;
  readonly plafondQuotidien: number | null;
}

export type ResultatBoitesSalesBlink =
  | { ok: true; boites: readonly BoiteSalesBlinkOption[] }
  | { ok: false; error: string };

/** Libellé de la santé d'une boîte reliée, ou `null` si aucune boîte n'est reliée. */
function libelleSante(
  t: ReturnType<typeof useTranslations>,
  providerRef: string | null,
  state: ProviderState | null,
): string | null {
  if (!providerRef) return null;
  if (!state) return t('salesblinkHealth', { etat: 'jamais' });
  if (state.sending_enabled === false) {
    return t('salesblinkHealth', { etat: 'coupe', message: state.derniereErreur?.message ?? '' });
  }
  return t('salesblinkHealth', { etat: 'actif' });
}

/** Jours au sens ISO : 1 = lundi … 7 = dimanche. */
const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Fenêtre d'envoi par défaut, reprise du séquenceur.
 *
 * Elle n'est pas décorative : quand `business_hours` est vide, c'est cette
 * fenêtre qui s'applique réellement. L'écran doit donc l'afficher plutôt que de
 * laisser croire qu'aucune règle ne s'applique.
 */
const FENETRE_PAR_DEFAUT = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };

/**
 * Fuseaux proposés, les mêmes que sur l'écran LinkedIn.
 *
 * Volontairement court : ce sont ceux où un opérateur francophone travaille.
 * Une liste de quatre cents entrées se parcourt moins vite qu'elle ne se
 * saisit.
 */
const FUSEAUX = ['Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal'] as const;

interface Fenetre {
  startHour: number;
  endHour: number;
  days: number[];
}

/** Lit la fenêtre stockée, en retombant sur celle qu'applique le séquenceur. */
function lireFenetre(brut: unknown): Fenetre {
  const h = brut as { startHour?: unknown; endHour?: unknown; days?: unknown } | null;
  const jours = Array.isArray(h?.days) ? (h.days as unknown[]).map(Number).filter((j) => j >= 1 && j <= 7) : [];
  return {
    startHour: typeof h?.startHour === 'number' ? h.startHour : FENETRE_PAR_DEFAUT.startHour,
    endHour: typeof h?.endHour === 'number' ? h.endHour : FENETRE_PAR_DEFAUT.endHour,
    days: jours.length > 0 ? jours : [...FENETRE_PAR_DEFAUT.days],
  };
}

/** `''` vaut « aucun plafond » ; toute autre saisie est un entier. */
function versNombre(valeur: string): number | null {
  const net = valeur.trim();
  return net === '' ? null : Number(net);
}

function memesJours(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().every((j, i) => j === [...b].sort()[i]);
}

/**
 * Réglage de la fenêtre d'envoi : jours, plage horaire, fuseau.
 *
 * Mêmes commandes que sur l'écran LinkedIn, à dessein. C'est le même geste —
 * dire quand un message a le droit de partir — et lui donner deux formes selon
 * le canal obligerait à l'apprendre deux fois.
 */
function ReglageFenetre({
  fenetre,
  fuseau,
  onFenetre,
  onFuseau,
  prefixe,
}: {
  fenetre: Fenetre;
  fuseau: string;
  onFenetre: (f: Fenetre) => void;
  onFuseau: (tz: string) => void;
  /** Rend les identifiants uniques quand plusieurs cartes coexistent. */
  prefixe: string;
}) {
  const t = useTranslations('senders');
  const tl = useTranslations('linkedin');

  const basculerJour = (jour: number) =>
    onFenetre({
      ...fenetre,
      days: fenetre.days.includes(jour)
        ? fenetre.days.filter((j) => j !== jour)
        : [...fenetre.days, jour].sort(),
    });

  return (
    <>
      <div className="rs-label" id={`${prefixe}-jours`}>
        {t('sendDays')}
        <div className="rs-lk-days" role="group" aria-labelledby={`${prefixe}-jours`}>
          {JOURS.map((j) => (
            <button
              key={j}
              type="button"
              className="rs-lk-day"
              data-active={fenetre.days.includes(j) ? 'true' : undefined}
              aria-pressed={fenetre.days.includes(j)}
              onClick={() => basculerJour(j)}
            >
              {tl(`sending.day.${j}`)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="rs-label">
          {t('sendFrom')}
          <select
            className="rs-input mono"
            value={fenetre.startHour}
            onChange={(e) => onFenetre({ ...fenetre, startHour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="rs-label">
          {t('sendTo')}
          <select
            className="rs-input mono"
            value={fenetre.endHour}
            onChange={(e) => onFenetre({ ...fenetre, endHour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="rs-label">
        {t('timezone')}
        <select className="rs-input" value={fuseau} onChange={(e) => onFuseau(e.target.value)}>
          {FUSEAUX.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * Sélecteur de la boîte SalesBlink reliée à un expéditeur email. Partagé
 * entre la carte d'un expéditeur existant et le formulaire de création : dans
 * les deux cas, c'est le même geste — dire quelle boîte du workspace envoie
 * réellement les messages de cet expéditeur.
 */
function SelecteurBoiteSalesBlink({
  boitesSalesBlink,
  providerRef,
  onProviderRef,
  idChamp,
}: {
  boitesSalesBlink: ResultatBoitesSalesBlink;
  providerRef: string | null;
  onProviderRef: (v: string | null) => void;
  idChamp: string;
}) {
  const t = useTranslations('senders');

  if (!boitesSalesBlink.ok || boitesSalesBlink.boites.length === 0) {
    return (
      <div className="rs-label">
        {t('salesblinkBox')}
        <p className="rs-row-sub" style={{ margin: 0 }}>
          {t('salesblinkBoxNone')}
        </p>
      </div>
    );
  }

  return (
    <label className="rs-label" htmlFor={idChamp}>
      {t('salesblinkBox')}
      <select
        id={idChamp}
        className="rs-input"
        value={providerRef ?? ''}
        onChange={(e) => onProviderRef(e.target.value || null)}
      >
        <option value="">—</option>
        {boitesSalesBlink.boites.map((b) => (
          <option key={b.id} value={b.id}>{`${b.nom} — ${b.email}`}</option>
        ))}
      </select>
    </label>
  );
}

function CarteExpediteur({
  sender,
  orgId,
  demo,
  boitesSalesBlink,
}: {
  sender: SenderRow;
  orgId: string;
  demo: boolean;
  boitesSalesBlink: ResultatBoitesSalesBlink;
}) {
  const t = useTranslations('senders');
  const [nom, setNom] = useState(sender.display_name ?? '');
  const [quotidien, setQuotidien] = useState(sender.daily_quota?.toString() ?? '');
  const [horaire, setHoraire] = useState(sender.hourly_quota?.toString() ?? '');
  const [actif, setActif] = useState(sender.is_active);
  const [fenetre, setFenetre] = useState<Fenetre>(() => lireFenetre(sender.business_hours));
  const [fuseau, setFuseau] = useState(sender.timezone ?? 'Europe/Paris');
  const [providerRef, setProviderRef] = useState<string | null>(sender.provider_ref);
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'enregistre'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  const fenetreInitiale = lireFenetre(sender.business_hours);
  const modifie =
    nom !== (sender.display_name ?? '') ||
    quotidien !== (sender.daily_quota?.toString() ?? '') ||
    horaire !== (sender.hourly_quota?.toString() ?? '') ||
    actif !== sender.is_active ||
    fuseau !== (sender.timezone ?? 'Europe/Paris') ||
    providerRef !== sender.provider_ref ||
    fenetre.startHour !== fenetreInitiale.startHour ||
    fenetre.endHour !== fenetreInitiale.endHour ||
    !memesJours(fenetre.days, fenetreInitiale.days);

  // Boîte reliée : sa santé (relevée en base par le worker) et son propre
  // plafond de séquence, à comparer au plafond Jay Reach ci-dessous.
  const boiteReliee = boitesSalesBlink.ok ? boitesSalesBlink.boites.find((b) => b.id === providerRef) ?? null : null;
  // `provider_state` décrit la dernière relève de la boîte ENREGISTRÉE : tant
  // qu'une nouvelle sélection n'est pas sauvegardée, cette santé ne la
  // concerne pas encore.
  const sante = providerRef === sender.provider_ref ? libelleSante(t, providerRef, sender.provider_state) : null;

  function touche<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setEtat('repos');
      setErreur(null);
    };
  }

  async function enregistrer() {
    setEtat('envoi');
    setErreur(null);
    const res = await updateSender(orgId, sender.id, {
      displayName: nom,
      dailyQuota: versNombre(quotidien),
      hourlyQuota: versNombre(horaire),
      isActive: actif,
      startHour: fenetre.startHour,
      endHour: fenetre.endHour,
      days: fenetre.days,
      timezone: fuseau,
      providerRef,
    });
    if (res.ok) {
      setEtat('enregistre');
    } else {
      setEtat('repos');
      setErreur(res.error);
    }
  }

  return (
    <div className="rs-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span className="rs-eyebrow" style={{ margin: 0 }}>
          {t(`kind.${sender.kind}`)}
        </span>
        <span className="mono rs-row-sub" style={{ overflowWrap: 'anywhere' }}>
          {sender.identity}
        </span>
      </div>

      <label className="rs-label">
        {t('displayName')}
        <input
          className="rs-input"
          value={nom}
          placeholder={t('displayNamePlaceholder')}
          onChange={(e) => touche(setNom)(e.target.value)}
        />
      </label>

      {sender.kind === 'email' ? (
        <>
          <SelecteurBoiteSalesBlink
            boitesSalesBlink={boitesSalesBlink}
            providerRef={providerRef}
            onProviderRef={touche(setProviderRef)}
            idChamp={`${sender.id}-boite-salesblink`}
          />
          {sante ? (
            <p className="rs-row-sub" style={{ margin: 0 }}>
              {sante}
            </p>
          ) : null}
        </>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="rs-label">
          {t('dailyQuota')}
          <input
            className="rs-input mono"
            type="number"
            min={0}
            inputMode="numeric"
            value={quotidien}
            placeholder={t('noLimit')}
            onChange={(e) => touche(setQuotidien)(e.target.value)}
          />
          {boiteReliee?.plafondQuotidien != null ? (
            <span className="rs-row-sub">
              {t('salesblinkCap')} : {boiteReliee.plafondQuotidien} — {t('lowestApplies')}
            </span>
          ) : null}
        </label>
        <label className="rs-label">
          {t('hourlyQuota')}
          <input
            className="rs-input mono"
            type="number"
            min={0}
            inputMode="numeric"
            value={horaire}
            placeholder={t('noLimit')}
            onChange={(e) => touche(setHoraire)(e.target.value)}
          />
        </label>
      </div>

      <ReglageFenetre
        fenetre={fenetre}
        fuseau={fuseau}
        onFenetre={touche(setFenetre)}
        onFuseau={touche(setFuseau)}
        prefixe={sender.id}
      />

      <label className="rs-check">
        <input type="checkbox" checked={actif} onChange={(e) => touche(setActif)(e.target.checked)} />
        {t('active')}
      </label>

      <div className="rs-actions">
        <button className="rs-btn" type="button" disabled={demo || !modifie || etat === 'envoi'} onClick={enregistrer}>
          {etat === 'envoi' ? t('saving') : t('save')}
        </button>
        {etat === 'enregistre' ? (
          <span role="status" className="rs-row-sub" style={{ color: 'var(--lime2)', alignSelf: 'center' }}>
            {t('saved')}
          </span>
        ) : null}
        {erreur ? (
          <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)', alignSelf: 'center' }}>
            {erreur}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ajout d'un expéditeur, replié par défaut.
 *
 * Comme sur l'écran des thèmes : c'est un geste ponctuel, et déplié il
 * repousserait sous la ligne de flottaison les expéditeurs déjà configurés,
 * qu'on vient consulter bien plus souvent.
 */
function AjouterExpediteur({
  orgId,
  demo,
  boitesSalesBlink,
}: {
  orgId: string;
  demo: boolean;
  boitesSalesBlink: ResultatBoitesSalesBlink;
}) {
  const t = useTranslations('senders');
  const [ouvert, setOuvert] = useState(false);
  const [canal, setCanal] = useState<'email' | 'linkedin'>('email');
  const [identite, setIdentite] = useState('');
  const [nom, setNom] = useState('');
  const [quotidien, setQuotidien] = useState('');
  const [horaire, setHoraire] = useState('');
  const [fenetre, setFenetre] = useState<Fenetre>({ ...FENETRE_PAR_DEFAUT, days: [...FENETRE_PAR_DEFAUT.days] });
  const [fuseau, setFuseau] = useState('Europe/Paris');
  const [providerRef, setProviderRef] = useState<string | null>(null);
  const [etat, setEtat] = useState<'repos' | 'envoi'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  function reinitialiser() {
    setCanal('email');
    setIdentite('');
    setNom('');
    setQuotidien('');
    setHoraire('');
    setFenetre({ ...FENETRE_PAR_DEFAUT, days: [...FENETRE_PAR_DEFAUT.days] });
    setFuseau('Europe/Paris');
    setProviderRef(null);
    setErreur(null);
  }

  async function creer() {
    setEtat('envoi');
    setErreur(null);
    const res = await createSender(orgId, {
      kind: canal,
      identity: identite,
      displayName: nom,
      dailyQuota: versNombre(quotidien),
      hourlyQuota: versNombre(horaire),
      isActive: true,
      startHour: fenetre.startHour,
      endHour: fenetre.endHour,
      days: fenetre.days,
      timezone: fuseau,
      providerRef: canal === 'email' ? providerRef : null,
    });
    setEtat('repos');
    if (res.ok) {
      reinitialiser();
      setOuvert(false);
    } else {
      setErreur(res.error);
    }
  }

  return (
    <>
      <div className="rs-head-actions">
        {/* Primaire seulement quand il ouvre : une fois le formulaire visible,
            l'action principale devient « Créer l'expéditeur ». */}
        <button
          className="rs-btn"
          {...(ouvert ? {} : { 'data-primary': 'true' })}
          type="button"
          disabled={demo}
          onClick={() => setOuvert((o) => !o)}
        >
          {ouvert ? t('form.cancel') : t('form.add')}
        </button>
      </div>

      {ouvert ? (
        <div className="rs-card" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <div className="rs-label" id="nouvel-expediteur-canal">
            {t('form.channel')}
            <div className="rs-lk-days" role="group" aria-labelledby="nouvel-expediteur-canal">
              {(['email', 'linkedin'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rs-lk-day"
                  style={{ width: 'auto', paddingInline: 14 }}
                  data-active={canal === c ? 'true' : undefined}
                  aria-pressed={canal === c}
                  onClick={() => {
                    setCanal(c);
                    setErreur(null);
                  }}
                >
                  {t(`kind.${c}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="rs-label">
            {canal === 'email' ? t('form.emailIdentity') : t('form.linkedinIdentity')}
            <input
              className="rs-input mono"
              value={identite}
              inputMode={canal === 'email' ? 'email' : 'text'}
              placeholder={canal === 'email' ? t('form.emailPlaceholder') : t('form.linkedinPlaceholder')}
              onChange={(e) => {
                setIdentite(e.target.value);
                setErreur(null);
              }}
            />
            {/* L'identité se fixe ici et nulle part ailleurs : elle désigne le
                compte branché chez le provider. */}
            <span className="rs-row-sub">{t('form.identityHint')}</span>
          </label>

          {canal === 'email' ? (
            <SelecteurBoiteSalesBlink
              boitesSalesBlink={boitesSalesBlink}
              providerRef={providerRef}
              onProviderRef={setProviderRef}
              idChamp="nouvel-expediteur-boite-salesblink"
            />
          ) : null}

          <label className="rs-label">
            {t('displayName')}
            <input
              className="rs-input"
              value={nom}
              placeholder={t('displayNamePlaceholder')}
              onChange={(e) => setNom(e.target.value)}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="rs-label">
              {t('dailyQuota')}
              <input
                className="rs-input mono"
                type="number"
                min={0}
                inputMode="numeric"
                value={quotidien}
                placeholder={t('noLimit')}
                onChange={(e) => setQuotidien(e.target.value)}
              />
            </label>
            <label className="rs-label">
              {t('hourlyQuota')}
              <input
                className="rs-input mono"
                type="number"
                min={0}
                inputMode="numeric"
                value={horaire}
                placeholder={t('noLimit')}
                onChange={(e) => setHoraire(e.target.value)}
              />
            </label>
          </div>

          <ReglageFenetre
            fenetre={fenetre}
            fuseau={fuseau}
            onFenetre={(f) => {
              setFenetre(f);
              setErreur(null);
            }}
            onFuseau={(tz) => {
              setFuseau(tz);
              setErreur(null);
            }}
            prefixe="nouvel-expediteur"
          />

          <div className="rs-actions">
            <button
              className="rs-btn"
              data-primary="true"
              type="button"
              disabled={demo || etat === 'envoi' || identite.trim() === ''}
              onClick={creer}
            >
              {etat === 'envoi' ? t('form.creating') : t('form.create')}
            </button>
            {erreur ? (
              <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)', alignSelf: 'center' }}>
                {erreur}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SendersForm({
  senders,
  orgId,
  demo,
  boitesSalesBlink,
}: {
  senders: readonly SenderRow[];
  orgId: string;
  demo: boolean;
  boitesSalesBlink: ResultatBoitesSalesBlink;
}) {
  const t = useTranslations('senders');

  return (
    <>
      <p className="rs-eyebrow">{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p className="rs-lead">{t('lead')}</p>

      <AjouterExpediteur orgId={orgId} demo={demo} boitesSalesBlink={boitesSalesBlink} />

      {senders.length === 0 ? (
        <div className="rs-card">
          <p className="rs-row-sub" style={{ margin: 0 }}>
            {t('empty')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {senders.map((s) => (
            <CarteExpediteur key={s.id} sender={s} orgId={orgId} demo={demo} boitesSalesBlink={boitesSalesBlink} />
          ))}
        </div>
      )}
    </>
  );
}
