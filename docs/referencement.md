# Référencement du site Magistra

Le site officiel est `https://www.mag-istra.fr`. Il publie 14 pages indexables : l'accueil, le répertoire `/guides` et 12 guides en français. Les pages légales et la page introuvable restent accessibles avec `noindex, follow`.

## Couverture éditoriale

Les guides répondent à des besoins distincts : choisir une IA gratuite pour enseignants ; préparer un cours ; créer des exercices et TD ; préparer examens et corrigés ; différencier un support ; construire un syllabus ou une progression ; lire des PDF scannés ; travailler avec une IA locale hors ligne ; configurer une clé OpenAI, Mistral, Gemini ou Anthropic ; installer Magistra sur Windows ; mettre à jour l'application ; vérifier les sources.

Chaque guide contient une méthode, un exemple concret, une FAQ et trois liens vers des sujets complémentaires. L'accueil présente six guides et donne accès au répertoire complet. Les informations sur les coûts API, la transmission des extraits au fournisseur et les limites de l'OCR correspondent au fonctionnement de l'application.

## Construction et maintenance

Les données éditoriales sont dans `shared/siteGuides.ts`. La liste du sitemap découle de ces guides ; les métadonnées et les schémas JSON-LD sont construits dans `shared/siteSeo.ts`. Les pages sont pré-rendues avec le même arbre React pour les visiteurs et les moteurs. L'application Windows n'embarque pas les textes de ces guides.

Pour modifier ou ajouter un guide :

1. Écrire un contenu distinct et utile, vérifier les fonctionnalités décrites et les liens connexes.
2. Exécuter `node scripts/sync-site-csp.mjs` si les métadonnées ou le schéma changent. Cette commande autorise uniquement les empreintes exactes du JSON-LD ; elle n'autorise aucun script exécutable en ligne.
3. Exécuter `npm run build:site`, puis les tests SEO/site et `npx playwright test --project=site`.
4. Publier les sources validées et vérifier les pages sur le domaine officiel.
5. Exécuter `node scripts/notify-search-engines.mjs --submit` pour notifier les pages indexables à IndexNow. Sans option, le script affiche un aperçu local et n'envoie rien. Il vérifie le fichier public de validation, les réponses HTTP, les liens canoniques et l'autorisation d'indexation avant toute notification.

Le pré-rendu doit toujours partir du gabarit neuf produit par Vite. Il refuse une entrée déjà enrichie, pour éviter de dupliquer les métadonnées. Le build contrôle toutes les pages, le sitemap, les images sociales, le fichier IndexNow et les injections de contenu.

## Découverte et suivi

Le sitemap est publié à la racine et déclaré dans `robots.txt`, suivant les [recommandations Google sur les sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap). Les URL canoniques sont absolues, uniques et identiques dans le HTML, le sitemap et les données structurées. Aucune date de modification automatique, note client, statistique d'utilisation ou avis fictif n'est ajouté.

Le fichier de validation IndexNow est public par définition. Il ne donne accès ni à un compte ni aux clés API des enseignants. Une réponse 200/202 confirme la réception de la notification, sans garantir l'indexation : [protocole IndexNow](https://www.indexnow.org/documentation).

Pour suivre les impressions, les clics, les requêtes et l'indexation Google, il faut une propriété Search Console vérifiée. Un jeton réel peut être fourni au build via `SITE_GOOGLE_VERIFICATION` ; ne pas inventer de jeton et ne pas ajouter de clé personnelle dans les sources. Le sitemap peut ensuite être soumis à cette propriété. Les classements et l'indexation effective restent décidés par les moteurs.

Les FAQ sont destinées aux lecteurs. Aucun affichage enrichi FAQ n'est promis. Pour les fonctionnalités de recherche IA de Google, les fondamentaux habituels restent applicables, sans fichier spécial obligatoire : [documentation Google](https://developers.google.com/search/docs/appearance/ai-features).
