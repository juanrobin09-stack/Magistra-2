# Politique de sécurité

Magistra est un logiciel gratuit pour les enseignants, maintenu bénévolement. Merci de nous aider à protéger leurs données.

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique** pour une faille de sécurité : elle serait visible de tous avant d'être corrigée.

Contactez directement l’éditeur à [juanrobin89@gmail.com](mailto:juanrobin89@gmail.com), l’adresse de contact publiée dans les mentions légales. Le dépôt de code est privé ; n’envoyez aucun détail de vulnérabilité dans les espaces publics de téléchargement.

Merci d'indiquer :
- le composant concerné et la version de Magistra (Réglages, ou numéro de l'installateur) ;
- les étapes pour reproduire, et l'effet obtenu (ce qu'un tiers peut lire, modifier ou exécuter) ;
- si possible, une piste de correction. Ne joignez ni vraies données d'élèves, ni clés ou jetons réels.

## Ce que vous pouvez attendre de nous

Magistra n'a pas d'équipe de sécurité dédiée ; voici nos objectifs, tenus au mieux :
- **accusé de réception** sous 7 jours ;
- **première évaluation** (confirmée ou non, gravité estimée) sous 14 jours ;
- **correctif** dans une nouvelle version dès que possible, selon la gravité : les failles graves d'abord ;
- **divulgation coordonnée** : nous vous demandons de ne rien publier avant la mise à disposition d'un correctif (90 jours au plus, sauf accord). Avec votre accord, vous êtes cité dans les notes de version.

Il n'y a pas de programme de récompense.

## Versions prises en charge

Seule la **dernière version publiée** de l'application Windows et du site reçoit des correctifs de sécurité. Une version plus ancienne se met à jour en installant la dernière version (Réglages → À propos → « Rechercher une mise à jour »).

## Périmètre

Magistra est une **application Windows locale** : le produit, c'est elle. Le **site public** n'en est que la vitrine (page statique : présentation, téléchargement, pages légales ; aucun compte, aucune application dans le navigateur, aucune donnée d'enseignant).

Dans le périmètre :
- l'**installateur et l'application Windows** (Electron, protocole `app://`, données locales, fusibles, mise à jour manuelle) ;
- le **site vitrine** : le site statique, ses en-têtes de sécurité (CSP stricte, sans script en ligne ni domaine tiers), et ses deux seules fonctions publiques, `GET /api/windows-release` et `GET /telecharger` (redirection vers l'installateur) ;
- le **connecteur local** de l'application Windows (échanges interface web ⇄ application, appairage, contrôle de l'origine) : c'est la **surface résiduelle** de l'application : elle écoute sur `127.0.0.1` tant que l'option « Permettre au site Magistra d'utiliser l'IA de cet ordinateur » (Réglages) est cochée, même si le site vitrine public ne l'utilise pas ;
- l'**hébergement personnel avancé**, pour qui l'utilise (hors site public) : serveur autonome, API `/api/*`, authentification Clerk, stockage Supabase, limites d'usage ;
- la **chaîne de publication** (workflows GitHub Actions, dépendances).

Hors périmètre : failles des services tiers eux-mêmes (Clerk, Supabase, Vercel, GitHub, Ollama, fournisseurs d'IA) — à signaler à leurs éditeurs ; qualité ou exactitude des textes générés par l'IA ; attaques supposant un ordinateur déjà compromis ou un accès physique ; déni de service par simple volume de requêtes ; absence de signature de code de l'installateur (connue et documentée).

## Ce que Magistra fait pour votre sécurité

- Le **site vitrine** n'a ni compte, ni base de données, ni clé d'IA : ses deux fonctions publiques ne lisent que le dépôt des versions et, facultativement, un jeton GitHub en lecture seule, qui n'est envoyé qu'à `api.github.com` (jamais au navigateur ni aux journaux). Sa politique de sécurité du contenu n'autorise que le site lui-même (et des images et polices `data:`), aucun script en ligne ni domaine tiers ; seuls les styles en ligne sont tolérés.
- Dans l'**hébergement personnel avancé**, la **clé de l'IA** (`AI_API_KEY`) et la clé « service_role » de Supabase restent sur le serveur : jamais dans le navigateur ni dans l'application Windows.
- Le **connecteur local** n'écoute que sur l'adresse de bouclage (`127.0.0.1`), refuse toute origine ou tout hôte inattendu, et n'accepte que cinq opérations Magistra, après l'accord de l'enseignant.
- L'application Windows durcit Electron (fusibles : pas de `runAsNode`, chargement depuis l'archive intègre uniquement ; isolation du contexte et bac à sable). La CI vérifie ces réglages sur le paquet construit.
- Aucun téléchargement de plusieurs Go sans l'accord explicite de l'utilisateur ; les messages d'erreur n'affichent ni trace d'exécution, ni secret, ni jeton.
- Les dépendances sont auditées en CI (`npm audit`, audit spécifique d'Electron) et mises à jour chaque semaine par Dependabot ; les actions de publication sont épinglées par SHA de commit.

Détails techniques : [ARCHITECTURE_IA.md](ARCHITECTURE_IA.md#19-connecteur-local-site-web--ia-de-lordinateur) (§ 19).
