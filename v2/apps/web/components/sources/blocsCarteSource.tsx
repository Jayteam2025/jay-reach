import type { getTranslations } from 'next-intl/server';
import { configFormulaireDepuisStockee, heuresDeSchedule, type SourceCarte } from '@jay-reach/core';
import { Puce } from '../ui';
import type { TuileLogoMarque } from '../ui';
import { heureAvecJour } from '../../lib/dates';
import type { BlocCarteSource } from './CarteSource';

type Traducteur = Awaited<ReturnType<typeof getTranslations>>;

export function marqueDe(providerId: SourceCarte['providerId']): TuileLogoMarque {
  if (providerId === 'adzuna') return 'adzuna';
  if (providerId === 'france_travail') return 'francetravail';
  return 'linkedin';
}

/** Un logo par fournisseur réel, dans l'ordre déjà posé par `resoudreProviders` (R44, core). */
export function marquesDe(providerIds: SourceCarte['providerIds']): TuileLogoMarque[] {
  return providerIds.map(marqueDe);
}

/**
 * Sous-titre de la carte Adzuna/France Travail (R43, tour de correction 2) :
 * lu par `configFormulaireDepuisStockee`, jamais directement `carte.config`
 * (dont les clés réelles sont celles du worker — `sousTitreDe` affichait
 * « — » pour toute source migrée avant ce lot). « France entière » plutôt
 * qu'un tiret seul quand aucun lieu n'est choisi : un tiret seul ne dit pas
 * si c'est un réglage ou une donnée manquante.
 */
