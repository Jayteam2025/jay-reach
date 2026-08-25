# 09 — Maquettes

`maquettes/jay-reach-mockups.html` s'ouvre dans un navigateur. La barre de gauche navigue, **Campagnes → Ouvrir** entre dans le détail, les onglets fonctionnent, le clic sur une étape ouvre la modale de message, le bouton d'import ouvre la modale d'import.

Ce n'est pas du code à copier : c'est une référence d'intention. Réimplémenter en React avec les tokens de `08-design-system.md`.

## Le modèle mental

L'unité qu'on ouvre le matin est la **campagne**. Elle porte ses chiffres, ses contacts, sa séquence, sa file d'attente, son journal.

Les écrans transverses — signaux, prospects, boîte de réception — existent pour ce qui traverse plusieurs campagnes.

## Écran par écran

### Dashboard

Quatre chiffres, une courbe, un anneau, deux listes.

Métriques : réponses, réponses positives, signaux qualifiés, et **délai médian signal → premier contact**. Cette dernière est propre à Jay Reach : c'est la seule qui mesure ce que le produit prétend améliorer. Une prospection par signal qui contacte à J+9 ne vaut pas mieux qu'une liste achetée.

Aucun montant de pipeline, jamais. C'est un calcul de CRM.

### Campagnes

Cartes avec nom, état, et quatre chiffres : contactés sur total, envoyés, taux d'acceptation, réponses. Les deux derniers en lime — ce sont les seuls qui disent si ça marche.

Une barre de progression montre la part du vivier traitée. À 30 % avec un bon taux, on pousse la cadence ; à 95 %, on élargit la source.

Une carte pointillée « Importer un fichier » termine la grille.

### Campagne — détail

Sept onglets. **Séquence** par défaut.

Les étapes sont des lignes repliées : numéro, titre, première ligne du message en italique, chiffres, canal. Clic → modale avec le message complet, l'objet quand c'est un email, les variables cliquables, la contrainte de longueur, la condition de déclenchement, et les statistiques de l'étape.

Le délai est un champ éditable entre deux étapes, avec la condition de branchement en lime.

Colonne de droite : bloc « ont répondu » avec photos, dernières réponses qualifiées, entonnoir par étape. On y voit que l'étape 3 ne touche que 53 personnes sur 197, parce qu'elle dépend de l'acceptation LinkedIn.

### Signaux

Trois états n'existent que sur cet écran et le justifient :

- **écarté par règle**, avec le motif et un bouton pour rétablir — c'est là qu'on découvre qu'un filtre est trop agressif ;
- **sans campagne** — un signal bien noté qu'aucune campagne ne prend, avec un bouton pour en créer une ;
- **à arbitrer** — entreprise non résolue.

Sans cet écran, une source qui se dégrade reste invisible jusqu'à ce que le flux se tarisse.

### Prospects

Tableau de séquence en mono, temps écoulé depuis le signal, étape en cours en lime. Contacts avec photo, nom cliquable et icône LinkedIn.

### Modale d'import

Zone de dépôt, mapping des colonnes avec exemple de valeur, compte rendu **avant** validation (412 lignes → 398 uniques, 14 fusionnées), trois destinations possibles, et coût d'enrichissement affiché avant de le lancer.

Deux détails à ne pas perdre : la fusion des doublons est annoncée avant l'import, pas après ; et le coût est affiché avant, jamais découvert sur la facture.

## Reste à maquetter

Boîte de réception, écran personas, configuration d'une source avec historique d'exécution, écran providers, assistant de première configuration, onglets Vue d'ensemble / Sources et personas / Activité / Paramètres. Suivre les mêmes conventions ; en cas de doute, reproduire la densité et la hiérarchie des écrans existants.
