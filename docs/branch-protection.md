# Protection de la branche `main`

## Modèle cible (org sur plan payant : GitHub Team)

La protection automatique de branche n'est disponible, pour un dépôt **privé**, qu'avec
un plan GitHub payant. Dès que l'org `Jayteam2025` est passée en GitHub Team, appliquer
le ruleset versionné :

```bash
gh api -X POST repos/Jayteam2025/jay-reach/rulesets --input docs/branch-protection-ruleset.json
```

Il impose : **push direct interdit** sur `main`, **Pull Request obligatoire** + **1 review
approuvée** + **review d'un code owner** (@Jeeiib via `CODEOWNERS`), **checks CI verts
requis** (`lint-and-test (22.x)`, `deno-check`, `gitleaks`), interdiction de force-push et
de suppression de branche. L'admin (@Jeeiib) est en **bypass** (il peut pousser/merger
directement).

## Modèle intérimaire (plan gratuit)

En gratuit, la protection ci-dessus est indisponible sur un repo privé. En attendant
l'upgrade, on obtient le même résultat (« personne ne push sans l'accord de l'admin »)
par les permissions :

- Les contributeurs sont ajoutés en **lecture seule** (Read) comme *outside collaborators*
  → ils **ne peuvent pas pousser** sur le dépôt.
- Ils **forkent** le dépôt (fork privé) et proposent leurs changements via **Pull Request**
  depuis leur fork.
- **Seul l'admin (@Jeeiib) merge.** Il vérifie manuellement, avant de merger, que la CI est
  verte et que le CLA est accepté (case du modèle de PR).

Dès l'upgrade en plan payant, appliquer le ruleset pour automatiser ces garde-fous.
