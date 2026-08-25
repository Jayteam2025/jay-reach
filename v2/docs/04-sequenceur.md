# 04 — Séquenceur

Cœur du produit, et partie à écrire le plus soigneusement. Un bug ici n'est pas un pixel mal placé : c'est un message envoyé deux fois, ou envoyé à quelqu'un qui vient de demander à ne plus être contacté.

## Modèle

Une **campagne** porte une liste ordonnée d'étapes. Une **inscription** est le parcours d'un contact. Une **action** est une occurrence concrète d'étape, avec son contenu figé.

## Cycle de vie d'une inscription

```
        entry_rules satisfaites
                 │
                 ▼
            [ active ] ──── réponse humaine ──────▶ [ replied ]   terminal
                 │
                 ├───── stop_on déclenché ────────▶ [ stopped ]   terminal
                 ├───── bounce dur ───────────────▶ [ bounced ]   terminal
                 ├───── contact parti ────────────▶ [ stopped ]   terminal
                 ├───── absence détectée ─────────▶ [ paused_absence ] ──▶ reprise à resume_at
                 ├───── pause manuelle ───────────▶ [ paused ] ──▶ reprise manuelle
                 │
          dernière étape franchie
                 │
                 ▼
           [ completed ]   terminal
```

Un état terminal est définitif. Toute reprise crée une nouvelle inscription, jamais une réouverture.

## La boucle `sequence.tick`

Toutes les cinq minutes :

1. Sélectionner les inscriptions dues (`status = active`, `next_action_at <= now()`) avec `FOR UPDATE SKIP LOCKED`.
2. Résoudre l'étape courante, évaluer ses `conditions`.
3. Condition non satisfaite → action `skipped`, passage à l'étape suivante.
4. Condition satisfaite → **résoudre le template** (famille + locale du contact + version courante), **rendre les variables**, créer l'action.
5. Appliquer la politique d'approbation et les garde-fous pour déterminer le statut de l'action.
6. Recalculer `next_action_at`.

La génération se fait **au tick, pas à l'inscription**. Un message écrit trois semaines à l'avance ignore tout ce qui s'est passé entre-temps.

## Politique d'approbation

Réglée par canal dans les paramètres de campagne.

| Canal | Défaut | Modifiable |
|---|---|---|
| Email | Automatique | Oui |
| Invitation LinkedIn | Automatique | Oui |
| Message LinkedIn | Automatique | Oui |
| Courrier | **Validation obligatoire** | Non |

Trois règles s'ajoutent quel que soit le réglage :

- **Rodage** — les trois premiers envois d'un couple `template_id` + `version` passent en file. Voir partir les premiers exemplaires évite de découvrir une variable cassée au bout de deux cents envois.
- **Dépassement de budget** — une action qui ferait franchir `letter_monthly_budget_eur` passe en file au lieu d'être perdue.
- **Adresse postale non vérifiée** — voir plus bas.

La file d'attente est un onglet de la campagne, pas une destination de navigation. Vide, elle affiche un compteur à zéro.

## Ordonnancement réel

Le `delay_hours` d'une étape est une intention, pas une heure d'envoi. Le planificateur applique ensuite, dans cet ordre :

1. **Fenêtre horaire** — heures ouvrées du sender, fuseau du contact. Une action prévue samedi 22 h glisse à lundi matin.
2. **Lead time du canal** — `dispatch_after = scheduled_for − leadTimeHours`. Un courrier qui doit arriver mardi part vendredi.
3. **Quota du sender** — journalier et horaire. Quota atteint : l'action glisse au prochain créneau libre, elle n'est jamais supprimée.
4. **Jitter** — ±20 % sur l'espacement, pour éviter un motif mécaniquement régulier.
5. **Un contact par compte et par jour** — deux personnes de la même entreprise ne reçoivent jamais quelque chose le même jour. Configurable, activé par défaut.

## Attribution des expéditeurs

Un contact est lié à un sender au moment de sa première action, et **conserve ce lien à vie** (`contact_sender_bindings`). Changer d'expéditeur en cours de séquence casse le fil de discussion et fait arriver la relance d'un inconnu.

Attribution initiale : le sender actif du bon type ayant la plus faible consommation de quota du jour. Si le sender lié devient inactif, l'inscription est mise en pause avec un message explicite plutôt que réattribuée en silence.

## Canaux

### Email — Smartlead

Jay Reach décide quoi envoyer et quand. Smartlead envoie et gère la délivrabilité.

- Une campagne Smartlead par campagne Jay Reach, alimentée à l'unité via l'API.
- Webhooks (réponse, bounce, désinscription) alimentent `outcomes` puis les transitions. Signature vérifiée, rejet sinon.
- Le fil est conservé : les relances partent dans le même thread, avec le même `Message-ID` de référence.

Isoler derrière `EmailProvider` dès le premier jour, même avec une seule implémentation.

### LinkedIn — Unipile, avec repli manuel

