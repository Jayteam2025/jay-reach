/**
 * Handler de la RELÈVE des réponses LinkedIn par le serveur (lot réponses LinkedIn, tâche 4).
 *
 * Un passage ouvre le navigateur du serveur, lit les vingt dernières conversations en UN appel
 * (`analyserConversations`), rattache chaque message entrant à un contact, l'enregistre
 * (`recordInboundReply`) et prévient l'opérateur (`notifyReply`, que `recordInboundReply` N'APPELLE
 * PAS). Il ne contacte jamais personne : lecture seule.
 *
 * Ordre, calqué sur `traiterEnvoiLinkedIn` : garde du canal, session active, plage horaire, verrou,
 * navigateur, relève de sortie + contrôle, trace, appel, puis `finally` qui rend le verrou et ferme
 * le pilote.
 *
 * Les règles qui comptent :
 *  - **Le curseur n'avance qu'après un passage ENTIÈREMENT réussi.** Un cas individuel qui échoue
 *    (écriture d'une réponse, notification) n'interrompt pas les autres : tous sont traités, le
 *    curseur reste figé, l'erreur est levée à la fin. Les messages déjà enregistrés au passage
 *    suivant rendent `isNew: false` : ni doublon, ni seconde notification.
 *  - **Le compte connecté est relu à CHAQUE passage.** S'il a changé, nos propres messages sortants
 *    passeraient pour des réponses entrantes, donc des exclusions sur nos propres contacts : on ne
 *    traite rien, on ne touche pas au curseur, on pose le nouveau compte.
 *  - **Le rattachement se fait en deux temps** : par l'identifiant du profil (`linkedin_provider_id`),
 *    puis, à défaut, par l'URL de profil. Beaucoup de contacts n'ont qu'une URL.
 *  - **Un message qui ne correspond à aucun contact n'est jamais stocké** (compté seulement).
 *  - **Le journal du passage porte TOUS les compteurs** (`compteursDuReleve` et les nôtres), jamais
 *    un contenu : deux dérives de forme (`groupChat` partout, unité de `lastActivityAt`) ne lèvent
 *    rien et ne se voient qu'à ces compteurs.
 *
 * Aucun secret, aucune URL de proxy dans un message ou un journal : seul `err.name` sort d'ici.
 */
