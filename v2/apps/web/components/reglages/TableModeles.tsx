'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CanalModele, ModeleMessage } from '@jay-reach/core';
import { Bouton, Champ, EtatVide, Puce, Table, Tiroir, TuileLogo, type ColonneTable } from '../ui';
import { actionEnregistrerModele } from '../../app/actions/templates';

export type CanalModeleVue = CanalModele;

/** `ModeleMessage` (`packages/core/src/fonctions/messages.ts`) avec `modifieLe` déjà mis en forme par la page (fuseau de l'organisation, `lib/dates.ts`) — jamais de calcul de date dans ce composant client. */
export type ModeleVue = Omit<ModeleMessage, 'modifieLe'> & { readonly modifieLeTexte: string };

export interface TableModelesProps {
  readonly modeles: readonly ModeleVue[];
  readonly peutModifier: boolean;
}

type Filtre = 'tous' | 'email' | 'linkedin' | 'non_utilises';

/** Variables offertes à l'insertion (mêmes que `TiroirEtape`, `sequence/TiroirEtape.tsx`). */
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

function estEmail(canal: CanalModeleVue): boolean {
  return canal === 'email';
}
function estLinkedin(canal: CanalModeleVue): boolean {
  return canal === 'linkedin_invite' || canal === 'linkedin_message';
}

/**
 * Cellule « Envois » de la table (tour de correction 1, important #2 :
 * `ModeleMessage.envois` était calculé mais jamais restitué à l'écran).
 * Fonction PURE (comme `sousTitreDe`/`marquesDe` dans `sources/blocsCarteSource.ts`) :
 * prend `t` déjà résolu par le composant plutôt que d'appeler `useTranslations`
 * elle-même, pour rester testable par `renderToStaticMarkup` sans fournisseur
 * `next-intl`.
 */
export function celluleEnvois(t: (cle: string, valeurs?: Record<string, number>) => string, envois: number) {
  return (
    <span className="jr-secondaire" style={{ fontSize: 12.5 }}>
      {t('table.sentCount', { n: envois })}
    </span>
  );
}

interface EtatModele {
  nom: string;
  canal: CanalModeleVue;
  nature: 'signal' | 'list';
  sujet: string;
  corps: string;
}

function etatInitial(modele: ModeleVue | null): EtatModele {
  return {
    nom: modele?.nom ?? '',
    canal: modele?.canal ?? 'email',
    nature: 'signal',
    sujet: modele?.sujet ?? '',
    corps: modele?.corps ?? '',
  };
}