Actions pilotées : visite de profil (réchauffement passif, 1 à 2 jours avant l'invitation), invitation avec ou sans note, message après acceptation, lecture des réponses.

Garde-fous **en dur**, non contournables par configuration :
- 20 invitations par jour et par compte, plafond absolu
- 60 messages par jour et par compte
- délai aléatoire de 30 à 180 secondes entre deux actions du même compte
- aucune action hors fenêtre horaire
- montée en charge sur 14 jours pour un compte fraîchement connecté
- **un seul provider LinkedIn actif par compte** — deux outils sur le même profil font sauter le compte

Le mode `manual` produit une liste d'actions à faire à la main, exportable, message pré-rédigé à copier. Zéro risque, zéro coût. C'est ce que beaucoup d'utilisateurs prudents choisiront.

Avertissement affiché à la connexion d'un compte : ces API ne sont pas officielles, l'automatisation contrevient aux conditions d'utilisation de la plateforme, le risque de restriction est assumé par l'utilisateur.

### Courrier — Manuscry

Le canal qui différencie, parce que presque personne ne le fait.

**Adresse postale.** L'adresse vient de l'annuaire légal, pas d'un enrichisseur de contacts. Une société a un siège et des établissements, et le directeur commercial travaille rarement au siège — un courrier nominatif envoyé au siège fait trois jours de circulation interne avant la poubelle.

Règle : siège par défaut, liste des établissements présentée si l'entreprise en a plusieurs, et **confirmation humaine obligatoire au premier courrier vers une entreprise donnée**. Une fois `postal_address_verified_at` renseigné, l'adresse est réutilisée sans redemander. Une action courrier vers un compte non vérifié part en `blocked` avec le motif correspondant.

**Jamais d'adresse personnelle.** Adresses professionnelles exclusivement. Règle produit, pas préférence.

Autres contraintes : lead time 72 h configurable, coût unitaire et total engagé affichés avant validation, plafond mensuel par organisation, approbation systématique sans possibilité de désactivation, une page maximum.

Manuscry remonte l'impression et l'expédition. Il n'y a pas d'accusé de lecture : le suivi se fait par l'étape suivante.

Placement optimal : après un email sans réponse et une invitation acceptée. Le courrier arrive alors comme troisième contact, pas comme intrusion.

### Téléphone — le canal qui n'envoie rien

Une étape `call` ne produit aucun envoi et n'appelle aucun provider. Elle crée une **tâche datée**, et c'est tout.

- Créée directement en `approved` : pas de validation, pas de quota d'envoi, pas de garde-fou de fenêtre horaire pour l'envoi — en revanche, elle est planifiée dans les heures ouvrées du contact, puisqu'on va l'appeler.
- Poussée vers le CRM du client via `CrmProvider.pushTask()`. C'est là que la notification arrivera sur le téléphone du commercial, par son application CRM habituelle : Jay Reach n'a pas à réinventer ce chemin.
- Elle porte le contexte que l'utilisateur aura besoin d'avoir sous les yeux : le signal d'origine et sa date, ce qui a déjà été envoyé, ce qui a été ouvert ou accepté, et la consigne courte de l'étape (`call_brief`).

**Résultat de l'appel.** L'utilisateur saisit `call_outcome`, et la séquence s'adapte :

| Résultat | Effet |
|---|---|
| `reached` | Étape terminée, la suite se déroule normalement |
| `not_reached` | Étape terminée, la suite se déroule normalement |
| `callback` | `call_callback_at` décale toutes les étapes suivantes de la même durée |
| `wrong_person` | Inscription arrêtée, contact marqué à revoir |
| `not_interested` | Inscription arrêtée, suppression proposée à l'utilisateur |

Une tâche sans résultat reste due et remonte chaque jour. Elle ne bloque pas la séquence indéfiniment : au-delà de sept jours, elle passe en `skipped` et la suite reprend, avec une notification.

**Ce que le canal `call` ne fait pas en v1 :** pas de téléphonie intégrée, pas d'enregistrement, pas de composeur. Jay Reach dit qui appeler, quand et pourquoi. L'appel se passe ailleurs.

## Garde-fous transverses

Dans `packages/core/src/guards/`, appelés avant tout `dispatch`, dans cet ordre :

1. Liste de suppression — email, domaine, profil LinkedIn, adresse postale, compte entier, **entreprise cliente**, **opposition légale au démarchage**
2. Une seule inscription en cours par contact (contrainte base)
3. Un contact par compte et par jour
4. Variables toutes résolues
5. Adresse postale vérifiée (courrier uniquement)
6. Quotas du sender
7. Fenêtre horaire
8. Plafond de dépense
9. Interrupteur d'arrêt global de l'organisation

Chaque garde-fou renvoie une décision explicite : `allow`, `defer` avec nouvelle date, ou `block` avec motif. Jamais un booléen — on veut savoir pourquoi une action ne part pas et pouvoir l'afficher.

## Tests obligatoires

- Un tick rejoué deux fois ne crée pas deux actions
- Une réponse reçue entre `approved` et `dispatched` annule l'envoi
- Une suppression ajoutée après approbation bloque l'envoi
- Le lead time du courrier décale `dispatch_after` sans décaler `scheduled_for`
- Un quota atteint reporte l'action au lieu de la perdre
- 500 inscriptions ne dépassent jamais le quota journalier du sender
- Un contact reçoit toujours du même expéditeur, sur toute la séquence
- Une action courrier vers un compte sans adresse vérifiée est bloquée
- Une variable non résolue bloque l'action et ne l'envoie jamais
- Une entreprise figurant dans la liste clients ne génère aucune inscription, même sur un signal à score élevé
- Une entreprise en opposition légale au démarchage ne génère aucune inscription, quelle que soit la configuration
- Une étape `call` ne consomme aucun quota d'envoi et ne passe par aucune validation
- Un résultat d'appel `callback` décale bien toutes les étapes suivantes, pas seulement la prochaine