import type { Pool } from 'pg';
import {
  heureLocale,
  isWithinWindow,
  lireHeuresEnvoiLinkedIn,
  compterRequetesLinkedIn,
  lirePlafondLinkedIn,
  memoriserUrnDuContact,
  normaliserUrlProfil,
  lireSessionLinkedIn,
  normaliserUrnLinkedIn,
  notifyReply,
  prendreVerrouLinkedIn,
  recordInboundReply,
  tracerRequeteMessagerie,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { controlerSortie } from '../linkedin/controle-sortie.js';
import { ENTETES_VOYAGER } from '../linkedin/engageurs.js';
import { lireCompteConnecte } from '../linkedin/envoi.js';
import {
  analyserConversations,
  compteursDuReleve,
  ErreurMessagerie,
  urlConversations,
  type MessageReleve,
} from '../linkedin/messagerie.js';
import type { Pilote } from '../linkedin/navigateur.js';

export type ReleveLinkedInJob = { organizationId: string };

/** Tout ce que le handler touche hors base, injecté pour que les tests ne parlent jamais à LinkedIn. */
export type DependancesReleve = {
  pool: Pool;
  env: Record<string, string | undefined>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
};

/**
 * Durée du verrou : celle de l'envoi, dont la relève partage l'amont (Chromium, écho d'IP) et la
 * session. Un verrou qui expire avant la fin du passage laisserait `linkedin.envoi` le prendre
 * légitimement : deux navigateurs sur la même session, le signal qui fait sauter un compte.
 */
export const DUREE_VERROU_RELEVE_MS = 5 * 60_000;
/** Ce qu'un passage coûte au budget de requêtes de l'heure : `/me` et les conversations. */
export const REQUETES_PAR_RELEVE = 2;
const UNE_HEURE_MS = 3_600_000;
/** Conversations lues par passage : le nombre que l'ancienne extension demandait. */
const NOMBRE_CONVERSATIONS = 20;
/**
 * Le curseur recule d'autant sous l'heure du passage : l'horloge de LinkedIn peut retarder sur la nôtre,
 * et une réponse arrivée pendant le passage porterait alors une date antérieure au curseur. Le rejeu
 * qui en résulte est absorbé par l'identifiant de message (`isNew: false`).
 */
export const MARGE_CURSEUR_MS = 5 * 60_000;
/** Tentatives d'enregistrement d'une notification : un échec d'écriture après `isNew` ne se rejoue pas au passage suivant. */
const TENTATIVES_NOTIFICATION = 3;
const LONGUEUR_EXTRAIT = 140;
const ENTETES = { ...ENTETES_VOYAGER, 'x-li-lang': 'fr_FR' };

const TITRE_NOTIFICATION = 'Nouvelle réponse LinkedIn';

/** Une erreur dont le NOM dit la panne : le message ne cite jamais de charge utile. */
function erreurNommee(type: string, message: string): Error {
  const e = new Error(message);
  e.name = type;
  return e;
}

const nomDe = (err: unknown): string => (err instanceof Error ? err.name : 'Erreur');

type EtatReleve = { curseur: Date | null; compteUrn: string | null };

export async function lireEtat(pool: Pool, organizationId: string): Promise<EtatReleve> {
  const res = await pool.query<{ releve_curseur_at: Date | null; releve_compte_urn: string | null }>(
    `select releve_curseur_at, releve_compte_urn
       from linkedin_server_sessions /* jr:linkedin_releve_etat_lire */
      where organization_id = $1`,
    [organizationId],
  );
  const l = res.rows[0];
  return { curseur: l?.releve_curseur_at ?? null, compteUrn: l?.releve_compte_urn ?? null };
}

/** Pose le compte connecté ; le curseur, lui, ne bouge que s'il est fourni. */
export async function ecrireEtat(pool: Pool, organizationId: string, compteUrn: string, curseur: Date | null): Promise<void> {
  await pool.query(
    `update linkedin_server_sessions /* jr:linkedin_releve_etat_ecrire */
        set releve_compte_urn = $2,
            releve_curseur_at = coalesce($3::timestamptz, releve_curseur_at)
      where organization_id = $1`,
    [organizationId, compteUrn, curseur],
  );
}

/** `url_ambigue` : plusieurs contacts portent cette URL, et ce peuvent être des personnes différentes. */
type Rattachement = { contactId: string; par: 'urn' | 'url'; ambigu: boolean } | 'url_ambigue' | null;

/**
 * Le contact de l'organisation que ce message désigne : d'abord par l'identifiant du profil (comparé
 * après normalisation, les deux formes — nue et préfixée — étant lues), puis en repli par l'URL de
 * profil. Borné à l'organisation (le worker n'a pas de RLS).
 *
 * Par URN, plusieurs contacts sont la même personne en double : le plus ancien, et le cas est compté.
 * Par URL c'est autre chose, deux contacts peuvent être deux personnes : on refuse (`url_ambigue`),
 * un mauvais rattachement arrête définitivement la séquence d'un prospect.
 *
 * L'URL passe d'abord par `normaliserUrlProfil`, qui exige l'hôte LinkedIn ET `/in/<segment>` :
 * `app.url_linkedin_normalisee` ne valide aucune forme, et `https://www.linkedin.com/in/` (un membre
 * hors réseau) se réduirait à `linkedin.com/in`, égal à toute URL enregistrée tronquée.
 */
export async function rattacher(pool: Pool, organizationId: string, m: MessageReleve): Promise<Rattachement> {
  const urn = normaliserUrnLinkedIn(m.expediteurUrn);
  if (urn !== null) {
    const res = await pool.query<{ id: string }>(
      `select id from contacts /* jr:releve_rattacher_urn */
        where organization_id = $1 and linkedin_provider_id = any($2::text[])
        order by created_at, id`,
      [organizationId, [urn, `urn:li:fsd_profile:${urn}`, `urn:li:fs_miniProfile:${urn}`]],
    );
    if (res.rows[0]) return { contactId: res.rows[0].id, par: 'urn', ambigu: res.rows.length > 1 };
  }
  const url = m.expediteurUrl === null ? null : normaliserUrlProfil(m.expediteurUrl);
  if (url === null) return null;
  const res = await pool.query<{ id: string }>(
    `select id from contacts /* jr:releve_rattacher_url */
      where organization_id = $1
        and btrim(coalesce(linkedin_url, '')) <> ''
        and app.url_linkedin_normalisee(linkedin_url) = app.url_linkedin_normalisee($2)
      order by created_at, id`,
    [organizationId, url],
  );
  if (res.rows.length > 1) return 'url_ambigue';
  return res.rows[0] ? { contactId: res.rows[0].id, par: 'url', ambigu: false } : null;
}

/** Les 140 premiers caractères (par points de code : jamais une paire de substitution coupée). */
const extrait = (texte: string): string => Array.from(texte).slice(0, LONGUEUR_EXTRAIT).join('');

type Compteurs = {
  /** Entrants lus dans la charge utile. */
  entrants: number;
  nouveaux: number;
  dejaEnregistres: number;
  nonRattaches: number;
  rattachesParUrl: number;
  /** Entrants dont l'URL désigne plusieurs contacts : refusés, comptés non rattachés aussi. */
  urlAmbigues: number;
  ambigus: number;
  /** Entrants dont l'enregistrement ou la notification a échoué : le curseur ne bouge pas. */
  echecs: number;
};

export async function traiterReleveLinkedIn(d: DependancesReleve, job: ReleveLinkedInJob): Promise<void> {
  const { pool } = d;
  const org = job.organizationId;
  const ctx: Contexte = { ex: pool, organisationId: org, utilisateurId: null, role: null };

  if (d.env.JAY_REACH_LINKEDIN !== '1') {
    console.warn('[releve-linkedin] canal LinkedIn non autorisé sur cette instance');
    return;
  }
  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') {
    console.warn('[releve-linkedin] session LinkedIn absente ou bloquée');
    return;
  }

  // Même plage que l'envoi : une relève à trois heures du matin est la signature d'une machine. Le curseur
  // ne bouge pas, le premier passage de la plage rattrape tout. La lecture exige un rôle que le worker n'a
  // pas : c'est une lecture de service, bornée à l'organisation par la requête.
  const maintenant = new Date();
  const heures = await lireHeuresEnvoiLinkedIn({ ...ctx, role: 'viewer' });
  const { hour, isoDay } = heureLocale(maintenant, heures.fuseau);
  if (!heures.jours.includes(isoDay) || !isWithinWindow(hour, heures.debutHeure, heures.finHeure)) {
    console.log('[releve-linkedin] hors de la plage horaire, passage suivant');
    return;
  }

  // Plafond de requêtes de l'heure, partagé avec les autres canaux : lu AVANT le verrou et le navigateur,
  // comme l'envoi. Un budget épuisé ne doit rien ouvrir ; le curseur ne bouge pas, le passage suivant rattrape.
  const [plafondHoraire, deLHeure] = await Promise.all([
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    compterRequetesLinkedIn(ctx, new Date(maintenant.getTime() - UNE_HEURE_MS)),
  ]);
  if (plafondHoraire - deLHeure < REQUETES_PAR_RELEVE) {
    console.log('[releve-linkedin] plafond de requêtes de l’heure atteint, passage suivant');
    return;
  }

  const proprietaire = `releve-${org}`;
  let verrouPris = false;
  let pilote: Pilote | null = null;
  try {
    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_RELEVE_MS);
    if (!verrouPris) {
      // Un envoi, une collecte ou une fiche de post tient la session. Pas une erreur : le passage suivant
      // rattrape, le curseur n'a pas bougé. Mais une relève SYSTÉMATIQUEMENT sautée rate le but du lot :
      // la ligne est stable pour qu'on la compte dans les journaux.
      console.warn('[releve-linkedin] renoncement : verrou LinkedIn déjà pris, curseur inchangé');
      return;
    }

    try {
      pilote = await d.ouvrirNavigateur();
    } catch (err) {
      // Le message peut porter l'URL du proxy : seul le type sort.
      console.error(`[releve-linkedin] navigateur indisponible (${nomDe(err)})`);
      return;
    }

    let brute: Sortie;
    try {
      brute = await d.releverSortie(pilote);
    } catch (err) {
      console.error(`[releve-linkedin] sortie non relevée (${nomDe(err)})`);
      return;
    }
    const controle = await controlerSortie(ctx, session.ipAttendue, async () => brute);
    if (!controle.ok) {
      // `verifierSortie` a déjà bloqué la session.
      console.warn('[releve-linkedin] sortie non conforme, passage abandonné');
      return;
    }

    // Requête 1 : `/me`, le compte qui est réellement connecté dans CE navigateur.
    await tracerRequeteMessagerie(ctx);
    const identite = await lireCompteConnecte(pilote);
    const moi = identite ? normaliserUrnLinkedIn(identite.urn) : null;
    if (!identite || moi === null) {
      throw new ErreurMessagerie('Le compte LinkedIn connecté n’a pas pu être lu : la relève est suspendue.');
    }

    const etat = await lireEtat(pool, org);
    const ancien = etat.compteUrn === null ? null : normaliserUrnLinkedIn(etat.compteUrn);
    if (ancien !== null && ancien !== moi) {
      await ecrireEtat(pool, org, identite.urn, null);
      console.warn('[releve-linkedin] le compte connecté a changé : rien traité, curseur inchangé');
      return;
    }

    // Premier passage : on part de maintenant (décision de JB), rien d'antérieur à la mise en route.
    const depuis = etat.curseur ?? maintenant;

    // Requête 2 : les conversations.
    await tracerRequeteMessagerie(ctx);
    const rep = await pilote.requete(urlConversations(identite.urn, NOMBRE_CONVERSATIONS), ENTETES);
    if (rep.statut < 200 || rep.statut >= 300) {
      throw erreurNommee('StatutInattendu', `La messagerie LinkedIn a répondu ${rep.statut} : la relève est suspendue.`);
    }
    const releve = analyserConversations(rep.corps, identite.urn, depuis);

    const c: Compteurs = {
      entrants: releve.entrants.length,
      nouveaux: 0,
      dejaEnregistres: 0,
      nonRattaches: 0,
      rattachesParUrl: 0,
      urlAmbigues: 0,
      ambigus: 0,
      echecs: 0,
    };
    // Les plus anciens d'abord : le fil se remplit dans l'ordre où l'échange a eu lieu.
    const entrants = [...releve.entrants].sort((a, b) => a.recuLe.getTime() - b.recuLe.getTime());
    for (const m of entrants) {
      try {
        const lien = await rattacher(pool, org, m);
        if (lien === 'url_ambigue') c.urlAmbigues += 1;
        if (lien === null || lien === 'url_ambigue') {
          c.nonRattaches += 1;
          continue;
        }
        if (lien.par === 'url') {
          c.rattachesParUrl += 1;
          // Le contact bascule sur le chemin principal pour toutes ses réponses suivantes. Confort : un
          // échec n'est pas un échec du message (la réponse reste rattachée par l'URL au prochain passage).
          await memoriserUrnDuContact(pool, org, lien.contactId, m.expediteurUrn).catch((err: unknown) => {
            console.error(`[releve-linkedin] identifiant du contact non mémorisé (${nomDe(err)})`);
          });
        }
        if (lien.ambigu) c.ambigus += 1;
        const enregistre = await recordInboundReply(pool, org, {
          contactId: lien.contactId,
          channel: 'linkedin_message',
          body: m.texte,
          providerMessageId: m.messageUrn,
          receivedAt: m.recuLe,
          raw: { source: 'releve_serveur' },
        });
        if (!enregistre.isNew) {
          c.dejaEnregistres += 1;
          continue;
        }
        c.nouveaux += 1;
        await notifier(pool, org, extrait(m.texte) || enregistre.classification);
      } catch (err) {
        // Un cas qui échoue n'éteint pas les autres : seul le type sort (le message d'une erreur de base
        // peut porter une chaîne de connexion, et jamais un contenu de message).
        c.echecs += 1;
        console.error(`[releve-linkedin] un message n’a pas pu être traité (${nomDe(err)})`);
      }
    }

    // Le journal du passage : tous les compteurs, aucun contenu.
    console.log(`[releve-linkedin] passage ${JSON.stringify({ ...c, ...compteursDuReleve(releve) })}`);

    if (c.echecs > 0) {
      throw erreurNommee(
        'ReleveIncomplete',
        `${c.echecs} réponse(s) LinkedIn n’ont pas pu être traitées : le curseur reste en place.`,
      );
    }
    const suivant = etat.curseur === null ? maintenant : new Date(Math.max(etat.curseur.getTime(), maintenant.getTime() - MARGE_CURSEUR_MS));
    await ecrireEtat(pool, org, identite.urn, suivant);
  } finally {
    // Durée nulle, même propriétaire : le verrou tombe tout de suite.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    if (pilote) await pilote.fermer().catch(() => undefined);
  }
}

