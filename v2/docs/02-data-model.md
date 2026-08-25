# 02 — Modèle de données

Postgres via Supabase. Toutes les tables métier portent `organization_id` et sont protégées par RLS.

## Vue d'ensemble

```
organizations ──< memberships >── users
      │
      ├──< sources ──< source_runs ──< signals ─┐
      ├──< lists ──< list_members ─────────────┤
      │                                        ├──> accounts ──< contacts
      ├──< personas                            │
      ├──< campaigns ──< sequence_steps ──> message_templates
      │        │
      │        └──< enrollments ──< actions ──< outcomes
      │
      ├──< senders
      ├──< suppressions
      ├──< threads ──< thread_messages
      ├──< credentials
      └──< audit_events
```

## Organisation et accès

**organizations** — `id`, `name`, `slug`, `default_locale`, `created_at`

**memberships** — `organization_id`, `user_id`, `role`, `created_at`

| Rôle | Peut | Ne peut pas |
|---|---|---|
| `owner` | tout | — |
| `admin` | configurer sources, campagnes, providers, inviter | supprimer l'organisation |
| `operator` | approuver et envoyer, répondre, éditer un message | changer la configuration providers |
| `viewer` | lire | toute action sortante |

Approuver un envoi exige `operator` minimum.

**credentials** — `organization_id`, `provider_id`, `secret` (bytea chiffré), `config` (jsonb non sensible), `status`, `last_checked_at`

## Sources

### Signaux

**sources** — `organization_id`, `provider_id`, `name`, `config` (jsonb), `schedule` (cron), `is_active`

**source_runs** — `source_id`, `started_at`, `finished_at`, `status`, `cursor` (jsonb), `items_found`, `items_new`, `error`

Sans historique d'exécution, on ne sait jamais pourquoi une source ne remonte plus rien.

**signals**
- `id`, `organization_id`, `source_id`, `provider_id`
- `external_id` — unique avec `source_id`
- `kind` — `job_posting` | `appointment` | `tradeshow`
- `occurred_at` — date de l'événement, **pas** de la collecte. Peut être dans le futur (salons).
- `raw` (jsonb), `title`, `url`, `company_hint`, `location`
- `account_id` nullable, `resolution_status` (`pending`|`resolved`|`unresolved`|`rejected`)
- `score` (0–100), `score_reason`, `scored_at`
- `status` — `new` | `qualified` | `discarded` | `enrolled`
- `discard_reason` — rempli quand `discarded`, affiché dans l'UI, permet de rétablir

Index : `unique(source_id, external_id)`, `(organization_id, status, occurred_at desc)`, GIN sur `raw`.

### Listes

**lists** — `organization_id`, `name`, `context_note`, `origin` (`import`|`manual`|`filter`), `source_file_name`, `imported_by`, `created_at`

`context_note` est la raison d'être de la liste : « rencontrés au salon Produrable, stand D14 ». Elle alimente la variable `{{contexte}}` dans les messages. Champ obligatoire — une liste sans contexte produit des messages sans motif.

