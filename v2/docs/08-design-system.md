# 08 — Système de design

Jay Reach est un produit distinct de Jay. **Aucun token, aucune couleur, aucune police du Jay Design System ne doit apparaître ici.** Si du violet `#8B5CF6` ou de l'Outfit se retrouve dans le code, c'est une erreur à corriger.

## Direction

Chronométrage sportif et dossard de course. Pas cyberpunk, pas terminal de hacker. La référence est un panneau d'affichage de temps intermédiaires : très lisible, très factuel, une couleur haute visibilité qui marque ce qui compte.

## Couleurs

Thème **clair**, sobre. Source unique : `apps/web/app/styles/jetons.css`, aucun composant ne porte de valeur hexadécimale.

| Token | Valeur | Usage |
|---|---|---|
| `--jr-fond` | `#F3F5F3` | Fond de page |
| `--jr-surface` | `#FFFFFF` | Cartes, tiroirs, menus |
| `--jr-encre` | `#1A2622` | Texte principal |
| `--jr-secondaire` | `#63736D` | Texte secondaire, métadonnées, légendes |
| `--jr-filet` | `#DCE2DE` | Bordures, séparateurs |
| `--jr-accent` | `#146C5A` | Accent principal : action primaire, valeurs actives |
| `--jr-accent-doux` | `#E2F0EA` | Fonds teintés de l'accent |
| `--jr-accent-encre` | `#FFFFFF` | Texte posé sur l'accent |
| `--jr-bon` / `--jr-bon-doux` | `#1F7A4D` / `#E6F3EC` | Réussi, livré |
| `--jr-attention` / `--jr-attention-doux` | `#B7791F` / `#FBF1DE` | À surveiller |
| `--jr-erreur` / `--jr-erreur-doux` | `#B4423A` / `#F9E6E4` | Erreur, quota dépassé, arbitrage requis |
| `--jr-linkedin` / `--jr-linkedin-doux` | `#0A66C2` / `#E7EEF9` | Canal LinkedIn |
| `--jr-voile` | `rgba(20, 30, 26, 0.28)` | Voile derrière tiroirs et modales |

**La règle de l'accent :** il signale ce qui est **vivant ou actionnable**. Campagne active, action primaire, étape en cours. Ce qui est inerte, passé, planifié ou neutre reste en encre ou en secondaire. Une seule action primaire en accent plein par vue ; les autres boutons sont en contour ou neutres.

**L'erreur est réservée à ce qui exige une action immédiate** : erreur fournisseur, quota dépassé, contact à arbitrer. Une absence détectée n'est pas une urgence.

Un seul thème : le mode sombre n'existe pas.

## Typographie

| Rôle | Police | Usage |
|---|---|---|
| Interface | **Instrument Sans** (`--jr-police`) | Titres, corps, libellés, textes. `display` n'est qu'un alias du corps |
| Données | **Geist Mono** | Compteurs, scores, montants, pourcentages, codes courts |

Chargées via `next/font` (`apps/web/app/fonts.ts`) : self-hébergées, aucun appel externe à l'exécution.

Le mono n'est pas décoratif : il porte ce qui est mesuré.

Tailles (jetons) : titre 24 px (`--jr-titre`), corps 14 px (`--jr-corps`), petit 12,5 px (`--jr-petit`). Casse phrase partout, capitales réservées aux codes courts en mono.

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
