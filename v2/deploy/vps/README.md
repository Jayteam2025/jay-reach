# Déployer le worker en production

Ce dossier contient tout ce qu'il faut pour faire tourner le moteur Jay Reach
en continu sur votre serveur, en dehors de la planification Vercel.

## Prérequis

- Docker 24+ avec Compose v2 (`docker compose version`).
- `git`.
- Un projet Supabase (URL de connexion Postgres, clé de chiffrement) **ayant
  reçu les migrations de ce dépôt** (`v2/supabase/migrations`) : le worker
  suppose leurs tables et fonctions déjà en place, il ne les crée pas.
- Un accès root ou sudo sur le serveur.

## Installation

Tous les chemins ci-dessous sont relatifs à `v2/`, la racine du monorepo.

1. Cloner le dépôt public dans un dossier de votre choix sur le serveur.
2. Créer le dossier de configuration :

   ```bash
   sudo mkdir -p /etc/jay-reach
   sudo chmod 755 /etc/jay-reach
   ```

3. Créer le fichier d'environnement à partir de l'exemple fourni, puis le
   remplir à la main (jamais de script pour ça) :

   ```bash
   sudo cp deploy/vps/worker.env.example /etc/jay-reach/worker.env
   sudo chmod 600 /etc/jay-reach/worker.env
   sudo chown root:root /etc/jay-reach/worker.env
   sudo nano /etc/jay-reach/worker.env
   ```

4. Appliquer les migrations sur le projet Supabase, si ce n'est pas déjà fait :

   ```bash
   supabase db push --linked
   ```

   ou, sans CLI liée, en exécutant le contenu de chaque fichier de
   `supabase/migrations/` dans l'éditeur SQL du projet, dans l'ordre des noms
   de fichiers. Cette commande n'applique QUE `supabase/migrations/` : les
   migrations destructrices (qui suppriment une table) vivent à part, dans
   `supabase/migrations-differees/`, et ne sont jamais prises par `db push` —
   voir l'étape 6. **Sans cette étape, rien ne prévient au démarrage** : le
   conteneur démarre, écrit son fichier de battement et reste `healthy`, mais
   chaque tour échoue faute de table `engine_status` — une erreur par minute
   dans les journaux — et l'écran Tableau de bord affiche « Aucun battement
   reçu » indéfiniment.

5. Premier déploiement :

   ```bash
   cd deploy/vps
   ./deployer.sh
   ```

6. **Seulement après** avoir vérifié que ce worker ET l'application web sont
   déployés et sains (section suivante) : appliquer à la main les migrations
   de `supabase/migrations-differees/`. Une migration qui supprime une table
   encore lue par un déploiement précédent du worker ou du web casserait ce
   déploiement avant que le nouveau ne soit confirmé — l'ordre inverse
   (migration avant déploiement) ferait tomber le tour de séquences toutes
   les 60 secondes tant que l'ancien worker reste en place. Chaque migration
   destructrice sauvegarde ce qu'elle supprime dans une table
   `..._sauvegarde_<date>` avant le `drop`, à son propre en-tête SQL.

   Geste exact (voir aussi le README de `supabase/migrations-differees/`) :
   soit copier le contenu du fichier dans l'éditeur SQL du projet, soit le
   déplacer dans `supabase/migrations/` puis :

   ```bash
   supabase db push --linked --include-all
   ```

   `--include-all` est nécessaire ici : l'horodatage de cette migration
   (`20260910190000`) est antérieur à celui de la migration additive déjà
   appliquée (`20260911120000`), et `db push` refuse par défaut d'appliquer
   une migration plus ancienne que la dernière déjà en place. Ne pas
   renommer le fichier pour la faire paraître plus récente.

## Vérifier

Après deux minutes environ, l'état du conteneur doit passer à `healthy` :

```bash
docker compose -p jay-reach ps
```

Dans l'application web, l'écran Tableau de bord doit afficher « Moteur actif ».

Ce contrôle est un voyant, pas un garde-fou : un conteneur `unhealthy` n'est
**pas** redémarré automatiquement (`restart: unless-stopped` ne réagit qu'à un
arrêt du process, jamais au `healthcheck`). Un `unhealthy` qui persiste se
traite à la main (`docker compose -p jay-reach restart worker`, ou
`./deployer.sh --force-recreate`).

## Mettre à jour

```bash
./deployer.sh
```

Après toute modification du fichier `/etc/jay-reach/worker.env`, relancer avec
recréation forcée pour que le conteneur reprenne les nouvelles variables :

```bash
./deployer.sh --force-recreate
```