/** Notifie, avec reprise : une réponse enregistrée mais jamais notifiée ne se rejoue pas (`isNew` sera faux), et ne doit pas passer inaperçue. */
async function notifier(pool: Pool, org: string, corps: string): Promise<void> {
  for (let essai = 1; ; essai += 1) {
    try {
      await notifyReply(pool, org, TITRE_NOTIFICATION, corps);
      return;
    } catch (err) {
      if (essai >= TENTATIVES_NOTIFICATION) throw err;
    }
  }
}

/** Les dépendances réelles. L'import du navigateur est dynamique : `puppeteer-core` n'est chargé que si une relève part. */
export function dependancesReleveReelles(pool: Pool): DependancesReleve {
  return {
    pool,
    env: process.env,
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
  };
}

/**
 * Le producteur : un job par organisation à session active, au plus un par intervalle réglable
 * (`linkedin_releve_intervalle_min`, 30 par défaut). La file est `stately` et la clé de singleton
 * l'organisation, `singletonSeconds` cadence : le minuteur peut passer chaque minute sans créer de
 * doublon ni de trafic. Une organisation qui échoue n'emporte pas les autres.
 */
export async function enqueueReleveLinkedIn(
  boss: { send(file: string, donnees: ReleveLinkedInJob, options: { singletonKey: string; singletonSeconds: number }): Promise<string | null> },
  pool: Pool,
): Promise<number> {
  const res = await pool.query<{ organization_id: string }>(
    `select organization_id from linkedin_server_sessions /* jr:linkedin_releve_organisations */
      where status = 'active'`,
  );
  let deposes = 0;
  for (const { organization_id: org } of res.rows) {
    try {
      const ctx: Contexte = { ex: pool, organisationId: org, utilisateurId: null, role: null };
      const minutes = await lirePlafondLinkedIn(ctx, 'linkedin_releve_intervalle_min');
      const id = await boss.send('linkedin.releve', { organizationId: org }, { singletonKey: org, singletonSeconds: minutes * 60 });
      if (id !== null) deposes += 1;
    } catch (err) {
      console.error(`[releve-linkedin] enfilage impossible pour une organisation (${nomDe(err)})`);
    }
  }
  return deposes;
}
