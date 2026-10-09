'use client';

import { useState, type ReactNode } from 'react';
import { Bouton, Carte, Champ, EtatVide, Menu, Puce, TuileLogo } from '../../ui';
import { collecteServeurDisponible } from '../../sources/collecte-maintenant';
import type { GroupeMenu } from '../../ui';
import {
  ChampsSourceLinkedIn,
  champsLinkedInValides,
  construireConfigLinkedIn,
  etatChampsLinkedInDepuisConfig,
  type EtatChampsLinkedIn,
  type TypeLinkedIn,
} from '../../sources/ChampsSourceLinkedIn';

export type ProviderIdAssistant = 'adzuna' | 'france_travail' | TypeLinkedIn;

const TYPES_LINKEDIN: readonly TypeLinkedIn[] = [
  'linkedin_post_engagers',
  'linkedin_competitor_posts',
  'linkedin_creator_posts',
  'linkedin_keywords',
  'linkedin_job_change',
];
function estLinkedIn(providerId: ProviderIdAssistant): providerId is TypeLinkedIn {
  return (TYPES_LINKEDIN as readonly string[]).includes(providerId);
}

export interface ConfigSourceAssistant {
  readonly [cle: string]: unknown;
}

export interface SourceAssistant {
  /** Identifiant LOCAL (pas un id base — la source n'existe pas encore) : sert de clé React et de cible de retrait. */
  readonly cle: string;
  readonly providerId: ProviderIdAssistant;
  readonly nom: string;
  readonly config: ConfigSourceAssistant;
}

export interface EtapeSourcesLibelles {
  titre: string;
  description: string;
  ajouter: string;
  vide: string;
  aide: string;
  retirer: string;
  menuOffres: string;
  menuAdzunaTitre: string;
  menuAdzunaDescription: string;
  menuFranceTravailTitre: string;
  menuFranceTravailDescription: string;
  menuLinkedin: string;
  menuLinkedinBadge: string;
  menuLinkedinPostEngagersTitre: string;
  menuLinkedinPostEngagersDescription: string;
  menuLinkedinCompetitorPostsTitre: string;
  menuLinkedinCompetitorPostsDescription: string;
  menuLinkedinCreatorPostsTitre: string;
  menuLinkedinCreatorPostsDescription: string;
  menuLinkedinKeywordsTitre: string;
  menuLinkedinKeywordsDescription: string;
  menuLinkedinJobChangeTitre: string;
  menuLinkedinJobChangeDescription: string;
  menuManuel: string;
  menuCsvTitre: string;
  menuCsvNote: string;
  formNom: string;
  formMotsCles: string;
  formMotsClesAide: string;
  formLieux: string;
  formContrat: string;
  formContratTous: string;
  formContratCdi: string;
  formLinkedinPostUrl: string;
  formLinkedinKeepPeople: string;
  formLinkedinCommented: string;
  formLinkedinReacted: string;
  formLinkedinPostOneCampaign: string;
  formLinkedinCompetitorPages: string;
  formLinkedinCompetitorPagesHint: string;
  formLinkedinCreatorProfiles: string;
  formLinkedinCreatorProfilesHint: string;
  formLinkedinTopics: string;
  formLinkedinTopicsHint: string;
  formLinkedinSinceDays: string;
  formLinkedinAccountId: string;
  formLinkedinProfilesPerDay: string;
  formLinkedinErreur: string;
  /** Bandeau du formulaire des engageurs d'un post : l'assistant crée toujours un brouillon. */
  formLinkedinBrouillon: string;
  resumeLinkedin: (n: number) => string;
  formAjouter: string;
  formAnnuler: string;
  formErreur: string;
}

export interface EtapeSourcesProps {
  sources: readonly SourceAssistant[];
  onAjouter: (source: SourceAssistant) => void;
  onRetirer: (cle: string) => void;
  disabled: boolean;
  libelles: EtapeSourcesLibelles;
}

