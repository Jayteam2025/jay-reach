# 07 — API publique et CRM

## Le principe

Jay Reach n'est pas un CRM. Il détecte, engage, obtient une réponse — puis passe la main. Un outil qui laisse un lead mourir dans sa propre base est un cul-de-sac.

Une seule voie de sortie, publique et documentée. **Jay CRM la consomme comme n'importe quel CRM tiers**, sans chemin privilégié. Si l'API est assez bonne pour l'usage interne, elle l'est pour les autres — et elle est testée en permanence sans effort particulier.

## Quels contacts montent dans le CRM

La question la plus importante de ce document, et la réponse est une opinion assumée.

Les CRM meurent d'être remplis de choses que personne ne regarde. Un CRM contenant huit mille contacts froids issus d'une prospection automatisée n'est plus consultable, et les commerciaux cessent de l'ouvrir. Jay Reach ne doit pas reproduire ça.

**Un contact monte quand il a répondu positivement. Pas avant.**

| Situation | Comportement |
|---|---|
| Réponse classée `positive` | Poussé automatiquement, avec le fil complet et la raison du contact |
| Réponse `neutral` ou `negative` | Bouton manuel dans la boîte de réception. Jamais automatique. |
| Absence détectée | Rien. La séquence reprendra. |
| Contact en séquence, sans réponse | Reste dans Jay Reach. Ce n'est pas une opportunité, c'est une tentative. |
| Contact importé, jamais contacté | Rien. |

Résultat : un CRM où chaque fiche a une conversation derrière elle.

Ce comportement est configurable — un utilisateur peut choisir de tout pousser — mais le réglage par défaut est celui-ci, et l'écran de configuration explique pourquoi en une phrase.

## Ce qui est poussé

```json
{
  "contact": { "first_name", "last_name", "email", "phone", "job_title", "linkedin_url", "locale" },
  "account": { "name", "legal_name", "siren", "domain", "headcount", "city", "country" },
  "reason": {
    "type": "signal | list",
    "label": "Offre publiée le 12/08 : commercial itinérant B2B — Normandie",
    "occurred_at": "2026-08-12",
    "score": 92,
    "url": "https://…"
  },
  "campaign": { "name", "persona" },
  "thread": [ { "direction", "channel", "body", "sent_at" } ],
  "sentiment": "positive",
  "jay_reach_url": "https://…/contacts/…"
}
```

Le champ `reason` est ce qui fait la valeur de la remontée : le commercial qui ouvre la fiche sait immédiatement pourquoi cette personne est là.

## API publique

REST, versionnée sous `/api/v1`, authentifiée par clé d'API par organisation, scopée en lecture ou en écriture, révocable, avec limitation de débit.

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/contacts` | Liste filtrable, paginée |
| `GET` | `/contacts/:id` | Fiche complète avec fils |
| `POST` | `/contacts` | Création ou fusion sur email |
| `GET` | `/accounts` | Entreprises |
| `GET` | `/signals` | Signaux, filtrables par type et score |
| `GET` | `/campaigns` | Campagnes et leurs compteurs |
| `POST` | `/campaigns/:id/enroll` | Inscrire des contacts |
| `POST` | `/lists/:id/members` | Ajouter à une liste |
| `POST` | `/suppressions` | Ajouter une suppression |
| `GET` | `/threads` | Fils de discussion |

OpenAPI généré à partir des schémas Zod, publié dans le dépôt. Un contributeur qui écrit un connecteur CRM part de ce fichier.

## Webhooks sortants

Configurables par organisation, avec URL, secret et sélection d'événements.

| Événement | Déclencheur |
|---|---|
| `signal.qualified` | Un signal passe le scoring |
| `contact.enrolled` | Un contact entre en séquence |
| `action.sent` | Une action est partie |
| `contact.replied` | Réponse humaine reçue, avec le sentiment |
| `contact.left_company` | Départ détecté |
| `enrollment.completed` | Séquence terminée sans réponse |
| `import.completed` | Import terminé, avec le compte rendu |

Charge utile signée en HMAC-SHA256, en-tête `X-Jay-Reach-Signature`. Réessais avec temporisation exponentielle sur cinq tentatives, puis abandon avec notification dans l'interface.

## CrmProvider

Pour les intégrations natives. Une seule méthode, volontairement :

```ts
interface CrmProvider {
  id: string;
  pushContact(contact: Contact, thread: Thread, reason: PushReason): Promise<{ externalId: string }>;
  pushTask(task: CallTask): Promise<{ externalId: string }>;
  listCustomers?(since?: Date): AsyncIterable<CustomerRecord>;
}
```

`pushTask` sert les étapes d'appel : la tâche arrive dans le CRM du commercial, qui reçoit la notification par son application habituelle sur son téléphone. Jay Reach n'a pas à reconstruire ce chemin.

`listCustomers` alimente la liste d'exclusion des clients actuels, en lecture seule et périodique. C'est la méthode qui évite qu'un utilisateur prospecte à froid son propre client — voir `docs/03-sources.md`, partie C.

Implémentations v1 : `jaycrm`, `webhook` (générique), `csv_export`. Les autres viendront des contributeurs — HubSpot, Pipedrive, Salesforce sont les trois demandes attendues.

Une fois poussé, `contacts.crm_external_id` est renseigné. Un second push met à jour au lieu de dupliquer.

## Ce que l'API ne fait pas

- Pas de lecture en masse destinée à reconstituer une base de contacts pour la revendre. Limitation de débit et journalisation des accès.
- Pas de création d'action sortante par API en v1. On peut inscrire un contact dans une campagne, pas court-circuiter le séquenceur et ses garde-fous.
- Pas d'accès inter-organisations, quelle que soit la clé.
