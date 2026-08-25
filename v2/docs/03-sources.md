# 03 — Sources : signaux et listes

## Partie A — Connecteurs de signaux

### Qu'est-ce qu'un bon signal

Quatre critères. Un connecteur qui n'en satisfait pas trois ne mérite pas d'être écrit.

1. **Daté** — on sait quand l'événement s'est produit. La fraîcheur est la moitié de la valeur.
2. **Public** — collecté sur une source ouverte, citable sans mettre le destinataire mal à l'aise.
3. **Causal** — l'événement rend un besoin plus probable, ce n'est pas une corrélation.
4. **Adressable** — on peut remonter à une entreprise identifiable et à une personne responsable.

### Anatomie d'un connecteur

```
packages/providers/signals/<id>/
  index.ts        implémentation du SignalProvider
  manifest.ts     id, clés i18n, configSchema Zod, freshnessWindowDays
  normalize.ts    fonction pure raw → Signal, testée
  fixtures/       échantillons de réponses réelles anonymisées
  README.md       source, limites de taux, coût, fragilité connue
  __tests__/
```

`normalize` doit être pur et testé sur les fixtures. C'est ce qui casse quand la source change de format, donc c'est ce qui doit hurler en intégration continue.

### `jobboard` — offres d'emploi

- **Sources** : API France Travail (officielle, gratuite, à privilégier), Adzuna en complément, Apify pour les sources sans API.
- **Configuration** : mots-clés d'intitulé, codes ROME, zone géographique, taille d'entreprise, fraîcheur maximale.
- **Extraction** : intitulé, entreprise, lieu, date de publication, description, type de contrat.
- **Piège majeur** : les cabinets de recrutement et agences d'intérim publient pour le compte de tiers et polluent massivement. Liste d'exclusion par SIREN et par code NAF (7830Z, 7820Z, 7810Z), plus détection par modèle sur la description.
- **Second piège** : la même offre est publiée sur cinq agrégateurs. Déduplication par empreinte (entreprise normalisée + intitulé normalisé + code postal) sur 30 jours glissants.
- `freshnessWindowDays` : 30.

### `appointment` — nominations et mouvements

Un décideur qui vient de prendre son poste dispose de 90 jours pendant lesquels il a mandat de changer les choses et aucun attachement au parc d'outils existant. Meilleur signal du lot, le plus difficile à collecter proprement.

- **Sources par ordre de qualité** : annonces légales (changements de dirigeant, fiable et licite) ; presse professionnelle et rubriques nominations via flux RSS ; communiqués d'entreprise ; changements de poste LinkedIn.
- **Sous-connecteur LinkedIn** : désactivé par défaut, limité au réseau du compte connecté, avertissement explicite dans l'interface. La collecte massive de profils est juridiquement exposée.
- **Extraction** : personne, nouveau poste, entreprise, date d'effet, poste précédent.
- **Piège** : distinguer nomination, promotion interne et simple mise à jour de titre. Le modèle tranche avec un seuil de confiance ; en dessous, arbitrage humain.
- `freshnessWindowDays` : 60.

### `tradeshow` — salons professionnels

Un exposant a un budget engagé, un objectif daté et une équipe mobilisée. La liste des exposants est publique.

- **Sources** : listes d'exposants publiées, catalogues en ligne, Apify pour les sites sans structure exploitable.
- **Extraction** : nom du salon, dates, numéro de stand, exposant, secteur, site web.
- **Spécificité** : deux fenêtres d'usage opposées, modélisées par `timing_mode`.
  - `pre_event` — contact avant, pour un rendez-vous sur place, entre J-30 et J-10.
  - `post_event` — contact après, sur le bilan, entre J+3 et J+15.

  `occurred_at` porte la date du salon. C'est le seul connecteur où le signal peut être dans le futur : le code doit le supporter, et l'interface afficher « dans 59 j » plutôt que « il y a 59 j ».

### Qualification

Trois filtres en cascade, du moins cher au plus cher :

1. **Règles** — fraîcheur, exclusions NAF, listes noires, géographie. Rejet immédiat, coût nul.
2. **Résolution d'entreprise** — voir `01-architecture.md`. Un signal non résolu ne va pas plus loin.
3. **Scoring par modèle** — appelé seulement sur les survivants. Prompt configurable par source, versionné, sortie JSON stricte :

```json
{ "score": 0, "reason": "une phrase", "persona_hint": "…", "confidence": 0.0 }
```

Tout changement de prompt est tracé dans `audit_events`, sinon on ne comprend plus pourquoi le scoring a dérivé.

### Ajouter un connecteur

```bash
pnpm reach:scaffold signal <id>
```

Implémenter `discover` et `normalize`, ajouter au moins trois fixtures et leurs tests, enregistrer dans `registry.ts`, documenter la source et ses conditions d'utilisation. **Aucune modification de `packages/core` ne doit être nécessaire.** Si elle l'est, c'est l'interface qui est mal conçue.

### Connecteurs à documenter comme « contributions bienvenues »

Levées de fonds, ouvertures d'établissement, appels d'offres publics, dépôts de marques, déménagements de siège, changements de statut juridique, publication de comptes annuels, obtention de certifications.

---

## Partie B — Import de fichiers et listes

### Ce qu'est une liste

Un ensemble de contacts réunis par un contexte commun plutôt que par un événement : « directeurs commerciaux de la distribution alimentaire », « rencontrés au salon Produrable ». La liste est stable, le signal est périssable — mais l'un et l'autre alimentent la même machine.

