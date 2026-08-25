# Revue de sécurité pré-envoi — Séquenceur (T17 / T18)

> **STOP T17.** Le cahier des charges (`docs/12-backlog.md`) marque le cœur du
> séquenceur comme un point de validation humaine avant de le brancher sur de
> **vrais envois**. Ce document est la revue à valider avant ce branchement.
>
> Périmètre : T17 (cœur, machine à états) + T18 (les 9 garde-fous), tels que
> présents sur la branche `ticket/t20-wire-engine` (HEAD `e4f0092`).

## Verdict — état de sécurité actuel : **SÛR (rien n'envoie)**

Le cœur du séquenceur est une **bibliothèque de fonctions pures et testées**
(machine à états, ordonnancement, quotas, liaison expéditeur, idempotence,
garde-fous). **Rien n'est câblé** :

- Les files `sequence.tick` et `sequence.enroll` sont des **no-op** (`apps/worker/src/index.ts`, boucle TODO) — aucun tick ne tourne, aucune inscription n'est créée.
- Aucun envoi réel ne peut donc partir du séquenceur aujourd'hui. C'est l'état sûr.

**Le danger apparaît au moment du câblage** (ticket T20+) si `actions.dispatch`
est alimenté sans passer d'abord par un tick qui exécute les garde-fous. Voir
les 3 points prioritaires en fin de document.

## Où le séquenceur s'insère

```
producteur → discover → qualify → accounts
                                      │
                        enrichment.company / contacts → contacts (emails)
                                      │
        ┌─────────────────────────────┴──────────────────────────────┐
        │  À CÂBLER (T20+) — ZONE STOP                                 │
        │  sequence.enroll : règles d'entrée + suppression/client/    │
        │                    opposition AVANT de créer une inscription│
        │  sequence.tick   : sélection des dus → conditions → rendu   │
        │                    du message → garde-fous → quota →        │
        │                    expéditeur → écrit les actions           │
        │  actions.dispatch : envoi RÉEL (Smartlead…) — seulement     │
        │                     après garde-fous + approbation          │
        └─────────────────────────────────────────────────────────────┘
```

## Code concerné

Tout est dans `packages/core/src/sequencer/` :

| Fichier | Rôle |
|---|---|
| `state-machine.ts` | `applyEvent()` — transitions de statut d'inscription, états terminaux définitifs |
| `scheduling.ts` | `shiftIntoBusinessHours()`, `applyLeadTime()`, `jitterMs()` — calcul d'horaire pur |
| `quota.ts` | `allocateWithinQuota()` (jour + heure), `requiresSendQuota()` |
| `sender-binding.ts` | `resolveSender()` — liaison contact→expéditeur à vie, pause si inactif |
| `actions.ts` | `actionIdempotencyKey()`, `dedupeActions()`, `shiftRemainingSteps()` |
| `guards.ts` | `runGuards()` — les 9 garde-fous, verdict `allow`/`defer`/`block` |

> Note : `docs/04` (ligne 147) situe les garde-fous dans `packages/core/src/guards/` ;
> ils sont en réalité dans `sequencer/guards.ts`. Chemin documenté à corriger.

## Règles obligatoires (`docs/04`) vs implémentation

Verdict prudent : une fonction pure qui existe ≠ règle appliquée, puisque
**rien n'appelle encore ces fonctions**.

