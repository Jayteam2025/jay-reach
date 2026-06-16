> **Français** | [English](SECURITY.en.md)

# Politique de sécurité

## Signalement des vulnérabilités

La sécurité est une priorité pour Jay Reach. Si vous découvrez une vulnérabilité, nous vous demandons de la signaler **en privé** et ne pas l'ouvrir dans une issue publique.

### Comment signaler

**Option recommandée** : Utilisez les GitHub Security Advisories du dépôt
- Allez à l'onglet **Security** du dépôt
- Cliquez sur **Report a vulnerability**
- Décrivez la vulnérabilité de manière détaillée

**Alternative** : Envoyez un email à **hey@jay-assistant.fr** avec :
- Description de la vulnérabilité
- Étapes pour la reproduire
- Impact potentiel
- Votre nom et contact pour coordonner la correction

### Responsabilité

- Nous investiguerons chaque rapport sérieusement
- Nous vous tiendrons au courant des progrès
- Nous vous créditerons dans les corrections (sauf si vous demandez l'anonymat)
- Nous publierons un correctif dès que possible

### Délais raisonnables

Donnez-nous **90 jours** pour préparer et publier un correctif avant toute divulgation publique.

## Versions supportées

Seule la branche `main` est actuellement supportée. Les correctifs de sécurité sont appliqués directement sur cette branche.

## Prévention des failles courantes

Jay Reach suit les bonnes pratiques de sécurité :

- **Row-Level Security (RLS)** activée sur toutes les tables Supabase
- **Validation des inputs** via Zod
- **Pas de secrets committé** (clés API, tokens, mots de passe)
- **HTTPS obligatoire** pour les redirections externes
- **Authentification JWT** sur tous les endpoints Edge Functions

Pour en savoir plus, consultez notre documentation de sécurité dans `docs/`.

---

Merci de nous aider à garder Jay Reach sécurisé.
