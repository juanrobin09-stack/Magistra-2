# Référencement Google de Magistra

## Ce que produit le build

`npm run build:site` compile la vitrine, pré-rend son contenu React puis vérifie les fichiers avant publication.

- Les 14 pages indexables sont l’accueil, le répertoire `/guides` et les 12 guides français. Leurs titres, textes et liens, ainsi que les FAQ des pages concernées, sont disponibles immédiatement dans le HTML, même sans JavaScript. Le navigateur hydrate le même contenu ; aucun traitement différent des robots.
- Chaque page possède un titre, une description, une URL canonique et des métadonnées Open Graph/Twitter propres. Les guides couvrent des besoins distincts : cours, TD, examens, adaptations, syllabus, PDF scannés, IA locale, clés API, installation, mises à jour et vérification des sources. La gratuité de l’application et les éventuels frais API sont distingués, sans promesse de classement.
- Les URL canoniques correspondent aux URL du sitemap et des schémas JSON-LD. Les trois pages légales ont leurs propres métadonnées et `noindex, follow` ; elles restent liées depuis le site.
- `robots.txt` laisse explorer le contenu public et annonce `/sitemap.xml`. Le sitemap contient les 14 pages indexables et découle des données éditoriales, sans inclure les pages légales ou la page 404.
- Un favicon PNG à URL stable et une image sociale de partage accompagnent les métadonnées Open Graph/Twitter.
- À l’accueil, le JSON-LD décrit `WebSite` et `SoftwareApplication`, avec un prix de 0 EUR. Le répertoire utilise `CollectionPage`, `ItemList` et `BreadcrumbList` ; chaque guide utilise `Article` et `BreadcrumbList`, en accord avec le contenu visible. Aucun avis, score ou date artificielle n’est ajouté. Le balisage ne garantit pas un résultat enrichi ; les FAQ servent aux lecteurs sans promesse d’affichage enrichi.
- Les chemins inconnus renvoient la page statique `404.html` avec le statut 404 fourni par Vercel. Les anciennes routes de l’application redirigent vers l’accueil.
- Les réponses de téléchargement et de l’API portent `X-Robots-Tag: noindex, nofollow, nosnippet`.
- Les polices de la vitrine utilisent leurs sous-ensembles latins auto-hébergés. Aucune mesure d’audience ni cookie supplémentaire.

## Publication dans le dépôt existant

Dépôt : `juanrobin09-stack/Magistra-2`. Branche de collaboration : la branche commune du dépôt. La production Vercel inspectée utilise `master`.

Reprendre les derniers changements distants avant intégration ; ne pas forcer l’envoi. Fusionner la branche commune dans `master`, puis vérifier que le déploiement Vercel attendu est `READY`.

Les guides, leur répertoire et leur navigation appartiennent au site public. L’application Windows n’embarque pas ces nouveaux textes. Un déploiement du site seul ne met pas à jour les applications installées et ne nécessite pas une nouvelle version de l’installateur. Les textes existants de l’accueil restent partagés avec l’application ; toute modification destinée aux applications installées passe par le circuit de reconstruction et de publication habituel. Voir [referencement.md](referencement.md) pour la couverture éditoriale et la procédure de maintenance.

Commandes de validation :

```sh
npm run build:site
npx vitest run tests/site tests/shared/site.test.ts tests/server/deploy.test.ts
npx playwright test --project=site
```

La CSP autorise les empreintes exactes des JSON-LD de chaque page, en plus des scripts du site. Après modification des métadonnées ou des schémas dans `shared/siteSeo.ts` ou `shared/siteGuides.ts`, exécuter `node scripts/sync-site-csp.mjs` pour synchroniser ces empreintes dans `vercel.json`, puis reconstruire le site. Le pré-rendu et les vérifications contrôlent la même sérialisation. Ne pas ajouter `unsafe-inline` à `script-src`.

## État du suivi au 12 octobre 2026

La propriété Search Console **Préfixe de l’URL** `https://www.mag-istra.fr/` est connectée et validée depuis le 12/10/2026. La production utilise un jeton réel fourni par `SITE_GOOGLE_VERIFICATION`, sans valeur écrite en dur dans le dépôt.

Le sitemap `https://www.mag-istra.fr/sitemap.xml` a été soumis à cette propriété et lu avec succès le 12/10/2026 : Search Console affiche **Opération effectuée** et **14 pages découvertes**. Le test de l’URL active confirme également l’exploration autorisée et la récupération réussie. Cela prouve la lecture du sitemap, sans prouver l’indexation des 14 pages ; suivre les rapports de Search Console pour distinguer découverte et indexation effective.

Les pages ont également été notifiées à IndexNow, avec une réponse HTTP **202**. Cette réponse confirme la réception de la notification pour traitement, pas l’indexation. La commande de notification et les contrôles préalables sont décrits dans [referencement.md](referencement.md).

## Valider le site dans Google Search Console : procédure propriétaire

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

Contrôler les réponses et leurs statuts : les 14 pages indexables répondent 200 avec leur contenu HTML complet, leur titre, leur description et leur canonique distincts ; les pages légales répondent 200 avec leur canonique et noindex ; robots et sitemap répondent 200 ; une URL inexistante répond 404 ; les anciennes routes de l’application et le domaine sans www redirigent vers leur destination canonique. Vérifier aussi les liens internes, les schémas JSON-LD, les aperçus sociaux et les affichages mobile et bureau. Le bouton de téléchargement doit conserver sa redirection vers l’installateur public.

Références officielles :

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=fr
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=fr
- https://developers.google.com/search/docs/appearance/structured-data/software-app?hl=fr
- https://support.google.com/webmasters/answer/9008080?hl=fr
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl?hl=fr