function texteVersListe(t: string): string[] {
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function asListeChaines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function titreLinkedin(providerId: TypeLinkedIn, libelles: EtapeSourcesLibelles): string {
  switch (providerId) {
    case 'linkedin_post_engagers':
      return libelles.menuLinkedinPostEngagersTitre;
    case 'linkedin_competitor_posts':
      return libelles.menuLinkedinCompetitorPostsTitre;
    case 'linkedin_creator_posts':
      return libelles.menuLinkedinCreatorPostsTitre;
    case 'linkedin_keywords':
      return libelles.menuLinkedinKeywordsTitre;
    case 'linkedin_job_change':
      return libelles.menuLinkedinJobChangeTitre;
  }
}

/**
 * Construit la `config` d'une source Adzuna/France Travail depuis les
 * champs de l'assistant (tour de correction 1, R58) : `configFranceTravail`
 * (`packages/core/src/fonctions/sources.ts`) attend `typeContrat`,
 * `configAdzuna` attend `contrat` — jamais l'un pour l'autre (avant ce
 * correctif, `contrat` était envoyé aux deux, silencieusement ignoré par le
 * schéma France Travail). Pure et exportée pour être testée directement
 * contre le vrai schéma zod, sans passer par le rendu du formulaire.
 */
export function construireConfigOffre(
  providerId: 'adzuna' | 'france_travail',
  motsCles: string[],
  lieux: string[],
  contrat: 'cdi' | 'tous',
): ConfigSourceAssistant {
  const commun = { motsCles, lieux, exclusions: [] as string[] };
  return providerId === 'france_travail' ? { ...commun, typeContrat: contrat } : { ...commun, contrat };
}

/**
 * Groupes du menu « + Ajouter une source » (maquette `nouvelle-campagne-2.html`,
 * tour de correction 1, R57) : Offres d'emploi, LinkedIn et Manuel
 * (Fichier CSV, affiché mais inerte — l'import exige une campagne déjà créée).
 *
 * Le badge marque les types que le serveur NE COLLECTE PAS ENCORE. La liste était écrite à la
 * main — « tous sauf les engageurs d'un post » — et chaque type branché la rendait fausse sans
 * que rien ne le signale : le 09/10, les posts d'un concurrent étaient collectés depuis la
 * veille et portaient toujours le badge. Il se décide donc par `collecteServeurDisponible`, la
 * même question que le bouton « Collecter maintenant » et que le worker.
 * Pure et exportée pour être testée sans ouvrir le menu (état interne du
 * composant, invisible à `renderToStaticMarkup`).
 */
export function construireGroupesMenu(
  libelles: EtapeSourcesLibelles,
  ouvrirFormulaire: (providerId: ProviderIdAssistant) => void,
): GroupeMenu[] {
  const badge = (providerId: ProviderIdAssistant): ReactNode =>
    collecteServeurDisponible(providerId) ? null : <Puce ton="gris">{libelles.menuLinkedinBadge}</Puce>;
  return [
    {
      titre: libelles.menuOffres,
      entrees: [
        {
          icone: <TuileLogo marque="adzuna" />,
          titre: libelles.menuAdzunaTitre,
          description: libelles.menuAdzunaDescription,
          onSelectionner: () => ouvrirFormulaire('adzuna'),
        },
        {
          icone: <TuileLogo marque="francetravail" />,
          titre: libelles.menuFranceTravailTitre,
          description: libelles.menuFranceTravailDescription,
          onSelectionner: () => ouvrirFormulaire('france_travail'),
        },
      ],
    },
    {
      titre: libelles.menuLinkedin,
      entrees: [
        {
          icone: <TuileLogo marque="linkedin" />,
          titre: (
            <>
              {libelles.menuLinkedinPostEngagersTitre}
            </>
          ),
          description: libelles.menuLinkedinPostEngagersDescription,
          onSelectionner: () => ouvrirFormulaire('linkedin_post_engagers'),
        },
        {
          icone: <TuileLogo marque="linkedin" />,
          titre: (
            <>
              {libelles.menuLinkedinCompetitorPostsTitre} {badge('linkedin_competitor_posts')}
            </>
          ),
          description: libelles.menuLinkedinCompetitorPostsDescription,
          onSelectionner: () => ouvrirFormulaire('linkedin_competitor_posts'),
        },
        {
          icone: <TuileLogo marque="linkedin" />,
          titre: (
            <>
              {libelles.menuLinkedinCreatorPostsTitre} {badge('linkedin_creator_posts')}
            </>
          ),
          description: libelles.menuLinkedinCreatorPostsDescription,
          onSelectionner: () => ouvrirFormulaire('linkedin_creator_posts'),
        },
        {
          icone: <TuileLogo marque="linkedin" />,
          titre: (
            <>
              {libelles.menuLinkedinKeywordsTitre} {badge('linkedin_keywords')}
            </>
          ),
          description: libelles.menuLinkedinKeywordsDescription,
          onSelectionner: () => ouvrirFormulaire('linkedin_keywords'),
        },
        {
          icone: <TuileLogo marque="linkedin" />,
          titre: (
            <>
              {libelles.menuLinkedinJobChangeTitre} {badge('linkedin_job_change')}
            </>
          ),
          description: libelles.menuLinkedinJobChangeDescription,
          onSelectionner: () => ouvrirFormulaire('linkedin_job_change'),
        },
      ],
    },
    {
      titre: libelles.menuManuel,
      entrees: [
        {
          icone: <TuileLogo marque="csv" />,
          titre: libelles.menuCsvTitre,
          description: libelles.menuCsvNote,
          desactive: true,
        },
      ],
    },
  ];
}

/**
 * Bandeau du formulaire des engageurs d'un post : l'assistant crée TOUJOURS un brouillon, donc
 * l'avertissement est vrai quoi qu'il arrive. Pure et exportée : le formulaire n'apparaît qu'après
 * un clic (état interne), invisible à `renderToStaticMarkup`.
 */
export function bandeauBrouillonLinkedin(providerId: ProviderIdAssistant, libelles: EtapeSourcesLibelles): ReactNode {
  if (providerId !== 'linkedin_post_engagers') return null;
  return <div className="jr-bandeau attention">{libelles.formLinkedinBrouillon}</div>;
}

function resumeSource(source: SourceAssistant, libelles: EtapeSourcesLibelles): string {
  if (source.providerId === 'adzuna' || source.providerId === 'france_travail') {
    const morceaux = [asListeChaines(source.config.motsCles).join(', ')];
    const lieux = asListeChaines(source.config.lieux);
    if (lieux.length > 0) morceaux.push(lieux.join(', '));
    return morceaux.join(' · ');
  }
  if (source.providerId === 'linkedin_post_engagers') {
    return typeof source.config.urlPost === 'string' ? source.config.urlPost : '';
  }
  // La source « posts d'un concurrent » se résume par ses pages, comme le post par son adresse.
  // Elle ne porte plus `profilsParJour` : afficher le repli à 40 annoncerait « 40 profils par
  // jour » alors que les plafonds réels sont les posts du jour et les personnes par passage —
  // un chiffre que le produit ne mesure pas.
  if (source.providerId === 'linkedin_competitor_posts') {
    return asListeChaines(source.config.pagesConcurrentes).join(', ');
  }
  if (source.providerId === 'linkedin_creator_posts') {
    return asListeChaines(source.config.profilsCreateurs).join(', ');
  }
  if (source.providerId === 'linkedin_keywords') {
    return asListeChaines(source.config.sujets).join(', ');
  }
  const profilsParJour = typeof source.config.profilsParJour === 'number' ? source.config.profilsParJour : 40;
  return libelles.resumeLinkedin(profilsParJour);
}

/**
 * Étape « Sources » de l'assistant (maquette `nouvelle-campagne-2.html`) :
 * n'écrit RIEN (`creerSource` n'est appelé qu'à la fin, par
 * `creerCampagneComplete`) — les sources ajoutées ici vivent dans l'état de
 * `Assistant`, retirables tant que la campagne n'est pas créée.
 *
 * Catalogue complet de la maquette (tour de correction 1, R57) : Offres
 * d'emploi (Adzuna, France Travail), les quatre sources LinkedIn — réglables
 * dès l'assistant via `ChampsSourceLinkedIn`, partagé avec le tiroir de
 * l'onglet Sources (tâche 11) ; seule la collecte des engageurs d'un post existe (lot 4a) —
 * et Manuel (Fichier CSV, affiché mais désactivé : l'import exige une
 * campagne déjà créée, `importerCsv`).
 */
export function EtapeSources({ sources, onAjouter, onRetirer, disabled, libelles }: EtapeSourcesProps) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState<ProviderIdAssistant | null>(null);
  const [nom, setNom] = useState('');
  const [motsCles, setMotsCles] = useState('');
  const [lieux, setLieux] = useState('');
  const [contrat, setContrat] = useState<'cdi' | 'tous'>('tous');
  const [erreur, setErreur] = useState(false);
  const [etatLinkedin, setEtatLinkedin] = useState<EtatChampsLinkedIn>(() => etatChampsLinkedInDepuisConfig());
  const [erreurLinkedin, setErreurLinkedin] = useState(false);

  function ouvrirFormulaire(providerId: ProviderIdAssistant) {
    setMenuOuvert(false);
    setAjoutEnCours(providerId);
    setNom('');
    setMotsCles('');
    setLieux('');
    setContrat('tous');
    setErreur(false);
    setEtatLinkedin(etatChampsLinkedInDepuisConfig());
    setErreurLinkedin(false);
  }

  function annulerFormulaire() {
    setAjoutEnCours(null);
    setErreur(false);
    setErreurLinkedin(false);
  }

  function validerFormulaireOffre(providerId: 'adzuna' | 'france_travail') {
    const mots = texteVersListe(motsCles);
    if (mots.length === 0) {
      setErreur(true);
      return;
    }
    const config = construireConfigOffre(providerId, mots, texteVersListe(lieux), contrat);
    onAjouter({
      cle: `${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      providerId,
      nom: nom.trim() || mots.join(', '),
      config,
    });
    setAjoutEnCours(null);
  }

  function validerFormulaireLinkedin(providerId: TypeLinkedIn) {
    if (!champsLinkedInValides(providerId, etatLinkedin)) {
      setErreurLinkedin(true);
      return;
    }
    onAjouter({
      cle: `${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      providerId,
      nom: nom.trim() || titreLinkedin(providerId, libelles),
      config: construireConfigLinkedIn(providerId, etatLinkedin),
    });
    setAjoutEnCours(null);
  }

  function validerFormulaire() {
    if (!ajoutEnCours) return;
    if (estLinkedIn(ajoutEnCours)) validerFormulaireLinkedin(ajoutEnCours);
    else validerFormulaireOffre(ajoutEnCours);
  }

  const badgeLinkedin = <Puce ton="gris">{libelles.menuLinkedinBadge}</Puce>;

  return (
    <Carte
      entete={
        <>
          <span>
            <b>{libelles.titre}</b>
            <br />
            <small>{libelles.description}</small>
          </span>
          <div className="jr-menu-ancre">
            <Bouton variante="sombre" onClick={() => setMenuOuvert((v) => !v)} disabled={disabled}>
              {libelles.ajouter}
            </Bouton>
            {menuOuvert && (
              <>
                <button
                  type="button"
                  className="jr-menu-clic-exterieur"
                  aria-label={libelles.ajouter}
                  onClick={() => setMenuOuvert(false)}
                />
                <Menu groupes={construireGroupesMenu(libelles, ouvrirFormulaire)} />
              </>
            )}
          </div>
        </>
      }
    >
      {sources.length === 0 && !ajoutEnCours && <EtatVide titre={libelles.vide} texte={libelles.aide} />}

      {sources.map((source) => (
        <div key={source.cle} className="jr-source">
          <TuileLogo
            marque={source.providerId === 'adzuna' ? 'adzuna' : source.providerId === 'france_travail' ? 'francetravail' : 'linkedin'}
          />
          <span>
            <b>{source.nom}</b>
            <small>{resumeSource(source, libelles)}</small>
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {estLinkedIn(source.providerId) && !collecteServeurDisponible(source.providerId) && badgeLinkedin}
            <Bouton taille="petit" onClick={() => onRetirer(source.cle)} disabled={disabled}>
              {libelles.retirer}
            </Bouton>
          </span>
        </div>
      ))}

      {ajoutEnCours && estLinkedIn(ajoutEnCours) && (
        <div className="jr-formulaire">
          {bandeauBrouillonLinkedin(ajoutEnCours, libelles)}
          <Champ libelle={libelles.formNom} id="assistant-sources-nom">
            <input id="assistant-sources-nom" name="nom" value={nom} onChange={(e) => setNom(e.target.value)} disabled={disabled} />
          </Champ>
          <ChampsSourceLinkedIn
            providerId={ajoutEnCours}
            etat={etatLinkedin}
            onChange={(patch) => setEtatLinkedin((precedent) => ({ ...precedent, ...patch }))}
            disabled={disabled}
            idPrefix="assistant-sources-linkedin"
            libelles={{
              postUrl: libelles.formLinkedinPostUrl,
              keepPeople: libelles.formLinkedinKeepPeople,
              commented: libelles.formLinkedinCommented,
              reacted: libelles.formLinkedinReacted,
              postOneCampaign: libelles.formLinkedinPostOneCampaign,
              competitorPages: libelles.formLinkedinCompetitorPages,
              competitorPagesHint: libelles.formLinkedinCompetitorPagesHint,
              creatorProfiles: libelles.formLinkedinCreatorProfiles,
              creatorProfilesHint: libelles.formLinkedinCreatorProfilesHint,
              topics: libelles.formLinkedinTopics,
              topicsHint: libelles.formLinkedinTopicsHint,
              sinceDays: libelles.formLinkedinSinceDays,
              accountId: libelles.formLinkedinAccountId,
              profilesPerDay: libelles.formLinkedinProfilesPerDay,
            }}
          />
          {erreurLinkedin && <div className="jr-aide-erreur">{libelles.formLinkedinErreur}</div>}
          <div className="jr-actions">
            <Bouton onClick={annulerFormulaire} disabled={disabled}>
              {libelles.formAnnuler}
            </Bouton>
            <Bouton variante="principal" onClick={validerFormulaire} disabled={disabled}>
              {libelles.formAjouter}
            </Bouton>
          </div>
        </div>
      )}

      {ajoutEnCours && !estLinkedIn(ajoutEnCours) && (
        <div className="jr-formulaire">
          <Champ libelle={libelles.formNom} id="assistant-sources-nom">
            <input id="assistant-sources-nom" name="nom" value={nom} onChange={(e) => setNom(e.target.value)} disabled={disabled} />
          </Champ>
          <Champ
            libelle={libelles.formMotsCles}
            erreur={erreur ? libelles.formErreur : undefined}
            id="assistant-sources-mots-cles"
          >
            <input
              id="assistant-sources-mots-cles"
              name="motsCles"
              value={motsCles}
              onChange={(e) => setMotsCles(e.target.value)}
              disabled={disabled}
            />
          </Champ>
          <div className="jr-aide">{libelles.formMotsClesAide}</div>
          <Champ libelle={libelles.formLieux} id="assistant-sources-lieux">
            <input id="assistant-sources-lieux" name="lieux" value={lieux} onChange={(e) => setLieux(e.target.value)} disabled={disabled} />
          </Champ>
          <Champ libelle={libelles.formContrat} id="assistant-sources-contrat">
            <select
              id="assistant-sources-contrat"
              name="contrat"
              value={contrat}
              onChange={(e) => setContrat(e.target.value === 'cdi' ? 'cdi' : 'tous')}
              disabled={disabled}
            >
              <option value="tous">{libelles.formContratTous}</option>
              <option value="cdi">{libelles.formContratCdi}</option>
            </select>
          </Champ>
          <div className="jr-actions">
            <Bouton onClick={annulerFormulaire} disabled={disabled}>
              {libelles.formAnnuler}
            </Bouton>
            <Bouton variante="principal" onClick={validerFormulaire} disabled={disabled}>
              {libelles.formAjouter}
            </Bouton>
          </div>
        </div>
      )}

      {sources.length > 0 && !ajoutEnCours && <p className="jr-aide">{libelles.aide}</p>}
    </Carte>
  );
}
