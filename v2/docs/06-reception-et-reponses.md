# 06 — Boîte de réception et traitement des réponses

## Pourquoi lire les deux sens du fil

Le problème n'est pas seulement de savoir qu'un prospect a répondu. C'est de savoir que **vous** avez déjà répondu, depuis votre téléphone, sur Gmail ou l'application LinkedIn. Sans cela, la relance part alors que la conversation a commencé — l'erreur la plus embarrassante qu'un outil de prospection puisse commettre.

Jay Reach synchronise donc les fils dans les deux sens, en lecture, avec un filtre serré.

## Filtrage — la règle qui protège tout le reste

À chaque message synchronisé :

1. Extraire les identités : adresses email de tous les participants, identifiant LinkedIn de l'interlocuteur.
2. Confronter aux contacts connus de l'organisation.
3. **Aucune correspondance → rien n'est stocké.** Pas de cache, pas de log, pas de trace. Le message est ignoré et l'identifiant provider est mémorisé dans un ensemble local d'exclusion pour ne pas le retraiter.
4. Correspondance → le message rejoint le fil du contact, avec sa direction (`in` ou `out`) et ses en-têtes.

Cette règle est non négociable. Elle est ce qui rend acceptable de connecter une boîte professionnelle à un outil de prospection, et elle doit être testée explicitement : un test vérifie qu'un échange sans rapport n'écrit aucune ligne en base.

L'interface le dit clairement au moment de connecter un compte : Jay Reach ne conserve que les échanges avec des contacts déjà présents dans votre base.

## Effets sur les inscriptions

| Événement | Effet |
|---|---|
| Message entrant classé `human_reply` | Inscription → `replied`, terminal |
| Message **sortant** vers un contact en séquence | Inscription → `stopped`, motif « repris en direct » |
| Message entrant classé `auto_absence` | Inscription → `paused_absence`, `resume_at` = lendemain du retour |
| Message entrant classé `auto_left_company` | Inscription → `stopped`, contact → `left_company` |
| Message entrant classé `auto_other` | Aucun effet, fil marqué non lu |

Le deuxième cas est celui qui justifie la synchronisation bidirectionnelle.

## Détection des réponses automatiques

Trois passes, dans l'ordre, du plus fiable au plus coûteux.

### 1. En-têtes

`Auto-Submitted: auto-replied`, `X-Autoreply`, `X-Autorespond`, `Precedence: bulk` ou `auto_reply`, `X-Auto-Response-Suppress`, `Return-Path` vide.

Fiable, gratuit, couvre la majorité des cas. Suffit à classer sans aller plus loin.

### 2. Motifs d'objet et de corps, dans les trois langues

- Français : « absence du bureau », « je suis absent », « réponse automatique », « congés »
- Anglais : « out of office », « automatic reply », « away from my desk », « on leave »
- Néerlandais : « afwezig », « automatisch antwoord », « niet aanwezig », « met vakantie »

Motifs stockés en configuration, pas en dur dans le code, pour être enrichis sans redéploiement.

### 3. Modèle de langage, sur ce qui reste ambigu

Sortie JSON stricte :

```json
{
  "classification": "human_reply|auto_absence|auto_left_company|auto_other",
  "return_date": "2026-08-25 ou null",
  "successor_hint": "nom ou email du remplaçant, ou null",
  "sentiment": "positive|neutral|negative",
  "confidence": 0.0
}
```

Confiance sous 0,7 : classé `unclassified`, aucun effet automatique sur l'inscription, fil remonté à l'utilisateur.

## Les deux cas intéressants

**Absence.** La séquence ne s'arrête pas, elle attend. C'est même un bon signal : l'adresse est vivante et lue. `resume_at` est fixé au lendemain de la date de retour extraite ; sans date, reprise à sept jours.

Le fil porte un badge en contour lime avec la date (« ABSENT · retour 25/08 ») et **remonte automatiquement en tête de boîte le jour du retour** — pas aujourd'hui. Le moment où il faut le regarder, c'est J, pas maintenant. Pas de couleur d'alerte : Flare reste réservé à l'urgence réelle.

**Départ de l'entreprise.** Arrêt, contact marqué `left_company`, et le compte remonte en suggestion pour identifier le successeur. C'est un signal d'achat déguisé : une entreprise qui vient de perdre son directeur commercial va en recruter un.

Quand `successor_hint` est renseigné, l'interface propose directement d'enrichir cette personne et de l'inscrire.

## Répondre depuis Jay Reach

La boîte permet de répondre dans le fil, email comme LinkedIn. Le message part par le sender lié au contact, jamais par un autre.

Une réponse envoyée depuis Jay Reach arrête l'inscription au même titre qu'une réponse envoyée depuis votre client habituel.

## Classement et suivi

Un fil porte un état de traitement : `à traiter`, `en cours`, `traité`, `à recontacter plus tard`. Assignable à un membre de l'organisation.

Un fil classé `positive` déclenche la remontée vers le CRM — voir `docs/07-api-et-crm.md`.