/** Tiroir de création/nouvelle version d'un modèle de bibliothèque (canal, type de campagne visée, objet, corps). */
function TiroirModele({
  modele,
  ouvert,
  onFermer,
}: {
  modele: ModeleVue | null;
  ouvert: boolean;
  onFermer: () => void;
}) {
  const tDrawer = useTranslations('reglages.messages.drawer');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | undefined>(undefined);
  const [etat, setEtat] = useState<EtatModele>(() => etatInitial(modele));
  const corpsRef = useRef<HTMLTextAreaElement>(null);

  function inserVariable(nom: string) {
    const jeton = `{{${nom}}}`;
    const zone = corpsRef.current;
    if (!zone) {
      setEtat((s) => ({ ...s, corps: s.corps + jeton }));
      return;
    }
    const debut = zone.selectionStart ?? etat.corps.length;
    const fin = zone.selectionEnd ?? etat.corps.length;
    setEtat((s) => ({ ...s, corps: `${s.corps.slice(0, debut)}${jeton}${s.corps.slice(fin)}` }));
    requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(debut + jeton.length, debut + jeton.length);
    });
  }

  function enregistrer() {
    setErreur(null);
    setIssues(undefined);
    startTransition(async () => {
      const res = await actionEnregistrerModele({
        familyId: modele?.familyId ?? null,
        nom: etat.nom.trim(),
        canal: etat.canal,
        sujet: estEmail(etat.canal) ? etat.sujet.trim() || null : null,
        corps: etat.corps,
        nature: etat.nature,
      });
      if (res.ok) {
        router.refresh();
        onFermer();
      } else {
        setErreur(res.error);
        setIssues(res.issues);
      }
    });
  }

  if (!ouvert) return null;

  return (
    <Tiroir
      ouvert
      taille="large"
      onFermer={onFermer}
      libelleFermer={tDrawer('close')}
      titre={modele ? tDrawer('titleEdit', { nom: modele.nom }) : tDrawer('titleNew')}
      icone={<TuileLogo marque={estLinkedin(etat.canal) ? 'linkedin' : 'email'} taille="grande" />}
      pied={
        <div className="jr-carte-h-actions">
          <Bouton onClick={onFermer} disabled={pending}>
            {tDrawer('cancel')}
          </Bouton>
          <Bouton variante="principal" onClick={enregistrer} disabled={pending} aria-busy={pending}>
            {tDrawer('save')}
          </Bouton>
        </div>
      }
    >
      <div className="jr-formulaire">
        <div className="ligne">
          <Champ libelle={tDrawer('name')} id="modele-nom">
            <input
              id="modele-nom"
              value={etat.nom}
              onChange={(e) => setEtat((s) => ({ ...s, nom: e.target.value }))}
            />
          </Champ>
          <Champ libelle={tDrawer('channel')} id="modele-canal">
            <select
              id="modele-canal"
              value={etat.canal}
              onChange={(e) => setEtat((s) => ({ ...s, canal: e.target.value as CanalModeleVue }))}
            >
              <option value="email">{tDrawer('channelEmail')}</option>
              <option value="linkedin_invite">{tDrawer('channelLinkedinInvite')}</option>
              <option value="linkedin_message">{tDrawer('channelLinkedinMessage')}</option>
              <option value="letter">{tDrawer('channelLetter')}</option>
              <option value="call">{tDrawer('channelCall')}</option>
            </select>
          </Champ>
        </div>

        <Champ libelle={tDrawer('nature')} id="modele-nature">
          <select
            id="modele-nature"
            value={etat.nature}
            onChange={(e) =>
              setEtat((s) => ({ ...s, nature: e.target.value as 'signal' | 'list' }))
            }
          >
            <option value="signal">{tDrawer('natureSignal')}</option>
            <option value="list">{tDrawer('natureList')}</option>
          </select>
        </Champ>
        <div className="jr-aide">{tDrawer('natureHint')}</div>

        {estEmail(etat.canal) && (
          <Champ libelle={tDrawer('subject')} id="modele-sujet">
            <input
              id="modele-sujet"
              value={etat.sujet}
              onChange={(e) => setEtat((s) => ({ ...s, sujet: e.target.value }))}
            />
          </Champ>
        )}

        <div>
          <span className="jr-libelle">{tDrawer('body')}</span>
          <Champ>
            <textarea
              ref={corpsRef}
              rows={9}
              value={etat.corps}
              onChange={(e) => setEtat((s) => ({ ...s, corps: e.target.value }))}
            />
          </Champ>
          <div className="jr-aide">{tDrawer('bodyHint')}</div>
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
      </div>
    </Tiroir>
  );
}