export function sousTitreDe(carte: SourceCarte, t: Traducteur): string {
  if (carte.providerId !== 'adzuna' && carte.providerId !== 'france_travail') {
    const config = carte.config as { pagesConcurrentes?: string[]; profilsCreateurs?: string[]; sujets?: string[] };
    // La source « posts d'un concurrent » n'a plus de `compteId` (un seul compte LinkedIn par
    // instance) : sans ça, sa carte affichait un tiret là où l'opérateur attend de voir QUI il
    // suit. On y met les noms publics des pages, qui tiennent sur une ligne — l'adresse complète
    // est juste en dessous.
    const pages = (config.pagesConcurrentes ?? [])
      .map((u) => /linkedin\.com\/(?:company|showcase)\/([^/?#]+)/i.exec(u)?.[1] ?? u)
      .filter((v) => v.length > 0);
    if (pages.length > 0) return pages.join(', ');
    // Même raisonnement pour la source « posts d'un créateur » : le nom public du profil.
    const profils = (config.profilsCreateurs ?? [])
      .map((u) => /linkedin\.com\/in\/([^/?#]+)/i.exec(u)?.[1] ?? u)
      .filter((v) => v.length > 0);
    if (profils.length > 0) return profils.join(', ');
    // Et pour la recherche par mot-clé : les mots-clés eux-mêmes.
    const sujets = (config.sujets ?? []).filter((v) => v.length > 0);
    if (sujets.length > 0) return sujets.join(', ');
    // Le changement de poste n'a ni entrée ni réglage : on dit sur qui il porte, pas un tiret.
    if (carte.providerId === 'linkedin_job_change') return t('card.jobChangeSubtitle');
    return '—';
  }
  const config = configFormulaireDepuisStockee(carte.providerId, carte.config) as {
    lieux: string[];
  };
  return config.lieux.length > 0 ? config.lieux.join(', ') : t('card.franceEntiere');
}

export function ListePuces({ valeurs }: { valeurs: string[] }) {
  if (valeurs.length === 0) return <span className="jr-secondaire">—</span>;
  return (
    <div className="jr-puces">
      {valeurs.map((v, i) => (
        <Puce key={i}>{v}</Puce>
      ))}
    </div>
  );
}

/** Cadence affichée : « Une fois par jour » (clé existante) plutôt que « Toutes les 24 heures », que la valeur stockée soit `daily` ou `every 24h`. */
function cadenceDe(schedule: string, t: Traducteur): string {
  const heures = heuresDeSchedule(schedule);
  return heures === 24 ? t('card.dailySchedule') : t('card.everyNHours', { n: heures });
}

export function construireBlocsOffres(carte: SourceCarte, t: Traducteur): BlocCarteSource[] {
  const config = configFormulaireDepuisStockee(carte.providerId, carte.config) as {
    motsCles: string[];
    contrat?: string;
    typeContrat?: string;
    taille?: string;
    departement?: string;
    exclusions: string[];
  };
  const filtres = [
    config.contrat === 'cdi' || config.typeContrat === 'cdi' ? t('drawer.contractCdi') : null,
    config.taille ?? null,
    config.departement ?? null,
    ...config.exclusions,
  ].filter((v): v is string => Boolean(v));

  const cadence = cadenceDe(carte.schedule, t);
  // Une source en pause n'a pas de prochain passage : on le dit plutôt que
  // d'afficher une heure (souvent déjà passée). R72 : une source active sans
  // AUCUNE campagne rattachée active ne tournera pas à l'heure calculée (le
  // producteur du worker l'ignore) — « au lancement » plutôt qu'une heure
  // trompeuse.
  const prochain = !carte.active
    ? t('card.nextPaused')
    : !carte.campagneActive
      ? t('card.nextOnLaunch')
      : carte.prochainPassage
        ? heureAvecJour(carte.prochainPassage)
        : '—';
  const passages = carte.dernierPassage
    ? t('card.schedule', { cadence, dernier: heureAvecJour(carte.dernierPassage.quand), prochain })
    : t('card.scheduleNoLast', { cadence, prochain: carte.active ? t('card.neverRun') : t('card.nextPaused') });

  return [
    { libelle: t('card.query'), contenu: <ListePuces valeurs={config.motsCles} /> },
    { libelle: t('card.filters'), contenu: <ListePuces valeurs={filtres} /> },
    {
      libelle: t('card.passages'),
      contenu: (
        <div>
          {passages}
          {carte.dernierPassage && (
            <>
              <br />
              <span className="jr-secondaire">
                {t('card.readAndKept', {
                  lus: carte.dernierPassage.lus,
                  retenus: carte.dernierPassage.retenus,
                })}
              </span>
            </>
          )}
        </div>
      ),
    },
  ];
}

export function construireBlocsLinkedIn(carte: SourceCarte, t: Traducteur): BlocCarteSource[] {
  const config = carte.config as {
    urlPost?: string;
    garder?: string[];
    pagesConcurrentes?: string[];
    profilsCreateurs?: string[];
    sujets?: string[];
  };
  const blocs: BlocCarteSource[] = [];
  // « Qui garder » vaut pour les deux sources d'engageurs : c'est le même collecteur derrière,
  // et l'opérateur vient de le saisir — ne pas le relire sur la carte lui ferait rouvrir le
  // tiroir pour vérifier.
  const quiGarder = (): BlocCarteSource => ({
    libelle: t('card.keep'),
    contenu: (
      <ListePuces
        valeurs={[
          config.garder?.includes('commente') ? t('drawer.commented') : null,
          config.garder?.includes('reagi') ? t('drawer.reacted') : null,
        ].filter((v): v is string => Boolean(v))}
      />
    ),
  });
  if (carte.providerId === 'linkedin_post_engagers') {
    blocs.push({ libelle: t('card.postFollowed'), contenu: <AdressePost url={config.urlPost} /> });
    blocs.push(quiGarder());
  } else if (carte.providerId === 'linkedin_competitor_posts') {
    blocs.push({
      libelle: t('drawer.competitorPages'),
      contenu: <ListePuces valeurs={config.pagesConcurrentes ?? []} />,
    });
    blocs.push(quiGarder());
  } else if (carte.providerId === 'linkedin_creator_posts') {
    blocs.push({
      libelle: t('drawer.creatorProfiles'),
      contenu: <ListePuces valeurs={config.profilsCreateurs ?? []} />,
    });
    blocs.push(quiGarder());
  } else if (carte.providerId === 'linkedin_keywords') {
    blocs.push({
      libelle: t('drawer.topics'),
      contenu: <ListePuces valeurs={config.sujets ?? []} />,
    });
  }
  if (carte.providerId === 'linkedin_post_engagers') {
    // Jamais de cadence ici : une source d'engageurs ne part pas toute seule
    // (`enqueueDiscoverForActiveSources` l'exclut, un passage ne s'ouvre que par
    // « Collecter maintenant »). Afficher « toutes les 6 heures » promettrait
    // une collecte que rien ne lance.
    blocs.push({ libelle: t('card.passages'), contenu: <span>{t('card.onDemand')}</span> });
    blocs.push({ libelle: t('card.lastRun'), contenu: <DernierePassageLinkedIn carte={carte} t={t} />, pleineLargeur: true });
    return blocs;
  }
  blocs.push({
    libelle: t('card.passages'),
    contenu: <span>{cadenceDe(carte.schedule, t)}</span>,
  });
  return blocs;
}

/**
 * L'adresse du post sur UNE ligne, tronquée par une ellipse : un identifiant d'activité de dix-sept
 * chiffres ne se lit pas, la couper en trois lignes la rend illisible. L'adresse complète reste au
 * survol et dans le lien. Le lien n'est posé que pour une adresse https : la valeur vient de la
 * configuration saisie par l'opérateur, jamais un schéma `javascript:`.
 */
function AdressePost({ url }: { url: string | undefined }) {
  if (!url) return <span>—</span>;
  if (!/^https:\/\//i.test(url)) return <span className="jr-url-tronquee" title={url}>{url}</span>;
  return (
    <a className="jr-url-tronquee" href={url} title={url} target="_blank" rel="noopener noreferrer">
      {url.replace(/^https:\/\/(www\.)?/i, '')}
    </a>
  );
}

/**
 * Le bilan du dernier passage d'une source d'engageurs : la raison d'un passage qui n'a rien produit
 * (`erreur`) et les issues de la spec §5.4 (nouveaux, doublons, déjà dans une campagne, écartés par
 * le scoring). C'est le seul retour de l'opérateur sur une collecte qui tourne sur le serveur.
 */
function DernierePassageLinkedIn({ carte, t }: { carte: SourceCarte; t: Traducteur }) {
  const c = carte.derniereCollecte;
  if (!c) return <span className="jr-secondaire">{t('card.lastRunNever')}</span>;
  // Un passage arrêté sans avoir rien vu : sa cause est la seule information, des compteurs à zéro la noieraient.
  const rienVu = c.vus === 0 && c.erreur !== null;
  const statut = c.statut === 'running' ? t('card.runRunning') : c.statut === 'success' ? t('card.runSuccess') : t('card.runError');
  return (
    <div>
      {t('card.runHeader', { quand: heureAvecJour(c.quand), statut })}
      {c.erreur && (
        <>
          <br />
          <span className={c.statut === 'error' ? 'jr-texte-erreur' : 'jr-secondaire'}>{c.erreur}</span>
        </>
      )}
      {!rienVu && (
        <>
          <br />
          <span>
            {t('card.runCounts', {
              vus: c.vus,
              nouveaux: c.nouveaux,
              doublons: c.doublons,
              dejaEnCampagne: c.dejaEnCampagne,
              ecartes: c.ecartes,
            })}
          </span>
          <br />
          <span className="jr-secondaire">
            {t('card.runDetails', {
              requetes: c.requetes,
              ignores: c.ignores,
              opposes: c.opposes,
              adressesDeduites: c.adressesDeduites,
            })}
          </span>
        </>
      )}
    </div>
  );
}
