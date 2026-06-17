# ADR 0008 : Licence FSL-1.1-MIT (Functional Source License)

- **Statut** : Accepted (FSL-1.1-MIT pour Phase 2 public, propriétaire en Phase 1 privée)
- **Date** : 2026-05-19
- **Dernière mise à jour** : 2026-06-16
- **Decideurs** : Alexandre De Clercq, Jean-Baptiste Renart

## Phase actuelle (Phase 1 - Repo privé)

Le repo est **actuellement privé** sur GitHub. **Aucune licence OSS n'est active** :
- Terms GitHub standard pour repos privés
- CLA.md obligatoire pour les contributeurs (voir `/CLA.md`)
- Propriétaire : Jay Team (copyright notice dans les fichiers)

## Contexte

Le choix de licence pour le repo public Jay Reach est strategique. Trois contraintes coexistent :

1. **Maximiser l'adoption et les contributions** (modele Cal.com)
2. **Proteger la commercialisation imminente** (Jay Reach Cloud SaaS prevu Q3-Q4 2026)
3. **Eviter qu'un acteur etabli** (Clay, Apollo, Smartlead, AWS) **clone et revende** Jay Reach avant qu'on ait construit le brand et les premiers clients

MIT pure satisfait la contrainte 1 mais expose totalement aux contraintes 2 et 3. AGPL satisfait 2 et 3 mais effraie les contributeurs entreprise. Il faut un equilibre.

Le contexte est specialement adapte a une licence type "Delayed Open Source" / "Fair Source" :

- Les 13 personnes interessees au lancement sont toutes pour usage interne (prospection pour leur propre business, pas de revente)
- La fenetre critique de protection commerciale est de ~2 ans (le temps de lancer le SaaS, construire le brand, signer les premiers clients enterprise)
- Apres cette fenetre, on accepte que le code devienne pleinement open-source

## Decision

**FSL-1.1-MIT** (Functional Source License, variante MIT-converting).

Licence creee par **Sentry en novembre 2023**. Adoptee par Sentry, Keygen, GitButler, et un nombre croissant de SaaS open-source de 2024+.

### Principe en 3 points