| # | Règle (`docs/04`) | État | Preuve / manque |
|---|---|---|---|
| 1 | Idempotence : un tick rejoué ne crée pas 2 actions | 🟡 Partiel | Clé `enrollmentId:stepId:attempt` (`actions.ts:7`) + `dedupeActions` en mémoire ; **pas** d'index unique DB, aucun appelant ne fournit les clés existantes |
| 2 | Génération au tick, pas à l'inscription | 🔴 Manquant | Aucun tick ni rendu de message n'existe |
| 3 | Fenêtre ouvrée (horaires) | 🟢 Fait (helper) | `scheduling.ts:20`, horaires expéditeur + fuseau contact |
| 4 | Délai de canal (lead time) | 🟢 Fait (helper) | `scheduling.ts:51` : `dispatch_after = scheduled_for − leadTime` |
| 5 | Quota expéditeur → **différé**, jamais perdu | 🟢 Fait (helper) | `quota.ts:17` + garde `guards.ts:82` renvoie `defer` |
| 6 | Jitter ±20 % | 🟢 Fait (helper) | `scheduling.ts:56` ; ratio = argument, non figé à 20 % |
| 7 | Un contact / compte / jour | 🟡 Partiel | Garde `guards.ts:61` `defer` — mais l'entrée `accountContactedToday` n'est calculée nulle part |
| 8 | Liaison expéditeur à vie | 🟢 Fait (helper) | `sender-binding.ts:25` : réutilise la liaison, pas de réattribution silencieuse |
| 9 | Politique d'approbation par canal | 🔴 Partiel/Manquant | La table email/LinkedIn=auto, **courrier=humain obligatoire** n'est pas implémentée comme politique |
| 10 | Courrier toujours humain + adresse vérifiée | 🟡 Partiel | `guards.ts:71` bloque `letter` si non vérifiée ; mais le **workflow** de confirmation humaine n'existe pas |
| 11 | Rodage (3 premiers envois → file) | 🔴 Manquant | Aucune trace dans le code |
| 12 | Plafond de budget | 🔴 Probablement FAUX | `guards.ts:78` renvoie **`block`** ; `docs/04:58` veut que l'action **« passe en file »** (approbation), donc différée/mise en file, **pas perdue** |
| 13 | Évaluation des conditions au tick | 🔴 Manquant | Aucune évaluation de condition, aucun chemin `skipped` sur condition non remplie |
| 14 | Machine à états / terminal = définitif | 🟢 Fait (helper) | `state-machine.ts:32-33` |
| 15 | Canal `call` = aucun envoi | 🟡 Partiel | Côté quota/garde géré ; **manque** création de tâche, `call_outcome`, expiration 7 j |
| 16 | Callback décale TOUTES les étapes suivantes | 🟢 Fait (helper) | `actions.ts:35` `shiftRemainingSteps()` |
| 17 | Entreprise cliente / opposition → **aucune inscription** | 🟡 Partiel | `guards.ts:54` bloque au **dispatch** ; `docs/04:172-173` exige d'empêcher l'**inscription** (code d'enroll inexistant) |

## Les 9 garde-fous (T18)

`runGuards()` (`guards.ts:47`). Chaque branche renvoie un `GuardDecision`
(`allow`/`defer`/`block`) — **jamais un booléen** (confirmé, le type n'a pas de
variante booléenne).

| Ordre doc | Garde-fou | Emplacement | Verdict |
|---|---|---|---|
| 9 | Kill-switch (arrêt global org) | `guards.ts:49` | `block` — **vérifié en 1er** (« prioritaire ») |
| 1 | Liste de suppression (client + opposition légale incluses) | `guards.ts:54` | `block` |
| 2 | Une inscription active par contact | — | **hors `runGuards`** — contrainte DB (`docs/04:150`) |
| 3 | Un contact / compte / jour | `guards.ts:61` | `defer` |
| 4 | Toutes les variables résolues | `guards.ts:66` | `block` |
| 5 | Adresse postale vérifiée (courrier) | `guards.ts:71` | `block` |
| 8 | Plafond de dépense | `guards.ts:78` | `block` |
| 6 | Quota expéditeur | `guards.ts:82` | `defer` |
| 7 | Horaires ouvrés | `guards.ts:86` | `defer` |

**Déviations d'ordre vs `docs/04:149-157` :**
- Kill-switch remonté en 1er : documenté, inoffensif (`block` gagne de toute façon).
- **Dépense (#8) vérifiée avant quota (#6) et horaires (#7).** L'ordre doc est 6→7→8. Comme la dépense renvoie `block` et quota/horaires `defer`, une action à la fois hors-budget **et** hors-horaires donne `block` dans le code, alors que l'ordre documenté donnerait `defer`. Le verdict/motif enregistré change → **décision à prendre avant câblage**.

## Couverture des tests (« tests obligatoires » `docs/04:163-176`)

Tests existants : `guards.test.ts` (11 cas) + `sequencer.test.ts` (machine à
états, idempotence, ordonnancement, quota, liaison, callback). **9/13 couverts.**

| # | Test obligatoire | État |
|---|---|---|
| 1 | Tick rejoué ne crée pas 2 actions | ✅ |
| 2 | Réponse entre `approved` et `dispatched` annule l'envoi | ❌ (pas de pipeline approve→dispatch à tester) |
| 3 | Suppression ajoutée après approbation bloque l'envoi | 🟡 (suppression→block testé, pas le timing post-approbation) |
| 4 | Lead time courrier décale `dispatch_after` pas `scheduled_for` | ✅ |
| 5 | Quota atteint → différé (pas perdu) | ✅ |
| 6 | 500 inscriptions ne dépassent jamais le quota | ✅ (faible : un seul appel, mono-expéditeur) |
| 7 | Contact = même expéditeur sur toute la séquence | ✅ |
| 8 | Courrier vers adresse non vérifiée bloqué | ✅ |
| 9 | Variable non résolue bloque | ✅ |
| 10 | Entreprise en liste client → aucune inscription même bien notée | ❌ (pas de code d'enroll) |
| 11 | Entreprise en opposition légale → aucune inscription | ❌ |
| 12 | Étape `call` : aucun quota / aucune validation | ✅ |
| 13 | `callback` décale toutes les étapes suivantes | ✅ |

Manques (#2, #3 timing, #10, #11) : tous nécessitent le code de pipeline / enroll
qui n'existe pas encore.

## Risques à lever AVANT de câbler de vrais envois

Par priorité :

1. **`actions.dispatch` n'applique AUCUN garde-fou.** `handlers/dispatch.ts` pousse directement vers Smartlead ; son commentaire prétend « garde-fous appliqués en amont » — mais aucun amont ne les applique. Si un producteur enfile un `actions.dispatch`, c'est un **envoi sans garde-fou**. → Ne jamais alimenter `actions.dispatch` sans passer par un tick qui exécute `runGuards`.
2. **Le plafond de budget bloque au lieu de mettre en file.** `guards.ts:78` `block` ⇒ l'action est **perdue** ; `docs/04:58` veut qu'elle « passe en file » (approbation). À trancher/corriger avant d'activer le canal courrier.
3. **Les entrées des garde-fous ne sont jamais calculées.** `accountContactedToday`, `spendWouldExceed`, `unresolvedVariables`, `quotaRemaining`, `postalVerified`, `businessHoursNextSlot`, `suppression` sont des entrées de `runGuards` sans producteur. Les garde-fous ne valent que ce que vaut ce calcul — qui n'existe pas encore.
4. **Idempotence en mémoire seule.** `dedupeActions` a besoin d'une vraie source de clés existantes ET d'un **index unique DB** sur la clé. La clé `enrollmentId:stepId:attempt` **n'inclut ni le canal ni la version de template** → une étape multi-canaux pourrait entrer en collision. À vérifier avant de compter sur la sécurité de rejeu.
5. **Rendu du message au tick.** `docs/04:42` impose le rendu au tick (pas à l'inscription). Aucun code de rendu n'existe : s'assurer que le futur tick rende là, sinon la protection « variable non résolue » est inopérante.
6. **Empêcher l'inscription des entreprises clientes / en opposition.** Les garde-fous ne bloquent qu'au dispatch. `docs/04:172-173` exigent de ne créer **aucune inscription** → à imposer dans `sequence.enroll` (inexistant).
7. **Effets de bord du canal `call` non implémentés** (création de tâche `approved`, `pushTask` CRM, `call_outcome`, callback→décalage, expiration 7 j → `skipped`).
8. **Ordre des garde-fous** (point #2 de la section précédente) à réconcilier avec `docs/04`.

## Recommandation

Le cœur T17/T18 est propre et bien testé, mais **c'est une bibliothèque, pas un
système en marche**. Avant tout envoi réel, décider/corriger au minimum les
**points 1, 2 et 3** ci-dessus, puis écrire la couche d'orchestration
(`sequence.enroll` + `sequence.tick`) qui **doit** router chaque envoi par
`runGuards` avant `actions.dispatch`.

Tant que cette revue n'est pas validée, `sequence.tick`/`sequence.enroll`
restent volontairement des no-op : **aucun envoi ne peut partir**.
