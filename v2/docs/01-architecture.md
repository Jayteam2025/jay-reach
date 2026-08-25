# 01 — Architecture

## Principe directeur

Le cœur ne connaît que des interfaces. Tout ce qui touche le monde extérieur est un provider remplaçable. C'est ce qui rend le projet contribuable : ajouter une source ou un canal ne doit demander aucune modification du cœur.

## Monorepo

```
jay-reach/
├── apps/
│   ├── web/                  Next.js — UI, Server Actions, webhooks, API publique
│   └── worker/               pg-boss, jobs planifiés
├── packages/
│   ├── core/                 Interfaces, types, state machine, règles. Zéro SDK externe.
│   ├── db/                   Client Supabase typé, migrations, seeds
│   ├── i18n/                 Messages fr / en / nl
│   ├── providers/
│   │   ├── signals/          jobboard, appointment, tradeshow
│   │   ├── enrichment/       fullenrich, dropcontact, legalregistry
│   │   ├── email/            smartlead
│   │   ├── linkedin/         unipile, manual
│   │   ├── mail/             manuscry, pdf
│   │   ├── inbox/            unipile
│   │   └── ai/               anthropic, openai, ollama
│   └── ui/                   Composants Jay Reach
├── supabase/migrations/
├── docker-compose.yml
└── docs/
```

Dépendances : `apps/*` → `packages/providers/*` → `packages/core`. Jamais l'inverse. `core` n'importe aucun SDK.

## Les sept interfaces

Dans `packages/core/src/contracts/`. Chaque provider exporte un objet conforme plus un manifest (champs de configuration, libellés traduits, validation Zod) qui permet de générer automatiquement l'écran de configuration.

### SignalProvider

```ts
interface SignalProvider {
  id: string;                          // "jobboard.francetravail"
  labelKey: string;                    // clé i18n
  configSchema: ZodSchema;
  freshnessWindowDays: number;
  discover(ctx: RunContext): AsyncIterable<RawSignal>;
  normalize(raw: RawSignal): Signal;   // pur, testable, sans I/O
}
```

`discover` est un générateur asynchrone : il streame, gère sa pagination et son curseur, stocké dans `source_runs.cursor`.

### EnrichmentProvider

```ts
interface EnrichmentProvider {
  id: string;
  capabilities: ('company'|'contact'|'email'|'phone'|'linkedin_url'|'postal_address')[];
  enrichCompany?(input: CompanyHint): Promise<CompanyEnrichment>;
  enrichContact?(input: ContactHint): Promise<ContactEnrichment>;
  findEmail?(input: ContactHint): Promise<EmailResult>;
  estimateCost(operations: number): Promise<{ amountEur: number }>;
}
```

Providers chaînés dans un ordre configurable, arrêt au premier résultat dépassant le seuil de confiance. Chaque appel est mis en cache : on ne paie jamais deux fois le même enrichissement.

**Répartition des rôles, à respecter :** l'annuaire légal fournit l'identité de l'entreprise, son SIREN, son code NAF et ses adresses d'établissement. FullEnrich fournit les coordonnées de la personne. Ne pas demander une adresse postale d'entreprise à un enrichisseur de contacts.

### ChannelProvider

Interface commune à `email`, `linkedin` et `mail`, ce qui permet au séquenceur de traiter les trois canaux identiquement.

```ts
interface ChannelProvider<T extends ChannelKind> {
  id: string;
  kind: T;
  leadTimeHours: number;               // 0 pour email, 72 pour un courrier
  unitCostEur: number;                 // 0 sauf courrier
  dispatch(action: OutboundAction): Promise<DispatchResult>;
  pollOutcomes?(since: Date): Promise<Outcome[]>;
  handleWebhook?(payload: unknown): Outcome[];
}
```

`leadTimeHours` est essentiel : un courrier prévu à J+7 doit partir à J+4.

### InboxProvider

```ts
interface InboxProvider {
  id: string;
  syncThreads(since: Date): AsyncIterable<RawThreadMessage>;
  sendReply(threadId: string, body: string): Promise<void>;
}
```

Lit les deux sens du fil. Voir `docs/06-reception-et-reponses.md` pour le filtrage obligatoire.

### AIProvider

```ts
interface AIProvider {
  id: string;
  complete(input: { system: string; prompt: string; json?: ZodSchema }): Promise<string|object>;
}
```

Scoring, classification des réponses, rédaction assistée, traduction. Anthropic par défaut, Ollama pour un fonctionnement entièrement local — un utilisateur qui refuse d'envoyer ses données à un modèle distant doit pouvoir faire tourner Jay Reach chez lui.

### ImportParser

```ts
interface ImportParser {
  id: string;                                    // "csv" | "xlsx"
  parse(file: Buffer): Promise<ParsedRows>;
  suggestMapping(headers: string[]): ColumnMapping;   // heuristique multilingue
}
```

### CrmProvider

```ts
interface CrmProvider {
  id: string;
  pushContact(contact: Contact, thread: Thread, reason: PushReason): Promise<{ externalId: string }>;
}
```

Voir `docs/07-api-et-crm.md`.

## Runtime

Tout passe par `pg-boss`. Une file par étape :

| File | Déclencheur | Rôle |
|---|---|---|
| `sources.discover` | cron par source | Exécute `discover`, écrit les signaux bruts |
| `signals.qualify` | insertion | Déduplication, résolution d'entreprise, scoring |
| `imports.process` | dépôt de fichier | Parsing, mapping, fusion de doublons, création de liste |
| `enrichment.company` | signal qualifié | Enrichit le compte |
| `enrichment.contacts` | compte enrichi | Identifie et enrichit les contacts par persona |
| `sequence.enroll` | contacts prêts | Crée les inscriptions selon les règles d'entrée |
| `sequence.tick` | cron 5 min | Fait avancer les inscriptions, crée les actions dues |
| `actions.dispatch` | action approuvée | Appelle le `ChannelProvider` |
| `outcomes.poll` | cron 15 min | Récupère les résultats sans webhook |
| `inbox.sync` | cron 5 min | Synchronise les fils, classe les réponses |
| `crm.push` | réponse positive | Pousse vers le CRM configuré |
| `retention.purge` | cron nocturne | Applique la politique de rétention |

Chaque job est idempotent et porte une clé d'unicité. Un job rejoué ne doit jamais produire un second envoi : c'est la garantie la plus importante du système.

## Résolution d'entreprise

Un signal ou une ligne de fichier donne un nom en texte libre. Il faut le rattacher à une entité stable, sinon on crée des doublons et on recontacte les mêmes gens. La clé canonique en France est le **SIREN**.

1. Correspondance exacte sur un domaine web déjà connu
2. Recherche par raison sociale + code postal via l'annuaire légal
3. Correspondance floue (trigram Postgres) sur les entreprises déjà en base
4. Aucune correspondance sûre : créer un compte `unresolved`, sortir de la file, demander un arbitrage humain

Ne jamais deviner. Un mauvais rattachement envoie un message à la mauvaise société.

## Sécurité

- Credentials chiffrés via `pgcrypto`, clé `ENCRYPTION_KEY` hors base
- RLS sur toutes les tables, policies basées sur l'appartenance à l'organisation
- Webhooks entrants avec vérification de signature obligatoire, rejet sinon
- Rate limiting sur l'API publique et les Route Handlers
- Aucune donnée personnelle dans les logs : on journalise des identifiants, pas des coordonnées
