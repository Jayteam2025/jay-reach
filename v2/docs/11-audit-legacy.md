# 11 — Audit du code existant

## Objectif

Décider quoi garder, quoi jeter, quoi réécrire — **sur pièces**.

Le code existant contient de la connaissance qui a coûté du temps : quels champs renvoie réellement l'API France Travail, quels acteurs polluent les résultats, quels cas cassent le parsing, quels messages ont obtenu des réponses. Cette connaissance vaut souvent plus que le code qui la porte.

## Règle absolue

**Une partie de ce code tourne en production.** L'éditeur prospecte réellement avec. L'audit doit donc répondre à une question de plus : qu'est-ce qui doit continuer à fonctionner pendant toute la refonte ?

Pour chaque module en usage réel, le rapport propose un chemin de migration progressif — nouveau code derrière un drapeau de fonctionnalité, ancien chemin conservé jusqu'à validation. Jamais de bascule sèche.

**L'audit ne modifie rien.** Il produit `AUDIT.md` et s'arrête. Aucune réécriture, aucun refactor, aucune suppression avant validation humaine.

## Méthode

### 1. Inventaire
Pour chaque fichier : chemin, rôle en une ligne, nombre de lignes, dernière modification, dépendances externes. Repérer les fichiers morts et les doublons.

### 2. Cartographier le pipeline réel
Reconstituer ce que le code fait vraiment, de la collecte à l'envoi. Signaler tout écart avec ce qui est censé se passer. Les surprises sont là.

### 3. Classer chaque module

| Verdict | Critère |
|---|---|
| **Reprendre** | Fonctionne, testable, transposable |
| **Extraire** | Code mauvais, connaissance précieuse. Récupérer la logique, jeter l'implémentation. |
| **Réécrire** | Besoin valide, code non |
| **Abandonner** | Le besoin lui-même a disparu |

### 4. Extraire les actifs

À sauver en priorité, quelle que soit la qualité du code :

- Requêtes et paramètres d'API qui fonctionnent (France Travail, Adzuna, Apify)
- Listes d'exclusion : SIREN de cabinets de recrutement, codes NAF, mots-clés parasites
- Règles de parsing éprouvées sur des cas réels
- Prompts de scoring, avec leurs itérations si l'historique Git les contient
- Templates de messages ayant obtenu des réponses, avec leurs taux si mesurés
- Mappings de champs vers Smartlead
- Toute donnée réelle collectée : elle devient un jeu de fixtures, après anonymisation

Chaque actif est écrit dans `docs/legacy-assets/` avec sa provenance.

### 5. Sécurité — avant tout le reste

- Secrets en dur dans le code ou committés dans l'historique Git
- Clés d'API dans un `.env` versionné
- Données personnelles réelles dans le dépôt (exports CSV, fixtures non anonymisées)
- Endpoints sans authentification

**Tout secret trouvé dans l'historique doit être révoqué et rotaté**, pas seulement supprimé du fichier. Un secret dans l'historique d'un dépôt destiné à devenir public est un incident, pas une dette technique.

### 6. Rapport

`AUDIT.md` :

1. Synthèse en dix lignes, lisible par un non-développeur
2. Tableau de classement module par module
3. Actifs extraits et leur emplacement
4. Problèmes de sécurité par gravité, avec actions correctives
5. Part du périmètre v1 déjà couverte par l'existant
6. Recommandation motivée

## Format du verdict

La dernière section tranche, elle ne décrit pas :

> **Reprise partielle.** Les modules X et Y sont transposables et couvrent Z % du périmètre v1. Migration recommandée dans cet ordre.

ou

> **Repartir à neuf.** Aucun module ne survit à la nouvelle architecture. Les actifs extraits sont conservés dans `docs/legacy-assets/` et alimenteront directement la v1.

Puis on s'arrête et on attend.

## Ton du rapport

Écrire sans jugement sur la personne. Un audit qui explique pourquoi un module est inutilisable est utile ; un audit qui commente le niveau du développeur ne l'est pas. Le rapport a vocation à être lu, et éventuellement partagé.