1. **Pendant 2 ans apres chaque release**, le code est "source available" :
   - Tout le monde peut **lire, modifier, contribuer, self-host pour usage interne**
   - **Interdit** : "Competing Use" (offrir Jay Reach comme service commercial concurrent)
   - **Autorise** : tout autre usage commercial (integrer Jay Reach dans un produit qui n'est pas un competitor)

2. **Apres 2 ans automatiquement**, chaque release bascule en **licence MIT pure** :
   - Plus aucune restriction
   - Vrai open-source au sens OSI

3. **Chaque release a son propre compteur de 2 ans** : ce qu'on publie en juin 2026 devient MIT en juin 2028. Ce qu'on publie en juin 2027 devient MIT en juin 2029. Etc.

### Definition de "Competing Use"

La clause cle de FSL est la definition de "Competing Use", textuellement (FSL 1.1):

> "Competing Use" means use of the Software in or for a commercial product or service that competes with the Software or any other product or service we offer using the Software as of the date we make the Software available.

Concretement, pour Jay Reach :

| Usage | Autorise ? |
|---|---|
| Une PME utilise Jay Reach en interne pour sa prospection | Oui |
| Une agence marketing utilise Jay Reach pour ses propres campagnes | Oui |
| Un dev integre Jay Reach dans un CRM proprietaire qu'il vend | Oui (pas un competitor) |
| Un SaaS cree "ProspectPro" et heberge Jay Reach pour ses clients | **Non** (Competing Use) |
| AWS lance "AWS Reach" en hebergeant Jay Reach | **Non** (Competing Use) |
| Apres 2 ans : tous les cas ci-dessus | Oui (devient MIT) |

### Variante choisie : FSL-1.1-MIT vs FSL-1.1-Apache-2.0

On choisit **FSL-1.1-MIT** plutot qu'Apache pour :
- Conversion finale en MIT (plus simple, plus connu)
- Pas besoin des clauses brevets Apache (on n'a pas de brevets a defendre)
- Coherence avec l'ecosysteme JS/TS qui est majoritairement MIT

### Texte de la licence (a placer dans LICENSE racine du repo)

```
Functional Source License, Version 1.1, MIT Future License

Abbreviation
   FSL-1.1-MIT

Notice
   Copyright 2026 Jay (Jayteam2025)
   
   This Software is licensed under the terms below.
   
   Licensor: Alexandre De Clercq

Terms
   Jay Team grants you the right to use, copy, modify, create derivative
   works, publish, and redistribute the Software, in each case subject to
   the limitations and conditions below.

Limitations
   You may make use of the Software only for the Permitted Purpose.
   
   You may distribute the Software only under this License. You must
   include a copy of this License with any copy of the Software you
   distribute. You may not modify this License.
   
   Any trademarks, service marks, logos, or trade names included with the
   Software are the property of their respective owners. This License does
   not grant any right to use them.

Permitted Purpose
   A Permitted Purpose is any purpose other than a Competing Use.
   
   A Competing Use means use of the Software in or for a commercial
   product or service that competes with the Software or any other
   product or service Jay Team offers using the Software as of the date
   Jay Team makes the Software available.
   
   Permitted Purposes specifically include using the Software:
   - for your internal business operations
   - to develop a new product as long as such product is not a Competing Use
   - for research and development
   - to host or use the Software in any way that is not a Competing Use

Patents
   To the extent your use for a Permitted Purpose would infringe any
   patent claims Jay Team can license or becomes able to license, Jay
   Team grants you a non-exclusive, worldwide, royalty-free patent
   license under those claims, with the same scope and limitations as
   the license to the Software.

Redistribution
   The Terms apply to all copies, modifications, and derivatives of the
   Software.
   
   If you redistribute any copies, modifications, or derivatives of the
   Software, you must include a copy of or a link to this License and
   retain all copyright, patent, trademark, and attribution notices.

Disclaimer
   THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND,
   INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY OR FITNESS
   FOR A PARTICULAR PURPOSE.
   
   IN NO EVENT WILL JAY TEAM BE LIABLE TO YOU FOR ANY DAMAGES ARISING
   OUT OF THESE TERMS OR THE USE OR NATURE OF THE SOFTWARE.

Future License
   On the second anniversary of the date Jay Team makes any version of
   the Software available, that version automatically becomes available
   under the MIT License:
   
   MIT License
   
   Copyright 2026 Jay Team
   
   Permission is hereby granted, free of charge, to any person obtaining
   a copy of this software and associated documentation files (the
   "Software"), to deal in the Software without restriction, including
   without limitation the rights to use, copy, modify, merge, publish,
   distribute, sublicense, and/or sell copies of the Software, and to
   permit persons to whom the Software is furnished to do so, subject to
   the following conditions:
   
   The above copyright notice and this permission notice shall be
   included in all copies or substantial portions of the Software.
   
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Source officielle : https://fsl.software/

## Consequences

### Positives

- **Protection commerciale pendant 2 ans** : la fenetre exacte dont on a besoin pour lancer Jay Reach Cloud SaaS, construire le brand, signer les premiers clients enterprise
- **Esprit open-source preserve** : self-host, contributions, transparence, communaute, tout reste possible
- **Conversion automatique** en MIT apres 2 ans : pas besoin d'une decision future, le code finit pur open-source
- **Coherence avec l'ecosysteme 2024+** : Sentry, Keygen, GitButler ont valide ce modele
- **Acceptable pour les 13 personnes interessees** : toutes en usage interne, FSL ne les concerne pas
- **Defendabilite legale** : si un acteur clone et revend, on a une base solide pour cease & desist
- **Signal positif aux investisseurs** : montre qu'on a anticipe la protection IP

### Negatives

- **Pas reconnue OSI** (Open Source Initiative). Certaines entreprises avec politiques strictes "OSI-only" refuseront. Estimation : on perd 5-15% des prospects enterprise, marginal pour notre cible PME/ETI.
- **Plus jeune et moins connue que MIT** : on devra expliquer la licence dans le README, le CONTRIBUTING, et probablement dans plusieurs conversations. Cout pedagogique reel.
- **Reactions ideologiques** : les puristes OSS (RMS-style) considerent FSL comme "pas open-source". On aura des reactions hostiles potentielles sur HackerNews/Reddit. Cout reputationnel limite.
- **Definition "Competing Use" ambigue** dans les cas borderline. Un avocat pourra contester. Mitigation : on documente clairement notre interpretation dans une FAQ.
- **Moins de contributions enterprise spontanees** (juristes plus prudents). Mitigation : on fait le travail nous-memes au depart, contributions viendront avec la traction.

### Mitigations specifiques

**Pour le risque "definition Competing Use ambigue"** :
- Une FAQ publique dans `docs/LICENSE_FAQ.md` qui clarifie les cas typiques
- Un email dedie `license@jay-reach.com` pour les questions
- Pour les cas vraiment borderline (ex: une grande boite qui demande une exception), on peut accorder une exception ecrite

**Pour le risque "moins de contributions"** :
- Bonne documentation
- Bonus identification des contributeurs (HALL_OF_FAME.md)
- Possibilite de donner aux mainteneurs externes des privileges (commit access apres contributions)

**Pour le risque "reactions hostiles communaute OSS"** :
- Article de blog "Pourquoi FSL pour Jay Reach" qui explique la decision
- Documentation transparente sur les criteres
- Ouverture au dialogue, pas defensif

### Politique "Exceptions accordees"

On documente publiquement les exceptions accordees au cas par cas dans `docs/LICENSE_EXCEPTIONS.md`. Par exemple :
- Une universite qui veut utiliser Jay Reach pour la recherche
- Une ONG qui veut l'utiliser pour la collecte de fonds
- Un competitor qui demande politiquement (rarement, mais possible)

Ces exceptions sont accordees par decision du Jay Team, sous forme d'avenant ecrit.

## Alternatives reconsiderees

### Alt 1 : MIT pure (option initiale)

Rejetee. Ne protege pas du fork commercial pendant la fenetre critique de commercialisation.

### Alt 2 : Apache 2.0

Equivalent fonctionnel a MIT sur la protection (aucune). Rejetee pour les memes raisons que MIT.

### Alt 3 : AGPL v3

Considere serieusement. Protection forte contre fork SaaS (copyleft net). Mais :
- Plus restrictif sur le long terme (jamais "pleinement permissif")
- Effraie les contributeurs entreprise (juristes paniquent)
- Pas de conversion future en licence permissive
- Moins coherent avec l'ecosysteme 2024+ pour les SaaS

Rejetee. FSL offre la meme protection court-terme avec une trajectoire long-terme vers MIT.

### Alt 4 : BSL (Business Source License, MariaDB)

Tres proche de FSL. Differences :
- BSL est plus customisable (chaque editeur definit ses termes)
- BSL conversion peut etre vers n'importe quelle licence (pas obligatoirement MIT/Apache)
- FSL est standardisee, plus simple

Rejetee. FSL est plus claire et standardisee, meme but, meilleur outil.

### Alt 5 : Polyform (Strict, Shield, Free Trial, Perimeter, Small Business, Noncommercial)

Famille de licences source available. Trop fragmentee, moins de momentum. Rejetee.

### Alt 6 : Dual-license (FSL + Commercial)

Option valide mais ajoute de la complexite legale. Pour l'instant, on garde une seule licence (FSL). Si plus tard on a un besoin specifique enterprise (ex: une boite veut une licence "rien a voir avec OSS"), on pourra ajouter un dual-licensing.

## Contributors License Agreement (CLA)

On garde le CLA recommande precedemment (CLA Assistant) avec une mention explicite :

> "By contributing, you agree that your contribution can be used by the project under the Functional Source License (FSL-1.1-MIT), and that the project may relicense in the future under terms equivalent or more permissive."

Le CLA nous garde la flexibilite : si on veut un jour switcher en MIT pur avant les 2 ans (parce qu'on a reussi la commercialisation et qu'on veut maximiser l'adoption), on peut le faire sans avoir a re-licencier le code des contributeurs.

## Trademark "Jay Reach"

A faire en Phase 0 :
- Verifier disponibilite "Jay Reach" sur INPI, EUIPO, USPTO
- Deposer la marque (classes 9, 42 software/SaaS)
- Reserver les domaines et handles

La FSL ne donne aucun droit sur le trademark. Meme apres 2 ans (conversion MIT), le nom "Jay Reach" reste protege. Quelqu'un qui fork doit utiliser un autre nom.

## Mentions legales dans le repo

A la racine du repo :
- `LICENSE` (texte FSL-1.1-MIT integral)
- `NOTICE` (copyright, attributions tierces, mention CLA)
- `TRADEMARK.md` (politique d'usage du nom "Jay Reach")
- `CONTRIBUTING.md` (process contribution + CLA + reference licence)
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `docs/LICENSE_FAQ.md` (FAQ specifique FSL pour rassurer les utilisateurs)

Le README mentionne clairement :
> "Jay Reach is licensed under FSL-1.1-MIT. You can use it for internal business, modify it, contribute, and self-host. Each release automatically converts to MIT 2 years after publication."

## Roadmap re-evaluation

On revisite cette ADR :
- **Mois 6** apres lancement public : la decision FSL tient-elle ? Avons-nous des plaintes legitimes ?
- **Mois 18** : a 6 mois de la premiere conversion automatique en MIT, planifier la communication
- **Mois 24** : premiere conversion automatique. Annonce publique de la transition.

## Communication publique

Quand le repo deviendra public (Phase 2), on prepare :

1. **Section README "Why FSL?"** : 2 paragraphes pour expliquer
2. **Blog post "Why we chose FSL for Jay Reach"** : article approfondi, ton honnete sur les trade-offs
3. **FAQ commune** dans `docs/LICENSE_FAQ.md`
4. **Reponse-type aux objections** : on prepare des reponses pretes pour les commentaires HackerNews/Reddit

## References

- FSL official : https://fsl.software/
- Sentry FSL announcement : https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/
- Comparaison FSL vs autres licenses : https://fsl.software/#how-does-fsl-compare
- Adoption tracker FSL : Sentry, Keygen, GitButler, ConvertKit, et autres en 2024+
- HackerNews discussion FSL launch : feedback communaute mixte mais majoritairement positif

## Phase future (Phase 2+ - Repo public OSS)

À la transition vers le public (Phase 2), **FSL-1.1-MIT s'active automatiquement** :
- Le fichier `LICENSE` devient le texte FSL-1.1-MIT
- Tous les contributeurs passés et futurs sont couverts par FSL-1.1-MIT
- Conversion automatique en MIT license à partir de 2 ans après publication publique (par version)

---

## Addendum - Clarification Phase Privée vs. Phase Publique (2026-06-16)

En phase **privée actuelle** du dépôt (invite-only sur GitHub) :

1. **Aucune licence OSS n'est active** dans ce document. Les termes suivants s'appliquent :
   - Terms GitHub standard pour les repositories privés
   - Un accord collaborateur léger (NDA ou contrat signé par chaque contributeur)
   - Le CLA.md du projet (accepté électroniquement)

2. **Le CLA.md est obligatoire** pour toute contribution. Il stipule :
   > "By contributing, you agree that your contribution can be used by the project under the Functional Source License (FSL-1.1-MIT) at the time of public release, and that the project may relicense in the future under terms equivalent or more permissive."

3. **La FSL-1.1-MIT s'activera automatiquement** lors du basculement du dépôt en public (Phase 2). À ce moment :
   - `LICENSE-FSL.md` devient `LICENSE` (remplace le texte propriétaire)
   - Tous les contributeurs passés et futurs sont couverts par FSL-1.1-MIT
   - La conversion automatique en MIT commence à partir de la date de publication publique

### Rationale

Cette séparation protège le projet commercialement pendant le lancement privé (protection IP forte pendant 2 ans après la première release publique), tout en engageant une trajectoire transparente vers l'open-source pur à long terme.

### Q&A pour les contributeurs (Phase privée)

**Q: Est-ce que ma contribution est propriétaire à jamais ?**
Non. Le CLA garantit qu'au basculement public, elle passe sous FSL-1.1-MIT, puis en MIT après 2 ans.

**Q: Puis-je utiliser mon code ailleurs ?**
Oui, le CLA vous permet de :
- Garder une copie personnelle
- Citer votre contribution
Mais vous acceptez que le projet l'utilise sous FSL-1.1-MIT ultérieurement.

**Q: Et si je révoque mon accord ?**
Le CLA est irrévocable (standard légal). Mais vous pouvez demander un "expiration date" lors de la signature (ex: "ma contribution ne s'applique que jusqu'au 2026-12-31").

---

Cette clarification garantit la bonne foi entre les contributeurs et le project maintainers pendant la phase privée, tout en scellant l'engagement OSS pour la phase publique.

