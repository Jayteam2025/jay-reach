# Déployer le worker en production

Ce dossier contient tout ce qu'il faut pour faire tourner le moteur Jay Reach
en continu sur votre serveur, en dehors de la planification Vercel.

## Prérequis

- Docker 24+ avec Compose v2 (`docker compose version`).
- `git`.
- Un projet Supabase (URL de connexion Postgres, clé de chiffrement).
- Un accès root ou sudo sur le serveur.

## Installation

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

4. Premier déploiement :

   ```bash
   cd deploy/vps
   ./deployer.sh
   ```

## Vérifier

Après deux minutes environ, l'état du conteneur doit passer à `healthy` :

```bash
docker compose -p jay-reach ps
```

Dans l'application web, l'écran Tableau de bord doit afficher « Moteur actif ».

## Mettre à jour

```bash
./deployer.sh
```

Après toute modification du fichier `/etc/jay-reach/worker.env`, relancer avec
recréation forcée pour que le conteneur reprenne les nouvelles variables :

```bash
./deployer.sh --force-recreate
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

`GIT_SHA`, `NODE_ENV` et `HEARTBEAT_FILE` sont posés directement par
`docker-compose.yml` : ils n'ont pas leur place dans `worker.env`.
