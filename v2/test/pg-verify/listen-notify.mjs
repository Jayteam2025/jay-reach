// Aller-retour réel via emettreMessageConnexion et ecouterCanalConnexion (lot 5).
// Deux connexions distinctes : l'écoute (dédiée, port imposé 5432 par le code) et l'émission
// (port LISTEN_PORT, 5432 par défaut ; 6543 pour mesurer le piège). Délai 10 s, échec bruyant.
// Seule la notification dont la charge DÉCHIFFRÉE correspond à l'essai compte : un worker
// qui émet pendant le test sur le canal de production ne fausse pas le résultat.
// Aucun secret affiché. Doit tourner depuis apps/worker (résolution de `pg` et des sources).
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { emettreMessageConnexion } from '@jay-reach/core';
import { ecouterCanalConnexion } from './src/linkedin/ecoute-connexion.js';

const DELAI_MS = 10_000;
const port = process.env.LISTEN_PORT ?? '5432';
const u = new URL(process.env.DATABASE_URL);
u.port = port;
const csEmission = u.toString();

const attendu = {
  type: 'secrets',
  demandeId: `essai-${randomUUID()}`,
  organizationId: 'essai',
  identifiant: 'essai@exemple.fr',
  motDePasse: 'Mot dé passé "çà" & €',
};

// Le pool ne sert qu'à porter la chaîne de connexion : l'écoute ouvre son propre client.
const poolBidon = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const emet = new pg.Client({ connectionString: csEmission });
let arreter = () => {};
let rc = 1;
try {
  await emet.connect();
  const recu = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('delai')), DELAI_MS);
    ecouterCanalConnexion(poolBidon, async (m) => {
      if (m.demandeId !== attendu.demandeId) return;
      clearTimeout(t);
      resolve(m);
    }).then((stop) => { arreter = stop; }, reject);
  });
  recu.catch(() => {});
  await new Promise((r) => setTimeout(r, 1500)); // laisse le LISTEN s'installer
  await emettreMessageConnexion({ ex: emet, organisationId: 'essai', utilisateurId: null, role: 'admin' }, attendu);
  const m = await recu;
  const ok = isDeepStrictEqual(m, attendu);
  console.log(`[listen] émission port ${port}, écoute imposée 5432 : ${ok ? 'PASS message déchiffré identique à l\'émis' : 'FAIL charge différente'}`);
  rc = ok ? 0 : 1;
} catch (e) {
  const motif = e instanceof Error && e.message === 'delai' ? `FAIL rien reçu en ${DELAI_MS / 1000} s` : `FAIL ${e instanceof Error ? e.code ?? e.name : 'erreur'}`;
  console.log(`[listen] émission port ${port} : ${motif}`);
} finally {
  arreter();
  await emet.end().catch(() => {});
  await poolBidon.end().catch(() => {});
}
process.exit(rc);
