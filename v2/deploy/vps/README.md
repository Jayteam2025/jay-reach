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

## Déployer l'envoi LinkedIn côté serveur (lot 4b)

Ce lot fait passer l'envoi LinkedIn de l'extension navigateur au worker. Trois
migrations l'accompagnent, et **l'ordre compte, il n'est pas symétrique** :

1. **Les cinq migrations, dans l'ordre des noms de fichiers**, avec
   `supabase db push --linked` :
   `20261007110000_linkedin_envoi`, `20261007120000_linkedin_resultat_indetermine_actif`,
   `20261007130000_linkedin_methode_par_defaut_serveur`,
   `20261008100000_linkedin_plafonds_envoi_report`, `20261008110000_linkedin_reprise_marquee`.
2. **Puis le worker** (`./deployer.sh`).
3. **Puis l'application web** (Vercel). Le worker et le web peuvent partir
   ensemble, du moment que la base est passée avant les deux.

Pourquoi cet ordre :

- **Web avant les migrations** : la lecture de la session LinkedIn sélectionne
  désormais `linkedin_server_sessions.envoi_pause_jusqua`. Sans la colonne, la
  requête échoue et deux pages tombent en 500 : Réglages → LinkedIn et
  Réglages → Moteur.
- **Worker avant les migrations** : l'enfilage d'une action écrit
  `method = 'serveur'`, que l'ancien check de la colonne refuse. Le job
  `actions.dispatch` lève, est rejoué cinq fois avec attente croissante, puis
  meurt : l'action du séquenceur est perdue.
- **La migration `20261007120000` peut refuser de s'appliquer** : elle recrée
  l'index unique `uq_linkedin_action_active` avec un prédicat élargi (les
  actions `failed` au résultat `resultat_indetermine` comptent comme actives),
  et s'arrête avec le nombre de couples fautifs s'il existe déjà un couple
  (contact, type) en doublon sur ce prédicat. Rien n'est modifié dans ce cas.
  Pour les trouver :

  ```sql
  select contact_id, kind, count(*), array_agg(id order by created_at) as actions
    from linkedin_action_queue
   where contact_id is not null
     and (status in ('pending', 'processing', 'sent')
          or (status = 'failed' and error_code = 'resultat_indetermine'))
   group by contact_id, kind
  having count(*) > 1;
  ```

  C'est à l'opérateur d'arbitrer, ligne par ligne, laquelle des actions du
  couple garder (relire les lignes avant de supprimer ou de passer un statut :
  une invitation peut déjà être partie). Puis relancer `supabase db push --linked`.

Vérifier que chaque migration est passée, dans l'éditeur SQL du projet :

```sql
-- 20261007110000 : colonnes et check
select column_name from information_schema.columns
 where table_name = 'linkedin_server_sessions' and column_name = 'envoi_pause_jusqua';
select column_name from information_schema.columns
 where table_name = 'linkedin_requetes' and column_name = 'action_queue_id';
select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'linkedin_action_queue_method_check';   -- doit contenir 'serveur'

-- 20261007130000 : défaut de la colonne method
select column_default from information_schema.columns
 where table_name = 'linkedin_action_queue' and column_name = 'method';  -- 'serveur'::text

-- 20261007120000 : l'index doit porter resultat_indetermine
select indexdef from pg_indexes where indexname = 'uq_linkedin_action_active';

-- 20261008100000 : le volume d'envoi est reporte par type
select key, value from organization_settings
 where key in ('linkedin_invitations_par_semaine', 'linkedin_messages_par_semaine');

-- 20261008110000 : la marque de reprise et son index
select column_name from information_schema.columns
 where table_name = 'linkedin_action_queue' and column_name = 'reprise_le';
select indexname from pg_indexes where indexname = 'linkedin_action_queue_reprise_idx';
```

La migration de report (`20261008100000`) ne pose une cle que pour les organisations
qui avaient deja regle `linkedin_settings.weekly_cap` ; une organisation qui n'en
avait pas garde le defaut du code (100 invitations, 200 messages par semaine), et le
regle ensuite dans Reglages > LinkedIn.

Chaque migration se vérifie aussi elle-même et échoue si son objet manque : un
`db push` qui se termine sans erreur est déjà un premier signal.

Enfin, poser `JAY_REACH_LINKEDIN=1` dans `worker.env` (voir le tableau des
variables) : sans elle, rien ne part, et rien ne le dit.

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
- **Aucun port n'est publié** : le worker ne fait que consommer des files
  d'attente, et le navigateur LinkedIn (section suivante, facultatif) n'est
  joignable que par le réseau Compose.
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

