# ADR 0003 : Multi-tenant via `workspace_id`

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

L'outil actuel est single-tenant Jay-only :
- RLS hardcodes sur 3 UUIDs admins
- Aucune notion d'organisation/equipe
- Toutes les donnees prospect_* sont accessibles uniquement par les 3 admins

Pour la version SaaS, plusieurs clients doivent coexister sans se voir.
Pour la version OSS self-host, un dev peut vouloir avoir plusieurs "espaces" (perso, son agence, ses clients).

## Decision

Modele **workspace-based multi-tenancy** :

```sql
workspaces (id, name, slug, settings, created_at)
workspace_members (workspace_id, user_id, role)
-- role: 'owner' | 'admin' | 'member' | 'viewer'

-- Toutes les tables prospection gagnent:
ALTER TABLE prospect_profiles ADD COLUMN workspace_id UUID NOT NULL;
ALTER TABLE prospect_signals ADD COLUMN workspace_id UUID NOT NULL;
-- etc. pour les 15+ tables prospect_*
```

### Pattern RLS uniforme

```sql
CREATE POLICY "members read" ON prospect_profiles
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "members write" ON prospect_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "admins delete" ON prospect_profiles
  FOR DELETE TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
```

Helper function pour reduire la verbosite :

```sql
CREATE OR REPLACE FUNCTION user_workspaces(min_role TEXT DEFAULT 'viewer')
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT workspace_id FROM workspace_members
  WHERE user_id = auth.uid()
    AND role_priority(role) >= role_priority(min_role);
$$;

-- Usage:
CREATE POLICY "members read" ON prospect_profiles
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT user_workspaces('viewer')));
```

### Crons et workers

Les crons restent globaux (un seul job pour tout le systeme) mais iterent par workspace :

```sql
-- weekly-prospect-cron itere sur tous les workspaces actifs
FOR ws IN SELECT id FROM workspaces WHERE is_active LOOP
  PERFORM call_workspace_cron(ws);
END LOOP;
```

Pour le SaaS, isolation par workspace_id evite que la prospection d'un client n'impacte les autres (quota, billing, errors).

### Sharing cross-workspace

Certaines tables partagent les donnees cross-workspace (caches, learnings) :

| Table | Strategie |
|---|---|
| `domain_email_patterns` | Globale, partagee (apprentissage cross-tenant fait sens) |
| `email_verification_cache` | Globale, partagee (eviter de re-payer Bouncer pour le meme email) |
| `catch_all_domains` | Globale, partagee |
| `pattern_audit_events` | Workspace-scoped (audit per tenant) MAIS aggregate dans `domain_email_patterns` global |
| `daily_reoon_usage` | Per workspace |
| `bouncer_jobs` | Per workspace |
| Toutes les tables prospect_* | Per workspace |

### Migration des donnees existantes Jay

```sql
-- Create the Jay workspace
INSERT INTO workspaces (id, name, slug, settings)
VALUES (gen_random_uuid(), 'Jay', 'jay', '{"is_legacy_jay": true}'::jsonb)
RETURNING id INTO jay_workspace_id;

-- Add existing admins as members
INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  (jay_workspace_id, '00000000-0000-0000-0000-0000000000a1', 'owner'),  -- membre 1
  (jay_workspace_id, '00000000-0000-0000-0000-0000000000a2', 'owner');  -- membre 2

-- Backfill workspace_id on all existing rows
UPDATE prospect_profiles SET workspace_id = jay_workspace_id;
UPDATE prospect_signals SET workspace_id = jay_workspace_id;
-- etc.

-- Then enforce NOT NULL
ALTER TABLE prospect_profiles ALTER COLUMN workspace_id SET NOT NULL;
```

## Consequences

### Positives

- Vrai multi-tenant, prod-grade
- Pattern uniforme et previsible
- Compatible OSS self-host (1 workspace par dev) et SaaS (N workspaces par client)
- Pas de couplage a Jay (les UUIDs admins disparaissent du code SQL)
- Audit RLS clair, testable
- Billing/quotas peuvent etre attaches a `workspaces`

### Negatives

- **Migration data lourde** : ~15 tables a backfiller + 50+ policies a reecrire
- **Risque de regression RLS** : si une policy oublie le check workspace_id, fuite de donnees critique
- Performance : `IN (SELECT workspace_id...)` est legere mais a verifier avec EXPLAIN sur les queries chaudes
- Indexes a ajouter : `(workspace_id, ...)` sur toutes les tables prospect_* pour eviter sequential scans

### Mitigation regression RLS

- Tests d'integration RLS systematiques : un user du workspace A ne doit jamais lire de donnees du workspace B
- Policy templates centralises (helper `user_workspaces()`)
- Code review obligatoire sur toute nouvelle migration touchant RLS
- Test pgTAP pour les invariants RLS

## Alternatives considerees

### Alt 1 : Tenant par schema (un schema PG par client)

Rejete. Complexe a maintenir, indexes/queries fragmentes, pas adapte a Supabase, mauvais quand on a > 100 tenants.

### Alt 2 : Multi-tenancy par user_id seulement

Rejete. Empeche la collaboration (plusieurs personnes sur le meme espace de prospection). Trop limite.

### Alt 3 : Pas de multi-tenant, instance par client (self-host force)

Rejete. Casse le modele SaaS. On veut multi-tenant pour le cloud.

### Alt 4 : Postgres Row Security via session variables

Rejete. Plus complexe que les RLS Supabase standard, peu d'avantages.

## References

- Supabase RLS best practices : https://supabase.com/docs/guides/auth/row-level-security
- Multi-tenant patterns SaaS : https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
