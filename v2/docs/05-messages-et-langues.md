# 05 — Messages, variables et langues

## Versionnement des messages

Un message vit dans `message_templates`, pas dans l'étape de séquence. Une étape pointe une **famille** de templates (`template_parent_id`) ; la version et la langue sont résolues au moment du rendu.

**Modifier un texte crée une nouvelle version, jamais une modification en place.** Conséquences, toutes voulues :

- Le taux de réponse est mesuré par version. On voit si une modification a amélioré ou cassé.
- Le retour arrière est possible : réactiver la version 3 quand la 4 déçoit.
- Le compteur `sent_count` repart à zéro, donc le rodage des trois premiers envois se redéclenche. C'est exactement le comportement souhaité : un texte modifié est un texte non testé.
- Un template est réutilisable entre campagnes.

L'interface n'expose pas la mécanique : l'utilisateur édite un message et enregistre. L'historique des versions est accessible dans un panneau replié, avec le taux de réponse de chacune.

## Résolution des variables

Trois niveaux, du moins cher au plus tardif.

### À l'enregistrement — validation statique

Le système connaît les variables disponibles selon la nature de la campagne :

| Variable | Campagne sur signal | Campagne sur liste |
|---|---|---|
| `{{prenom}}` `{{nom}}` `{{poste}}` `{{entreprise}}` | oui | oui |
| `{{ville}}` `{{effectif}}` | oui | oui |
| `{{signal_date}}` `{{signal_mois}}` `{{signal_titre}}` `{{signal_zone}}` | oui | **non** |
| `{{contexte}}` | non | oui |
| `{{persona_angle}}` | oui | oui |

Enregistrer un message contenant une variable indisponible est **refusé**, avec un message explicite : « `{{signal_date}}` n'existe pas pour une campagne alimentée par une liste. »

### Valeur de repli — optionnelle

Syntaxe `{{signal_zone|votre secteur}}`. La phrase reste correcte quand la donnée manque. À utiliser sur les variables souvent absentes, jamais sur `{{prenom}}` — un message qui commence par « Bonjour cher professionnel » vaut moins qu'un message non envoyé.

### Au rendu — blocage

Variable vide et sans repli : l'action passe en `blocked`, motif `missing_variable`, avec le nom du champ manquant. Elle n'est **jamais** envoyée.

L'interface regroupe les actions bloquées par champ manquant et propose des actions groupées : compléter les contacts, ignorer ces contacts, ou passer cette étape pour eux. C'est le garde-fou qui évite deux cents emails avec un trou au milieu d'une phrase.

## Contraintes de rédaction par canal

Appliquées à la génération assistée et affichées à l'édition :

| Canal | Longueur maximale | Notes |
|---|---|---|
| Email d'ouverture | 90 mots | Objet obligatoire, une seule question |
| Email de relance | 70 mots | Reprend le fil, ne répète pas l'ouverture |
| Note d'invitation LinkedIn | 45 mots | Ou aucune note — meilleur taux d'acceptation sur les profils de direction |
| Message LinkedIn | 60 mots | Angle différent de l'email |
| Courrier | 120 mots | Une page, signature manuscrite |

Règles imposées au générateur, quel que soit le canal :

- Citer explicitement la raison du contact — le signal avec sa date, ou le contexte de la liste
- **Interdiction absolue d'inventer un fait** sur l'entreprise ou la personne. Si le contexte ne le contient pas, ne pas l'écrire.
- Un seul appel à l'action, formulé comme une question
- Pas de superlatif, pas de « j'espère que vous allez bien », pas de flatterie
- Sortie relue par un humain lors du rodage

## Trois langues

Français, anglais, néerlandais. La partie visible est l'interface ; la partie qui compte est **le message**. Un contact flamand doit recevoir du néerlandais.

### Interface

`next-intl`, messages dans `packages/i18n/messages/{fr,en,nl}.json`. Aucune chaîne en dur dans un composant. Langue choisie par l'utilisateur dans son profil, valeur par défaut de l'organisation en repli.

Les manifests de providers exposent des clés de traduction, pas des libellés — c'est ce qui permet à l'écran de configuration de se générer dans les trois langues.

### Contacts

`contacts.locale` est déduit dans cet ordre :

1. Pays du compte : `BE` → néerlandais si la région ou le code postal est en Flandre, français sinon ; `FR` → français ; `NL` → néerlandais ; autre → anglais
2. Langue déclarée du profil LinkedIn quand elle est disponible
3. Valeur par défaut de l'organisation

Modifiable à la main sur la fiche contact. La Belgique est le cas qui casse les heuristiques naïves : traiter Bruxelles comme francophone par défaut, avec un avertissement dans l'interface invitant à vérifier.

### Messages

Une famille de templates porte une variante par langue. Au rendu, la variante correspondant à `contacts.locale` est choisie.

**Variante manquante = action bloquée**, motif `missing_locale`. On n'envoie jamais du français à Anvers par défaut. L'éditeur affiche les trois onglets de langue avec un indicateur clair de ce qui manque, et propose une traduction assistée — relue avant enregistrement, jamais publiée automatiquement.

### Formats

Dates, nombres et devises localisés via `Intl`. Les fuseaux horaires suivent le contact, pas l'organisation : la fenêtre d'envoi de 9 h – 18 h s'entend chez le destinataire.
