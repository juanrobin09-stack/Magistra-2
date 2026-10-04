# Référencement Google de Magistra

## Ce que produit le build

`npm run build:site` compile la vitrine, pré-rend son contenu React puis vérifie les fichiers avant publication.

- L’accueil contient immédiatement ses titres, sa présentation, ses liens et sa FAQ, même sans JavaScript. Le navigateur hydrate le même contenu ; aucun traitement différent des robots.
- Le titre et la description ciblent l’assistant IA gratuit pour enseignants. La gratuité, Windows et l’IA locale sont décrits sans promesse de classement.
- L’accueil a une URL canonique cohérente avec le sitemap. Les trois pages légales ont leurs propres métadonnées et `noindex, follow` ; elles restent liées depuis le site.
- `robots.txt` laisse explorer le contenu et annonce `/sitemap.xml`. Le sitemap contient uniquement l’accueil indexable.
- Un favicon PNG à URL stable et les métadonnées Open Graph/Twitter permettent les aperçus de partage.
- Le JSON-LD décrit `WebSite` et `SoftwareApplication`, avec un prix de 0 EUR. Aucun avis ou score n’est inventé. L’absence d’avis peut rendre l’application inéligible à certains résultats enrichis ; le balisage ne promet pas leur affichage.
- Les chemins inconnus renvoient la page statique `404.html` avec le statut 404 fourni par Vercel. Les anciennes routes de l’application redirigent vers l’accueil.
- Les réponses de téléchargement et de l’API portent `X-Robots-Tag: noindex, nofollow, nosnippet`.
- Les polices de la vitrine utilisent leurs sous-ensembles latins auto-hébergés. Aucune mesure d’audience ni cookie supplémentaire.

## Publication dans le dépôt existant

Dépôt : `juanrobin09-stack/Magistra-2`. Branche de collaboration : la branche commune du dépôt. La production Vercel inspectée utilise `master`.

Reprendre les derniers changements distants avant intégration ; ne pas forcer l’envoi. Fusionner la branche commune dans `master`, puis vérifier que le déploiement Vercel attendu est `READY`.

Les textes de l’accueil sont partagés avec l’application Windows. Le sélecteur de sources de l’application est également clarifié : recherche prévue avant génération, sources réellement utilisées dans le résultat. Le numéro de version reste inchangé dans ce correctif. Les utilisateurs déjà équipés ne recevront ces textes qu’après reconstruction et publication d’un installateur par le circuit habituel ; un déploiement du site seul ne met pas à jour les applications installées. Voir `SOURCES_VERIFICATION.md` pour le périmètre des vérifications.

Commandes de validation :

```sh
npm run build:site
npx vitest run tests/site tests/shared/site.test.ts tests/server/deploy.test.ts
npx playwright test --project=site
```

La CSP autorise uniquement l’empreinte exacte du JSON-LD, en plus des scripts du site. Si `SITE_STRUCTURED_DATA` change, `prerender-site.mjs` signale l’empreinte à reporter dans `vercel.json`. Ne pas ajouter `unsafe-inline` à `script-src`.

## Valider le site dans Google Search Console

1. Ouvrir https://search.google.com/search-console/welcome avec le compte Google du propriétaire.
2. Ajouter une propriété **Préfixe de l’URL** avec l’adresse canonique `https://www.mag-istra.fr/`.
3. Choisir **Balise HTML**. Copier uniquement la valeur `content` de la balise `google-site-verification` proposée par Google.
4. Renseigner cette valeur dans la variable de build Vercel `SITE_GOOGLE_VERIFICATION` pour la production, puis redéployer. Ce jeton est public ; ce n’est pas un mot de passe.
5. Vérifier que la balise apparaît dans le HTML de l’accueil, puis cliquer sur **Valider** dans Search Console.
6. Dans **Sitemaps**, envoyer `https://www.mag-istra.fr/sitemap.xml`.
7. Inspecter `https://www.mag-istra.fr/`, lancer le test de l’URL publiée puis demander son indexation.

Une propriété **Domaine** déjà validée convient aussi. La validation par balise HTML ne valide que le préfixe choisi. Ne pas supprimer les jetons d’autres propriétaires.

Google décide de l’indexation et du classement ; une demande d’indexation ne garantit ni délai ni première position. Suivre ensuite les rapports d’indexation, les requêtes et les performances dans Search Console. Les statistiques Search Console sont accessibles aux comptes autorisés, indépendamment des compteurs publics de téléchargement GitHub.

## Vérifications après publication

Contrôler les réponses et leurs statuts : accueil 200 avec contenu HTML complet, pages légales 200 avec leur canonique et noindex, robots et sitemap 200, URL inexistante 404, ancienne route de l’application redirigée, domaine sans www redirigé vers le domaine canonique. Le bouton de téléchargement doit conserver sa redirection vers l’installateur public.

Références officielles :

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=fr
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=fr
- https://developers.google.com/search/docs/appearance/structured-data/software-app?hl=fr
- https://support.google.com/webmasters/answer/9008080?hl=fr
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl?hl=fr
