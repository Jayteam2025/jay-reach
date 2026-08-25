# 13 — Notifications

## Pourquoi c'est un sujet de produit, pas une finition

Toute la valeur de Jay Reach tient dans le timing : on écrit au bon moment. Cette promesse s'effondre si un prospect répond à 9 h et que personne ne le voit avant 17 h.

Le délai entre la réponse d'un prospect et le moment où l'utilisateur l'apprend est donc une métrique du produit. Elle doit être proche de zéro.

## Deux canaux

| Canal | Usage | Latence |
|---|---|---|
| **Email** | Ce qui compte, même quand l'application est fermée | Immédiate ou groupée |
| **Notification bureau** | Ce qui compte pendant qu'on travaille — macOS, Windows, Linux | Immédiate |

### Notification bureau — mécanisme

Web Push standard : `Notification` API + service worker + protocole VAPID. C'est ce qui produit une **vraie notification système macOS**, dans le centre de notifications, même quand l'onglet est fermé — pas une bannière dans la page.

Contraintes à respecter :

- HTTPS obligatoire, y compris en développement (`localhost` est exempté)
- Manifest PWA et service worker enregistré
- Sur macOS, Safari exige que le site ait été ajouté au Dock ou que l'utilisateur ait explicitement autorisé les notifications ; Chrome et Firefox demandent simplement l'autorisation
- La demande d'autorisation ne se fait **jamais au premier chargement**. Elle est déclenchée par un bouton explicite dans les paramètres, après une phrase qui explique ce qu'on enverra. Une demande automatique se solde par un refus définitif dans la majorité des cas.
- Les clés VAPID sont générées à l'installation et stockées comme les autres secrets
- `push_subscriptions` est purgée des abonnements qui renvoient `410 Gone`

Un repli existe pour les instances sans HTTPS ou sans autorisation : une pastille en temps réel dans l'interface, alimentée par Supabase Realtime.

## Événements

| Événement | Défaut email | Défaut bureau | Contenu |
|---|---|---|---|
| `reply.positive` | Immédiat | Oui | Nom, entreprise, campagne, extrait du message, lien direct |
| `reply.neutral` | Immédiat | Oui | Idem |
| `reply.negative` | Groupé quotidien | Non | Idem |
| `call.due` | Groupé matinal | Non | Liste des appels du jour |
| `letter.pending` | Immédiat | Oui | Courriers à valider avant l'heure limite d'expédition |
| `source.failed` | Immédiat | Non | Source en échec, motif, lien vers Providers |
| `quota.reached` | Immédiat | Non | Canal concerné, reprise prévue |
| `action.blocked` | Groupé quotidien | Non | Nombre d'actions bloquées, motif dominant |
| `import.completed` | Immédiat | Non | Compte rendu de l'import |

Tout est réglable par utilisateur dans `notification_preferences`. Les valeurs ci-dessus sont les défauts, choisis pour qu'un nouvel utilisateur reçoive ce qui compte sans être noyé.

## L'email de réponse

Le seul qui compte vraiment. Il doit permettre de décider sans ouvrir Jay Reach.

**Objet.** `Sylvain Mercier (Groupe Vantel) a répondu`

Le nom et l'entreprise dans l'objet, rien d'autre. Pas de préfixe `[Jay Reach]`, pas d'emoji : cet email doit ressembler à une notification de messagerie, pas à une newsletter.

**Corps**, dans cet ordre :

1. Qui a répondu, son poste, son entreprise
2. **Le message reçu**, en entier s'il fait moins de dix lignes, tronqué sinon
3. Le motif du contact — le signal d'origine et sa date, ou le contexte de la liste
4. Ce qui a déjà été envoyé, en une ligne : « email J+0, invitation acceptée J+1, message LinkedIn J+3 »
5. Un bouton unique : **Répondre dans Jay Reach**
6. En pied : lien de réglage des notifications

Le point 3 est celui qu'on oublie. Trois semaines après le début d'une séquence, personne ne se souvient pourquoi ce contact a été démarché — et c'est précisément ce qu'il faut savoir pour bien répondre.

**Expéditeur.** L'instance envoie depuis sa propre adresse technique, jamais depuis le compte de prospection de l'utilisateur : une notification ne doit pas polluer la réputation d'un domaine d'envoi.

## Groupement

Une notification `instant` part dans la minute. Une notification `hourly` ou `daily` est accumulée puis envoyée en un seul email récapitulatif, trié par importance.

Règle anti-avalanche : jamais plus d'une notification bureau par minute et par utilisateur. Au-delà, elles sont fusionnées en « 4 nouvelles réponses ».

## Ce qu'on ne notifie pas

- Les ouvertures d'email. Le signal est bruité par les proxys de sécurité et notifier une ouverture entraîne à relancer trop tôt.
- Les envois réussis. C'est le fonctionnement normal.
- Les acceptations d'invitation LinkedIn, sauf si l'utilisateur l'active — elles arrivent par paquets.

Une notification qui se déclenche trop souvent est désactivée, et l'utilisateur perd aussi celles qui comptaient.