`context_note` est **obligatoire**. C'est la raison d'être de la liste, et elle devient la variable `{{contexte}}` dans les messages. Une liste sans contexte produit des messages sans motif de contact, c'est-à-dire du spam.

### Parcours d'import

1. **Dépôt** — CSV ou XLSX, 5 000 lignes maximum par fichier. Encodage détecté automatiquement, UTF-8 et Latin-1 supportés, séparateur détecté (`,` `;` tabulation).
2. **Mapping** — proposé automatiquement par correspondance floue sur les en-têtes, dans les trois langues (`Prénom` / `First name` / `Voornaam` → `first_name`). L'utilisateur corrige. Une colonne non mappée est ignorée, pas devinée.
3. **Champs reconnus** : `first_name`, `last_name`, `email`, `job_title`, `company`, `linkedin_url`, `phone`, `city`, `postal_code`, `country`, `siren`, `website`.
4. **Validation** — lignes sans nom **et** sans email rejetées, listées dans un rapport téléchargeable.
5. **Résolution d'entreprise** — même pipeline que les signaux. Non résolue : le contact est créé, le compte reste `unresolved`, arbitrage proposé.
6. **Déduplication** — clé de correspondance : email en minuscules, puis URL LinkedIn normalisée, puis nom + entreprise normalisés. Un doublon est **fusionné**, jamais dupliqué. Les champs vides sont complétés, les champs remplis ne sont jamais écrasés par l'import.
7. **Compte rendu avant validation** — « 412 lignes, 398 uniques, 14 fusionnées, 6 rejetées, 34 emails manquants ». Affiché avant l'import définitif, pas après.
8. **Enrichissement optionnel** — proposé avec son **coût estimé en euros**, jamais lancé sans accord explicite. Découvrir la facture après coup est le meilleur moyen de faire désinstaller le produit.
9. **Destination** — trois choix :
   - créer une nouvelle campagne à partir de cette liste,
   - ajouter à une campagne existante,
   - importer sans inscrire.

### Règles de sécurité à l'import

- Un contact présent dans les suppressions est importé mais marqué `do_not_contact` et jamais inscrit.
- Un contact appartenant à une entreprise cliente n'est pas inscrit, et le compte rendu le signale.
- Un contact déjà en séquence active dans une autre campagne n'est pas inscrit une seconde fois ; il est listé dans le compte rendu.
- L'import ne déclenche jamais d'envoi immédiat : la campagne démarre à l'heure de la fenêtre configurée.
- Le fichier d'origine n'est pas conservé après traitement. Seul `list_members.raw_row` garde la ligne, dans le périmètre de la politique de rétention.

## Partie C — Import des clients actuels

Un import à part, avec une finalité opposée : ces contacts ne sont pas là pour être démarchés, mais pour ne jamais l'être.

### Pourquoi c'est indispensable

Prospecter à froid une entreprise déjà cliente est la faute la plus embarrassante que l'outil puisse commettre. Elle arrive une fois, et le commercial désinstalle. Aucun outil sérieux ne peut s'en passer.

### Ce qu'on importe

- clients actifs et anciens clients
- affaires en cours dans le CRM
- prospects déjà travaillés par un collègue
- comptes stratégiques réservés à une approche directe
- concurrents et partenaires, si l'utilisateur le souhaite

### Le point qui compte : exclure au niveau du compte

L'exclusion porte sur **l'entreprise**, pas seulement sur les contacts importés. Si Groupe Vantel est client, aucun de ses salariés n'entre en séquence — y compris ceux qu'on n'a jamais vus et qui apparaîtront dans un signal futur.

Correspondance dans cet ordre : SIREN, puis domaine web, puis nom normalisé avec seuil de similarité. Les correspondances floues incertaines partent en arbitrage plutôt que d'exclure à tort.

### Deux modes d'alimentation

**Fichier** — CSV ou XLSX, mêmes parsers que l'import de prospection. Colonnes minimales : nom d'entreprise, ou SIREN, ou domaine. Les colonnes de contact sont optionnelles.

**Synchronisation CRM** — via `CrmProvider`, une lecture périodique qui rafraîchit la liste. C'est le mode à privilégier : une liste importée une fois se périme en trois mois.

### Comportement

- Un signal concernant une entreprise exclue est marqué `discarded` avec le motif **affiché en clair** : « Groupe Vantel figure dans votre liste clients », jamais un simple « écarté ».
- L'utilisateur peut lever l'exclusion contact par contact, avec confirmation explicite.
- Retirer une liste retire toutes les suppressions issues de cet import — et uniquement celles-là, grâce au champ `origin`. Les désinscriptions réelles ne sont jamais touchées.
- L'écran Signaux dispose d'un filtre « écartés — clients existants » pour vérifier que le filtre ne mange pas trop large.

## Partie D — Opposition légale à la prospection

L'annuaire des entreprises françaises expose un indicateur d'opposition à l'utilisation commerciale des données : un dirigeant peut demander que sa société ne fasse pas l'objet de démarchage.

Cet indicateur est récupéré au moment de la résolution d'entreprise et stocké dans `accounts.prospecting_opposition`. Lorsqu'il est actif, une suppression de portée `account` est créée automatiquement, avec l'origine `sirene_opposition`.

**Ce filtre n'est pas désactivable, par aucune configuration.** C'est trois lignes de code qui protègent l'utilisateur d'un manquement facile à lui reprocher, et c'est exactement le genre de détail qui distingue un outil sérieux d'un scraper.

L'interface affiche le motif en clair sur le signal écarté, avec un lien vers l'explication.