Chaque déploiement construit une image `jay-reach-worker:<sha>` distincte :
elles s'accumulent sur le disque du serveur au fil des mises à jour. Purger de
temps en temps celles qui ne sont plus utilisées :

```bash
docker image prune
```

## Journaux

```bash
docker compose -p jay-reach logs -f worker
```

Les journaux tournent automatiquement (5 fichiers de 10 Mo maximum) : pas
d'accumulation à surveiller côté disque.

## Arrêter

```bash
docker compose -p jay-reach down
```

## Règles

- **Une seule instance du moteur à la fois.** Deux moteurs qui traitent les
  mêmes files rendent les journaux illisibles.
- **Ne pas remettre la planification Vercel en route** tant que ce worker
  tourne : les deux produiraient le même travail.
- **Le worker n'expose aucun service réseau**, il ne fait que consommer des
  files d'attente. Seul le navigateur LinkedIn (section suivante, facultatif)
  publie un port, sur `127.0.0.1` uniquement.
- **Les plafonds quotidiens comptent en UTC**, le jour de la base Postgres,
  pas le fuseau du serveur ni celui d'un opérateur. C'est le comportement par
  défaut d'un projet Supabase ; à vérifier si le projet a été reconfiguré.

### Variables d'environnement

| Variable | Sens |
|---|---|
| `DATABASE_URL` | Connexion Postgres du projet Supabase. Connexion directe ou pooler en mode session (port 5432). Jamais le pooler en mode transaction (port 6543) : pg-boss ne le supporte pas. |
| `ENCRYPTION_KEY` | Clé du coffre des clés fournisseurs. Obligatoire : sans elle aucun job ne trouve de clé et le moteur ne fait rien. |
| `APP_URL` | URL publique de l'application web (liens dans les notifications). |
| `DISCOVER_INTERVAL_MS` | Cadence de production (millisecondes). Défaut 900000 (15 min). |
| `TICK_INTERVAL_MS` | Cadence des séquences (millisecondes). Défaut 60000 (60 s). |
| `REQUESTED_RUN_POLL_MS` | Cadence du relevé des demandes de collecte manuelles (millisecondes). Défaut 10000 (10 s). |
| `ENRICH_DAILY_CAP` | Plafond de repli d'enrichissements par jour si aucun plafond n'est réglé dans l'écran Fournisseurs (0 = pause). |
| `SCORE_DAILY_CAP` | Plafond de repli de scorages par jour si aucun plafond n'est réglé dans l'écran Fournisseurs (0 = pause). |
| `SIGNAL_MAX_AGE_DAYS` | Âge maximal d'un signal avant écart automatique (jours). |
| `ACCOUNT_PEOPLE_PER_DAY` | Personnes contactées par entreprise et par jour. |
| `ENRICH_MAX_WAIT_MS` | Attente maximale d'un enrichissement (millisecondes). |
| `MS_GRAPH_TENANT_ID` | Optionnelle. La lecture directe des réponses se configure dans l'application, Fournisseurs → Microsoft Graph ; cette variable n'est qu'un repli, utilisé seulement quand rien n'y est saisi. |
| `MS_GRAPH_CLIENT_ID` | Optionnelle, même repli que ci-dessus. |
| `MS_GRAPH_CLIENT_SECRET` | Optionnelle, même repli que ci-dessus. |

La relève ne démarre que pour une organisation ayant au moins une boîte avec la
lecture directe activée dans Réglages → Expéditeurs, et une configuration
joignable : celle de Fournisseurs → Microsoft Graph, ou, à défaut, les trois
variables ci-dessus **toutes les trois** présentes. Une seule manquante et rien
ne tourne.

