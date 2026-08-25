# CLAUDE.md — Jay Reach

Instructions permanentes. Lis ce fichier en entier au début de chaque session, avant toute action.

## Le produit

Jay Reach est un moteur de prospection multicanale, self-hosted, publié en source ouverte. Il détecte des occasions de contacter une entreprise, enrichit les bonnes personnes, et déroule une séquence email + LinkedIn + courrier manuscrit.

Deux natures de sources alimentent la même machine :
- **Les signaux** — événements datés détectés automatiquement (offre d'emploi, nomination, salon).
- **Les listes** — fichiers importés ou constitués à la main (directeurs commerciaux d'une verticale, contacts d'un salon).

Édité par HEY JAY SAS. Jay Reach est un produit distinct de Jay : aucune dépendance de code, aucun token de design partagé. Le lien est commercial (un lien discret vers Jay dans le pied de page) et technique dans un seul sens (Jay Reach expose une API que Jay CRM consomme, comme n'importe quel CRM tiers).

## Ce dépôt n'est pas vierge

**Du code existe déjà et fonctionne. Ces documents décrivent la cible, pas une table rase.**

Cette documentation vient se poser sur une base existante — connecteurs de collecte, enrichissement, scoring, intégration d'envoi. Une partie tourne aujourd'hui en production sur la prospection réelle de l'éditeur.

Règles qui en découlent, sans exception :

1. **Ne rien supprimer sans l'avoir classé.** Le ticket T0 audite l'existant et produit un verdict module par module. Aucune suppression avant validation humaine de ce rapport.
2. **Migrer plutôt que réécrire quand le module fonctionne.** Un code peu élégant qui traite correctement les cas réels vaut mieux qu'une réécriture propre qui les redécouvre un par un.
3. **Toute connaissance encodée dans l'existant est un actif** : listes d'exclusion, paramètres d'API qui marchent, règles de parsing éprouvées, prompts itérés, messages ayant obtenu des réponses. Extraire d'abord, jeter ensuite.
4. **Ne jamais interrompre ce qui tourne.** Si un module est en usage réel, sa refonte se fait derrière un drapeau de fonctionnalité, avec l'ancien chemin conservé jusqu'à validation du nouveau.
5. **En cas de divergence entre le code et ces documents**, ce sont ces documents qui font foi pour la cible — mais l'écart est signalé dans `QUESTIONS.md` avant d'être corrigé, car il révèle parfois un cas réel que la spécification a oublié.

## Périmètre actuel : le self-hosted uniquement

La v1 vise l'auto-hébergement — usage propre de l'éditeur et co-constructeurs open source. Chaque organisation branche ses propres comptes providers et paie ses propres consommations.

**L'offre hébergée n'est pas au périmètre.** Ne pas coder de facturation, d'abonnement, de période d'essai, de compteur de sièges ni de credentials mutualisés. Ces sujets viendront dans un jalon ultérieur, et une partie du contenu de la page commerciale les anticipe — elle ne fait pas foi.

## Comment travailler sur ce dépôt

**Tu ne poses pas de question bloquante.** Le paquet de documentation est conçu pour que chaque décision soit déjà prise. Si une situation n'est pas couverte :

1. Choisis l'option la plus conservatrice — celle qui n'envoie rien, ne dépense rien, ne supprime rien.
2. Écris la question et ton choix dans `QUESTIONS.md`, sous le ticket concerné.
3. Continue le ticket.

`QUESTIONS.md` est relu par un humain en fin de jalon. Ne t'arrête que sur les tickets marqués **STOP** dans le backlog.

**Un ticket = une PR.** Suis `docs/12-backlog.md` dans l'ordre. Pas de refonte opportuniste hors périmètre. Chaque ticket se termine par : tests verts, documentation à jour, `CHANGELOG.md` complété.

## Règles non négociables

1. **L'approbation se règle par canal, et le courrier n'est jamais négociable.** Email et LinkedIn partent automatiquement par défaut. Le courrier passe systématiquement par la file d'attente. Les trois premiers envois d'un couple template + version passent aussi par la file, quel que soit le canal.
2. **Une variable non résolue bloque l'envoi.** Jamais de message expédié avec un `{{champ}}` vide ou littéral. L'action part en file avec le champ manquant nommé.
3. **Aucun secret en clair en base.** Credentials chiffrés via `pgcrypto`, clé hors base. Jamais de clé dans un log ni dans une réponse d'API.
4. **Tout provider externe passe par une interface.** Aucun appel direct à Smartlead, Unipile, Manuscry, Apify, FullEnrich ou Anthropic hors de `packages/providers/*`.
5. **Multi-utilisateurs dès le schéma.** Chaque table métier porte `organization_id`. RLS activée partout. Le worker utilise la clé de service et doit donc filtrer explicitement par organisation dans chaque requête.
6. **TypeScript strict.** Pas de `any`, pas de `@ts-ignore`. Zod sur toute donnée entrante : API, webhooks, réponses providers, fichiers importés.
7. **Trois langues dès le premier écran.** Français, anglais, néerlandais. Aucune chaîne en dur dans un composant.
8. **Une étape d'appel n'envoie rien.** Le canal `call` crée une tâche datée, dans Jay Reach et poussée vers le CRM. Il ne consomme aucun quota d'envoi, ne passe par aucune validation, et n'appelle aucun provider sortant.
9. **Une réponse ne doit jamais passer inaperçue.** Toute réponse humaine déclenche une notification. Le délai entre la réponse d'un prospect et le moment où l'utilisateur l'apprend est une métrique du produit, pas un détail d'implémentation.

## Stack imposée

- Next.js 15, App Router, React Server Components par défaut
- TypeScript strict, pnpm workspaces
- Supabase self-hosted : Postgres, Auth, Storage, Realtime
- Migrations SQL versionnées via Supabase CLI, types générés
- `pg-boss` pour les jobs de fond et la planification
- Tailwind + shadcn/ui, thème Jay Reach (`docs/08-design-system.md`)
- `next-intl` pour l'internationalisation
- Vitest (unitaire) + Playwright (parcours critiques)
- `docker compose up` doit suffire à démarrer une instance complète

## Conventions

- Interface et documentation produit en français, puis traduites. Code, tables, commits en anglais.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Server Actions pour les mutations, Route Handlers pour les webhooks entrants et l'API publique.
- Pas de `useEffect` pour du chargement de données. RSC ou React Query.
- Les tests couvrent en priorité : la state machine du séquenceur, les quotas, la résolution de variables, les règles d'arrêt.

## Ce qu'il ne faut pas faire

- Ne pas coder de client SMTP maison. Smartlead gère l'email en v1.
- Ne pas scraper LinkedIn en direct (Puppeteer, cookies bruts, extension). On passe par un provider tiers assumé.
- Ne pas stocker un message de boîte de réception qui ne correspond à aucun contact connu.
- Ne pas inventer de fonctionnalité absente du backlog.
- Ne pas générer de fixtures avec de vraies personnes ou de vraies entreprises.
- Ne jamais afficher un chiffre que Jay Reach ne mesure pas réellement.
