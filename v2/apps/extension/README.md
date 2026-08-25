# Jay Reach — Extension LinkedIn (interne)

Extension Chrome (Manifest V3) qui exécute les **actions LinkedIn** de Jay Reach
— **invitations** et **messages (DM)** — via l'API interne **Voyager** de
LinkedIn, avec la **propre session** de l'utilisateur. Reprise de l'extension
interne « Jay » (JB), réduite à LinkedIn et branchée sur les endpoints de l'app
Jay Reach.

> ⚠️ L'automatisation LinkedIn est contraire aux CGU de LinkedIn et peut
> entraîner une restriction de compte. Usage interne, session de l'utilisateur,
> plafonds prudents, pause automatique 24 h. Ne pas distribuer publiquement.

## Architecture

- **Le pacing est appliqué côté serveur** (app Jay Reach) : fenêtre 08–21 h
  Europe/Paris, plafond dur 200/7 j, plafond quotidien (curseur), intervalle
  1–20 min, requeue des lignes bloquées. L'extension ne décide rien : elle
  demande la prochaine action prête et remonte le résultat.
- `background.js` — poll toutes les 2 min → `POST /api/extension/linkedin/next`
  → dispatch selon `kind` (`invite` → `linkedin-invite.js`, `message` →
  `linkedin-message.js`) → `POST /api/extension/linkedin/update`. Pause 24 h si
  `restricted` / `not_logged_in`.
- `linkedin-invite.js` — Voyager `verifyQuotaAndCreateV2` (invitation sans note).
  Repris de JB.
- `linkedin-message.js` — **net-new** : Voyager `createMessage` (DM). À valider
  avec un vrai compte (endpoint messagerie mouvant ; DM possible seulement vers
  une relation de 1er degré).
- `content-oauth.js` — reçoit le jeton d'extension depuis `/settings/linkedin`.
- `popup.html` / `popup.js` — état, poll manuel, reprise, **avertissement CGU**.

## Distribution à un utilisateur final

Le Chrome Web Store refuse généralement l'automatisation LinkedIn : la voie
**fiable** est un paquet `.zip` chargé en local. `pnpm package:extension` (lancé
aussi au `build` du web) génère `apps/web/public/jay-reach-linkedin-extension.zip`,
proposé au téléchargement depuis l'écran `/settings/linkedin`. L'utilisateur
décompresse puis « charge l'extension non empaquetée » (guide pas-à-pas dans l'app).

## Installation (dev)

1. `chrome://extensions` → activer le **mode développeur**.
2. **Charger l'extension non empaquetée** → sélectionner `apps/extension/`.
3. Lancer l'app (`pnpm dev`, `http://localhost:3000`) et ouvrir
   `/settings/linkedin` pour connecter l'extension (génère un jeton).
4. Être connecté à LinkedIn dans le même navigateur.

## Configuration

- Origines autorisées : `http://localhost:3000` (dev) et `https://app.jay-reach.fr`
  (placeholder prod — remplacer par le vrai domaine dans `manifest.json`,
  `background.js` et `content-oauth.js` le moment venu).
- Le jeton et l'URL de l'app sont stockés dans `chrome.storage.local`
  (`extensionToken`, `appBaseUrl`).

## Envoi réel

Aucun envoi réel n'est déclenché tant que (a) le séquenceur n'enfile pas
d'actions (STOP, validation boss) et (b) l'extension n'est pas connectée à un
vrai compte LinkedIn. Le backend est testé hermétiquement
(`test/pg-verify/linkedin-queue.sh`, données fictives).
