# Faire tourner le worker en permanence

Le moteur tourne aujourd'hui en mode éphémère : une fonction Vercel par tour,
déclenchée par la planification. C'est suffisant depuis que la maintenance de
pg-boss rattrape les jobs coupés, mais un processus permanent reste préférable
sur un point précis : un enrichissement FullEnrich peut demander deux minutes,
et une fonction Vercel s'arrête à une.

## Ce que ça change

| | Éphémère (aujourd'hui) | Permanent |
|---|---|---|
| Enrichissement long | tué à 60 s, repris au tour suivant | va au bout |
| Cadence | un tour toutes les ~8 min | continue |
| Coût | inclus dans Vercel | un conteneur à héberger |
| Surveillance | journaux Vercel | à mettre en place |

## Lancer

```bash
docker build -f apps/worker/Dockerfile -t jay-reach-worker .
docker run --env-file .env jay-reach-worker
```

Trois variables suffisent : `DATABASE_URL`, `ENCRYPTION_KEY`, `APP_URL`. Les
clés des fournisseurs sont lues en base, chiffrées — elles ne passent pas par
l'environnement du conteneur.

## Une fois qu'il tourne

**Couper la planification Vercel**, sinon les deux produisent le même travail.
Les identifiants de job sont déterministes, donc rien ne partirait en double,
mais deux moteurs qui se disputent les mêmes files rendent les journaux
illisibles.

`ENRICH_MAX_WAIT_MS` peut alors être relevé : la borne de vingt-cinq secondes
n'existe que pour tenir dans le budget d'une fonction.
