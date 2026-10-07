# Jay Reach — Extension LinkedIn (interne)

> **GELEE depuis le 06/10/2026 (lot 4a).** Le travail LinkedIn passe par le
> serveur. Le code est conserve (regle 1) mais ne s'execute plus : motifs
> d'injection et `externally_connectable` du manifeste pointent vers
> `extension-gelee.invalid`, et `EXTENSION_GELEE = true` dans `background.js`
> coupe alarmes, poll, releve et messages externes. Pour la reveiller, voir le
> commentaire en tete de `background.js` ; `gel.test.ts` garde la porte fermee.

Extension Chrome (Manifest V3) qui exécutait les **actions LinkedIn** de Jay Reach
— **invitations** et **messages (DM)** — via l'API interne **Voyager** de
LinkedIn, avec la **propre session** de l'utilisateur. Reprise de l'extension
interne « Jay » (JB), réduite à LinkedIn et branchée sur les endpoints de l'app
Jay Reach.

> ⚠️ L'automatisation LinkedIn est contraire aux CGU de LinkedIn et peut
> entraîner une restriction de compte. Usage interne, session de l'utilisateur,
> plafonds prudents, pause automatique 24 h. Ne pas distribuer publiquement.

> Tout ce qui suit, jusqu'à « Envoi réel », décrit le chemin gelé tel qu'il
> fonctionnait : conservé pour archive, il n'est plus le fonctionnement actuel.

## Architecture (chemin gelé)

- **Le pacing était appliqué côté serveur** (app Jay Reach) : fenêtre 08–21 h
  Europe/Paris, plafond dur 200/7 j, plafond quotidien (curseur), intervalle
  1–20 min, requeue des lignes bloquées. L'extension ne décidait rien : elle
  demandait la prochaine action prête et remontait le résultat.
- `background.js` — pollait toutes les 2 min → `POST /api/extension/linkedin/next`
  → dispatch selon `kind` (`invite` → `linkedin-invite.js`, `message` →
  `linkedin-message.js`) → `POST /api/extension/linkedin/update`. Pause 24 h si
  `restricted` / `not_logged_in`.
- `linkedin-invite.js` — Voyager `verifyQuotaAndCreateV2` (invitation sans note).
  Repris de JB.
- `linkedin-message.js` — **net-new** : Voyager `createMessage` (DM). À valider
  avec un vrai compte (endpoint messagerie mouvant ; DM possible seulement vers
  une relation de 1er degré).
- `content-oauth.js` — recevait le jeton d'extension depuis `/settings/linkedin`.
- `popup.html` / `popup.js` — affichait l'état, poll manuel, reprise, **avertissement CGU**.

## Distribution à un utilisateur final (chemin gelé)

Le Chrome Web Store refuse généralement l'automatisation LinkedIn : la voie
**fiable** était un paquet `.zip` chargé en local. `pnpm package:extension` (lancé
aussi au `build` du web) génère `apps/web/public/jay-reach-linkedin-extension.zip`.
L'écran `/settings/linkedin` ne le propose plus ni ne mentionne l'extension. Le
chemin d'installation était : décompresser, puis « charger l'extension non empaquetée ».

## Installation (dev, chemin gelé)

1. `chrome://extensions` → activer le **mode développeur**.
2. **Charger l'extension non empaquetée** → sélectionner `apps/extension/`.
3. Lancer l'app (`pnpm dev`, `http://localhost:3000`) et, pour connecter
   l'extension (génération d'un jeton), ouvrir l'écran qui l'offrait (retiré
   de `/settings/linkedin`).
4. Être connecté à LinkedIn dans le même navigateur.

## Configuration (chemin gelé)

- Origines autorisées (à l'époque) : `http://localhost:3000` (dev) et `https://app.jay-reach.fr`
  (placeholder prod — remplacer par le vrai domaine dans `manifest.json`,
  `background.js` et `content-oauth.js` le moment venu).
- Le jeton et l'URL de l'app étaient stockés dans `chrome.storage.local`
  (`extensionToken`, `appBaseUrl`).

## Envoi réel

L'extension n'envoie plus rien. Le serveur exécute lui-même les invitations et
les messages, depuis sa propre session LinkedIn, et les routes qu'appelait
l'extension répondent 410.

Le harnais `test/pg-verify/linkedin-queue.sh` a disparu avec ce chemin : il
éprouvait la file telle que l'extension la consommait. La file et l'envoi côté
serveur sont couverts par `linkedin-file.sh` et `linkedin-envoi.sh`.