**list_members** — `list_id`, `contact_id`, `added_at`, `raw_row` (jsonb, la ligne du fichier d'origine)

**imports** — `organization_id`, `file_name`, `rows_total`, `rows_unique`, `rows_merged`, `mapping` (jsonb), `status`, `list_id`, `created_at`

## Personas

**personas**
- `organization_id`, `name`, `description`
- `title_patterns` (text[]) — intitulés qui déclenchent la correspondance, multilingues
- `title_exclusions` (text[])
- `seniority` — `executive` | `director` | `manager` | `individual`
- `angle` — l'angle de message propre à ce persona, injecté dans le contexte du modèle
- `default_campaign_id` nullable

Les personas remplacent le `role_bucket` figé. `contacts.persona_id` est calculé à l'enrichissement par correspondance sur `title_patterns`, avec repli sur un arbitrage humain quand plusieurs personas matchent.

## Entités

**accounts**
- `id`, `organization_id`, `name`, `legal_name`, `siren`, `naf_code`, `domain`, `linkedin_url`
- `headcount`, `city`, `postal_code`, `country`, `locale`
- `postal_address` (jsonb), `postal_address_verified_at`, `postal_address_verified_by`
- `prospecting_opposition` (bool) — indicateur légal d'opposition au démarchage, récupéré à la résolution
- `is_customer` (bool) — dérivé des listes clients, recalculé à chaque import
- `enrichment` (jsonb), `enriched_at`
- `unique(organization_id, siren)` quand non nul ; idem sur `domain`

L'adresse postale n'est utilisable pour un courrier que si `postal_address_verified_at` est renseigné. Voir `docs/04-sequenceur.md`.

**contacts**
- `id`, `organization_id`, `account_id`, `persona_id`
- `first_name`, `last_name`, `job_title`, `locale`
- `email`, `email_status` (`unknown`|`valid`|`risky`|`invalid`), `email_confidence`
- `linkedin_url`, `linkedin_provider_id`, `photo_url`
- `enrichment` (jsonb), `enriched_at`
- `source_signal_id` nullable, `source_list_id` nullable
- `status` — `active` | `left_company` | `do_not_contact`
- `unique(organization_id, lower(email))` quand non nul

`locale` est déduit du pays et de la région du compte, modifiable à la main. Il détermine la langue des messages.

`photo_url` est mis en cache localement à l'enrichissement. Repli sur les initiales si absent — jamais d'icône morte.

## Campagnes et séquences

**campaigns**
- `organization_id`, `name`, `status` (`draft`|`active`|`paused`|`archived`)
- `source_id` nullable, `list_id` nullable — **exactement l'un des deux**, contrainte CHECK
- `entry_rules` (jsonb) — score minimum, personas, effectif, géographie
- `daily_cap`, `approval_policy` (jsonb, par canal)
- `letter_monthly_budget_eur`

**message_templates**
- `id`, `organization_id`, `name`, `channel`, `locale`
- `version` (int), `subject`, `body`
- `sent_count` — remis à zéro à chaque nouvelle version
- `parent_id` — relie les versions successives
- `created_by`, `created_at`
- `unique(parent_id, version, locale)`

Modifier le texte d'un message crée une nouvelle version, ne modifie jamais l'ancienne. On garde ainsi le taux de réponse par version, et le retour arrière est possible.

**sequence_steps**
- `campaign_id`, `position`
- `channel` — `email` | `linkedin_invite` | `linkedin_message` | `letter` | `call`
- `delay_hours` — décalage depuis l'étape précédente
- `template_parent_id` — pointe la famille de templates ; la version et la locale sont résolues au rendu. **Nul pour une étape `call`** : elle porte à la place `call_brief`, une consigne courte affichée à l'utilisateur au moment d'appeler.
- `conditions` (jsonb) — ex. « seulement si l'invitation a été acceptée »
- `stop_on` (text[])

### Le canal `call`

Une étape d'appel ne produit aucun envoi. Elle crée une **tâche datée**, visible dans Jay Reach et poussée vers le CRM du client. Trois champs supplémentaires sur `actions` la servent :

- `call_outcome` — `reached` | `not_reached` | `callback` | `wrong_person` | `not_interested`
- `call_notes` — texte libre saisi par l'utilisateur
- `call_callback_at` — quand `call_outcome = callback`, décale l'étape suivante à cette date

Une action `call` naît directement en `approved` : aucune validation, aucun quota d'envoi, aucun appel provider. Elle passe en `completed` quand l'utilisateur saisit un résultat, ou en `skipped` s'il la déclare non faite. Tant qu'elle n'a pas de résultat, elle reste due et remonte chaque jour dans la liste des tâches.

**enrollments**
- `id`, `organization_id`, `campaign_id`, `contact_id`
- `signal_id` **nullable**, `list_id` nullable
- `status` — `active` | `paused` | `paused_absence` | `completed` | `stopped` | `replied` | `bounced`
- `current_step`, `next_action_at`, `started_at`, `ended_at`, `stop_reason`, `resume_at`
- `unique(contact_id)` partiel sur `status in ('active','paused','paused_absence')`

Cette contrainte partielle est la protection la plus efficace contre le double envoi : un contact ne peut être que dans une seule campagne en cours.

**actions**
- `id`, `organization_id`, `enrollment_id`, `step_id`, `channel`, `sender_id`
- `status` — `scheduled` | `pending_approval` | `blocked` | `approved` | `dispatched` | `delivered` | `failed` | `skipped` | `cancelled`
- `block_reason` — variable manquante, adresse non vérifiée, budget dépassé
- `scheduled_for`, `dispatch_after` (= `scheduled_for` − lead time du canal)
- `template_id`, `payload` (jsonb) — contenu final figé à la génération
- `cost_eur`, `provider_ref`, `approved_by`, `approved_at`, `dispatched_at`, `error`
- `idempotency_key` unique

**outcomes** — `action_id`, `type` (`sent`, `opened`, `clicked`, `replied`, `bounced`, `invite_accepted`, `letter_printed`, `letter_delivered`, `unsubscribed`), `occurred_at`, `raw`

Les ouvertures sont enregistrées mais **ne déclenchent jamais de branchement** : le taux d'ouverture est bruité par les proxys de sécurité. Seuls réponses, clics et acceptations font foi.

## Envoi

**senders** — `organization_id`, `kind` (`email`|`linkedin`|`postal`), `provider_id`, `identity`, `display_name`, `daily_quota`, `hourly_quota`, `warmup_stage`, `timezone`, `business_hours` (jsonb), `is_active`

**contact_sender_bindings** — `contact_id`, `sender_id`, `bound_at`

Un contact reste attaché au même expéditeur pour toute sa vie. Changer d'expéditeur en cours de séquence casse le fil de discussion et fait arriver la relance d'un inconnu.

**suppressions** — `organization_id`, `scope` (`email`|`domain`|`linkedin`|`postal`|`account`), `value`, `reason`, `origin`, `created_at`, `expires_at`

`origin` distingue la provenance : `manual`, `unsubscribe`, `bounce`, `customer_import`, `sirene_opposition`, `api`. C'est ce qui permet d'afficher pourquoi un contact est protégé, et de retirer en bloc une importation obsolète sans toucher aux désinscriptions réelles.

Vérifiée avant chaque envoi, sans exception, y compris pour une action déjà approuvée.

### Deux sources d'exclusion automatiques

**Vos clients actuels.** Une entreprise déjà cliente ne doit jamais recevoir un message de prospection à froid. C'est la faute la plus embarrassante que l'outil puisse commettre, et elle suffit à le faire désinstaller.

**customer_lists** — `organization_id`, `name`, `source` (`csv`|`crm_sync`), `last_synced_at`, `entries_count`

L'exclusion se fait au niveau du **compte**, pas seulement du contact : si Groupe Vantel est client, aucun de ses salariés n'entre en séquence, y compris ceux qu'on n'a jamais vus. La correspondance se fait par SIREN, puis par domaine web, puis par nom normalisé.

Périmètre importable : clients actifs, affaires en cours, prospects déjà travaillés par un collègue, comptes stratégiques réservés. Chaque entrée porte une raison affichée dans l'interface quand un signal est écarté — « Groupe Vantel est dans votre liste clients » et non « écarté ».

**Opposition légale à la prospection.** L'annuaire des entreprises expose un indicateur d'opposition à l'utilisation commerciale des données : un dirigeant peut demander que sa société ne soit pas démarchée. Cet indicateur est récupéré à la résolution d'entreprise et, lorsqu'il est actif, crée automatiquement une suppression de portée `account` avec l'origine `sirene_opposition`.

Ce filtre n'est pas désactivable. Trois lignes de code qui protègent l'utilisateur d'un manquement facile à lui reprocher.

## Notifications

**notification_preferences** — `user_id`, `organization_id`, `channel` (`email`|`push`), `event`, `enabled`, `digest` (`instant`|`hourly`|`daily`)

**push_subscriptions** — `user_id`, `endpoint`, `keys` (jsonb chiffré), `user_agent`, `created_at`, `last_used_at`

**notifications** — `organization_id`, `user_id`, `event`, `payload` (jsonb), `sent_at`, `read_at`, `channel`

Voir `docs/13-notifications.md`.

## Réception

**threads** — `organization_id`, `contact_id`, `channel`, `provider_thread_id`, `last_message_at`, `is_read`, `assigned_to`, `classification`, `resume_at`

`classification` : `human_reply` | `auto_absence` | `auto_left_company` | `auto_other` | `unclassified`

**thread_messages** — `thread_id`, `direction` (`in`|`out`), `body`, `sent_at`, `provider_message_id`, `headers` (jsonb), `raw`

## Traçabilité

**audit_events** — `organization_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `diff` (jsonb), `created_at`

Append-only. Aucun `UPDATE` ni `DELETE`. Y sont journalisés : toute approbation, tout envoi, toute modification de configuration provider, tout accès aux données personnelles d'une personne.

## RLS

Une policy par table, sur ce modèle :

```sql
create policy "org members read"
on public.signals for select
using (
  organization_id in (
    select organization_id from public.memberships
    where user_id = auth.uid()
  )
);
```

Les écritures d'actions sortantes exigent en plus un rôle suffisant. Écrire un test qui vérifie qu'aucune requête du worker ne traverse une organisation.

## Rétention

Purge nocturne :
- signaux `discarded` : 90 jours
- contacts jamais engagés : 12 mois
- contacts engagés : 3 ans après le dernier contact
- `thread_messages` : 3 ans
- `audit_events` : 5 ans
- `signals.raw` : réduit après 6 mois aux champs normalisés
