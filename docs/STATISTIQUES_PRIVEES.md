# Statistiques privées de Magistra Windows

La version 2.0.11 prépare un suivi facultatif des installations participantes : activité quotidienne, activité mensuelle, ouvertures et retours. Aucun compte enseignant n'est créé. Les documents, consignes, réponses IA, clés API, noms, courriels et empreintes matérielles ne font pas partie du protocole. Les adresses IP ne sont ni lues ni enregistrées dans la base des statistiques ; les prestataires réseau peuvent les traiter dans leurs journaux techniques, comme indiqué dans la politique de confidentialité.

## Activation et accès propriétaire

Le tableau est servi par `/tableau-prive`, avec un export protégé `/api/usage-dashboard?format=json`. Le HTML et le JSON exigent une authentification HTTP Basic sur HTTPS, vérifiée avant tout accès à la base. Ils ne sont pas mis en cache et ne sont pas indexables. L'adresse du tableau seule ne donne aucun accès. Les identifiants ne doivent pas être partagés.

Cinq variables **serveur uniquement** sont nécessaires dans le projet Vercel Magistra-2 en production :

| Variable | Usage |
| --- | --- |
| `MAGISTRA_STATS_DATABASE_URL` | Connexion à la base dédiée, jamais dans une variable `VITE_` |
| `MAGISTRA_STATS_HASH_SECRET` | Secret aléatoire de déduplication, au moins 32 caractères |
| `MAGISTRA_STATS_OWNER_LOGIN` | Identifiant du propriétaire |
| `MAGISTRA_STATS_OWNER_PASSWORD_HASH` | SHA-256 hexadécimal d'un mot de passe aléatoire fort, généré avec 32 octets aléatoires |
| `CRON_SECRET` | Secret aléatoire distinct pour la maintenance quotidienne |

Les valeurs réelles ne figurent pas dans le dépôt, le site statique ou l'exécutable. Le fichier d'accès privé est conservé séparément, avec une ACL Windows limitée au propriétaire et à SYSTEM. Sans configuration, les lectures sont refusées et l'envoi reste réessayable, sans empêcher l'usage de l'application.

La base dédiée `magistra-usage-private` se trouve dans Neon, région Francfort, offre gratuite. Projet : `royal-dawn-71972082`. Branche de production : `br-polished-cell-b98rvwdx`. Une branche isolée `usage-validation` (`br-square-grass-b9eb80ze`) contient exclusivement les essais synthétiques. Elle n'est pas reliée à la collecte de production. Aucun abonnement payant ni changement de plan n'est requis par cette préparation ; les limites gratuites restent applicables.

Le schéma est `server/usage-schema.sql`, exécutable à nouveau sans réinitialiser les compteurs. Les tables activent RLS et révoquent les droits publics. Les fonctions utilisent les droits de l'appelant ; la lecture est `STABLE` et fonctionne dans une transaction en lecture seule.

Avant mise en service : installer les variables serveur, déployer le site, vérifier les refus 401 sans identifiants sur les deux routes de lecture, vérifier une lecture 200 avec les identifiants du propriétaire, puis publier l'installateur corrigé. Les anciennes installations n'envoient pas rétrospectivement des statistiques. La production doit rester vide pendant la validation : utiliser la branche isolée pour les essais.

## Définitions

| Statistique | Calcul |
| --- | --- |
| Actives par jour | Jetons de jour distincts pour lesquels une activité a été reçue, période UTC |
| Actives par mois | Jetons de mois distincts, comptés une seule fois dans le mois calendaire UTC ; ce n'est pas la somme des jours |
| Ouvertures | Nouveaux lancements affichés de l'application ; les clics, le focus et les reprises réseau ne sont pas des ouvertures |
| Moyenne des ouvertures | Ouvertures du mois divisées par les installations actives du même mois |
| Retour à 7 / 30 jours | Activité sur un autre jour entre J1 et J7 / J30 inclus après le premier usage mesuré, parmi les cohortes dont toute la fenêtre est terminée |

La date du premier usage et les drapeaux de retour sont calculés localement. Un retour dans les sept premiers jours compte aussi dans les trente premiers jours. Une cohorte récente reste en attente plutôt que d'être comptée comme un échec. Les taux de retour portent sur toutes les cohortes conservées arrivées à échéance ; le sélecteur de mois concerne l'activité et les ouvertures. Des rapports hors ligne peuvent encore compléter les agrégats dans les 35 jours suivant l'activité. Si le premier usage n'a jamais été acquitté et a expiré, les drapeaux de retour orphelins sont retirés pour ne pas produire un numérateur sans dénominateur.

Ces chiffres représentent des installations et profils locaux participants, pas des personnes uniques. Plusieurs ordinateurs, une réinstallation, un retrait puis un nouvel accord peuvent créer une nouvelle participation. Le compteur public de réception ne peut pas certifier qu'un rapport provient d'une personne : un client modifié peut fabriquer des jetons. Les contrôles de taille, format, périodes et déduplication limitent les erreurs ; ils ne promettent pas une mesure antifraude. Les téléchargements GitHub sont affichés séparément et comprennent les téléchargements répétés et mises à jour.

## Participation et conservation

La participation est désactivée par défaut. La proposition de l'application et le réglage de confidentialité permettent d'accepter, refuser ou retirer l'accord. Aucun événement de travail ni contenu de frappe n'est envoyé. Les interactions réelles servent uniquement à signaler une activité, sans leur contenu. Un test, un environnement de développement et les plateformes autres que Windows n'envoient rien.

Un jeton aléatoire change chaque jour et un autre change chaque mois. Ils sont envoyés dans des rapports distincts et transformés côté serveur par HMAC avec une séparation entre type et période. Aucun identifiant permanent ou lien entre les jetons quotidiens et mensuels n'est enregistré. Ce sont des données minimisées et temporaires, pas une promesse d'anonymat absolu.

Les rapports en attente sont bornés à 35 jours. Retirer l'accord annule les requêtes en cours, supprime la file locale et arrête les envois. Les agrégats déjà reçus n'ont pas de profil individuel permettant de retrouver et retirer une participation précise.

Les empreintes de déduplication expirent à la fin de la période, plus 46 jours : au plus 77 jours depuis leur création. Les agrégats expirent après 400 jours. Une maintenance Vercel quotidienne à `03:17 UTC`, compatible avec la fréquence Hobby, purge les données expirées ; la réception réalise également une maintenance limitée à une fois par jour. Le secret de maintenance est distinct du compte de lecture. En cas de suspension de l'hébergement ou d'échec du cron, la suppression physique reprend à la prochaine maintenance réussie ; les lectures excluent déjà les agrégats expirés. Un mois dont l'historique quotidien est partiellement expiré est signalé et sa moyenne est masquée.

## Validation

Les tests couvrent le refus par défaut, l'accord/retrait, la limitation du protocole aux compteurs, les origines, les corps surdimensionnés, l'IPC de confiance, les retries, les bornes hors ligne, les retours, le non-double-comptage, l'absence de cache et les refus d'accès. Le SQL est exécuté dans PostgreSQL embarqué PGlite, pas seulement simulé. Vingt écritures concurrentes ont aussi été validées sur la branche Neon isolée : un seul actif et vingt ouvertures pour le même jeton.

Commandes locales : `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:site`, `npm run build:electron`, `node scripts/verify-package.mjs`, puis `node scripts/electron-smoke.mjs --mock-ollama --generate`. Le smoke utilise un profil de test isolé et désactive l'envoi de statistiques.
