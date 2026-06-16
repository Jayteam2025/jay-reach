# Protection de la branche `main`

## Modèle actif (dépôt public)

Dépôt public : le ruleset GitHub de protection de branche est **actif et automatisé**.

```bash
gh api -X POST repos/Jayteam2025/jay-reach/rulesets --input docs/branch-protection-ruleset.json
```

Le ruleset impose :
- **Push direct interdit** sur `main` (tous les contributeurs)
- **Pull Request obligatoire** + review approuvée
- **Review d'un code owner** (@Jeeiib via `CODEOWNERS`)
- **Checks CI verts requis** : `lint-and-test (22.x)`, `deno-check`, `gitleaks`, etc.
- Interdiction de force-push et de suppression de branche

**L'admin (@Jeeiib) est en bypass** : il peut pousser/merger directement si nécessaire.

## Processus de contribution

**N'importe qui peut contribuer** :

1. **Fork** le dépôt public
2. Créez une branche feature/bugfix
3. Ouvrez une **Pull Request** (depuis votre fork vers `main`)
4. Un mainteneur review et vérifie que le CLA est accepté
5. Une fois approuvée, la PR est mergée

Le ruleset GitHub automatise l'exécution de ces garde-fous pour tous les contributeurs.
