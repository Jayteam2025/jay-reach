# 08 — Système de design

Jay Reach est un produit distinct de Jay. **Aucun token, aucune couleur, aucune police du Jay Design System ne doit apparaître ici.** Si du violet `#8B5CF6` ou de l'Outfit se retrouve dans le code, c'est une erreur à corriger.

## Direction

Chronométrage sportif et dossard de course. Pas cyberpunk, pas terminal de hacker. La référence est un panneau d'affichage de temps intermédiaires : très lisible, très factuel, une couleur haute visibilité qui marque ce qui compte.

## Couleurs

| Token | Hex | Usage |
|---|---|---|
| `--lime` | `#C6FF3D` | Accent principal, série de graphique 1, actions, valeurs actives |
| `--volt` | `#EDFF66` | Survol et focus du lime |
| `--lime2` | `#8FCB2E` | Série 2, icônes de lien |
| `--lime3` | `#4E7A1C` | Série 3, états passés |
| `--limeghost` | `rgba(198,255,61,.12)` | Fonds teintés |
| `--limeline` | `rgba(198,255,61,.32)` | Bordures teintées |
| `--ink` | `#0A130E` | Fond de page |
| `--slate` | `#18271F` | Cartes |
| `--slate2` | `#243629` | Bordures, séparateurs |
| `--slate3` | `#31473A` | Bordures fortes, survol |
| `--chalk` | `#EEF3E9` | Texte principal |
| `--moss` | `#8B9C91` | Texte secondaire |
| `--moss2` | `#65766B` | Métadonnées, légendes |
| `--flare` | `#FF5A1F` | Erreur, quota dépassé, arbitrage requis |

**La règle du lime :** il signale ce qui est **vivant ou réussi**. Campagne active, signal bien noté, réponse obtenue, valeur qui progresse, étape en cours. Ce qui est inerte, passé, planifié ou neutre reste en chalk ou en moss. Un lime posé sur un élément mort casse le code et rend l'interface illisible.

Une seule action primaire en lime plein par vue. Les autres boutons sont en contour lime ou neutres.

**Flare est réservé à ce qui exige une action immédiate.** Erreur provider, quota dépassé, contact à arbitrer. Une absence détectée n'est pas une urgence : elle porte un badge lime, pas du Flare.

Mode clair : non prioritaire. Tokens en variables CSS pour ne pas fermer la porte, mais ne pas concevoir deux thèmes en v1.

## Typographie

| Rôle | Police | Usage |
|---|---|---|
| Display | **Archivo** (variable, largeur 112–122, graisse 600) | Titres, chiffres clés |
| Corps | **Geist Sans** | Interface, libellés, textes |
| Données | **Geist Mono** | Chronos, scores, compteurs, montants, SIREN, pourcentages |

Chargées via `next/font` — aucun appel externe à l'exécution, condition d'un vrai self-hosted.

Le mono n'est pas décoratif : il porte tout ce qui est mesuré. Cette séparation stricte donne à l'interface son air d'instrument.

Échelle : 32 / 26 / 18 / 15 / 13 / 11 px. Interlignage 1,5 pour le corps, 1,15 pour le display. Casse phrase partout, capitales réservées aux codes courts en mono.

## Formes

- Rayon : 6 px pour les contrôles, 10 px pour les cartes, 14 px pour les modales, 999 px pour les puces d'état
- Bordures : 1 px `--slate2`. **Aucune ombre portée** — la hiérarchie passe par la surface
- Grille de 4 px

## Éléments signature

### Le tableau de séquence

Sur la fiche prospect, la séquence s'affiche comme un tableau de temps intermédiaires : une ligne par étape, temps écoulé depuis le signal en mono, étape en cours en lime, un filet vertical qui relie.

Ce n'est pas décoratif : c'est ce qui rend lisible la variable centrale du produit, le délai entre le déclencheur et le contact. Un email envoyé à J+2 et le même à J+21 ne sont pas le même email.

### La ligne d'étape

Dans l'éditeur de campagne, chaque étape est une ligne : numéro, titre, première ligne du message en italique, chiffres de l'étape, canal. Le clic ouvre une modale avec le message complet, modifiable.

Le délai et la condition se règlent **entre** deux étapes, sur une ligne dédiée, avec la condition en lime. Jamais dans un formulaire caché.

## Icônes

Aucune icône dans les tableaux et les listes. Les canaux sont des codes courts en mono — `EMAIL`, `LINKEDIN`, `COURRIER` — lisibles sans apprentissage.

**Une seule exception :** partout où un contact apparaît, son nom est un lien vers sa fiche, et une icône LinkedIn de 14 px en `--lime2` ouvre son profil dans un nouvel onglet (`target="_blank"`, `aria-label` nommant la personne). C'est un raccourci utilisé cent fois par jour. Un contact sans profil connu affiche « pas de profil » en gris, jamais une icône morte.

## Avatars

Photo de profil (`contacts.photo_url`, mise en cache locale) en cercle de 30 px. Repli automatique sur les initiales en mono lime sur fond `--limeghost` si l'image manque ou échoue à charger — ce qui arrivera pour tout contact dont on n'a que l'email.

## Écrans

| Écran | Contenu |
|---|---|
| Dashboard | Quatre chiffres, courbe d'activité, répartition par canal, signaux par score, signaux à traiter |
| Campagnes | Cartes avec quatre chiffres et barre de progression du vivier |
| Campagne · détail | Vue d'ensemble · Contacts · File d'attente · Sources et personas · Séquence · Activité · Paramètres |
| Signaux | Flux brut toutes campagnes, y compris écartés, sans campagne, à arbitrer |
| Prospects | Entreprise, contacts, signaux, tableau de séquence |
| Boîte de réception | Fils email et LinkedIn unifiés |
| Personas | Définition, intitulés, angle, campagne par défaut |
| Sources · Providers · Paramètres | Configuration |

La campagne est l'unité qu'on ouvre le matin. Les écrans transverses existent pour ce qui la traverse.

La file d'attente se pilote au clavier : `J` `K` naviguer, `A` approuver, `E` éditer, `R` reporter, `X` ignorer, `⌘↵` approuver et suivant. Raccourcis affichés sur les boutons.

## Écriture dans l'interface

- Verbe à l'infinitif sur les boutons : « Approuver l'envoi », pas « Valider »
- Un mot garde le même sens partout : un signal reste un signal, il ne devient jamais un lead
- Les erreurs disent ce qui s'est passé et quoi faire : « Le quota LinkedIn du jour est atteint. L'envoi repart demain à 9 h. »
- Les états vides sont une invitation, jamais un tiret : « Aucun signal pour l'instant. Ajoutez une source pour lancer la détection. »
- Pas de point d'exclamation, pas de félicitations automatiques
- **Aucun chiffre que Jay Reach ne mesure pas réellement.** Pas de pipeline en euros : ni les paniers moyens ni les taux de closing ne sont connus.

## Vocabulaire

| Terme | Sens |
|---|---|
| Signal | Événement daté détecté |
| Liste | Contacts réunis par un contexte commun |
| Campagne | Source + personas + séquence |
| Séquence | Suite ordonnée d'étapes |
| Étape | Un envoi sur un canal |
| Persona | Type d'interlocuteur ciblé |
| File d'attente | Actions en attente de validation |

« Leg », « relais », « lead » : à ne pas utiliser dans l'interface.

## Logo

Deux traits parallèles décalés qui suggèrent le passage de témoin, en lime sur ink. Monogramme pour les usages réduits. À produire en SVG : `logo.svg` et `mark.svg`.
