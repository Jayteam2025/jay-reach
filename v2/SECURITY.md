# Politique de sécurité

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.**

Écrivez à `security@jay-reach.fr` avec :
- une description de la faille,
- les étapes pour la reproduire,
- l'impact que vous estimez,
- votre nom ou pseudonyme si vous souhaitez être crédité.

Réponse sous 72 heures. Nous vous tenons informé de l'avancement du correctif et publions un remerciement à la publication, sauf si vous préférez rester anonyme.

## Périmètre

Sont dans le périmètre : le code de ce dépôt, les images Docker publiées, l'API publique.

Sont hors périmètre : les services tiers (Smartlead, Unipile, Manuscry, enrichisseurs), et les instances déployées par des tiers que nous n'opérons pas.

## Ce que nous traitons en priorité

- Traversée d'organisation : accès à des données d'une autre organisation
- Fuite de credentials providers
- Contournement des garde-fous d'envoi
- Injection SQL, XSS, SSRF
- Élévation de privilège entre rôles

## Rappel aux personnes qui déploient Jay Reach

Vous êtes responsable de votre instance : rotation de vos clés, chiffrement de vos sauvegardes, mise à jour des images. `ENCRYPTION_KEY` ne doit jamais être committée ni stockée en base.
