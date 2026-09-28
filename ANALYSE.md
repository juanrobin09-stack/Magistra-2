# Analyse complète de Magistra : ce qui marche et ce qui ne marche pas

*Audit du 28/09/2026, fait sur le commit `24bc451` (« feat: convert magistra to Electron desktop app for Windows »).*

---

## 1. Verdict en bref

| | |
|---|---|
| ✅ **L'interface web fonctionne** | Le build passe, l'app se charge sans erreur console, et la navigation, l'onboarding, le dashboard, l'historique, les favoris, les réglages et le mode démo fonctionnent, sur desktop comme sur mobile (sauf la page Générer). |
| 🔴 **La génération IA réelle est cassée** | Le modèle codé en dur, `claude-sonnet-4-20250514`, est **retiré par Anthropic depuis le 15/06/2026**. Toute génération d'un utilisateur connecté échoue avec « Erreur lors de la génération. Réessayez. », sur le web comme sur Windows. |
| 🔴 **Aucune sécurité côté serveur** | Les endpoints `/api/*` font confiance au `userId` envoyé par le navigateur et utilisent la clé Supabase `service_role`. Quiconque connaît l'identifiant d'un enseignant peut lire, modifier ou supprimer ses contenus, ou générer à ses frais. |
| 🔴 **L'application Windows (Electron) ne démarre pas** | Elle plante à l'ouverture de la fenêtre (`__dirname` indéfini en ESM) et reste bloquée en mémoire. Même une fois ce bug corrigé, le preload ne se charge pas, donc aucun écran ne permet de saisir les clés API. |
| ⚠️ **Qualité** | ESLint échoue (8 erreurs). `api/` et `electron/` ne sont jamais typecheckés. Il n'y a aucun test ni CI, et npm audit signale 9 vulnérabilités (non exploitables en l'état). |

**La correction la plus rentable tient en une ligne** : remplacer le modèle par `claude-sonnet-4-6` (le remplaçant officiel) ou un modèle plus récent, idéalement dans une constante unique. Cela débloque le cœur du produit. La deuxième urgence est d'authentifier les appels API avec le jeton Clerk, avant toute mise en production.

---

## 2. Méthode

- **6 analyses parallèles**, une par sous-système : backend/API + SQL, Electron, génération IA et prompts, frontend, test E2E réel, outillage/dépendances. Chaque analyste a lu intégralement les fichiers de son périmètre et a exécuté du code quand c'était possible.
- **Tests réellement exécutés** :
  - l'app parcourue dans Chromium via Playwright (mode démo, puis mode connecté simulé avec l'API mockée) ;
  - les handlers `api/*.ts` compilés et appelés avec des requêtes simulées ;
  - le schéma SQL appliqué sur un PostgreSQL 16 local ;
  - Electron 33 lancé pour de vrai sous `xvfb`, et un paquet Linux construit avec electron-builder ;
  - build, lint, typecheck, `npm audit`.