| `JAY_REACH_LINKEDIN` | Optionnelle. `1` autorise les commandes `jay-reach linkedin ...` ; sinon `connecter`, `deconnecter` et `ip` refusent (`statut` reste lisible). |
| `LINKEDIN_BROWSER_URL` | Adresse DevTools du service `navigateur` : `http://navigateur:9223`. |
| `LINKEDIN_PROXY_URL` (`navigateur.env`) | Proxy résidentiel dédié, **sans identifiants** (`schéma://hôte:port`). Le navigateur refuse de démarrer sans lui. |
| `LINKEDIN_PROXY_USER` / `LINKEDIN_PROXY_PASSWORD` (`navigateur.env`) | Identifiants du proxy, présentés par CDP : Chromium les refuse dans `--proxy-server`. |
| `JAY_REACH_ORGANISATION_ID` | Optionnelle. À poser si la base porte plusieurs organisations (sinon l'organisation unique est prise). |

`GIT_SHA`, `NODE_ENV` et `HEARTBEAT_FILE` sont posés directement par
`docker-compose.yml` : ils n'ont pas leur place dans `worker.env`.

## Le navigateur LinkedIn (facultatif)

Le canal LinkedIn exécuté côté serveur pilote un Chromium dans son propre
conteneur (`navigateur`), derrière un proxy résidentiel dédié. Il est derrière
un profil Compose : sans le réglage ci-dessous, `./deployer.sh` ne le construit
ni ne le démarre.

1. Dans `/etc/jay-reach/worker.env`, poser `JAY_REACH_LINKEDIN=1` et
   `LINKEDIN_BROWSER_URL`. Le proxy va dans un **fichier à part**, que seul le
   navigateur charge (avec le worker, qui y lit les identifiants du proxy) :

   ```bash
   sudo cp deploy/vps/navigateur.env.example /etc/jay-reach/navigateur.env
   sudo chmod 600 /etc/jay-reach/navigateur.env
   sudo chown root:root /etc/jay-reach/navigateur.env
   sudo nano /etc/jay-reach/navigateur.env
   ```
2. Activer le profil, une fois, dans `deploy/vps/.env` (fichier local, jamais commité) :

   ```bash
   echo 'COMPOSE_PROFILES=linkedin' > .env
   ./deployer.sh --force-recreate
   ```

3. Installer la commande d'exploitation :

   ```bash
   sudo install -m 0755 jay-reach /usr/local/bin/jay-reach
   ```

   Le script suppose le dépôt dans `/opt/jay-reach` ; ailleurs, exporter
   `JAY_REACH_DEPLOY_DIR` vers ce dossier (`deploy/vps`). Il est installé par
   copie : après une mise à jour du dépôt, le réinstaller.
4. Ouvrir la session, depuis un terminal (la saisie du mot de passe et du code
   est masquée, rien ne passe par l'historique du shell) :

   ```bash
   jay-reach linkedin connecter
   jay-reach linkedin statut
   ```

Autres commandes : `jay-reach linkedin deconnecter` (révoque la session) et
`jay-reach linkedin ip [--confirmer]` (relève l'IP de sortie par le navigateur ;
`--confirmer` la pose comme IP attendue après un changement de proxy voulu).

Points à connaître :

- **Le navigateur ne sort jamais par l'IP du VPS** : il refuse de démarrer sans
  `LINKEDIN_PROXY_URL`, et l'IP de sortie est relevée **par le navigateur**,
  jamais par le worker.
- **Le port DevTools (`127.0.0.1:9222`) donne la main sur la session
  LinkedIn.** Ne jamais le publier sur une autre interface ni le tunneler vers
  un poste partagé.
- Le conteneur `navigateur` ne charge que `navigateur.env` (le proxy) : il
  exécute le JavaScript de pages tierces et ne voit aucune clé du worker.
  `LINKEDIN_PROXY_*` ne se met donc pas dans `worker.env`.
- Le profil (cookies de la session) vit dans le volume `profil-navigateur` :
  `docker compose -p jay-reach down -v` l'efface.

### Restreindre l'application Microsoft Graph à ses boîtes

L'application Microsoft Graph qui lit les réponses ne doit avoir accès qu'aux
boîtes réellement relevées, pas à tout le tenant. Deux permissions
d'application (pas déléguées) suffisent, avec consentement administrateur :
`Mail.Read` et `Mail.Send`.

Dans Exchange Online PowerShell (`Connect-ExchangeOnline`), créer un groupe de
distribution à sécurité activée contenant les boîtes relevées, puis restreindre
l'application à ce groupe :

```powershell
New-DistributionGroup -Name "jayreach-boites" -Type Security -MemberDepartRestriction Closed
Add-DistributionGroupMember -Identity "jayreach-boites" -Member "prospection@exemple.fr"

New-ApplicationAccessPolicy -AppId "00000000-0000-0000-0000-000000000000" `
  -PolicyScopeGroupId "jayreach-boites@exemple.fr" -AccessRight RestrictAccess `
  -Description "Jay Reach : lecture directe des réponses, boîtes autorisées seulement"
```

Vérifier ensuite que la restriction s'applique bien :

```powershell
Test-ApplicationAccessPolicy -AppId "00000000-0000-0000-0000-000000000000" `
  -Identity "prospection@exemple.fr"
```

Les identifiants et adresses ci-dessus sont des exemples : remplacer l'`AppId`
par celui de l'application enregistrée dans Entra ID, et l'adresse par celle
d'une boîte réellement relevée.