/** Réglages › Messages (maquette `reglages-messages.html`) : filtres, recherche, table, tiroir de création/édition. */
export function TableModeles({ modeles, peutModifier }: TableModelesProps) {
  const t = useTranslations('reglages.messages');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [recherche, setRecherche] = useState('');
  const [modeleOuvert, setModeleOuvert] = useState<ModeleVue | null | undefined>(undefined);

  const compteurs = useMemo(
    () => ({
      tous: modeles.length,
      email: modeles.filter((m) => estEmail(m.canal)).length,
      linkedin: modeles.filter((m) => estLinkedin(m.canal)).length,
      non_utilises: modeles.filter((m) => m.campagnes.length === 0).length,
    }),
    [modeles],
  );

  const filtres: { cle: Filtre; libelle: string }[] = [
    { cle: 'tous', libelle: t('filters.all', { n: compteurs.tous }) },
    { cle: 'email', libelle: t('filters.email', { n: compteurs.email }) },
    { cle: 'linkedin', libelle: t('filters.linkedin', { n: compteurs.linkedin }) },
    { cle: 'non_utilises', libelle: t('filters.unused', { n: compteurs.non_utilises }) },
  ];

  const rechercheNormalisee = recherche.trim().toLowerCase();
  const modelesAffiches = modeles.filter((m) => {
    if (filtre === 'email' && !estEmail(m.canal)) return false;
    if (filtre === 'linkedin' && !estLinkedin(m.canal)) return false;
    if (filtre === 'non_utilises' && m.campagnes.length > 0) return false;
    if (rechercheNormalisee && !m.nom.toLowerCase().includes(rechercheNormalisee)) return false;
    return true;
  });

  // Largeurs de contenu (tour de correction F6, points 25 et 25 bis) : Canal / Utilisé par / Envois
  // se réduisent à leur contenu (`largeur: '1%'`, même astuce que la colonne Statut des tableaux de
  // contacts, point 20) pour laisser le plus d'espace possible à Modèle ; Modifié passe en nowrap
  // (l'auteur descend sur sa propre ligne, cf. plus bas) plutôt que de couper au milieu d'un mot.
  // Modèle est la SEULE colonne compressible (`largeur: '40%'` + `largeurMax: '0'`, point 25 bis) :
  // avec les cinq autres colonnes déjà `nowrap` (largeur minimale non négociable), l'aperçu du
  // modèle forçait la sienne à 264 px (`max-width: 30ch` d'origine, ci-dessous, jamais compressible
  // en `table-layout: auto`) — plus rien ne pouvait se compresser, la table débordait de son
  // conteneur (835 px pour 782 px mesurés) et coupait le bouton Modifier. `largeurMax: '0'` retire
  // ce plancher : Modèle prend ce qu'il reste une fois les cinq autres colonnes servies, jamais plus.
  const colonnes: ColonneTable[] = [
    { cle: 'modele', titre: t('table.name'), largeur: '40%', largeurMax: '0' },
    { cle: 'canal', titre: t('table.channel'), nowrap: true, largeur: '1%' },
    { cle: 'utilisePar', titre: t('table.usedBy'), nowrap: true, largeur: '1%' },
    { cle: 'envois', titre: t('table.sent'), num: true, nowrap: true, largeur: '110px' },
    { cle: 'modifie', titre: t('table.modified'), nowrap: true, largeur: '160px' },
    { cle: 'action', titre: '' },
  ];

  const libelleCanal = (canal: CanalModeleVue): string => {
    if (canal === 'email') return t('table.channelEmail');
    if (canal === 'linkedin_invite' || canal === 'linkedin_message')
      return t('table.channelLinkedin');
    if (canal === 'letter') return t('table.channelLetter');
    return t('table.channelCall');
  };

  const lignes = modelesAffiches.map((m) => ({
    // Titre et aperçu tronqués sur une ligne à la largeur RÉELLE de la cellule (tour de correction
    // F6, point 25 bis), plus jamais à un nombre de caractères fixe (`max-width: 30ch` ci-avant) :
    // c'est justement cette largeur en dur qui forçait la colonne Modèle à 264 px quoi qu'il arrive.
    modele: (
      <>
        <b className="jr-modele-titre">{m.nom}</b>
        <small className="jr-secondaire jr-modele-apercu">{m.sujet ?? m.corps}</small>
      </>
    ),
    canal: <Puce ton={estLinkedin(m.canal) ? 'li' : undefined}>{libelleCanal(m.canal)}</Puce>,
    utilisePar:
      m.campagnes.length === 0 ? (
        <span className="jr-secondaire" style={{ fontSize: 12.5 }}>
          {t('table.unusedBy')}
        </span>
      ) : (
        <div className="jr-puces">
          {m.campagnes.map((nom) => (
            <span key={nom} className="jr-puce gris">
              {nom}
            </span>
          ))}
        </div>
      ),
    envois: celluleEnvois(t, m.envois),
    // Auteur en sous-ligne plutôt qu'accolé à la date (tour de correction F6, point 25) : les deux
    // bout à bout (« renartjeanbaptiste · 28 août ») dépassaient la largeur de la colonne et
    // coupaient sur deux lignes malgré le nowrap.
    modifie: (
      <span className="jr-secondaire" style={{ fontSize: 12.5 }}>
        {m.modifieLeTexte}
        {m.modifiePar && <small className="jr-detail-ligne">{m.modifiePar}</small>}
      </span>
    ),
    action: peutModifier ? (
      <Bouton taille="petit" onClick={() => setModeleOuvert(m)}>
        {t('table.edit')}
      </Bouton>
    ) : null,
  }));

  return (
    <>
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('lead')}</p>
        </div>
        {peutModifier && (
          <Bouton variante="principal" onClick={() => setModeleOuvert(null)}>
            {t('new')}
          </Bouton>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div className="jr-puces">
          {filtres.map((f) => (
            <button
              key={f.cle}
              type="button"
              className={['jr-puce', filtre === f.cle ? 'accent' : undefined]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={filtre === f.cle}
              onClick={() => setFiltre(f.cle)}
            >
              {f.libelle}
            </button>
          ))}
        </div>
        <div className="jr-champ" style={{ width: 240 }}>
          <input
            value={recherche}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      </div>

      {modeles.length === 0 ? (
        <EtatVide
          titre={t('empty.title')}
          texte={t('empty.text')}
          action={
            peutModifier && (
              <Bouton onClick={() => setModeleOuvert(null)}>{t('empty.action')}</Bouton>
            )
          }
        />
      ) : (
        <div className="jr-carte">
          <Table colonnes={colonnes} lignes={lignes} vide={t('noResult')} />
        </div>
      )}

      <TiroirModele
        key={modeleOuvert === undefined ? 'clos' : (modeleOuvert?.id ?? 'nouveau')}
        modele={modeleOuvert ?? null}
        ouvert={modeleOuvert !== undefined}
        onFermer={() => setModeleOuvert(undefined)}
      />
    </>
  );
}
