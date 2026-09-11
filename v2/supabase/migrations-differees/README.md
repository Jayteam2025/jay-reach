# Migrations différées

Ces migrations ne sont pas prises par `supabase db push --linked` (elles vivent
hors de `supabase/migrations/`) parce qu'elles suppriment quelque chose encore
lu par un déploiement précédent du worker ou du web.

Pour en appliquer une : après avoir vérifié que le nouveau déploiement (worker
et web) est en place et sain, copier son contenu dans l'éditeur SQL du projet
Supabase, ou déplacer le fichier dans `supabase/migrations/` puis relancer

```bash
supabase db push --linked --include-all
```

`--include-all` est nécessaire quand l'horodatage de la migration différée est
antérieur à celui d'une migration déjà appliquée : `db push` refuse par défaut
d'appliquer une migration plus ancienne que la dernière en place. Ne pas
renommer le fichier pour la faire paraître plus récente.
