# 10 — Conformité

Jay Reach traite des données personnelles pour de la prospection B2B en France, en Belgique et aux Pays-Bas. Contrainte de conception, pas finition — et argument commercial face aux outils américains.

Ce document décrit ce que le logiciel doit implémenter. Il ne constitue pas un avis juridique : les choix de traitement relèvent de l'utilisateur qui déploie l'instance, et une revue par un juriste est recommandée avant tout usage en production.

## Qui est responsable de quoi

Jay Reach est self-hosted. **L'utilisateur qui déploie l'instance est responsable de traitement.** HEY JAY édite le logiciel et n'héberge, ne voit ni ne traite aucune donnée. À écrire noir sur blanc dans le README : cela protège l'éditeur et informe correctement l'utilisateur.

## Ce que le logiciel fournit

### Base légale et traçabilité

- Chaque source déclare sa base légale (intérêt légitime, en pratique) et son origine
- Chaque contact conserve `source_signal_id` ou `source_list_id` : on doit toujours pouvoir répondre à « d'où vient cette personne »
- Registre de traitement pré-rempli, exportable, adaptable

### Information des personnes

- Chaque message sortant identifie l'expéditeur et la finalité
- Lien de désinscription en un clic dans les emails, **non contournable par configuration**
- Page d'information générée par l'instance, dans les trois langues, dont l'URL est insérable dans les templates

### Droits des personnes

Écran dédié, accessible aux rôles `admin` et `owner` :

- **Accès** — export complet des données d'une personne en JSON, en une action, fils de discussion inclus
- **Effacement** — suppression réelle, avec inscription automatique en liste de suppression pour éviter une re-collecte au prochain passage. C'est le point que la plupart des outils ratent : ils effacent, puis re-collectent la même personne trois semaines plus tard.
- **Opposition** — arrête immédiatement toute inscription en cours et bloque toute inscription future
- **Rectification** — édition directe sur la fiche

Cible : une demande traitable en moins de cinq minutes.

### Minimisation

- Ne collecter que les champs déclarés utiles par la source
- **Adresse postale collectée uniquement si une étape courrier existe** dans la séquence
- Adresses professionnelles exclusivement, jamais de domicile
- Aucune donnée sensible, quelle que soit la source
- Purge automatique selon la politique de rétention de `02-data-model.md`

### Boîte de réception — la règle qui compte

Connecter une boîte professionnelle à un outil de prospection n'est acceptable qu'à une condition : **rien n'est stocké qui ne concerne un contact déjà connu**. Un message dont aucun participant ne correspond à un contact de l'organisation est ignoré et ne laisse aucune trace, pas même en cache.

Cette règle fait l'objet d'un test explicite, et elle est annoncée à l'utilisateur au moment de la connexion.

### Sécurité

- Credentials chiffrés au repos
- Aucune coordonnée dans les logs applicatifs
- Journal d'audit sur les accès aux données personnelles
- Sauvegardes chiffrées, procédure documentée dans le guide d'installation

## Prospection B2B — les trois pays

Le cadre est proche mais pas identique. À respecter dans les templates livrés par défaut :

- Objet correspondant au contenu, sans tromperie
- Expéditeur identifiable, adresse valide et surveillée
- Motif de contact explicite — c'est précisément ce que permet la prospection par signal : « vous recrutez un commercial itinérant depuis le 12 août » est un motif, pas un prétexte
- Désabonnement fonctionnel et honoré immédiatement

Aux Pays-Bas, le régime de prospection électronique est plus strict que le régime français, y compris en B2B. L'écran de configuration d'une campagne ciblant les Pays-Bas affiche un avertissement invitant à vérifier le cadre applicable. Ne pas prétendre trancher à la place de l'utilisateur.

## Courrier postal

Régime distinct de l'email. Deux exigences produit :

- Le scope `postal` existe dans les suppressions : quelqu'un qui demande à ne plus recevoir de courrier doit pouvoir être enregistré. C'est le canal le plus intrusif, il doit avoir sa porte de sortie.
- Le courrier porte les coordonnées de l'expéditeur permettant de s'y opposer.

## LinkedIn

À écrire dans le README et à afficher au moment de connecter un compte :

- Les API utilisées ne sont pas officielles
- L'automatisation contrevient aux conditions d'utilisation de la plateforme
- Le risque de restriction ou de suspension est réel et assumé par l'utilisateur
- Le mode manuel existe précisément pour ceux qui ne veulent pas le prendre

Ne pas minimiser. Un projet qui le dit clairement inspire plus confiance qu'un projet qui l'enterre en note de bas de page.

## Ce que Jay Reach ne fera pas

Refus structurels, à afficher comme des choix :

- Pas de revente ni de redistribution de données personnelles
- Pas de base de contacts pré-constituée livrée avec le produit
- Pas de collecte de données sensibles
- Pas de contournement d'un mécanisme d'opposition
- Pas de mode « ignorer la liste de suppression », sous aucune configuration
- Pas de stockage d'un message sans rapport avec un contact connu
