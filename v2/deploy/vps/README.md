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
- **Aucun port n'est publié** par ce compose : le worker n'expose aucun
  service réseau, il ne fait que consommer des files d'attente.
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
| `MS_GRAPH_TENANT_ID` | Optionnelle : repli pour la lecture directe des réponses (Microsoft Graph), seulement nécessaire si une boîte l'a activée dans Expéditeurs. La clé saisie dans l'onglet Fournisseurs prime sur cette variable. |
| `MS_GRAPH_CLIENT_ID` | Optionnelle, même repli que ci-dessus. |
| `MS_GRAPH_CLIENT_SECRET` | Optionnelle, même repli que ci-dessus. |

`GIT_SHA`, `NODE_ENV` et `HEARTBEAT_FILE` sont posés directement par
`docker-compose.yml` : ils n'ont pas leur place dans `worker.env`.

### Restreindre l'application Microsoft Graph à ses boîtes

L'application Microsoft Graph qui lit les réponses ne doit avoir accès qu'aux
boîtes réellement relevées, pas à tout le tenant. Deux permissions
d'application (pas déléguées) suffisent, avec consentement administrateur :
`Mail.Read` et `Mail.Send`.

Dans Exchange Online PowerShell (`Connect-ExchangeOnline`), créer un groupe de
distribution à sécurité activée contenant les boîtes relevées, puis restreindre
l'application à ce groupe :

```powershell
New-DistributionGroup -Name "jayreach-boites" -MemberDepartRestriction Closed
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