- **Contre-vérification** : chaque problème a été vérifié par 2 agents indépendants, l'un chargé de le **réfuter**, l'autre de le **reproduire**. Aucun des 108 n'a été réfuté, mais 57 ont été nuancés : sévérité revue ou description corrigée. **La sévérité retenue est la plus basse des deux estimations**, pour ne pas surévaluer.
- **Passe de complétude** : un dernier agent a relu tout le repo pour chercher ce qui avait été oublié. Il a trouvé 17 problèmes supplémentaires, eux aussi vérifiés.
- **Le fait le plus lourd a été revérifié à la main** : la page officielle [model-deprecations](https://docs.claude.com/en/docs/about-claude/model-deprecations) indique bien `claude-sonnet-4-20250514 — Retired — April 14, 2026 / June 15, 2026`, avec pour remplaçant recommandé `claude-sonnet-4-6`, et précise : « Requests to retired models will fail ».

**Ce qui n'a pas pu être testé en conditions réelles** : aucune clé API n'était disponible pour Anthropic, Supabase et Clerk, qui ont donc été simulés. Le déploiement Vercel réel et l'installateur Windows (qui demande Windows ou wine) n'ont pas été testés non plus.

---

## 3. Tableau de bord

| Zone | État | Détail |
|---|---|---|
| Build web (`npm run build`) | ✅ | OK. Bundle principal de 916 kB, sans découpage par route |
| Build de prod + `vite preview` | ✅ | La SPA se charge |
| ESLint (`npm run lint`) | ❌ | 8 erreurs, plus 2 masquées dans DashboardPage |
| Typecheck `src/` | ✅ | OK |
| Typecheck `api/` + `electron/` | ❌ | Jamais exécuté (`tsconfig` n'inclut que `src/`), 7 erreurs cachées |
| Tests | ❌ | Aucun |
| CI | ❌ | Aucune (pas de `.github/`) |
| `npm audit` (prod) | ⚠️ | 9 vulnérabilités (2 critical, 5 high, 2 moderate), chemins vulnérables non utilisés, toutes corrigeables sans rupture |
| Interface (landing, onboarding, dashboard, navigation) | ✅ | 0 erreur console, responsive, hors page Générer |
| Mode démo (sans clé Clerk) | ⚠️ | Les 11 outils répondent, mais seuls 5 ont un vrai contenu, et rien n'est sauvegardé malgré le message « Sauvegardé » |
| Génération IA réelle | ❌ | Modèle retiré, donc 502 à chaque essai |
| Historique / Favoris (connecté) | ✅ | Fonctionnent, testés avec l'API mockée. Pas de gestion d'erreur |
| Export Markdown | ✅ | OK |
| Export PDF | ⚠️ | Le fichier est produit, mais le contenu est altéré (tirets, `>`, `*`, emojis, tableaux) |
| Authentification serveur | ❌ | Inexistante (userId déclaratif) |
| Schéma Supabase | ⚠️ | S'applique et correspond au code, mais la RLS est factice (`USING (true)`) |
| Déploiement Vercel | ⚠️ | Probablement fonctionnel. Pas de `maxDuration` pour des générations longues |
| Déploiement Netlify | ❌ | Aucune fonction `/api`, le backend n'existe pas |
| App Windows (Electron) | ❌ | Ne démarre pas |

---

## 4. ✅ Ce qui marche

### Build et infrastructure
- **Build web** : `tsc -b && vite build` réussit, et le build de prod se sert correctement avec `vite preview`.
- **Séparation des builds web et Electron** dans `vite.config.ts` : le plugin Electron n'est chargé que si `BUILD_TARGET=electron`.
- **Lockfile** cohérent et intègre.
- **Aucun secret dans l'historique git** : recherche de `sk-ant`, `eyJ`, `pk_live` et `service_role` sur tout l'historique.
- **Les clés Anthropic et `service_role` ne sont pas dans le bundle navigateur** : elles restent côté serveur.
- **Le build Vite Electron** produit bien `main.js` et `preload.mjs`, mais ils plantent à l'exécution (voir plus bas).

### Interface
- **Landing page** : rendu complet, 0 erreur console, pas de débordement horizontal sur desktop ni en 390 px.
- **Onboarding en 5 étapes** : validation par étape, sélection multiple, retour arrière, persistance en localStorage, puis redirection vers `/app`.
- **La garde d'onboarding** redirige `/app` vers `/onboarding` tant qu'il n'est pas fait.
- **Routes protégées en mode Clerk**, testées avec un mock de Clerk.
- **Dashboard** : salutation, stats calculées sur les vraies données (Aujourd'hui, Cette semaine, Favoris, Total), 6 outils rapides, suggestions, présélection via `?type=` et `?sujet=`.
- **Navigation** : sidebar, état actif, rafraîchissement direct d'une route profonde, route inconnue, boutons précédent/suivant.
- **Mobile** : menu hamburger, overlay, fermeture au clic sur un lien, bascule liste/détail dans Historique et Favoris.
- **Dropdowns `SelectField`** à la souris : groupes, fermeture au clic extérieur, filtrage des matières selon le niveau.
- **Réglages** : résumé du profil et « Reconfigurer mon profil ».

### Génération
- **Architecture claire du chemin réel** : `GeneratePage` → `apiGenerate` → `POST /api/generate` → `api/generate.ts` (Vercel) ou le serveur local d'Electron → Anthropic.
- **Les 11 outils ont un prompt système spécifique.** Ceux de Vercel et d'Electron sont identiques au caractère près (aux espaces de fin de ligne près).
- **Tous les champs du formulaire sont transmis** et utilisés dans le prompt.
- **La validation du formulaire par outil** (`canGenerate`) fonctionne.
- **Le chemin nominal du handler Vercel fonctionne**, testé avec Supabase et Anthropic simulés : création du profil, contrôle du quota, appel Anthropic, sauvegarde, incrément du compteur.
- **Les erreurs 429, 500 et 502 sont affichées** à l'utilisateur.
- **Mode démo** : les 11 outils produisent un résultat sans aucun appel réseau.
- **Le rendu Markdown ignore le HTML brut** : pas d'injection de script possible via le contenu généré.

### Données et exports
- **Historique** : liste, recherche, détail, favori, suppression, copie, export `.md`.
- **Favoris** : filtre et retrait.
- **Même source de données** pour Générer, Historique, Favoris et Dashboard en mode connecté.
- **Le schéma SQL** s'applique sur une base vierge et ses colonnes correspondent au code.
- **Export Markdown** et **copie dans le presse-papiers** fonctionnels.
- **Export PDF** : le fichier est généré, avec les accents Latin-1, un en-tête et la pagination multi-pages. Le contenu est toutefois altéré, voir plus bas.

---

## 5. ❌ Ce qui ne marche pas

> Les sévérités sont celles retenues après contre-vérification. La liste complète des 108 problèmes est en [annexe](#annexe--liste-complète-des-108-problèmes).

### 🔴 Bloquants (3)

**1. Toute génération IA réelle échoue : le modèle est retiré**
- **Où** : `api/generate.ts:429`, `electron/main.ts:155` (et `src/lib/ai.ts:197`, du code mort).
- `'claude-sonnet-4-20250514'` est codé en dur à trois endroits. Anthropic l'a retiré le 15/06/2026 et renvoie une erreur, que le serveur convertit en 502 générique. L'utilisateur voit « Erreur lors de la génération. Réessayez. » à chaque essai, pour les 11 outils, et la vraie cause n'apparaît que dans les logs serveur.
- **Correctif** : une constante unique (ou une variable d'env `ANTHROPIC_MODEL`) avec `claude-sonnet-4-6` ou plus récent. Il faut aussi journaliser `error.type`.

**2. Aucune authentification côté serveur (IDOR)**
- **Où** : `api/history.ts:25`, `api/delete.ts:14`, `api/favorite.ts:14`, `api/generate.ts:401`.
- Les 4 endpoints prennent `userId` dans la requête et interrogent Supabase avec la clé `service_role`, qui contourne la RLS. CORS est ouvert à `*`, et le client n'envoie aucun jeton.
- Il suffit donc de connaître l'identifiant Clerk d'un enseignant pour lire ses 100 dernières générations, supprimer ses documents, modifier ses favoris ou consommer son quota.
- **Correctif** : côté client, envoyer `Authorization: Bearer <getToken()>`. Côté serveur, vérifier ce jeton avec `@clerk/backend` et déduire `userId` du claim `sub`, en ignorant toute valeur envoyée par le client.

**3. L'application Windows plante au démarrage**
- **Où** : `electron/main.ts:293, 373, 380`.
- `package.json` déclare `"type": "module"`, donc le main est compilé en ESM, où `__dirname` n'existe pas. `createWindow()` lève une `ReferenceError`, aucune fenêtre ne s'ouvre, et le processus reste en mémoire en gardant le port 3721 et le verrou d'instance unique. Chaque relance échoue ensuite silencieusement.
- Reproduit avec le vrai Electron 33 et avec l'app packagée.
- **Correctif** : `const __dirname = path.dirname(fileURLToPath(import.meta.url))`, plus un `.catch` qui affiche l'erreur et quitte l'app.

### 🟠 Majeurs (4)

| # | Problème | Où | Correctif |
|---|---|---|---|
| 4 | **Endpoint de génération ouvert** : quota contournable en changeant de `userId` à chaque appel, pas de limite de taille des champs, CORS `*`. C'est un proxy Anthropic public, payé par le propriétaire de la clé. | `api/generate.ts:401` | Authentification (voir le point 2), limite par IP ou globale, bornes sur les champs, liste blanche pour type, niveau et matière |
| 5 | **Le preload Electron ne se charge jamais** : `main.ts` charge `preload.js`, mais le build produit `preload.mjs` au contenu CommonJS, refusé avec `sandbox:false`. `window.electronAPI` est donc indéfini et l'écran « Clés API » n'apparaît jamais : l'app desktop ne peut pas être configurée. | `electron/main.ts:373` | `sandbox: true` et `preload: 'preload.mjs'` (variante validée) |
| 6 | **Les tableaux Markdown ne s'affichent pas** : `react-markdown` est utilisé sans `remark-gfm`. Les déroulements minutés, barèmes et progressions exigés par les prompts s'affichent comme un paragraphe de barres verticales. | `GeneratePage.tsx:586`, `HistoryPage.tsx:134`, `FavoritesPage.tsx:102` | `npm i remark-gfm` et un composant `MarkdownView` partagé |
| 7 | **L'export PDF change le sens du contenu** : les regex globales transforment chaque `-` en `•` (« 2025•2026 », « •5 + 8 »), suppriment `>` (« Si x   3 ») et `*` (« 2  3  4 = 24 »). Une fiche de maths imprimée devient fausse. | `src/lib/export.ts:7-15` | Parser le Markdown, ou au minimum ancrer les regex en début de ligne |

### 🟡 Moyens (33)

**Sécurité**
- **RLS factice** : les 10 policies « own » sont en `USING (true)`, et la fonction `increment_usage` est exécutable par PUBLIC. Il n'y a aucune défense en profondeur si la clé anon est un jour utilisée (`supabase-schema.sql:57`).
- **Filtres PostgREST construits sans encodage** : `id` et `userId` sont concaténés tels quels dans l'URL. Un `#` dans `id` fait disparaître le filtre `user_id` (`api/delete.ts:19`, `favorite.ts:19`, `history.ts:30`, `generate.ts:58`).
- **Electron, serveur local sans authentification** : n'importe quel site web visité peut déclencher `POST http://127.0.0.1:3721/api/generate` (requête « simple » en `text/plain`) et consommer la clé Anthropic de l'enseignant. Le DNS rebinding permet même de lire les réponses (`electron/main.ts:325`).
- **Electron, path traversal** : `curl --path-as-is http://127.0.0.1:3721/../../../../Roaming/magistra-app/config.json` renvoie les clés en clair à tout processus local, par exemple une autre session Windows sur un PC partagé (`electron/main.ts:299`).
- **Electron, navigation non restreinte** : un lien dans le contenu généré fait naviguer la fenêtre vers le site externe, sans bouton Retour. Ce site accède alors au pont `electronAPI` (`getConfigRaw`), donc aux clés (`electron/main.ts:385`).

**Backend et génération**
- **Génération synchrone** (jusqu'à 8000 tokens) sans streaming, sans `maxDuration` Vercel et sans timeout ni annulation (`vercel.json`).
- **Quota non atomique** : des requêtes simultanées dépassent la limite de 20 par jour (`api/generate.ts:409`).
- **Génération payée perdue** : un échec de sauvegarde Supabase fait perdre une génération déjà facturée, et le type d'outil n'est pas validé avant l'appel Anthropic (`api/generate.ts:452`).
- **Un échec de `increment_usage` renvoie 500** alors que la génération est déjà sauvegardée (`api/generate.ts:467`).
- **`stop_reason` ignoré** : une réponse tronquée à `max_tokens` est sauvegardée et affichée comme complète (`api/generate.ts:443`).
- **Erreurs Anthropic non distinguées** : 401, 404, 429 et 529 deviennent toutes un 502 générique, sans nouvel essai (`api/generate.ts:436`).
- **Netlify documenté mais non fonctionnel** : il n'y a aucune fonction `/api` (`netlify.toml`).
- **Favoris limités** aux 100 dernières générations (`FavoritesPage.tsx:20`).

**Prompts et formulaire**
- **Appréciations** : le prompt système impose 10 appréciations alors que l'enseignant en demande N (`prompts.ts:152`).
- **Différenciation** : les profils d'élèves cochés sont ignorés, le prompt dit « produis 3 versions » (`prompts.ts:173`).
- **Paramètres parasites** : des champs masqués d'un outil précédent sont envoyés, et « Difficulté : moyen » est ajouté à tous les outils (`GeneratePage.tsx:78`).
- **Double soumission** : la touche Entrée relance une génération pendant qu'une autre est en cours (`GeneratePage.tsx:306`).
- **Profil enseignant jamais transmis aux prompts**, et partagé entre comptes car stocké dans un localStorage global (`useTeacherProfile.ts:12`).
- **Onboarding maternelle** : la matière `francais` est enregistrée par défaut même pour un niveau où elle n'existe pas (`OnboardingPage.tsx:33`).

**Interface**
- **Page Générer inutilisable sur mobile** : la colonne d'outils fixe de 220 px laisse un champ Sujet de 65 px et un résultat de 72 px de large (`GeneratePage.tsx:125`).
- **Aucune gestion d'erreur** dans Historique, Favoris et Dashboard : spinner infini, liste vide trompeuse, actions qui échouent en silence (`HistoryPage.tsx:18`).
- **Mode démo mensonger** : « Sauvegardé dans votre historique » s'affiche alors que rien n'est enregistré, et l'Historique reste vide à vie (`GeneratePage.tsx:591`). Pourtant, `storage.ts` contient un stockage localStorage complet, jamais utilisé.
- **Listes sans puces ni numéros** dans le contenu généré, à cause du preflight Tailwind (`index.css:131`).
- **Suppression sans confirmation** ni annulation (`HistoryPage.tsx:130`).
- **Export PDF** : un emoji ou un symbole mathématique corrompt toute la ligne, car la police Helvetica ne gère pas l'Unicode. Les tableaux et les titres sont perdus (`export.ts:13-20`).
- **Accessibilité** : boutons à icône seule sans nom accessible, et contrastes insuffisants (tokens `mg-400` à `mg-600`).

**Electron (au-delà des bloquants)**
- **Écran blanc** au rechargement (Ctrl+R) ou au retour de Clerk sur `/app/...` : vite-plugin-electron impose `base: './'` quand `vite.config.ts` n'en définit pas, et le serveur local renvoie `index.html` à la place du JS. Correctif : `base: '/'`.
- **Clerk en production** : les clés `pk_live` sont incompatibles avec `http://127.0.0.1:3721`, et le login Google est bloqué dans une fenêtre embarquée (`App.tsx:74`).
- **Génération impossible sans la clé Supabase `service_role`**, qu'il est dangereux de distribuer sur chaque poste (`electron/main.ts:134`).

**Légal et produit**
- **Affirmations non fondées** : « Open-source » sans fichier LICENSE, « RGPD compliant », « Aucune donnée élève collectée » (alors que les copies d'élèves à corriger sont envoyées à Anthropic, et que les appréciations générées sont stockées dans Supabase), « programmes 2026 intégrés ».
- **Aucun moyen de supprimer son compte ou ses données**, alors que le RGPD l'impose.

### ⚪ Mineurs (68)

En résumé :
- dépendances à nettoyer : `@supabase/supabase-js` et `file-saver` inutilisés, `@vercel/node` manquant, `@clerk/clerk-react` déprécié, Electron 33 en fin de vie ;
- du code mort, dont `ai.ts:generateContent`, `storage.ts`, et les prompts dupliqués dans `api/generate.ts` et `prompts.ts` ;
- un README obsolète, qui parle de la clé API « dans Réglages » et oublie les variables serveur ;
- un `.gitignore` qui n'ignore pas `.env` ;
- `tsconfig.tsbuildinfo` committé, et réécrit à chaque build ;
- un script SQL non idempotent ;
- plusieurs erreurs d'affichage du Dashboard : quota calculé depuis l'historique, « Matière phare » toujours à 0, stats plafonnées à 100 ;
- un `SelectField` sans ARIA ni navigation au clavier ;
- 6 outils sur 11 sans vrai contenu de démo ;
- et une dizaine de petits bugs Electron : port déjà occupé, JSON invalide, écrasement des clés, etc.

Le détail complet est dans l'annexe.

---

## 6. Plan de correction recommandé

| Priorité | Action | Effort | Débloque |
|---|---|---|---|
| **P0** | Remplacer le modèle par `claude-sonnet-4-6` ou plus récent, dans une constante partagée entre `api/generate.ts` et `electron/main.ts` | 10 min | **Le produit entier** |
| **P0** | Authentifier `/api/*` avec le jeton Clerk (`@clerk/backend`), valider et encoder `id`/`userId`, restreindre CORS au domaine de l'app | ½ journée | Sécurité des données et des coûts |
| **P1** | Quota atomique réservé *avant* l'appel Anthropic ; renvoyer le contenu même si la sauvegarde échoue ; gérer `stop_reason` ; `maxDuration` ou streaming | ½ journée | Fiabilité et coûts |
| **P1** | `remark-gfm`, styles des listes, réécriture de l'export PDF (parser le Markdown au lieu des regex) | ½ journée | Qualité du contenu pour les enseignants |
| **P1** | Electron : shim `__dirname`, puis preload (`sandbox:true` + `.mjs`), puis `base: '/'` | 1 h | L'app démarre |
| **P2** | Electron, **avant toute distribution** : jeton sur le serveur local (ou passage en IPC), correctif du path traversal, `will-navigate`, vérification de l'expéditeur IPC. Revoir aussi l'architecture qui impose une clé `service_role` sur chaque poste. | 1 journée | Sécurité desktop |
| **P2** | Page Générer responsive ; gestion d'erreur dans Historique, Favoris et Dashboard ; confirmation de suppression ; vraie persistance du mode démo via `storage.ts` | 1 journée | UX |
| **P2** | Transmettre les bons paramètres aux prompts : nombre d'appréciations, profils de différenciation, profil enseignant, pas de champs parasites | ½ journée | Pertinence pédagogique |
| **P3** | Corriger les 8 erreurs ESLint ; ajouter `api/` et `electron/` au typecheck ; CI GitHub Actions (lint, typecheck, build) ; premiers tests | 1 journée | Éviter les régressions |
| **P3** | `npm audit fix`, migration de `@clerk/clerk-react` vers `@clerk/react`, mise à jour d'Electron | ½ journée | Dépendances |
| **P3** | README à jour, LICENSE, retrait des affirmations non tenues, suppression de compte et de données (RGPD), vraie RLS Supabase | ½ journée | Conformité |

---

## Annexe : liste complète des 108 problèmes

**Sévérité** : 🔴 critique · 🟠 majeure · 🟡 moyenne · ⚪ mineure.

**Vérif** : `confirmé` = les deux vérificateurs confirment tel quel ; `confirmé*` = existence confirmée, mais sévérité ou description corrigée par au moins un vérificateur.

| # | Sév. | Catégorie | Problème | Fichier | Vérif |
|---|---|---|---|---|---|
| 1 | 🔴 | fonctionnalité cassée | Modèle claude-sonnet-4-20250514 retiré depuis le 15/06/2026 et codé en dur : toute génération IA réelle échoue | `api/generate.ts:429` | confirmé |
| 2 | 🔴 | sécurité | Aucune authentification réelle : le serveur fait confiance au userId envoyé par le client | `api/history.ts:25` | confirmé |
| 3 | 🔴 | build/déploiement | Electron : le process main plante au démarrage (__dirname indéfini dans le bundle ESM), aucune fenêtre ne s'ouvre | `electron/main.ts:373` | confirmé |
| 4 | 🟠 | sécurité | Endpoint de génération ouvert : quota contournable et coût Anthropic non borné | `api/generate.ts:401` | confirmé |
| 5 | 🟠 | fonctionnalité cassée | Electron : le preload ne se charge jamais (preload.js introuvable, preload.mjs au contenu CJS refusé avec sandbox:false), donc pas d'écran Clés API | `electron/main.ts:373` | confirmé |
| 6 | 🟠 | bug | Export PDF : les regex de nettoyage Markdown altèrent le sens du contenu (tirets, « > », « * », cases à cocher) | `src/lib/export.ts:15` | confirmé |
| 7 | 🟠 | fonctionnalité cassée | Les tableaux Markdown ne sont jamais rendus (react-markdown sans remark-gfm) | `src/pages/GeneratePage.tsx:586` | confirmé |
| 8 | 🟡 | sécurité | Valeurs id/userId concaténées sans encodage ni validation dans les filtres PostgREST | `api/delete.ts:19` | confirmé* |
| 9 | 🟡 | sécurité | Path traversal dans le serveur statique Electron : lecture de n'importe quel fichier, dont config.json avec les clés | `electron/main.ts:299` | confirmé* |
| 10 | 🟡 | sécurité | Serveur local Electron sans authentification : n'importe quel site web ou processus local peut utiliser la clé Anthropic et les données Supabase | `electron/main.ts:325` | confirmé* |
| 11 | 🟡 | sécurité | Navigation non restreinte : un lien du contenu généré ouvre un site externe dans la fenêtre, avec accès au pont electronAPI (getConfigRaw) | `electron/main.ts:385` | confirmé* |
| 12 | 🟡 | bug | Export PDF : un emoji ou un symbole mathématique corrompt toute la ligne (police Helvetica sans Unicode) | `src/lib/export.ts:20` | confirmé* |
| 13 | 🟡 | UX | Page Générer inutilisable sur mobile : la colonne d'outils de 220 px écrase le formulaire et le résultat | `src/pages/GeneratePage.tsx:125` | confirmé* |
| 14 | 🟡 | fonctionnalité cassée | Mode démo : « Sauvegardé dans votre historique » affiché alors que rien n'est enregistré ; Historique, Favoris et stats toujours vides | `src/pages/GeneratePage.tsx:591` | confirmé* |
| 15 | 🟡 | bug | Historique, Favoris et Dashboard : aucune gestion d'erreur des appels API (spinner infini, liste vide trompeuse, actions qui échouent en silence) | `src/pages/HistoryPage.tsx:18` | confirmé* |
| 16 | 🟡 | sécurité | Politiques RLS toutes à USING(true) et RPC increment_usage exécutable par PUBLIC | `supabase-schema.sql:57` | confirmé* |
| 17 | 🟡 | build/déploiement | Génération synchrone non streamée (jusqu'à 8000 tokens) sans maxDuration, sans timeout ni annulation | `vercel.json:1` | confirmé* |
| 18 | 🟡 | bug | Quota non atomique : des requêtes simultanées dépassent la limite de 20 générations par jour | `api/generate.ts:409` | confirmé |
| 19 | 🟡 | bug | Erreurs Anthropic (401/404/429/529) toutes converties en 502 générique, sans nouvel essai | `api/generate.ts:436` | confirmé* |
| 20 | 🟡 | bug | stop_reason ignoré : une réponse tronquée à max_tokens est sauvegardée et affichée comme complète | `api/generate.ts:443` | confirmé* |
| 21 | 🟡 | bug | Un échec de sauvegarde Supabase fait perdre la génération déjà payée ; type d'outil non validé avant l'appel Anthropic | `api/generate.ts:452` | confirmé* |
| 22 | 🟡 | bug | Un échec de la RPC increment_usage renvoie 500 alors que la génération est sauvegardée | `api/generate.ts:467` | confirmé |
| 23 | 🟡 | fonctionnalité cassée | Electron : génération impossible sans clé Supabase service_role | `electron/main.ts:134` | confirmé* |
| 24 | 🟡 | build/déploiement | Déploiement Netlify documenté mais non fonctionnel : aucune fonction /api | `netlify.toml:1` | confirmé* |
| 25 | 🟡 | fonctionnalité cassée | Clerk dans Electron : clés pk_live incompatibles avec http://127.0.0.1:3721 et OAuth Google bloqué dans une fenêtre embarquée | `src/App.tsx:74` | confirmé |
| 26 | 🟡 | cohérence des données | Aucun moyen de supprimer son compte ou ses données : les générations restent dans Supabase après suppression du compte Clerk | `src/components/layout/AppLayout.tsx:268` | confirmé* |
| 27 | 🟡 | cohérence des données | Profil enseignant uniquement en localStorage global : partagé entre comptes, jamais synchronisé et jamais transmis aux prompts | `src/hooks/useTeacherProfile.ts:12` | confirmé |
| 28 | 🟡 | UX | Contrastes de texte très insuffisants (tokens mg-400, mg-500, mg-600) | `src/index.css:8` | confirmé |
| 29 | 🟡 | UX | Listes du contenu généré sans puces ni numéros (preflight Tailwind) | `src/index.css:131` | confirmé |
| 30 | 🟡 | UX | Export PDF : mise en forme perdue (séparateurs de tableau transformés en lignes de tirets, pas de titres ni d'en-tête) | `src/lib/export.ts:13` | confirmé* |
| 31 | 🟡 | bug | Appréciations : le prompt système impose 10 appréciations alors que l'enseignant en demande N | `src/lib/prompts.ts:152` | confirmé |
| 32 | 🟡 | bug | Différenciation : les profils cochés sont ignorés par le prompt système (« produis 3 versions ») | `src/lib/prompts.ts:173` | confirmé* |
| 33 | 🟡 | fonctionnalité cassée | Favoris limités aux 100 dernières générations et historique complet rechargé à chaque page | `src/pages/FavoritesPage.tsx:20` | confirmé |
| 34 | 🟡 | bug | Des champs masqués d'un outil précédent sont envoyés, et « Difficulté : moyen » est ajouté à tous les outils | `src/pages/GeneratePage.tsx:78` | confirmé |
| 35 | 🟡 | bug | Double soumission : la touche Entrée relance une génération pendant qu'une autre est en cours | `src/pages/GeneratePage.tsx:306` | confirmé |
| 36 | 🟡 | UX | Boutons à icône seule sans nom accessible, état des boutons de sélection non exposé | `src/pages/HistoryPage.tsx:122` | confirmé |
| 37 | 🟡 | UX | Suppression d'un contenu sans confirmation ni annulation | `src/pages/HistoryPage.tsx:130` | confirmé |
| 38 | 🟡 | docs | Affirmations non fondées : « Open-source » sans licence, « RGPD-compliant », « Aucune donnée élève collectée » | `src/pages/LandingPage.tsx:106` | confirmé* |
| 39 | 🟡 | cohérence des données | Onboarding : matière par défaut 'francais' enregistrée même quand elle n'existe pas pour le niveau (maternelle, changement de cycle) | `src/pages/OnboardingPage.tsx:33` | confirmé |
| 40 | 🟡 | fonctionnalité cassée | Electron : écran blanc au rechargement (Ctrl+R) ou au retour de Clerk sur une route à deux niveaux (/app/…) | `vite.config.ts:94` | confirmé |
| 41 | ⚪ | sécurité | .gitignore n'ignore pas .env alors que le README demande d'y mettre les clés | `.gitignore:15` | confirmé* |
| 42 | ⚪ | qualité de code | Prompts dupliqués entre api/generate.ts et src/lib/prompts.ts, plus une 3e variante morte dans ai.ts (et storage.ts inutilisé) | `api/generate.ts:93` | confirmé* |
| 43 | ⚪ | build/déploiement | Empaquetage Electron : app.asar de 35,5 Mo rempli de 111 paquets npm inutiles, nom d'app « magistra-app », exe non signé | `electron-builder.json:9` | confirmé* |
| 44 | ⚪ | build/déploiement | Application desktop sans mise à jour automatique alors que le modèle est codé en dur | `electron-builder.json:44` | confirmé* |
| 45 | ⚪ | sécurité | Electron : clés API et clé service_role Supabase stockées en clair et renvoyées en clair au renderer | `electron/main.ts:24` | confirmé* |
| 46 | ⚪ | bug | Electron : corps JSON invalide → rejet non géré, la requête ne reçoit jamais de réponse (voire le process s'arrête) | `electron/main.ts:118` | confirmé* |
| 47 | ⚪ | cohérence des données | Electron : favorite/delete renvoient toujours success:true, même quand Supabase refuse | `electron/main.ts:232` | confirmé* |
| 48 | ⚪ | bug | Electron : port 3721 déjà occupé, l'erreur est seulement loggée et la fenêtre charge le serveur de quelqu'un d'autre | `electron/main.ts:353` | confirmé* |
| 49 | ⚪ | sécurité | Electron 33 (fin de vie) embarqué dans l'app Windows : 34 advisories non comptées par l'audit prod | `package.json:38` | confirmé* |
| 50 | ⚪ | docs | README et textes d'aide obsolètes : clé API « dans Réglages », mode démo, variables serveur, Supabase, npm run dev, Electron | `README.md:64` | confirmé* |
| 51 | ⚪ | performance | Bundle principal de 916 kB chargé dès la landing : aucune route lazy, jsPDF (≈41 %) importé statiquement | `src/App.tsx:6` | confirmé* |
| 52 | ⚪ | fonctionnalité cassée | Si clerk-js ne se charge pas, /app est une page vide et la landing n'a plus de bouton « Commencer » | `src/App.tsx:18` | confirmé* |
| 53 | ⚪ | UX | SelectField personnalisé inaccessible (ni ARIA, ni navigation clavier, ni Échap) et labels non associés aux champs | `src/components/ui/SelectField.tsx:55` | confirmé* |
| 54 | ⚪ | UX | Contenu généré : titres ####, liens, blocs de code et séparateurs sans aucun style (liens invisibles, code qui déborde) | `src/index.css:127` | confirmé* |
| 55 | ⚪ | fonctionnalité cassée | Mode démo : 6 outils sur 11 n'ont pas de démo et renvoient vers une « clé API » introuvable | `src/lib/ai.ts:572` | confirmé* |
| 56 | ⚪ | bug | apiGenerate : réponses non JSON, 504 et erreurs réseau affichées comme messages bruts en anglais ou trompeurs | `src/lib/api.ts:38` | confirmé* |
| 57 | ⚪ | bug | Export PDF : texte découpé pour du 16 pt puis dessiné en 11 pt, un tiers de la largeur de page perdu | `src/lib/export.ts:18` | confirmé |
| 58 | ⚪ | cohérence des données | Quota du Dashboard calculé depuis l'historique et non depuis le compteur serveur (valeurs fausses ou négatives) | `src/pages/DashboardPage.tsx:95` | confirmé* |
| 59 | ⚪ | UX | Electron en mode démo (build sans VITE_CLERK_PUBLISHABLE_KEY) : le serveur local et les clés saisies ne servent à rien | `src/pages/GeneratePage.tsx:92` | confirmé* |
| 60 | ⚪ | fonctionnalité cassée | Différenciation : impossible de fournir l'exercice à adapter (champ texte d'une seule ligne) | `src/pages/GeneratePage.tsx:294` | confirmé* |
| 61 | ⚪ | fonctionnalité cassée | Aucun moyen d'ajouter un favori depuis la page Générer | `src/pages/GeneratePage.tsx:562` | confirmé* |
| 62 | ⚪ | UX | « Passer cette étape » saute tout l'onboarding et enregistre un profil vide (voire écrase un profil existant) | `src/pages/OnboardingPage.tsx:331` | confirmé* |
| 63 | ⚪ | bug | Réglages Electron › Clés API : « Configurées » affiché à tort, clés effacées par une sauvegarde à vide, erreurs d'écriture ignorées | `src/pages/SettingsPage.tsx:39` | confirmé* |
| 64 | ⚪ | build/déploiement | Script SQL non idempotent : une deuxième exécution échoue | `supabase-schema.sql:36` | confirmé* |
| 65 | ⚪ | qualité de code | tsconfig ne couvre que src/ : api/ et electron/ ne sont jamais typecheckés (7 erreurs cachées) | `tsconfig.json:22` | confirmé* |
| 66 | ⚪ | docs | .env.example copié tel quel : l'app reste bloquée au lieu de passer en mode démo | `.env.example:2` | confirmé* |
| 67 | ⚪ | bug | API Vercel : corps de requête absent → exception non gérée ou 500 au lieu de 400 | `api/favorite.ts:14` | confirmé* |
| 68 | ⚪ | bug | API Vercel favorite/delete : succès renvoyé même si aucune ligne n'est modifiée, isFavorite non validé | `api/favorite.ts:28` | confirmé* |
| 69 | ⚪ | cohérence des données | Date du quota incohérente : UTC côté serveur, CURRENT_DATE côté SQL, heure locale côté Dashboard | `api/generate.ts:56` | confirmé* |
| 70 | ⚪ | cohérence des données | tokens_used ne compte que les tokens de sortie : suivi de consommation et de coût faux | `api/generate.ts:444` | confirmé |
| 71 | ⚪ | cohérence des données | Paramètres de génération partiellement persistés : texte de l'élève, type de courrier, trimestre et profils perdus | `api/generate.ts:452` | confirmé* |
| 72 | ⚪ | docs | design/untitled.pen : 73 % de gabarit Pencil sans rapport avec Magistra | `design/untitled.pen:1` | confirmé* |
| 73 | ⚪ | build/déploiement | Build Windows : icône absente (remplacée en silence) et build impossible hors Windows sans wine | `electron-builder.json:31` | confirmé* |
| 74 | ⚪ | bug | Electron : variables d'environnement de secours avec des noms inattendus (ANTHROPICKEY au lieu d'ANTHROPIC_API_KEY) | `electron/main.ts:31` | confirmé* |
| 75 | ⚪ | bug | Electron : corps de plus de 64 Ko, caractères accentués corrompus (U+FFFD) avant envoi à Claude | `electron/main.ts:94` | confirmé* |
| 76 | ⚪ | cohérence des données | Serveur Electron : écarts de parité mineurs avec api/*.ts | `electron/main.ts:338` | confirmé* |
| 77 | ⚪ | sécurité | setWindowOpenHandler contournable par préfixe (http://localhost.evil.example) et openExternal sans filtrage | `electron/main.ts:386` | confirmé* |
| 78 | ⚪ | bug | Electron mode dev : URL http://localhost:5173 codée en dur, VITE_DEV_SERVER_URL ignoré et pas de strictPort | `electron/main.ts:401` | confirmé* |
| 79 | ⚪ | qualité de code | ESLint analyse les artefacts de build (dist-electron, release) | `eslint.config.js:8` | confirmé |
| 80 | ⚪ | sécurité | Polices chargées depuis Google Fonts : transfert d'IP à Google sans consentement, et dépendance réseau de l'app desktop | `index.html:12` | confirmé* |
| 81 | ⚪ | qualité de code | Aucun test, aucune CI : les régressions (lint, typecheck, Electron) passent inaperçues | `package.json:7` | confirmé |
| 82 | ⚪ | sécurité | Vulnérabilités npm prod : 9 signalées, aucune exploitable en l'état, toutes corrigeables sans rupture | `package.json:16` | confirmé* |
| 83 | ⚪ | qualité de code | Dépendances inutilisées, manquante (@vercel/node), dépréciée ou obsolètes | `package.json:18` | confirmé |
| 84 | ⚪ | sécurité | Vulnérabilités de l'outillage de dev (vite, concurrently/shell-quote, electron-builder/tar) | `package.json:47` | confirmé* |
| 85 | ⚪ | bug | Profil localStorage incomplet : écran blanc sur /app, /app/generate et /app/settings (pas de validation, pas d'ErrorBoundary) | `src/hooks/useTeacherProfile.ts:16` | confirmé* |
| 86 | ⚪ | bug | ai.ts (code mort) : le parsing du streaming SSE perd du texte et ignore les erreurs en cours de flux | `src/lib/ai.ts:219` | confirmé |
| 87 | ⚪ | cohérence des données | Matière et niveau stockés sous forme de libellés : l'emoji de matière est toujours 📝 dans l'Historique et les Favoris | `src/lib/api.ts:23` | confirmé |
| 88 | ⚪ | bug | Prompts : règles communes inadaptées (note /20 en maternelle, compétences du socle dans un courrier aux parents) | `src/lib/prompts.ts:34` | confirmé* |
| 89 | ⚪ | bug | Statistiques du Dashboard plafonnées à 100 (Total généré, Favoris, Cette semaine) | `src/pages/DashboardPage.tsx:76` | confirmé |
| 90 | ⚪ | qualité de code | ESLint échoue avec 8 erreurs, et 2 autres masquées dans DashboardPage | `src/pages/DashboardPage.tsx:77` | confirmé |
| 91 | ⚪ | bug | Dashboard : la carte « Matière phare » affiche toujours « 0 générations » | `src/pages/DashboardPage.tsx:183` | confirmé |
| 92 | ⚪ | UX | Dashboard : un élément « Récent » ouvre l'Historique sans sélectionner l'élément (et petits textes obsolètes) | `src/pages/DashboardPage.tsx:284` | confirmé |
| 93 | ⚪ | UX | Favoris moins complets que l'Historique ; Réglages obsolètes | `src/pages/FavoritesPage.tsx:98` | confirmé |
| 94 | ⚪ | UX | Paramètre ?type= invalide : formulaire vide et bouton Générer désactivé en permanence | `src/pages/GeneratePage.tsx:30` | confirmé* |
| 95 | ⚪ | bug | Copier : un échec de navigator.clipboard provoque une promesse rejetée non gérée, sans aucun retour | `src/pages/GeneratePage.tsx:110` | confirmé |
| 96 | ⚪ | UX | Suggestions de sujets non filtrées par niveau (Pythagore et fonctions affines proposés en CP, dissertation en CE1) | `src/pages/GeneratePage.tsx:308` | confirmé |
| 97 | ⚪ | bug | Champ « Nombre d'appréciations » : vider le champ le remet à 10, bornes 1-35 non appliquées | `src/pages/GeneratePage.tsx:352` | confirmé* |
| 98 | ⚪ | bug | En-tête du résultat et noms d'export suivent l'outil sélectionné, pas celui qui a généré le contenu | `src/pages/GeneratePage.tsx:553` | confirmé* |
| 99 | ⚪ | UX | Squelette de chargement invisible pendant la génération (classes Tailwind construites dynamiquement) | `src/pages/GeneratePage.tsx:581` | confirmé |
| 100 | ⚪ | UX | Recherche de l'Historique sensible aux accents et limitée au sujet et à la matière | `src/pages/HistoryPage.tsx:28` | confirmé |
| 101 | ⚪ | bug | Double-clic sur le cœur : l'interface et le serveur ne sont plus d'accord | `src/pages/HistoryPage.tsx:42` | confirmé |
| 102 | ⚪ | UX | Les CTA de la landing renvoient toujours à l'onboarding, même quand il est déjà fait | `src/pages/LandingPage.tsx:12` | confirmé |
| 103 | ⚪ | docs | Affirmations produit non tenues : « programmes 2026 intégrés », « alignés sur le BO », « 180+ bulletins », « Retouchez si besoin » | `src/pages/LandingPage.tsx:105` | confirmé* |
| 104 | ⚪ | qualité de code | Données collectées ou déclarées mais jamais utilisées (matière secondaire, VITE_ANTHROPIC_API_KEY, API IPC inutilisées) | `src/pages/OnboardingPage.tsx:242` | confirmé |
| 105 | ⚪ | UX | « Reconfigurer mon profil » efface le profil sans le pré-remplir et bloque l'utilisateur dans l'onboarding | `src/pages/SettingsPage.tsx:161` | confirmé* |
| 106 | ⚪ | qualité de code | tsconfig.tsbuildinfo committé, périmé, réécrit à chaque build | `tsconfig.tsbuildinfo:1` | confirmé |
| 107 | ⚪ | sécurité | Web : aucun en-tête de sécurité (CSP, frame-ancestors, nosniff) sur le déploiement Vercel ou Netlify | `vercel.json:1` | confirmé* |
| 108 | ⚪ | build/déploiement | `npm run dev` (web) : /api est proxifié vers 127.0.0.1:3721 (serveur Electron), toute requête API échoue en 500 | `vite.config.ts:44` | confirmé* |