| `JAY_REACH_LINKEDIN` | `1` active le canal LinkedIn du serveur : les commandes `jay-reach linkedin ...` (`connecter`, `deconnecter`, `ip` ; `statut` reste lisible) **et tout l'envoi**. Clé absente, vide ou différente de `1` : le minuteur d'envoi ne démarre pas et le handler `linkedin.envoi` sort sur un `console.warn`, sans rien envoyer. Aucune erreur, aucune action en échec : les actions restent `pending`. La valeur est comparée strictement à `1` (`true` ou `oui` ne comptent pas). |
| `LINKEDIN_ENVOI_POLL_MS` | Optionnelle. Cadence (millisecondes) à laquelle le worker évalue s'il y a un envoi LinkedIn à faire. Défaut `60000`. Absente, vide, illisible ou sous `10000` : le défaut. Au-dessus de `300000` : ramenée à `300000`. N'a d'effet que si `JAY_REACH_LINKEDIN=1`. |
| `LINKEDIN_BROWSER_URL` | Adresse DevTools du service `navigateur` : `http://navigateur:9223`. |
| `LINKEDIN_PROXY_URL` (**`navigateur.env`**) | Adresse du proxy résidentiel dédié, **sans identifiants** (`schéma://hôte:port`). Le navigateur refuse de démarrer sans elle. |
| `LINKEDIN_PROXY_USER` / `LINKEDIN_PROXY_PASSWORD` (`worker.env`) | Identifiants du proxy, présentés par CDP : Chromium les refuse dans `--proxy-server`. |
| `JAY_REACH_ORGANISATION_ID` | Optionnelle. À poser si la base porte plusieurs organisations (sinon l'organisation unique est prise). |

`GIT_SHA`, `NODE_ENV` et `HEARTBEAT_FILE` sont posés directement par
`docker-compose.yml` : ils n'ont pas leur place dans `worker.env`.

## Le navigateur LinkedIn (facultatif)

Le canal LinkedIn exécuté côté serveur (collecte et envoi) pilote un Chromium dans son propre
conteneur (`navigateur`), derrière un proxy résidentiel dédié. Il est derrière
un profil Compose : sans le réglage ci-dessous, `./deployer.sh` ne le construit
ni ne le démarre.

1. Dans `/etc/jay-reach/worker.env`, poser `JAY_REACH_LINKEDIN=1`,
   `LINKEDIN_BROWSER_URL`, `LINKEDIN_PROXY_USER` et `LINKEDIN_PROXY_PASSWORD`.
   **L'adresse du proxy va dans un fichier à part**, que seul le navigateur
   charge :

   ```bash
   sudo cp deploy/vps/navigateur.env.example /etc/jay-reach/navigateur.env
   sudo chmod 600 /etc/jay-reach/navigateur.env
   sudo chown root:root /etc/jay-reach/navigateur.env
   sudo nano /etc/jay-reach/navigateur.env
   ```
2. Activer le profil, une fois, dans `deploy/vps/.env` (fichier local, jamais commité) :

   ```bash
   echo 'COMPOSE_PROFILES=linkedin' >> .env
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
- **Le DevTools du navigateur donne la main sur la session LinkedIn**, c'est
  pourquoi aucun port n'est publié, pas même sur `127.0.0.1` (tout processus
  local ou conteneur en `network_mode: host` y accéderait). Ne jamais en
  ajouter un, ni tunneler le port vers un poste partagé.
- **Vérifier ce que vaut une IP de proxy, et en changer.** `jay-reach linkedin ip` affiche, sous
  la sortie observée, le titulaire de l'adresse selon le registre RIPE, et avertit quand le pays
  déclaré par ce titulaire est contredit par son adresse postale. Le cas vu le 07/10/2026 :

  ```
  Sortie du navigateur : 185.134.193.162 · AS6830 Liberty Global Europe Holding B.V. · FR
  Titulaire de l’IP : NADEJDA-NET · Sofia, Bulgaria Kukush Str., Bl.58
  Attention : le titulaire déclare le pays France mais son adresse est « Sofia, Bulgaria … »
  ```

  Le champ `country` d'un objet RIPE est une **déclaration**, que les bases de géolocalisation
  recopient : trois d'entre elles répondaient « France, Paris » pour cette adresse. Une fois la
  session ouverte, le contrôle le plus sûr reste la page LinkedIn des sessions actives
  (`/mypreferences/d/user-sessions`), qui donne le lieu retenu **et** le propriétaire de l'IP.

  Pour changer d'IP : poser la nouvelle `LINKEDIN_PROXY_URL` dans `/etc/jay-reach/navigateur.env`
  (et ses identifiants dans `worker.env`), relancer `./deployer.sh --force-recreate`, vérifier avec
  `jay-reach linkedin ip`, puis figer la nouvelle sortie avec `jay-reach linkedin ip --confirmer`.
  Sans ce dernier appel, la collecte s'arrête sur l'écart entre la sortie vue et l'IP attendue.

- **Seul un proxy HTTP ou HTTPS convient.** Chromium ne sait pas authentifier
  un proxy SOCKS5 : `page.authenticate` n'aurait aucun effet et l'erreur serait
  illisible. L'entrypoint refuse toute autre forme.
- **Limites du conteneur** : 1,5 Go de mémoire et 512 processus, car ce serveur
  héberge aussi les bots de visioconférence de production. Un `docker stats`
  qui colle au plafond se traite avant qu'il ne coûte la mémoire de ces bots.
- **Le secret du proxy est réparti sur deux fichiers, exprès.** L'adresse
  `LINKEDIN_PROXY_URL` va dans `navigateur.env` (Chromium en a besoin pour
  `--proxy-server`) ; les identifiants `LINKEDIN_PROXY_USER` et
  `LINKEDIN_PROXY_PASSWORD` vont dans `worker.env` (le worker les présente par
  CDP). Le conteneur `navigateur`, qui exécute le JavaScript de pages tierces,
  ne voit ainsi ni clé du worker ni identifiant de proxy. Ne pas tout remettre
  dans un seul fichier.
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
