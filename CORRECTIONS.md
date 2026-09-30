# Corrections — suivi des 108 problèmes de l'audit

Source de vérité : [ANALYSE.md](ANALYSE.md) (annexe, problèmes n° 1 à 108). Branche : `claude/correction-integrale-1o7pn8`.

Méthode : chaque point a été contrôlé **après** les corrections, par une relecture indépendante du code (fichiers, tests, commandes), puis complété par les correctifs de la dernière passe. Les preuves citent les fichiers et les tests du dépôt ; les vérifications ponctuelles faites hors dépôt (base PostgreSQL jetable, scripts de reproduction) sont signalées comme telles.

| Statut | Signification | Nombre |
|---|---|---|
| **FIXED** | le défaut est corrigé et vérifié (test automatisé ou vérification décrite) | 88 |
| **NOT APPLICABLE** | le code concerné n'existe plus : il a été supprimé ou remplacé par la nouvelle architecture (plus d'Anthropic, plus de serveur HTTP local dans Electron, plus de quota…), et le remplaçant n'a pas le défaut | 18 |
| **DEFERRED** | corrigé en partie ; le reste est reporté pour une raison précise, indiquée | 2 |

> **Note postérieure à l'audit (connecteur local).** Les points [#9](#9), [#46](#46) et [#75](#75) indiquent qu'aucun
> serveur HTTP ne subsiste dans electron/ : c'était exact à la date de ce suivi. Depuis, `electron/connector/server.ts`
> ajoute UN serveur dédié au connecteur local (site web officiel → IA de cet ordinateur) : écoute sur 127.0.0.1
> uniquement, cinq routes Magistra, origine officielle et en-tête Host exacts, requêtes signées après un appairage
> accepté dans l'application, aucun fichier servi, aucun relais vers Ollama. Les défauts de ces trois points ne s'y
> retrouvent pas : l'interface reste servie par app:// (le serveur statique serveStatic n'est pas revenu), un JSON
> invalide reçoit 400, et le corps est accumulé en octets puis décodé une seule fois en UTF-8 strict (voir
> tests/electron/connectorServer.test.ts et tests/localConnector/interop.test.ts).

## Récapitulatif

| # | Gravité | Problème | Statut |
|---|---|---|---|
| [1](#1) | 🔴 | Modèle claude-sonnet-4-20250514 retiré depuis le 15/06/2026 et codé en dur : toute génération IA réelle échoue | NOT APPLICABLE |
| [2](#2) | 🔴 | Aucune authentification réelle : le serveur fait confiance au userId envoyé par le client | FIXED |
| [3](#3) | 🔴 | Electron : le process main plante au démarrage (__dirname indéfini dans le bundle ESM), aucune fenêtre ne s'ouvre | FIXED |
| [4](#4) | 🟠 | Endpoint de génération ouvert : quota contournable et coût Anthropic non borné | FIXED |
| [5](#5) | 🟠 | Electron : le preload ne se charge jamais (preload.js introuvable, preload.mjs au contenu CJS refusé avec sandbox:false), donc pas d'écran Clés API | FIXED |
| [6](#6) | 🟠 | Export PDF : les regex de nettoyage Markdown altèrent le sens du contenu (tirets, « > », « * », cases à cocher) | FIXED |
| [7](#7) | 🟠 | Les tableaux Markdown ne sont jamais rendus (react-markdown sans remark-gfm) | FIXED |
| [8](#8) | 🟡 | Valeurs id/userId concaténées sans encodage ni validation dans les filtres PostgREST | FIXED |
| [9](#9) | 🟡 | Path traversal dans le serveur statique Electron : lecture de n'importe quel fichier, dont config.json avec les clés | NOT APPLICABLE |
| [10](#10) | 🟡 | Serveur local Electron sans authentification : n'importe quel site web ou processus local peut utiliser la clé Anthropic et les données Supabase | NOT APPLICABLE |
| [11](#11) | 🟡 | Navigation non restreinte : un lien du contenu généré ouvre un site externe dans la fenêtre, avec accès au pont electronAPI (getConfigRaw) | FIXED |
| [12](#12) | 🟡 | Export PDF : un emoji ou un symbole mathématique corrompt toute la ligne (police Helvetica sans Unicode) | FIXED |
| [13](#13) | 🟡 | Page Générer inutilisable sur mobile : la colonne d'outils de 220 px écrase le formulaire et le résultat | FIXED |
| [14](#14) | 🟡 | Mode démo : « Sauvegardé dans votre historique » affiché alors que rien n'est enregistré ; Historique, Favoris et stats toujours vides | FIXED |
| [15](#15) | 🟡 | Historique, Favoris et Dashboard : aucune gestion d'erreur des appels API (spinner infini, liste vide trompeuse, actions qui échouent en silence) | FIXED |
| [16](#16) | 🟡 | Politiques RLS toutes à USING(true) et RPC increment_usage exécutable par PUBLIC | FIXED |
| [17](#17) | 🟡 | Génération synchrone non streamée (jusqu'à 8000 tokens) sans maxDuration, sans timeout ni annulation | FIXED |
| [18](#18) | 🟡 | Quota non atomique : des requêtes simultanées dépassent la limite de 20 générations par jour | FIXED |
| [19](#19) | 🟡 | Erreurs Anthropic (401/404/429/529) toutes converties en 502 générique, sans nouvel essai | FIXED |
| [20](#20) | 🟡 | stop_reason ignoré : une réponse tronquée à max_tokens est sauvegardée et affichée comme complète | FIXED |
| [21](#21) | 🟡 | Un échec de sauvegarde Supabase fait perdre la génération déjà payée ; type d'outil non validé avant l'appel Anthropic | FIXED |
| [22](#22) | 🟡 | Un échec de la RPC increment_usage renvoie 500 alors que la génération est sauvegardée | NOT APPLICABLE |
| [23](#23) | 🟡 | Electron : génération impossible sans clé Supabase service_role | NOT APPLICABLE |
| [24](#24) | 🟡 | Déploiement Netlify documenté mais non fonctionnel : aucune fonction /api | FIXED |
| [25](#25) | 🟡 | Clerk dans Electron : clés pk_live incompatibles avec http://127.0.0.1:3721 et OAuth Google bloqué dans une fenêtre embarquée | NOT APPLICABLE |
| [26](#26) | 🟡 | Aucun moyen de supprimer son compte ou ses données : les générations restent dans Supabase après suppression du compte Clerk | FIXED |
| [27](#27) | 🟡 | Profil enseignant uniquement en localStorage global : partagé entre comptes, jamais synchronisé et jamais transmis aux prompts | FIXED |
| [28](#28) | 🟡 | Contrastes de texte très insuffisants (tokens mg-400, mg-500, mg-600) | FIXED |
| [29](#29) | 🟡 | Listes du contenu généré sans puces ni numéros (preflight Tailwind) | FIXED |
| [30](#30) | 🟡 | Export PDF : mise en forme perdue (séparateurs de tableau transformés en lignes de tirets, pas de titres ni d'en-tête) | FIXED |
| [31](#31) | 🟡 | Appréciations : le prompt système impose 10 appréciations alors que l'enseignant en demande N | FIXED |
| [32](#32) | 🟡 | Différenciation : les profils cochés sont ignorés par le prompt système (« produis 3 versions ») | FIXED |
| [33](#33) | 🟡 | Favoris limités aux 100 dernières générations et historique complet rechargé à chaque page | FIXED |
| [34](#34) | 🟡 | Des champs masqués d'un outil précédent sont envoyés, et « Difficulté : moyen » est ajouté à tous les outils | FIXED |
| [35](#35) | 🟡 | Double soumission : la touche Entrée relance une génération pendant qu'une autre est en cours | FIXED |
| [36](#36) | 🟡 | Boutons à icône seule sans nom accessible, état des boutons de sélection non exposé | FIXED |
| [37](#37) | 🟡 | Suppression d'un contenu sans confirmation ni annulation | FIXED |
| [38](#38) | 🟡 | Affirmations non fondées : « Open-source » sans licence, « RGPD-compliant », « Aucune donnée élève collectée » | FIXED |
| [39](#39) | 🟡 | Onboarding : matière par défaut 'francais' enregistrée même quand elle n'existe pas pour le niveau (maternelle, changement de cycle) | FIXED |
| [40](#40) | 🟡 | Electron : écran blanc au rechargement (Ctrl+R) ou au retour de Clerk sur une route à deux niveaux (/app/…) | FIXED |
| [41](#41) | ⚪ | .gitignore n'ignore pas .env alors que le README demande d'y mettre les clés | FIXED |
| [42](#42) | ⚪ | Prompts dupliqués entre api/generate.ts et src/lib/prompts.ts, plus une 3e variante morte dans ai.ts (et storage.ts inutilisé) | FIXED |
| [43](#43) | ⚪ | Empaquetage Electron : app.asar de 35,5 Mo rempli de 111 paquets npm inutiles, nom d'app « magistra-app », exe non signé | DEFERRED |
| [44](#44) | ⚪ | Application desktop sans mise à jour automatique alors que le modèle est codé en dur | DEFERRED |
| [45](#45) | ⚪ | Electron : clés API et clé service_role Supabase stockées en clair et renvoyées en clair au renderer | FIXED |
| [46](#46) | ⚪ | Electron : corps JSON invalide → rejet non géré, la requête ne reçoit jamais de réponse (voire le process s'arrête) | NOT APPLICABLE |
| [47](#47) | ⚪ | Electron : favorite/delete renvoient toujours success:true, même quand Supabase refuse | NOT APPLICABLE |
| [48](#48) | ⚪ | Electron : port 3721 déjà occupé, l'erreur est seulement loggée et la fenêtre charge le serveur de quelqu'un d'autre | NOT APPLICABLE |
| [49](#49) | ⚪ | Electron 33 (fin de vie) embarqué dans l'app Windows : 34 advisories non comptées par l'audit prod | FIXED |
| [50](#50) | ⚪ | README et textes d'aide obsolètes : clé API « dans Réglages », mode démo, variables serveur, Supabase, npm run dev, Electron | FIXED |
| [51](#51) | ⚪ | Bundle principal de 916 kB chargé dès la landing : aucune route lazy, jsPDF (≈41 %) importé statiquement | FIXED |
| [52](#52) | ⚪ | Si clerk-js ne se charge pas, /app est une page vide et la landing n'a plus de bouton « Commencer » | FIXED |
| [53](#53) | ⚪ | SelectField personnalisé inaccessible (ni ARIA, ni navigation clavier, ni Échap) et labels non associés aux champs | FIXED |
| [54](#54) | ⚪ | Contenu généré : titres ####, liens, blocs de code et séparateurs sans aucun style (liens invisibles, code qui déborde) | FIXED |
| [55](#55) | ⚪ | Mode démo : 6 outils sur 11 n'ont pas de démo et renvoient vers une « clé API » introuvable | FIXED |
| [56](#56) | ⚪ | apiGenerate : réponses non JSON, 504 et erreurs réseau affichées comme messages bruts en anglais ou trompeurs | FIXED |
| [57](#57) | ⚪ | Export PDF : texte découpé pour du 16 pt puis dessiné en 11 pt, un tiers de la largeur de page perdu | FIXED |
| [58](#58) | ⚪ | Quota du Dashboard calculé depuis l'historique et non depuis le compteur serveur (valeurs fausses ou négatives) | NOT APPLICABLE |
| [59](#59) | ⚪ | Electron en mode démo (build sans VITE_CLERK_PUBLISHABLE_KEY) : le serveur local et les clés saisies ne servent à rien | NOT APPLICABLE |
| [60](#60) | ⚪ | Différenciation : impossible de fournir l'exercice à adapter (champ texte d'une seule ligne) | FIXED |
| [61](#61) | ⚪ | Aucun moyen d'ajouter un favori depuis la page Générer | FIXED |
| [62](#62) | ⚪ | « Passer cette étape » saute tout l'onboarding et enregistre un profil vide (voire écrase un profil existant) | FIXED |
| [63](#63) | ⚪ | Réglages Electron › Clés API : « Configurées » affiché à tort, clés effacées par une sauvegarde à vide, erreurs d'écriture ignorées | NOT APPLICABLE |
| [64](#64) | ⚪ | Script SQL non idempotent : une deuxième exécution échoue | FIXED |
| [65](#65) | ⚪ | tsconfig ne couvre que src/ : api/ et electron/ ne sont jamais typecheckés (7 erreurs cachées) | FIXED |
| [66](#66) | ⚪ | .env.example copié tel quel : l'app reste bloquée au lieu de passer en mode démo | FIXED |
| [67](#67) | ⚪ | API Vercel : corps de requête absent → exception non gérée ou 500 au lieu de 400 | FIXED |
| [68](#68) | ⚪ | API Vercel favorite/delete : succès renvoyé même si aucune ligne n'est modifiée, isFavorite non validé | FIXED |
| [69](#69) | ⚪ | Date du quota incohérente : UTC côté serveur, CURRENT_DATE côté SQL, heure locale côté Dashboard | NOT APPLICABLE |
| [70](#70) | ⚪ | tokens_used ne compte que les tokens de sortie : suivi de consommation et de coût faux | NOT APPLICABLE |
| [71](#71) | ⚪ | Paramètres de génération partiellement persistés : texte de l'élève, type de courrier, trimestre et profils perdus | FIXED |
| [72](#72) | ⚪ | design/untitled.pen : 73 % de gabarit Pencil sans rapport avec Magistra | FIXED |
| [73](#73) | ⚪ | Build Windows : icône absente (remplacée en silence) et build impossible hors Windows sans wine | FIXED |
| [74](#74) | ⚪ | Electron : variables d'environnement de secours avec des noms inattendus (ANTHROPICKEY au lieu d'ANTHROPIC_API_KEY) | NOT APPLICABLE |
| [75](#75) | ⚪ | Electron : corps de plus de 64 Ko, caractères accentués corrompus (U+FFFD) avant envoi à Claude | NOT APPLICABLE |
| [76](#76) | ⚪ | Serveur Electron : écarts de parité mineurs avec api/*.ts | NOT APPLICABLE |
| [77](#77) | ⚪ | setWindowOpenHandler contournable par préfixe (http://localhost.evil.example) et openExternal sans filtrage | FIXED |
| [78](#78) | ⚪ | Electron mode dev : URL http://localhost:5173 codée en dur, VITE_DEV_SERVER_URL ignoré et pas de strictPort | FIXED |
| [79](#79) | ⚪ | ESLint analyse les artefacts de build (dist-electron, release) | FIXED |
| [80](#80) | ⚪ | Polices chargées depuis Google Fonts : transfert d'IP à Google sans consentement, et dépendance réseau de l'app desktop | FIXED |
| [81](#81) | ⚪ | Aucun test, aucune CI : les régressions (lint, typecheck, Electron) passent inaperçues | FIXED |
| [82](#82) | ⚪ | Vulnérabilités npm prod : 9 signalées, aucune exploitable en l'état, toutes corrigeables sans rupture | FIXED |
| [83](#83) | ⚪ | Dépendances inutilisées, manquante (@vercel/node), dépréciée ou obsolètes | FIXED |
| [84](#84) | ⚪ | Vulnérabilités de l'outillage de dev (vite, concurrently/shell-quote, electron-builder/tar) | FIXED |
| [85](#85) | ⚪ | Profil localStorage incomplet : écran blanc sur /app, /app/generate et /app/settings (pas de validation, pas d'ErrorBoundary) | FIXED |
| [86](#86) | ⚪ | ai.ts (code mort) : le parsing du streaming SSE perd du texte et ignore les erreurs en cours de flux | NOT APPLICABLE |
| [87](#87) | ⚪ | Matière et niveau stockés sous forme de libellés : l'emoji de matière est toujours 📝 dans l'Historique et les Favoris | FIXED |
| [88](#88) | ⚪ | Prompts : règles communes inadaptées (note /20 en maternelle, compétences du socle dans un courrier aux parents) | FIXED |
| [89](#89) | ⚪ | Statistiques du Dashboard plafonnées à 100 (Total généré, Favoris, Cette semaine) | FIXED |
| [90](#90) | ⚪ | ESLint échoue avec 8 erreurs, et 2 autres masquées dans DashboardPage | FIXED |
| [91](#91) | ⚪ | Dashboard : la carte « Matière phare » affiche toujours « 0 générations » | FIXED |
| [92](#92) | ⚪ | Dashboard : un élément « Récent » ouvre l'Historique sans sélectionner l'élément (et petits textes obsolètes) | FIXED |
| [93](#93) | ⚪ | Favoris moins complets que l'Historique ; Réglages obsolètes | FIXED |
| [94](#94) | ⚪ | Paramètre ?type= invalide : formulaire vide et bouton Générer désactivé en permanence | FIXED |
| [95](#95) | ⚪ | Copier : un échec de navigator.clipboard provoque une promesse rejetée non gérée, sans aucun retour | FIXED |
| [96](#96) | ⚪ | Suggestions de sujets non filtrées par niveau (Pythagore et fonctions affines proposés en CP, dissertation en CE1) | FIXED |
| [97](#97) | ⚪ | Champ « Nombre d'appréciations » : vider le champ le remet à 10, bornes 1-35 non appliquées | FIXED |
| [98](#98) | ⚪ | En-tête du résultat et noms d'export suivent l'outil sélectionné, pas celui qui a généré le contenu | FIXED |
| [99](#99) | ⚪ | Squelette de chargement invisible pendant la génération (classes Tailwind construites dynamiquement) | FIXED |
| [100](#100) | ⚪ | Recherche de l'Historique sensible aux accents et limitée au sujet et à la matière | FIXED |
| [101](#101) | ⚪ | Double-clic sur le cœur : l'interface et le serveur ne sont plus d'accord | FIXED |
| [102](#102) | ⚪ | Les CTA de la landing renvoient toujours à l'onboarding, même quand il est déjà fait | FIXED |
| [103](#103) | ⚪ | Affirmations produit non tenues : « programmes 2026 intégrés », « alignés sur le BO », « 180+ bulletins », « Retouchez si besoin » | FIXED |
| [104](#104) | ⚪ | Données collectées ou déclarées mais jamais utilisées (matière secondaire, VITE_ANTHROPIC_API_KEY, API IPC inutilisées) | FIXED |
| [105](#105) | ⚪ | « Reconfigurer mon profil » efface le profil sans le pré-remplir et bloque l'utilisateur dans l'onboarding | FIXED |
| [106](#106) | ⚪ | tsconfig.tsbuildinfo committé, périmé, réécrit à chaque build | FIXED |
| [107](#107) | ⚪ | Web : aucun en-tête de sécurité (CSP, frame-ancestors, nosniff) sur le déploiement Vercel ou Netlify | FIXED |
| [108](#108) | ⚪ | `npm run dev` (web) : /api est proxifié vers 127.0.0.1:3721 (serveur Electron), toute requête API échoue en 500 | FIXED |

## Détail

<a id="1"></a>
### #1 — Modèle claude-sonnet-4-20250514 retiré depuis le 15/06/2026 et codé en dur : toute génération IA réelle échoue

**NOT APPLICABLE** · 🔴 fonctionnalité cassée · signalé dans `api/generate.ts:429`

Tout le code Anthropic a disparu : `git grep` ne trouve plus aucun `claude-sonnet`, `anthropic` ni `sk-ant` ailleurs que dans des tests qui vérifient justement leur absence. Il n'y a donc plus de modèle commercial codé en dur qui pourrait être retiré. Sur le web, le modèle vient de AI_MODEL/AI_BASE_URL (server/config.ts, loadAI). Dans l'application Windows, c'est un modèle Ollama local choisi par l'enseignant (shared/ai/models.ts), avec un nom personnalisé possible (electron/aiConfig.ts, customModel). La seconde moitié du défaut, l'erreur 404 noyée dans un 502 générique, est aussi traitée : un modèle absent donne MODEL_NOT_INSTALLED avec un message clair (mapHttpError), et /api/status le détecte à l'avance (health).

*Preuves :* shared/ai/openaiCompatible.ts (mapHttpError → MODEL_NOT_INSTALLED) et 243-257 (health) ; server/config.ts ; tests/shared/ai.openai.test.ts ; tests/shared/ai.ollama.test.ts ; tests/server/deploy.test.ts ; E2E Electron test 6 (« modèle introuvable ») réussi

<a id="2"></a>
### #2 — Aucune authentification réelle : le serveur fait confiance au userId envoyé par le client

**FIXED** · 🔴 sécurité · signalé dans `api/history.ts:25`

Toutes les routes (status compris) passent par handleApi. Celle-ci exige un jeton `Authorization: Bearer`, le vérifie avec @clerk/backend (verifyToken) et prend l'identité dans le claim `sub`. Sans vérificateur configuré, la réponse est SERVER_MISCONFIGURED, jamais un accès ouvert. Aucun userId venant du corps ou de l'URL n'est lu, et chaque méthode du store filtre par l'utilisateur du jeton. Le client joint le jeton Clerk à chaque appel (authedFetch). Le serveur de développement Vite ne contourne pas l'authentification. Remarque : server/auth.ts est en cours de modification dans l'arbre de travail par un autre processus (durcissement : algorithmes RS*, kid), ce qui ne change pas le verdict.

*Preuves :* server/handlers.ts ; server/auth.ts (extractBearerToken, createClerkVerifier → payload.sub, authenticate) ; server/store.ts (.eq('user_id', uid)) ; src/lib/runtime/http.ts ; tests/server/auth.test.ts (B ne lit, ne modifie ni ne supprime rien de A ; 401 sur toutes les routes sans jeton) ; tests/server/clerk.test.ts (signature, expiration, alg none, sub modifié) ; 522 tests vitest ciblés réussis

<a id="3"></a>
### #3 — Electron : le process main plante au démarrage (__dirname indéfini dans le bundle ESM), aucune fenêtre ne s'ouvre

**FIXED** · 🔴 build/déploiement · signalé dans `electron/main.ts:373`

Le main est désormais construit par esbuild au format ESM, et `__dirname` est défini explicitement par `path.dirname(fileURLToPath(import.meta.url))`. Le dossier dist est résolu par app.getAppPath(), plus par __dirname. Une erreur au démarrage ne laisse plus de processus fantôme : `whenReady().then(start).catch(fatal)` et le gestionnaire unhandledRejection affichent une boîte d'erreur puis appellent app.exit(1). Il n'existe plus de port 3721, et second-instance recrée une fenêtre si aucune n'existe. J'ai reconstruit main.js et preload.cjs dans un dossier temporaire hors dépôt depuis les sources actuelles et lancé Electron réel sous xvfb : fenêtre ouverte sur app://magistra/setup, pont présent, génération complète réussie.

*Preuves :* electron/main.ts (__dirname), 64-87 (fatal, unhandledRejection), 443-451, 461 ; scripts/build-electron.mjs (format esm) ; dist-electron/main.js ; script de vérification ponctuel hors dépôt : verif-e18/smoke.log : « [smoke] SUCCÈS », bridge=object, url app://magistra/setup, generation.ok=true ; E2E Electron 14/14 (e2e-run-logs.txt)

<a id="4"></a>
### #4 — Endpoint de génération ouvert : quota contournable et coût Anthropic non borné

**FIXED** · 🟠 sécurité · signalé dans `api/generate.ts:401`

L'endpoint n'est plus ouvert : l'identité vient uniquement du jeton Clerk vérifié côté serveur (jamais d'un userId envoyé par le client), CORS n'est plus « * », et les entrées sont bornées (sujet 300, consignes 3 000, travail d'élève 20 000, corps 1 Mo, sortie AI_MAX_OUTPUT_TOKENS, durée AI_TIMEOUT_SECONDS). Il n'y a plus de coût Anthropic (serveur d'IA de l'établissement). Les protections anti-abus sont atomiques, dans une seule fonction SQL sous verrou par utilisateur : débit par utilisateur (RATE_LIMIT_PER_MINUTE, 10), plafond global du déploiement (RATE_LIMIT_GLOBAL_PER_MINUTE, 120 → AI_BUSY 503), générations simultanées par utilisateur (MAX_CONCURRENT_GENERATIONS_PER_USER, 2 → GENERATION_BUSY 429) et par instance (MAX_CONCURRENT_GENERATIONS, 8). Le README recommande de restreindre les inscriptions Clerk (mode Restricted / liste autorisée) pour un établissement.

*Preuves :* server/auth.ts ; server/handlers.ts (generate, HTTP_STATUS_OVERRIDES) ; server/concurrency.ts ; supabase-schema.sql (magistra_begin_generation / magistra_end_generation, table active_generations) ; tests/server/concurrency.test.ts, tests/server/generate.test.ts ; test PostgreSQL 16 : 24 connexions simultanées d'un même utilisateur → 2 acceptées / 22 refusées

*Remarque :* Ajouter un plafond global (et/ou par IP) côté serveur, par exemple une clé globale dans magistra_register_request. Plafonner les générations simultanées par utilisateur. Documenter la restriction des inscriptions Clerk (mode restreint ou liste de domaines autorisés) pour un déploiement d'établissement.

<a id="5"></a>
### #5 — Electron : le preload ne se charge jamais (preload.js introuvable, preload.mjs au contenu CJS refusé avec sandbox:false), donc pas d'écran Clés API

**FIXED** · 🟠 fonctionnalité cassée · signalé dans `electron/main.ts:373`

Le preload est construit en CommonJS dans dist-electron/preload.cjs. Il n'utilise que require('electron') (contextBridge, ipcRenderer) et est chargé avec `preload: path.join(__dirname, 'preload.cjs')` et `sandbox: true`, la combinaison validée par l'audit. Le pont window.magistra est bien exposé dans Electron réel. L'écran « Clés API » Anthropic n'a plus lieu d'être : l'IA est locale (Ollama) et sa configuration passe par l'assistant et les Réglages via IPC.

*Preuves :* electron/main.ts ; scripts/build-electron.mjs (preload format cjs → preload.cjs) ; electron/preload.ts ; electron-builder.json (dist-electron/** inclus) ; smoke Electron rejoué sur un build frais : checks.bridge="object", isElectron=true, isolated=true ; tests/electron/preload.test.ts

<a id="6"></a>
### #6 — Export PDF : les regex de nettoyage Markdown altèrent le sens du contenu (tirets, « > », « * », cases à cocher)

**FIXED** · 🟠 bug · signalé dans `src/lib/export.ts:15`

Les regex globales ont disparu. L'export PDF analyse le Markdown en arbre mdast (unified + remark-gfm + remark-math) et dessine chaque nœud : les '-', '>', '*' du texte ne sont plus touchés, et les cases GFM ou ☐ restent des cases. J'ai rejoué les entrées exactes de l'audit sur le PDF produit, puis extrait le texte avec pdf.js. On retrouve à l'identique « Si x > 3 alors 2x > 6 », « Calcule 2 * 3 * 4 = 24 et -5 + 8 = 3 », « l'arc-en-ciel, 2025-2026, le Sud-Est, peut-être », « ☐ Réponse A » (sans « • • »), et « - [ ] » / « - [x] » deviennent ☐ / ☑.

*Preuves :* src/lib/export/markdown.ts (parseMarkdown) ; src/lib/export/pdf.ts ; tests/pdf/pdf.test.ts ; tests/pdf/edge-cases.test.ts ; script de vérification ponctuel hors dépôt : verif-e18/vt/pdf18.test.ts (réussi, lignes extraites listées)

<a id="7"></a>
### #7 — Les tableaux Markdown ne sont jamais rendus (react-markdown sans remark-gfm)

**FIXED** · 🟠 fonctionnalité cassée · signalé dans `src/pages/GeneratePage.tsx:586`

Tous les affichages de contenu (résultat de génération, détail de l'historique et des favoris, impression) passent par le composant partagé MarkdownView. Celui-ci utilise remark-gfm (présent dans package.json) et enveloppe chaque tableau dans un conteneur défilant accessible.

*Preuves :* src/components/MarkdownView.tsx ; usages dans src/components/generate/ResultPanel.tsx, src/components/history/GenerationDetail.tsx, src/lib/export/PrintView.tsx ; tests/markdown/MarkdownView.test.tsx ; E2E web test 5 « générer « Cours » … tableau » réussi

<a id="8"></a>
### #8 — Valeurs id/userId concaténées sans encodage ni validation dans les filtres PostgREST

**FIXED** · 🟡 sécurité · signalé dans `api/delete.ts:19`

Plus aucune URL PostgREST n'est construite à la main. Le store utilise @supabase/supabase-js (.eq(), qui encode les valeurs). L'identifiant de contenu est validé comme UUID strict (requireUuid, sinon 400), et l'utilisateur vient uniquement du jeton, validé par un motif borné. Le seul filtre .or() (curseur de pagination) n'accepte qu'un horodatage validé par regex et un UUID. Suppression et favori renvoient .select('id') et répondent NOT_FOUND si aucune ligne n'est touchée. Le serveur Electron qui dupliquait le défaut n'existe plus.

*Preuves :* server/ids.ts ; server/store.ts (decodeCursor), 322-326, 380-405 ; tests/server/supabaseStore.test.ts (« un identifiant contenant des caractères spéciaux ne peut pas ajouter de filtre »), 158 ; tests/server/auth.test.ts

<a id="9"></a>
### #9 — Path traversal dans le serveur statique Electron : lecture de n'importe quel fichier, dont config.json avec les clés

**NOT APPLICABLE** · 🟡 sécurité · signalé dans `electron/main.ts:299`

Le serveur HTTP local d'Electron (serveStatic, port 3721) a été supprimé : aucun createServer, listen ou node:http ne subsiste dans electron/. L'interface est servie par le protocole privilégié app:// (protocol.handle), inaccessible aux autres processus ou sessions Windows. Ce remplaçant décode, normalise et confine lui-même le chemin à dist (404 sinon), et ne fait le repli SPA que pour les chemins sans extension. Il n'existe plus de config.json contenant des clés : l'éventuelle clé d'un serveur distant est chiffrée par safeStorage dans ai-config.json.

*Preuves :* electron/main.ts ; electron/protocol.ts (ligne 82 : confinement) ; tests/electron/protocol.test.ts ; E2E Electron test 7 : fetch('/%2e%2e/…/etc/passwd') → leaked=false

<a id="10"></a>
### #10 — Serveur local Electron sans authentification : n'importe quel site web ou processus local peut utiliser la clé Anthropic et les données Supabase

**NOT APPLICABLE** · 🟡 sécurité · signalé dans `electron/main.ts:325`

Il n'y a plus de serveur local /api/* : les requêtes simples, le DNS rebinding et les appels depuis un autre processus n'ont plus de cible. La fenêtre communique uniquement par IPC. Chaque gestionnaire vérifie l'expéditeur (même webContents, cadre principal, origine app://magistra), puis valide ses arguments. La fenêtre elle-même ne peut contacter aucun réseau (CSP connect-src 'self' et blocage webRequest). Il n'existe plus de clé Anthropic ni de clé Supabase côté bureau (données locales en JSON, IA locale Ollama).

*Preuves :* electron/ipc.ts ; electron/security.ts (isTrustedSender), 16-27 (CSP) ; electron/main.ts ; tests/electron/security.test.ts ; E2E Electron test 7 (fetch Internet et Ollama « bloqué »)

<a id="11"></a>
### #11 — Navigation non restreinte : un lien du contenu généré ouvre un site externe dans la fenêtre, avec accès au pont electronAPI (getConfigRaw)

**FIXED** · 🟡 sécurité · signalé dans `electron/main.ts:385`

Plusieurs verrous se cumulent. will-navigate annule toute navigation hors de l'origine de l'application et confie les liens http(s) au navigateur du système. will-frame-navigate et will-redirect sont aussi filtrés, setWindowOpenHandler refuse les nouvelles fenêtres et les webviews sont interdites. Les gestionnaires IPC refusent (FORBIDDEN) tout cadre qui ne vient pas de app://magistra. getConfigRaw et config:set libre n'existent plus : setConfig est assaini. Enfin, les liens Markdown portent target=_blank rel=noopener et passent par bridge.app.openExternal, limité à http(s).

*Preuves :* electron/main.ts ; electron/ipc.ts ; electron/security.ts ; src/components/MarkdownView.tsx ; tests/electron/security.test.ts ; E2E Electron test 7 (lien, window.location, window.open : navigation annulée, liens confiés au système, une seule fenêtre)

<a id="12"></a>
### #12 — Export PDF : un emoji ou un symbole mathématique corrompt toute la ligne (police Helvetica sans Unicode)

**FIXED** · 🟡 bug · signalé dans `src/lib/export.ts:20`

Helvetica/WinAnsi est remplacée par les polices TTF DejaVu (normal, gras, italique, mono), embarquées via addFileToVFS et servies par l'application elle-même. Chaque caractère est dessiné avec une police qui le contient. Les émojis absents de la police sont retirés proprement (comptés dans pdfStats) sans toucher au reste de la ligne. Les prompts ne demandent plus d'émojis. Test sur les entrées de l'audit : aucun octet nul ni « Ø=Ü¡ ». « 💡 Coup de pouce · 🟢 Facile » donne « Coup de pouce · Facile », et « b ≠ 0 et x ≤ 7, Année… → suite, √2 ≈ 1,41, π » est intact.

*Preuves :* src/lib/export/fonts.ts ; src/lib/export/pdf.ts (addFileToVFS), 199-241 (segment, ligne 222 émojis) ; tests/pdf/pdf.test.ts (« retire seulement les émojis absents de la police »), 16 (symboles mathématiques) ; script de vérification ponctuel hors dépôt : verif-e18/vt/pdf18.test.ts (emojiRemoved=3, unsupported=0)

<a id="13"></a>
### #13 — Page Générer inutilisable sur mobile : la colonne d'outils de 220 px écrase le formulaire et le résultat

**FIXED** · 🟡 UX · signalé dans `src/pages/GeneratePage.tsx:125`

L'aside de 220 px n'apparaît plus qu'à partir de lg (hidden lg:block). Sous lg, il est remplacé par une bande d'onglets horizontale défilante, et la mise en page n'utilise une grille qu'à partir de lg. J'ai mesuré moi-même la page avec Playwright sur le build démo, aux largeurs de l'audit. À 375 px : champ Sujet de 301 px (contre 65), résultat de 309 px (contre 72), boutons Copier/Markdown/PDF/Imprimer/Favori tous visibles (PDF à droite = 293 px), aucun défilement horizontal. À 320 px : Sujet de 246 px et scrollWidth égal à 320.

*Preuves :* src/components/generate/ToolPicker.tsx ; src/pages/GeneratePage.tsx ; e2e/web-mobile.spec.ts (390 et 430 px, réussis) ; script de vérification ponctuel hors dépôt : verif-e18/mobile/check.mjs et gen-375.png / gen-320.png

<a id="14"></a>
### #14 — Mode démo : « Sauvegardé dans votre historique » affiché alors que rien n'est enregistré ; Historique, Favoris et stats toujours vides

**FIXED** · 🟡 fonctionnalité cassée · signalé dans `src/pages/GeneratePage.tsx:591`

En mode démo, les générations sont réellement enregistrées dans localStorage (DemoDataStore.add), et l'historique, les favoris et les statistiques lisent ce même stockage via la couche runtime commune. « Enregistré » ne s'affiche que si le moteur a confirmé l'enregistrement (done.saved). En démo, le libellé précise « historique de démonstration (ce navigateur) », et un échec d'écriture produit un avertissement STORAGE_ERROR avec « Non enregistré ». Le compteur « 20 / 20 » a disparu. Seule différence restante : le formulaire n'est pas restauré après Précédent, mais le contenu reste accessible dans l'Historique et n'est donc plus perdu.

*Preuves :* src/lib/runtime/demo.ts ; src/lib/generation/result.ts ; tests/demo/demo.test.ts ; E2E web tests 5 (enregistrement) et 12 (historique, favori, suppression, statistiques exactes) réussis

<a id="15"></a>
### #15 — Historique, Favoris et Dashboard : aucune gestion d'erreur des appels API (spinner infini, liste vide trompeuse, actions qui échouent en silence)

**FIXED** · 🟡 bug · signalé dans `src/pages/HistoryPage.tsx:18`

Le client HTTP rejette toute réponse non OK ou non JSON (par exemple une page index.html) avec une erreur typée, et une panne réseau devient NETWORK_ERROR. Il ne renvoie plus jamais [] à tort. L'historique et les favoris (useGenerationList), le détail et le tableau de bord gèrent chacun un état « error » avec un bandeau visible et un bouton « Réessayer », et ignorent les réponses arrivées après démontage. Les mutations sont protégées par try/catch : pour le favori, bascule optimiste annulée en cas d'échec avec un toast d'erreur ; pour la suppression, un toast « Suppression impossible » et l'élément reste listé.

*Preuves :* src/lib/runtime/http.ts ; src/components/history/useGenerationList.ts ; src/components/history/HistoryView.tsx ; src/pages/DashboardPage.tsx ; tests/ui/historyView.test.tsx ; tests/ui/dashboard.test.tsx

<a id="16"></a>
### #16 — Politiques RLS toutes à USING(true) et RPC increment_usage exécutable par PUBLIC

**FIXED** · 🟡 sécurité · signalé dans `supabase-schema.sql:57`

Le script supprime toutes les anciennes politiques (y compris les USING(true)), ainsi que la table usage et increment_usage. Il active RLS sans aucune politique et retire tous les droits de PUBLIC, anon et authenticated sur les tables comme sur les fonctions. Les fonctions sont en SECURITY DEFINER avec search_path figé et ne sont exécutables que par service_role. Je l'ai vérifié sur un PostgreSQL 16 local (rôles Supabase simulés, droits par défaut ouverts), en migration depuis l'ancien schéma de l'audit comme sur une base neuve : 0 politique, 0 droit anon/authenticated, proacl limité à service_role, et « permission denied » pour anon et authenticated sur generations comme sur magistra_register_request.

*Preuves :* supabase-schema.sql ; tests/server/deploy.test.ts ; script de vérification ponctuel hors dépôt : verif-e18/pg.sh (sortie : policies|0, increment_usage|0, fn … {postgres=X,service_role=X}, « ERROR: permission denied for table generations »)

<a id="17"></a>
### #17 — Génération synchrone non streamée (jusqu'à 8000 tokens) sans maxDuration, sans timeout ni annulation

**FIXED** · 🟡 build/déploiement · signalé dans `vercel.json:1`

La génération est streamée de bout en bout, en NDJSON avec une ligne de maintien toutes les 15 s. vercel.json fixe maxDuration à 300 pour api/generate.ts, et le serveur applique un délai global AI_TIMEOUT_SECONDS=280 (renvoie AI_TIMEOUT), plus des délais de premier fragment et d'inactivité côté fournisseur. max_tokens est configurable (6 000 par défaut). Côté client, un AbortController et un bouton Arrêter sont branchés sur fetch. La déconnexion du client annule le pipeline et l'appel à l'IA, et rien n'est enregistré dans ce cas.

*Preuves :* vercel.json ; server/handlers.ts ; server/node.ts (sendEventStream, heartbeat), 222-228 ; shared/ai/openaiCompatible.ts ; src/lib/runtime/web.ts ; tests/server/generate.test.ts ; tests/server/deploy.test.ts ; E2E web test 9 « arrêter une génération » réussi

<a id="18"></a>
### #18 — Quota non atomique : des requêtes simultanées dépassent la limite de 20 générations par jour

**FIXED** · 🟡 bug · signalé dans `api/generate.ts:409`

Le quota quotidien de 20 a été retiré volontairement (génération illimitée). La seule limite restante, l'anti-abus RATE_LIMIT_PER_MINUTE, est réservée de façon atomique AVANT l'appel à l'IA : la RPC magistra_begin_generation (qui a remplacé magistra_register_request) prend un verrou pg_advisory_xact_lock par utilisateur, compte les demandes, refuse ou insère dans la même transaction. Il n'y a plus de lecture puis incrémentation après génération, ni de valeur « remaining » fausse. MemoryStore est atomique, JavaScript s'exécutant sur un seul fil. Test de concurrence réel sur PostgreSQL 16 : 12 appels simultanés avec un maximum de 3 donnent exactement 3 acceptés et 9 refusés, avec 3 lignes enregistrées.

*Preuves :* supabase-schema.sql (ligne 250 : verrou) ; server/handlers.ts ; server/store.ts ; tests/server/generate.test.ts ; script de vérification ponctuel hors dépôt : verif-e18/pg.sh, section « concurrence » : « 3 t / 9 f », count=3

<a id="19"></a>
### #19 — Erreurs Anthropic (401/404/429/529) toutes converties en 502 générique, sans nouvel essai

**FIXED** · 🟡 bug · signalé dans `api/generate.ts:436`

Anthropic est supprimé. Les erreurs du serveur d'IA sont distinguées : 401/403 → AI_AUTH_FAILED, modèle absent → MODEL_NOT_INSTALLED, 404 → adresse incorrecte, 429 → AI_BUSY, 408/504 → AI_TIMEOUT, 5xx → AI_SERVER_UNAVAILABLE, chacune avec un message français précis. Le pipeline réessaie maintenant automatiquement (2 s puis 5 s) quand le serveur est surchargé ou indisponible AVANT le premier mot, en l'annonçant (« nouvel essai automatique dans 2 s… ») ; jamais après le premier mot (pas de texte dupliqué) ni après « Arrêter ». La place de concurrence reste tenue pendant les essais. En local, un délai dépassé est annoncé comme venant du moteur local, pas d'un « serveur ».

*Preuves :* shared/ai/openaiCompatible.ts (mapHttpError, localizeEngineError) ; shared/pipeline.ts (TRANSIENT_AI_ERRORS, DEFAULT_RETRY_DELAYS_MS) ; tests/shared/pipeline.test.ts (surcharge passagère → succès ; surcharge persistante ; arrêt pendant l'attente) ; tests/server/generate.test.ts ; tests/shared/ai.ollama.test.ts

*Remarque :* L'en-tête Retry-After du serveur d'IA n'est pas lu : les attentes sont fixes (2 s, 5 s).

*Mise à jour (lot « branchement réel de l'IA ») :* cette remarque est dépassée. Retry-After, `x-ratelimit-reset*` et les en-têtes transmis dans le corps de l'erreur sont maintenant lus. Un 429 avec une attente de 15 s au plus reste AI_BUSY : le pipeline attend la durée indiquée au lieu de 2 s puis 5 s. Un quota (journalier, crédits épuisés, 402, 413 « tokens par minute », attente de plus de 15 s) donne AI_QUOTA_EXCEEDED avec l'heure de reprise, et une adresse injoignable donne AI_SERVER_UNREACHABLE : dans ces deux cas, aucun nouvel essai automatique, seulement « Réessayer ». Voir [ARCHITECTURE_IA.md](ARCHITECTURE_IA.md) § 8 et § 15 ; shared/ai/errorMapping.ts (mapHttpError, mapNetworkError) ; tests/shared/ai.errors.test.ts ; tests/shared/pipeline.test.ts.

<a id="20"></a>
### #20 — stop_reason ignoré : une réponse tronquée à max_tokens est sauvegardée et affichée comme complète

**FIXED** · 🟡 bug · signalé dans `api/generate.ts:443`

Les deux fournisseurs lisent la raison de fin : finish_reason « length » / « max_tokens » pour OpenAI, done_reason « length » pour Ollama. Un flux coupé sans fin explicite donne « unknown ». Le pipeline émet alors un avertissement GENERATION_TRUNCATED, enregistre truncated=true et le renvoie dans l'évènement done. L'interface affiche le badge « Contenu tronqué » et l'avertissement, et le détail d'historique affiche une note. L'ancien compteur tokens_used (qui ne comptait que les tokens de sortie) a été supprimé avec le quota.

*Preuves :* shared/ai/openaiCompatible.ts ; shared/ai/ollama.ts ; shared/pipeline.ts ; server/store.ts (colonne truncated) ; src/components/generate/ResultPanel.tsx ; src/components/history/GenerationDetail.tsx ; tests/shared/pipeline.test.ts (finish length → avertissement + truncated) et :149 (unknown) ; tests/shared/ai.openai.test.ts

*Remarque :* Point mineur, hors du scénario décrit : un finish_reason « content_filter » (serveurs de type Azure) est assimilé à « stop » (openaiCompatible.ts). Une réponse coupée par un filtre de modération serait donc présentée comme complète.

<a id="21"></a>
### #21 — Un échec de sauvegarde Supabase fait perdre la génération déjà payée ; type d'outil non validé avant l'appel Anthropic

**FIXED** · 🟡 bug · signalé dans `api/generate.ts:452`

La demande est validée avant tout appel à l'IA et avant l'anti-abus : type absent de la liste blanche des 11 outils → 400 « Type de contenu inconnu. ». La contrainte CHECK SQL correspond exactement à ALL_TYPES. La sauvegarde a son propre try/catch avec un délai maximal de 60 s. En cas d'échec, l'utilisateur reçoit un avertissement STORAGE_ERROR puis done{content, saved:false} : le contenu n'est jamais perdu. Vérifié par verif-19-36/store-fail.ts : sauvegarde en échec → [sources, warning STORAGE_ERROR, done saved:false avec le contenu] ; type 'zzz' ou 'quiz' → 400 et 0 appel à l'IA.

*Preuves :* shared/validation.ts ; server/handlers.ts (validation avant getProvider et registerRequest) ; electron/generation.ts ; shared/pipeline.ts ; supabase-schema.sql vs shared/catalog.ts ; src/lib/generation/result.ts ; tests/server/generate.test.ts ; tests/shared/pipeline.test.ts ; script de vérification ponctuel hors dépôt : verif-19-36/store-fail.ts

<a id="22"></a>
### #22 — Un échec de la RPC increment_usage renvoie 500 alors que la génération est sauvegardée

**NOT APPLICABLE** · 🟡 bug · signalé dans `api/generate.ts:467`

Le quota quotidien, la table usage et la RPC increment_usage ont été supprimés : le script SQL les retire, et plus rien n'est appelé après la sauvegarde. Seul reste un compteur anti-abus technique (magistra_begin_generation, qui a remplacé magistra_register_request), appelé AVANT la génération. S'il tombe en panne, l'erreur est journalisée et la requête acceptée. Vérifié avec verif-19-36/store-fail.ts : compteur en échec → flux [sources, done], aucune erreur.

*Preuves :* supabase-schema.sql (DROP FUNCTION increment_usage, DROP TABLE usage) ; server/handlers.ts ; shared/pipeline.ts (rien après la sauvegarde sauf l'évènement done) ; script de vérification ponctuel hors dépôt : verif-19-36/store-fail.ts (cas 2) ; tests/server/concurrency.test.ts (compteur partagé indisponible : demande acceptée et journalisée)

<a id="23"></a>
### #23 — Electron : génération impossible sans clé Supabase service_role

**NOT APPLICABLE** · 🟡 fonctionnalité cassée · signalé dans `electron/main.ts:134`

L'application Windows n'utilise plus du tout Supabase, Clerk ni Anthropic. Le processus principal valide la demande, résout le fournisseur local (Ollama) ou un serveur distant choisi dans les réglages, puis enregistre dans des fichiers JSON locaux (LocalStore, userData). Il n'y a ni quota ni compteur, et aucune clé n'est demandée. L'ancien repli ANTHROPICKEY n'existe plus.

*Preuves :* electron/generation.ts ; electron/localStore.ts (saveGeneration dans un fichier JSON) ; grep -i 'supabase|service_role|anthropic|clerk' electron/ → aucun résultat ; tests/electron/generation.test.ts ; e2e/electron-local.spec.ts (14 tests avec Ollama simulé)

<a id="24"></a>
### #24 — Déploiement Netlify documenté mais non fonctionnel : aucune fonction /api

**FIXED** · 🟡 build/déploiement · signalé dans `netlify.toml:1`

Correction retenue, conforme à la première option proposée : netlify.toml est supprimé et le README indique que Netlify n'est plus proposé. Les déploiements documentés (Vercel, et un serveur Node autonome) sont fonctionnels. vercel.json déclare les fonctions api/* et une réécriture SPA qui exclut /api/ : /api/history ne peut plus renvoyer index.html.

*Preuves :* netlify.toml absent (ls) ; README.md ; vercel.json (rewrites « /((?!api/).*) », functions api/*.ts) ; tests/server/deploy.test.ts et :37-41 (expect(existsSync('netlify.toml')).toBe(false))

<a id="25"></a>
### #25 — Clerk dans Electron : clés pk_live incompatibles avec http://127.0.0.1:3721 et OAuth Google bloqué dans une fenêtre embarquée

**NOT APPLICABLE** · 🟡 fonctionnalité cassée · signalé dans `src/App.tsx:74`

L'application Windows ne sert plus l'interface depuis http://127.0.0.1:3721 et n'utilise plus Clerk. Dès que le pont IPC est présent, detectMode renvoie 'local' : App rend LocalRuntimeProvider sans ClerkProvider, aucune connexion n'est demandée et le profil est local. L'interface est servie par le protocole app:// sans serveur HTTP. La CSP d'Electron n'autorise d'ailleurs aucun domaine Clerk. Les problèmes pk_live/origine et OAuth Google dans une fenêtre embarquée ne peuvent donc plus se produire.

*Preuves :* src/lib/runtime/context.ts ; src/App.tsx ; electron/main.ts (protocol.handle app://) ; electron/security.ts (CSP sans clerk) ; e2e/electron-local.spec.ts

<a id="26"></a>
### #26 — Aucun moyen de supprimer son compte ou ses données : les générations restent dans Supabase après suppression du compte Clerk

**FIXED** · 🟡 cohérence des données · signalé dans `src/components/layout/AppLayout.tsx:268`

Réglages → « Supprimer toutes mes données Magistra » (DELETE /api/account) efface générations, profil, compteurs et générations en cours de l'utilisateur du jeton ; Windows et la démonstration ont leur équivalent local. La suppression du compte Clerk ne laisse plus de données orphelines : le webhook POST /api/clerk-webhook reçoit l'évènement user.deleted et appelle la même suppression (idempotente). La signature Svix est vérifiée sans dépendance (HMAC-SHA256, comparaison en temps constant, tolérance de 5 min, corps borné) ; sans CLERK_WEBHOOK_SECRET, la route répond 503 et un problème de configuration est journalisé.

*Preuves :* server/clerkWebhook.ts ; api/clerk-webhook.ts ; vercel.json ; server/handlers.ts (account) ; tests/server/clerkWebhook.test.ts (signature valide / invalide / expirée, rejeu, suppression effective, secret absent) ; README (procédure Clerk) ; .env.example

*Remarque :* Pas d'export global des données en un seul fichier (chaque contenu s'exporte en Markdown ou PDF).

<a id="27"></a>
### #27 — Profil enseignant uniquement en localStorage global : partagé entre comptes, jamais synchronisé et jamais transmis aux prompts

**FIXED** · 🟡 cohérence des données · signalé dans `src/hooks/useTeacherProfile.ts:12`

Web : le profil est stocké côté serveur (table profiles, champ data) et lu ou écrit par /api/profile, filtré par l'utilisateur du jeton Clerk. Le cache local est nommé magistra_profile_<userId> et n'est lu qu'en cas de NETWORK_ERROR. useProfile rattache le profil au magasin du compte courant : après un changement de compte, l'ancien profil n'est jamais affiché. Windows : profil dans le stockage local. Démo : localStorage. Le profil (niveaux, matières, spécialité) est transmis au modèle, et le courrier aux parents utilise le nom et l'établissement comme signataire, sinon des crochets à compléter.

*Preuves :* src/lib/runtime/web.ts ; src/lib/runtime/RuntimeProvider.tsx ; server/handlers.ts ; server/store.ts ; src/lib/generation/request.ts ; shared/validation.ts ; shared/prompts/index.ts ; shared/prompts/tools.ts ; tests/shared/prompts.test.ts ; tests/server/auth.test.ts

*Remarque :* Remarque mineure, hors du comportement décrit : la copie locale magistra_profile_<userId> (nom, établissement) n'est pas effacée à la déconnexion. Elle reste lisible dans le stockage du navigateur d'un poste partagé, mais n'est jamais présentée à un autre compte.

<a id="28"></a>
### #28 — Contrastes de texte très insuffisants (tokens mg-400, mg-500, mg-600)

**FIXED** · 🟡 UX · signalé dans `src/index.css:8`

Les jetons ont été éclaircis : mg-400 #8a8a9e (5,84:1 sur mg-900, 5,56 sur mg-800, 5,10 sur mg-700), mg-300 #9d9db2 (7,43:1). mg-500, mg-600 et mg-700 sont réservés aux fonds et aux bordures. Aucune classe text-mg-500/600/700/800 n'est utilisée dans src (text-mg-900 seulement sur fond clair accent, 10,9:1). Les autres couleurs de texte (accent, danger, warning, success) dépassent 4,5:1 sur les fonds sombres. Calculs refaits par verif-19-36/contrast.mjs.

*Preuves :* src/index.css ; grep « text-mg-(500|600|700|800) » dans src → aucun résultat ; script de vérification ponctuel hors dépôt : verif-19-36/contrast.mjs

<a id="29"></a>
### #29 — Listes du contenu généré sans puces ni numéros (preflight Tailwind)

**FIXED** · 🟡 UX · signalé dans `src/index.css:131`

.prose-content définit explicitement disc, circle, square pour ul et decimal pour ol, avec les marges, les marqueurs colorés et les listes de tâches. Ces styles sont dans @layer components, donc ils l'emportent sur le preflight (base). Le CSS construit contient bien « .prose-content ol{…list-style:decimal} ». MarkdownView applique la classe prose-content.

*Preuves :* src/index.css ; src/components/MarkdownView.tsx ; dist/assets/index-BP25q9cU.css (.prose-content ol{…list-style:decimal}) ; tests/markdown/MarkdownView.test.tsx

<a id="30"></a>
### #30 — Export PDF : mise en forme perdue (séparateurs de tableau transformés en lignes de tirets, pas de titres ni d'en-tête)

**FIXED** · 🟡 UX · signalé dans `src/lib/export.ts:13`

L'export PDF est entièrement réécrit. Le Markdown est analysé en arbre (unified/remark GFM + maths) et chaque nœud est dessiné avec les polices DejaVu. Les tableaux passent par jspdf-autotable (en-têtes en gras) et le séparateur « --- » devient un vrai filet, pas des tirets. Les titres ont des tailles décroissantes et sont en gras. L'en-tête contient le titre, « niveau · matière · type » et la date, avec un en-tête courant et « Page n / N ». Les exports passent title et meta.

*Preuves :* src/lib/export/pdf.ts (styles de titres), 727-730 (titre + métadonnées), 783-789 (filet), 1021-1039 (autoTable), 1053 (decoratePages), 1141-1156 ; src/components/history/logic.ts ; src/lib/generation/result.ts ; tests/pdf/pdf.test.ts (pas de « | --- »), 176 ; tests/pdf/edge-cases.test.ts

<a id="31"></a>
### #31 — Appréciations : le prompt système impose 10 appréciations alors que l'enseignant en demande N

**FIXED** · 🟡 bug · signalé dans `src/lib/prompts.ts:152`

Le prompt système demande « EXACTEMENT N … numérotées de 1 à N. Ni plus, ni moins. », au singulier pour N=1, adapté à la maternelle et au supérieur. Le « 10 » imposé et le libellé ambigu « Nombre d'élèves » ont disparu. N est borné de 1 à 40 côté client et côté serveur (erreur explicite hors bornes), et le résumé de l'interface affiche exactement le nombre qui sera demandé.

*Preuves :* shared/prompts/tools.ts ; shared/validation.ts ; src/lib/generation/request.ts ; tests/shared/prompts.test.ts (EXACTEMENT 7, jamais 10) et :137 ; tests/generate/request.test.ts (« transmet exactement N, borné entre 1 et 40 »)

<a id="32"></a>
### #32 — Différenciation : les profils cochés sont ignorés par le prompt système (« produis 3 versions »)

**FIXED** · 🟡 bug · signalé dans `src/lib/prompts.ts:173`

Un champ dédié profilsDifferenciation (liste blanche renforce / standard / approfondissement, sans doublon) est validé côté serveur. Le prompt système ne liste que les versions cochées, avec leurs libellés et consignes, et ajoute « UNIQUEMENT celles-ci / Ne rédige aucune autre version ». Le « produis 3 versions » a disparu. Le formulaire exige au moins un profil.

*Preuves :* shared/prompts/tools.ts ; shared/validation.ts ; src/lib/generation/request.ts ; tests/shared/prompts.test.ts (2 profils, pas de Standard) et :154 (1 seul profil)

<a id="33"></a>
### #33 — Favoris limités aux 100 dernières générations et historique complet rechargé à chaque page

**FIXED** · 🟡 fonctionnalité cassée · signalé dans `src/pages/FavoritesPage.tsx:20`

/api/history accepte favorites=1 (filtre is_favorite=true côté base, index partiel dédié) et une pagination par curseur (created_at, id), sans plafond de 100. Les listes ne transfèrent que des résumés (colonne excerpt calculée en base, jamais contenu) ; le contenu complet est chargé à la demande via /api/generation?id=. La page Favoris utilise HistoryView favoritesOnly avec « Charger plus ». Le tableau de bord utilise une RPC de statistiques et seulement 5 éléments récents. Windows fait de même en local.

*Preuves :* server/handlers.ts ; server/store.ts ; supabase-schema.sql ; src/components/history/useGenerationList.ts ; src/pages/FavoritesPage.tsx ; src/pages/DashboardPage.tsx ; electron/localStore.ts ; tests/ui/historyView.test.tsx (favoris au-delà de 100), 275 ; tests/server/supabaseStore.test.ts ; tests/electron/localStore.test.ts

<a id="34"></a>
### #34 — Des champs masqués d'un outil précédent sont envoyés, et « Difficulté : moyen » est ajouté à tous les outils

**FIXED** · 🟡 bug · signalé dans `src/pages/GeneratePage.tsx:78`

La requête est construite par une liste blanche unique : visibleFields(tool, niveau), dérivée de TOOL_FIELDS, pilote à la fois l'affichage des champs et leur envoi. Les champs masqués d'un autre outil ne sont donc jamais transmis. La difficulté n'a plus de valeur par défaut ('' = rien envoyé) et n'existe que pour exercices et évaluation. Le prompt utilise des libellés rédigés, pas le code « differencie ». Défense en profondeur : validateGenerationRequest et buildUserPrompt refiltrent aussi par TOOL_FIELDS.

*Preuves :* src/lib/generation/request.ts ; src/components/generate/GenerateFormFields.tsx ; shared/validation.ts ; shared/prompts/index.ts ; shared/prompts/tools.ts ; tests/generate/request.test.ts (dont « les champs saisis pour un autre outil ne sont pas envoyés », « aucune difficulté par défaut ») ; tests/shared/prompts.test.ts

<a id="35"></a>
### #35 — Double soumission : la touche Entrée relance une génération pendant qu'une autre est en cours

**FIXED** · 🟡 bug · signalé dans `src/pages/GeneratePage.tsx:306`

handleSubmit ignore toute soumission pendant une génération (if (generation.isRunning) return) et le bouton est désactivé. useGeneration.start annule de toute façon la requête précédente (AbortController) et ignore les évènements d'un ancien run. Côté Windows, GenerationManager refuse une seconde génération simultanée (GENERATION_BUSY).

*Preuves :* src/pages/GeneratePage.tsx ; src/hooks/useGeneration.ts ; electron/generation.ts ; e2e/web-demo.spec.ts (double-clic = une seule génération, Entrée sans doublon) ; tests/electron/generation.test.ts

<a id="36"></a>
### #36 — Boutons à icône seule sans nom accessible, état des boutons de sélection non exposé

**FIXED** · 🟡 UX · signalé dans `src/pages/HistoryPage.tsx:122`

Tous les boutons à icône seule ont un aria-label et une infobulle (Favori avec aria-pressed, Copier, Exporter en Markdown/PDF, Imprimer, Supprimer ; Ouvrir/Fermer le menu avec aria-expanded et aria-controls). Le tiroir mobile se ferme par Échap, piège le focus et rend le focus au bouton Menu. L'onboarding expose aria-pressed sur cycle, classes et matière, et ses labels sont associés (htmlFor). Le scan AST de tous les .tsx (verif-19-36/scan2.cjs) ne trouve aucun bouton sans nom accessible.

*Preuves :* src/components/history/GenerationDetail.tsx ; src/components/layout/AppLayout.tsx ; src/pages/OnboardingPage.tsx ; tests/ui/historyView.test.tsx ; tests/ui/appLayout.test.tsx ; e2e/web-demo.spec.ts ; e2e/web-mobile.spec.ts ; script de vérification ponctuel hors dépôt : verif-19-36/scan2.cjs

<a id="37"></a>
### #37 — Suppression d'un contenu sans confirmation ni annulation

**FIXED** · 🟡 UX · signalé dans `src/pages/HistoryPage.tsx:130`

L'icône corbeille (Historique et Favoris, tous deux servis par HistoryView) ne supprime plus rien directement : elle ouvre une ConfirmDialog accessible (rôle alertdialog, focus initial sur « Annuler », Échap et clic sur le fond annulent). La suppression n'est lancée par confirmDelete qu'après « Supprimer », et l'élément n'est retiré de la liste qu'une fois le store en succès (sinon un toast d'erreur s'affiche).

*Preuves :* src/components/history/GenerationDetail.tsx (onRequestDelete) ; src/components/history/HistoryView.tsx (confirmDelete), 283-292 (ConfirmDialog danger) ; src/components/ui/ConfirmDialog.tsx ; tests/ui/historyView.test.tsx « suppression avec confirmation (Annuler ne supprime rien) » (réussi) ; e2e/web-demo.spec.ts ; e2e/electron-local.spec.ts

<a id="38"></a>
### #38 — Affirmations non fondées : « Open-source » sans licence, « RGPD-compliant », « Aucune donnée élève collectée »

**FIXED** · 🟡 docs · signalé dans `src/pages/LandingPage.tsx:106`

LICENSE MIT ajoutée et "license": "MIT" dans package.json. Les mentions « RGPD-compliant », « Aucune donnée élève », « Programmes 2026 », « 30 niveaux » et « Hébergement EU » ont disparu (les chiffres sont calculés depuis le catalogue). Google Fonts est remplacé par @fontsource auto-hébergé : aucune requête externe mesurée sur la landing. Les textes de confidentialité décrivent le flux réel (serveur Magistra puis serveur d'IA de l'administrateur), une suppression de toutes les données existe, et le travail d'élève n'est pas stocké (seule sa longueur l'est).

*Preuves :* LICENSE ; package.json ; index.html (aucun fonts.googleapis) + src/main.tsx ; src/pages/LandingPage.tsx ; src/lib/runtime/web.ts ; src/pages/SettingsPage.tsx ; shared/pipeline.ts ; src/components/generate/GenerateFormFields.tsx ; README.md ; tests/ui/landing.test.tsx (réussi) ; e2e/web-demo.spec.ts ; verif-issues37-54/landing.cjs : external=[]

*Remarque :* Pistes non bloquantes : aucun avertissement explicite du type « n'y collez pas de données nominatives » dans l'outil Corrigé, et aucune liste des sous-traitants (Clerk, hébergeur) côté web. Cette liste relève de l'établissement qui déploie.

<a id="39"></a>
### #39 — Onboarding : matière par défaut 'francais' enregistrée même quand elle n'existe pas pour le niveau (maternelle, changement de cycle)

**FIXED** · 🟡 cohérence des données · signalé dans `src/pages/OnboardingPage.tsx:33`

L'onboarding ne stocke plus de matière par défaut figée. La matière effective est calculée par defaultMatiereFor(premier niveau, choix) : un choix qui n'existe pas au niveau est remplacé par la première matière disponible, et le supérieur reçoit « autre ». Changer de cycle revalide donc la matière. La page Générer revalide aussi le couple niveau/matière (pickMatiere, buildRequest), et les Réglages affichent le libellé plutôt que le code brut.

*Preuves :* src/pages/OnboardingPage.tsx ; shared/catalog.ts ; src/lib/generation/request.ts ; src/pages/SettingsPage.tsx ; tests/ui/onboarding.test.tsx (maternelle → langage_oral, jamais « français »), :70 (changement de cycle), :159 (ancien profil incohérent corrigé), tous réussis

*Remarque :* Défense en profondeur seulement : server/profile.ts et electron/validate.ts ne vérifient pas la cohérence niveau/matière d'un profil envoyé directement à l'API, sans effet sur les parcours de l'interface.

<a id="40"></a>
### #40 — Electron : écran blanc au rechargement (Ctrl+R) ou au retour de Clerk sur une route à deux niveaux (/app/…)

**FIXED** · 🟡 fonctionnalité cassée · signalé dans `vite.config.ts:94`

vite-plugin-electron est retiré et le build utilise base '/' : dist/index.html référence /assets/… en absolu, donc un rechargement sur /app/history charge les bons scripts. Le serveur HTTP local est remplacé par le protocole app://, qui ne renvoie index.html qu'aux routes sans extension et répond 404 à un fichier manquant (plus de script servi en text/html). En mode local, il n'y a plus de retour Clerk.

*Preuves :* vite.config.ts (base: '/') ; dist/index.html (src="/assets/index-….js") ; electron/protocol.ts ; tests/electron/protocol.test.ts « repli SPA uniquement pour les routes sans extension » (réussi) ; e2e/electron-local.spec.ts (page.reload() sur app://magistra/app/history → titre affiché, #root non vide)

<a id="41"></a>
### #41 — .gitignore n'ignore pas .env alors que le README demande d'y mettre les clés

**FIXED** · ⚪ sécurité · signalé dans `.gitignore:15`

.gitignore ignore désormais .env et .env.* (sauf .env.example), ainsi que *.tsbuildinfo, .vercel et .netlify. Vérifié avec git check-ignore : .env, .env.production, .env.local et .env.development.local sont ignorés, .env.example reste suivi.

*Preuves :* .gitignore:29-34 ; git check-ignore : IGNORED .env / .env.production / .env.local, NOT IGNORED .env.example

<a id="42"></a>
### #42 — Prompts dupliqués entre api/generate.ts et src/lib/prompts.ts, plus une 3e variante morte dans ai.ts (et storage.ts inutilisé)

**FIXED** · ⚪ qualité de code · signalé dans `api/generate.ts:93`

Les prompts n'existent plus qu'à un seul endroit : shared/prompts (index, levels, tools), utilisé uniquement par shared/pipeline.ts, lui-même appelé par le serveur web et par Electron. api/generate.ts n'est plus qu'un adaptateur d'une ligne. src/lib/ai.ts, src/lib/prompts.ts, src/lib/storage.ts et VITE_ANTHROPIC_API_KEY ont été supprimés. Le typage Record<TypeContenu, …> rend l'oubli d'un outil impossible à la compilation.

*Preuves :* shared/pipeline.ts (seul import de prompts) ; server/handlers.ts et electron/generation.ts (runGeneration) ; api/generate.ts ; shared/prompts/tools.ts ; src/vite-env.d.ts (seule VITE_CLERK_PUBLISHABLE_KEY) ; ls src/lib/{ai,prompts,storage}.ts → absents

<a id="43"></a>
### #43 — Empaquetage Electron : app.asar de 35,5 Mo rempli de 111 paquets npm inutiles, nom d'app « magistra-app », exe non signé

**DEFERRED** · ⚪ build/déploiement · signalé dans `electron-builder.json:9`

Le gonflement est corrigé : main et preload sont regroupés par esbuild et node_modules est exclu, l'app.asar passe de 35,5 Mo / 111 paquets à 10,7 Mo / 0 paquet. Le nom est corrigé : productName « Magistra » dans package.json et electron-builder.json (Magistra.exe, dossier de données « Magistra »). Des fusibles Electron sont activés (RunAsNode, NODE_OPTIONS et --inspect désactivés, intégrité de l'asar vérifiée, chargement depuis l'asar seulement). La SIGNATURE de l'exécutable est reportée : elle exige un certificat de signature de code payant, incompatible pour l'instant avec un projet non lucratif sans budget. Le README l'explique et décrit l'avertissement SmartScreen (« Informations complémentaires » → « Exécuter quand même », téléchargement uniquement depuis la page officielle).

*Preuves :* scripts/build-electron.mjs ; electron-builder.json (files, electronFuses) ; package.json (productName) ; README (section Windows) ; npx electron-fuses read sur les exécutables Linux et Windows construits

*Reste à faire :* Signer Magistra.exe dès qu'un certificat est disponible (par exemple via un programme de signature gratuit pour l'open source).

<a id="44"></a>
### #44 — Application desktop sans mise à jour automatique alors que le modèle est codé en dur

**DEFERRED** · ⚪ build/déploiement · signalé dans `electron-builder.json:44`

La cause citée (modèle commercial codé en dur, retiré à distance) a disparu : les modèles sont open weights, locaux et choisis par l'enseignant. Une vérification de mise à jour est ajoutée : Réglages → À propos → « Rechercher une mise à jour » interroge, au clic seulement, la dernière version publiée du dépôt (URL fixe, redirections limitées à api.github.com, délai 10 s, réponse bornée, lien vérifié) et ouvre la page de téléchargement. La mise à jour AUTOMATIQUE (electron-updater) est reportée : elle suppose un canal de publication (GitHub Releases) qui n'existe pas encore, et la signature du code (n°43) pour éviter les alertes à chaque mise à jour.

*Preuves :* electron/updateCheck.ts ; electron/ipc.ts (canal app:check-update, expéditeur vérifié) ; src/components/UpdateCheck.tsx ; tests/electron/updateCheck.test.ts

*Reste à faire :* Publier les versions sur GitHub Releases puis intégrer electron-updater (NSIS).

<a id="45"></a>
### #45 — Electron : clés API et clé service_role Supabase stockées en clair et renvoyées en clair au renderer

**FIXED** · ⚪ sécurité · signalé dans `electron/main.ts:24`

L'application Windows ne stocke plus aucune clé Anthropic ni service_role Supabase : elle n'utilise que des données locales et Ollama. Le seul secret possible, la clé d'un serveur d'IA distant facultatif, est chiffré par safeStorage (DPAPI sous Windows). Son enregistrement est refusé sans chiffrement sûr (basic_text Linux refusé) ou en http non local, et la clé est effacée si l'adresse du serveur change. Elle n'est jamais renvoyée à la fenêtre (seulement hasApiKey), et config:get-raw a disparu des canaux IPC.

*Preuves :* electron/aiConfig.ts ; shared/ipc.ts (aucun canal get-raw) ; grep supabase/service_role/anthropic dans electron/ → aucun résultat ; tests/electron/aiConfig.test.ts « est chiffrée sur le disque et jamais renvoyée », :48, :117 (réussis)

*Remarque :* Choix assumé : ai-config.json (clé chiffrée DPAPI) reste sur le disque après désinstallation (deleteAppDataOnUninstall: false, electron-builder.json).

<a id="46"></a>
### #46 — Electron : corps JSON invalide → rejet non géré, la requête ne reçoit jamais de réponse (voire le process s'arrête)

**NOT APPLICABLE** · ⚪ bug · signalé dans `electron/main.ts:118`

L'application Windows n'a plus de serveur HTTP local : aucun createServer ni readBody dans electron/. Les échanges passent par IPC (clonage structuré, pas de JSON à analyser). Chaque gestionnaire vérifie l'expéditeur, valide ses arguments et convertit toute erreur en « CODE|message », sans rejet non géré. Côté serveur web, l'équivalent est traité : JSON invalide → 400, corps de plus de 1 Mo → 413.

*Preuves :* electron/main.ts (« Aucun serveur HTTP local ») ; grep createServer/listen( dans electron/ → aucun résultat ; electron/ipc.ts ; server/node.ts ; tests/server/generate.test.ts (réussis)

<a id="47"></a>
### #47 — Electron : favorite/delete renvoient toujours success:true, même quand Supabase refuse

**NOT APPLICABLE** · ⚪ cohérence des données · signalé dans `electron/main.ts:232`

Les gestionnaires Electron handleFavorite et handleDelete, qui appelaient Supabase sans vérifier res.ok, ont disparu : l'application Windows stocke tout localement (LocalStore via IPC). setFavorite lève NOT_FOUND ou STORAGE_ERROR, et delete propage les erreurs d'écriture. L'interface ne retire l'élément qu'après succès. Côté web, le SupabaseStore contrôle error et le nombre de lignes touchées.

*Preuves :* electron/ipc.ts ; electron/localStore.ts ; server/store.ts ; src/components/history/HistoryView.tsx ; tests/electron/localStore.test.ts (setFavorite('inexistant') → NOT_FOUND) ; tests/server/supabaseStore.test.ts (réussis)

<a id="48"></a>
### #48 — Electron : port 3721 déjà occupé, l'erreur est seulement loggée et la fenêtre charge le serveur de quelqu'un d'autre

**NOT APPLICABLE** · ⚪ bug · signalé dans `electron/main.ts:353`

Il n'y a plus de port 3721 ni de serveur local. La fenêtre charge app://magistra, servi par protocol.handle depuis app.asar, donc aucun autre programme ne peut répondre à sa place. Un second lancement est refusé par requestSingleInstanceLock et la fenêtre existante est réactivée.

*Preuves :* electron/main.ts (registerSchemesAsPrivileged app), 284-285 (loadURL(APP_URL)), 425,443 (verrou d'instance unique) ; electron/protocol.ts ; e2e/electron-local.spec.ts (second lancement fermé, une seule fenêtre)

<a id="49"></a>
### #49 — Electron 33 (fin de vie) embarqué dans l'app Windows : 34 advisories non comptées par l'audit prod

**FIXED** · ⚪ sécurité · signalé dans `package.json:38`

Electron passe de 33 (fin de vie) à 44.4.5, avec une CSP stricte sur toutes les réponses app://, une session propre à la fenêtre qui bloque tout réseau (y compris depuis un SharedWorker) et des fusibles de sécurité. L'audit voit maintenant le binaire livré : la CI lance scripts/audit-electron.mjs, qui échoue sur tout avis « high » ou « critical » concernant electron lui-même (même en devDependencies, comme l'exige electron-builder), avertit pour la chaîne d'empaquetage et ignore les autres outils de développement. L'exécution réelle donne 0 vulnérabilité.

*Preuves :* package.json (electron 44) ; .github/workflows/ci.yml (étape d'audit Electron) ; scripts/audit-electron.mjs ; tests/electron/auditElectron.test.ts ; electron/windowSession.ts ; electron/protocol.ts

*Remarque :* La mise à jour des postes déjà installés dépend du n°44 (vérification manuelle en place, mise à jour automatique reportée).

<a id="50"></a>
### #50 — README et textes d'aide obsolètes : clé API « dans Réglages », mode démo, variables serveur, Supabase, npm run dev, Electron

**FIXED** · ⚪ docs · signalé dans `README.md:64`

Le README est réécrit pour la nouvelle architecture. Il ne parle plus de clé API Anthropic ni de « cd magistra-app ». Il couvre les trois modes (Windows/Ollama, web compatible OpenAI, démo) avec leurs vraies conditions, et toutes les variables serveur, documentées aussi dans .env.example. Il mentionne l'exécution de supabase-schema.sql, maxDuration via vercel.json, npm run dev qui sert réellement /api (plugin magistraDevApi), l'abandon de Netlify et une section Electron complète. Les textes d'aide obsolètes (« Cours · Exercices · Évaluations · Séquences », bandeau démo « Connectez-vous ») ont été remplacés.

*Preuves :* README.md ; server/viteDevApi.ts + vite.config.ts ; .env.example:13-98 ; src/pages/DashboardPage.tsx ; src/pages/SettingsPage.tsx ; grep « Clé API Anthropic|magistra-app|vercel dev|17 matières » → aucun résultat

*Remarque :* README.md renvoie vers CORRECTIONS.md, qui n'existe pas encore dans le dépôt : créer ce fichier ou retirer le lien.

<a id="51"></a>
### #51 — Bundle principal de 916 kB chargé dès la landing : aucune route lazy, jsPDF (≈41 %) importé statiquement

**FIXED** · ⚪ performance · signalé dans `src/App.tsx:6`

Toutes les pages sont en React.lazy avec Suspense, et l'export PDF (jsPDF, autotable, polices) est chargé dynamiquement au clic. Un build de vérification (dossier de sortie temporaire) donne un chunk d'entrée de 390,7 kB (128 kB gzip), sans jsPDF, micromark, KaTeX ni pdf.js, contre 916 kB auparavant. La landing charge 407,7 kB de JS au total et aucune requête externe.

*Preuves :* src/App.tsx (lazy) ; src/lib/export/index.ts (import('./pdf'), import('./fonts')) ; verif-issues37-54/dist : index-CP3HnVF3.js 390 692 o, grep jsPDF/micromark/katex/GlobalWorkerOptions = 0 ; landing.cjs : LANDING JS total 407 726 o, external []

*Remarque :* Mineur : les chunks optionnels de jsPDF (html2canvas 201 kB, canvg index.es 159 kB, purify 29 kB) sont toujours émis, jamais chargés, mais présents dans dist et donc dans app.asar. @clerk/react reste dans l'entrée même en mode démo.

<a id="52"></a>
### #52 — Si clerk-js ne se charge pas, /app est une page vide et la landing n'a plus de bouton « Commencer »

**FIXED** · ⚪ fonctionnalité cassée · signalé dans `src/App.tsx:18`

En mode web, WebAuthGuard affiche un spinner « Connexion… » (ClerkLoading), puis un écran d'erreur « Le service de connexion est indisponible » avec un bouton Réessayer (ClerkFailed). Les CTA de la landing proposent aussi « Connexion… » puis « Connexion indisponible — réessayer ». Un ErrorBoundary racine entoure tous les modes. Vérifié en navigateur réel (build avec une clé pk_test, requêtes externes bloquées) : / propose « Réessayer la connexion », et /app, /app/generate et /onboarding affichent le message au lieu d'un #root vide.

*Preuves :* src/App.tsx ; src/components/guards.tsx (AuthUnavailable) ; src/pages/LandingPage.tsx (AccessButton : ClerkLoading/ClerkFailed) ; verif-issues37-54/clerkfail.cjs : PATH /app rootLen=448 buttons=["Réessayer"] ; PATH / buttons=["Réessayer la connexion","Connexion indisponible — réessayer",…] ; clerkloading.cjs : « Connexion… » à 2 s

*Remarque :* Au moment de la vérification, cette correction n'existe que dans l'arbre de travail NON commité (src/App.tsx, src/components/guards.tsx, src/pages/LandingPage.tsx modifiés) : il faut la commiter. Aucun test automatisé (unitaire ou E2E) ne couvre encore l'état ClerkFailed. L'écran d'erreur n'apparaît qu'après environ 15 s, le délai interne de Clerk.

<a id="53"></a>
### #53 — SelectField personnalisé inaccessible (ni ARIA, ni navigation clavier, ni Échap) et labels non associés aux champs

**FIXED** · ⚪ UX · signalé dans `src/components/ui/SelectField.tsx:55`

SelectField implémente le motif bouton + listbox. Le bouton porte aria-haspopup, aria-expanded, aria-controls et un nom accessible qui inclut la valeur. La liste a role=listbox, les options role=option avec aria-selected et aria-activedescendant. Clavier : flèches, Début/Fin, Page préc./suiv., Entrée/Espace, Échap, recherche par lettre ; Tab et la perte de focus ferment la liste. Les libellés Niveau, Matière, Profil et Matière secondaire sont reliés par htmlFor/id et aria-labelledby, et les autres champs par htmlFor.

*Preuves :* src/components/ui/SelectField.tsx ; src/components/generate/GenerateFormFields.tsx ; src/pages/OnboardingPage.tsx ; tests/ui/selectField.test.tsx (réussis)

<a id="54"></a>
### #54 — Contenu généré : titres ####, liens, blocs de code et séparateurs sans aucun style (liens invisibles, code qui déborde)

**FIXED** · ⚪ UX · signalé dans `src/index.css:127`

.prose-content stylise désormais h4-h6 (taille, graisse, marges), les liens (couleur accent et soulignement), code et pre (fond, overflow-x:auto, white-space:pre) et hr (marges de 1,5 rem). Les tableaux sont enveloppés dans un .table-wrap défilant. Vérifié dans l'application réelle (Historique, démo) à 1280 et 390 px : h4 en 600 avec marges, lien souligné de couleur distincte, pre qui défile dans sa boîte (scrollWidth 1394 pour clientWidth 348), aucun défilement horizontal de la page.

*Preuves :* src/index.css ; src/components/MarkdownView.tsx (table-wrap) ; verif-issues37-54/history-prose.cjs : 390 → docScrollW 390 = vw, pre overflowX auto, h4 600/18.4px, a underline rgb(224,212,255), hr 24px

<a id="55"></a>
### #55 — Mode démo : 6 outils sur 11 n'ont pas de démo et renvoient vers une « clé API » introuvable

**FIXED** · ⚪ fonctionnalité cassée · signalé dans `src/lib/ai.ts:572`

Les 11 outils ont maintenant un exemple de démonstration réel, en version scolaire et en version supérieur (seul le cahier journal n'a pas de variante supérieur). Ces exemples sont restitués en flux avec un avertissement honnête (DEMO_NOTICE) qui ne parle plus de « clé API ». Le bloc générique de 240 caractères n'existe plus.

*Preuves :* shared/demo/content.ts (DEMO_CONTENT: Record<TypeContenu,…> impose au typage la présence de tous les outils) ; shared/demo/index.ts (avertissement) ; src/lib/runtime/demo.ts (le mode démo utilise runDemoGeneration) ; tests/demo/demo.test.ts « couvre exactement les 11 outils », :48-64 (250 à 700 mots, aucune mention /cl[ée]\s*api/, anthropic ni claude) ; e2e/web-demo.spec.ts et :279.

<a id="56"></a>
### #56 — apiGenerate : réponses non JSON, 504 et erreurs réseau affichées comme messages bruts en anglais ou trompeurs

**FIXED** · ⚪ bug · signalé dans `src/lib/api.ts:38`

Toutes les erreurs passent par MagistraError avec un message français : 429 → RATE_LIMITED, 504 → AI_TIMEOUT, coupure réseau → NETWORK_ERROR, 502/503 non JSON → « Le serveur Magistra est momentanément indisponible. Réessayez… » (réessayable, et non plus « mal configuré »). Une réponse 200 qui n'est pas le flux de génération (page HTML d'une réécriture SPA, JSON) est détectée : Content-Type application/x-ndjson exigé, évènements validés un par un ; sans aucun évènement lisible, le message est « le service de génération n'est pas accessible à cette adresse » au lieu de « connexion interrompue ».

*Preuves :* src/lib/runtime/http.ts (parseError, readEventStream, NOT_A_STREAM_MESSAGE) ; src/lib/runtime/web.ts ; tests/runtime/http.test.ts (HTML en 200, JSON inconnu, flux coupé, 502/503, erreur JSON du serveur)

*Remarque :* Dans ApiGenerationClient.generate, exiger `application/x-ndjson` pour la réponse 200 (sinon SERVER_MISCONFIGURED). Dans readEventStream, valider event.type. Pour un 502/503 non JSON, renvoyer une erreur « service indisponible » avec nouvelle tentative possible plutôt que « mal configuré, contactez l'administrateur ». Ajouter des tests de http.ts.

<a id="57"></a>
### #57 — Export PDF : texte découpé pour du 16 pt puis dessiné en 11 pt, un tiers de la largeur de page perdu

**FIXED** · ⚪ bug · signalé dans `src/lib/export.ts:18`

L'ancien export (splitTextToSize avec la police par défaut de 16 pt) a été remplacé par un moteur de mise en page. Chaque segment y est mesuré avec la police et la taille réellement dessinées, puis le retour à la ligne se fait sur la largeur utile. Mesure faite : un paragraphe de 335 caractères donne des lignes de 476,6, 462,0 et 469,9 pt pour une largeur utile de 483,28 pt, soit 95 à 99 % de remplissage.

*Preuves :* src/lib/export/pdf.ts (this.fonts.width(seg.text, seg.key, partSize)), :585 (lines(tokens, maxWidth)), :171-179 (use/width avec fontSize explicite) ; tests/pdf/pdf.test.ts « respecte les marges (retour à la ligne mesuré avec la police réellement utilisée) » ; script de vérification ponctuel hors dépôt : verif-55-72/pdfwidth.test.ts (lignes remplies à plus de 85 %, réussi).

*Remarque :* Aucun test du dépôt ne vérifie le taux de remplissage des lignes : les tests ne contrôlent que l'absence de débordement. Ce serait un test de non-régression facultatif.

<a id="58"></a>
### #58 — Quota du Dashboard calculé depuis l'historique et non depuis le compteur serveur (valeurs fausses ou négatives)

**NOT APPLICABLE** · ⚪ cohérence des données · signalé dans `src/pages/DashboardPage.tsx:95`

Le quota quotidien de 20 générations a été supprimé dans toute l'architecture (génération illimitée, table usage et fonction increment_usage supprimées). Le tableau de bord n'affiche plus de quota. Il montre les statistiques exactes renvoyées par store.getStats() : sur le web, elles sont calculées par le serveur (RPC magistra_stats) ; sous Windows et en démo, elles viennent de l'historique local. Un affichage « -5 / 20 » ou « 20 / 20 » n'est plus possible.

*Preuves :* README.md (« ni quota ni compteur ») ; supabase-schema.sql (DROP increment_usage, DROP TABLE usage) ; src/pages/DashboardPage.tsx et 161-190 (stats.today / week / total) ; tests/ui/dashboard.test.tsx « statistiques exactes…, aucun quota » (aucun « / 20 ») ; electron/generation.ts.

<a id="59"></a>
### #59 — Electron en mode démo (build sans VITE_CLERK_PUBLISHABLE_KEY) : le serveur local et les clés saisies ne servent à rien

**NOT APPLICABLE** · ⚪ UX · signalé dans `src/pages/GeneratePage.tsx:92`

L'application Windows ne dépend plus de Clerk ni de clés API. Le mode « local » est choisi dès que le pont IPC window.magistra est présent, quelle que soit la clé Clerk du build. La génération passe par IPC vers Ollama local et l'historique est enregistré dans des fichiers JSON locaux. Le build Electron est documenté dans le README. Si le pont manquait, le mode démo serait explicitement signalé comme tel.

*Preuves :* src/lib/runtime/context.ts (getBridge() → 'local' avant tout test de clé Clerk) ; src/App.tsx (LocalRuntimeProvider) ; src/lib/runtime/local.ts ; README.md et 121 (dev:electron, build:electron) ; e2e/electron-local.spec.ts « génération réelle par IPC avec un document → sources citées → historique → favori… ».

<a id="60"></a>
### #60 — Différenciation : impossible de fournir l'exercice à adapter (champ texte d'une seule ligne)

**FIXED** · ⚪ fonctionnalité cassée · signalé dans `src/pages/GeneratePage.tsx:294`

L'outil Différenciation a une zone de texte multiligne « Exercice ou contenu à adapter » (champ contenuSource). Les retours à la ligne sont conservés côté client et côté serveur. Le contenu est inséré dans le prompt dans un bloc délimité qu'il ne peut pas refermer.

*Preuves :* src/components/generate/GenerateFormFields.tsx (textarea, 6 lignes) ; shared/catalog.ts ; src/lib/generation/request.ts et 271 ; shared/validation.ts (\n conservé) ; shared/prompts/index.ts ; shared/prompts/tools.ts ; tests/generate/request.test.ts ('Exercice 1\nExercice 2' conservé) ; tests/shared/prompts.test.ts.

<a id="61"></a>
### #61 — Aucun moyen d'ajouter un favori depuis la page Générer

**FIXED** · ⚪ fonctionnalité cassée · signalé dans `src/pages/GeneratePage.tsx:562`

La barre d'actions du résultat affiche un bouton « Favori » (bascule optimiste, annulée en cas d'échec avec un message d'erreur). Il utilise l'identifiant renvoyé par l'évènement done et store.setFavorite, dans les trois modes (web, Windows, démo). Le bouton n'apparaît que si le contenu a bien été enregistré.

*Preuves :* src/components/generate/ResultPanel.tsx ; shared/pipeline.ts (done contient id) ; e2e/web-demo.spec.ts (clic sur Favori → aria-pressed=true → isFavorite dans l'historique et le détail).

<a id="62"></a>
### #62 — « Passer cette étape » saute tout l'onboarding et enregistre un profil vide (voire écrase un profil existant)

**FIXED** · ⚪ UX · signalé dans `src/pages/OnboardingPage.tsx:331`

« Passer cette étape » n'apparaît que sur les étapes facultatives (1 et 3) et passe seulement à l'étape suivante (goTo(step+1)). Il n'enregistre plus rien. Les niveaux sont obligatoires. Un profil existant ouvre le mode édition et n'est jamais écrasé sans clic explicite sur « Enregistrer ».

*Preuves :* src/pages/OnboardingPage.tsx (SKIPPABLE_STEPS = {1,3}), :543-549, :124-129 (profil existant → mode édition), :168-183 (seule handleSave écrit) ; tests/ui/onboarding.test.tsx « pas de « Passer » (bienvenue), Continuer désactivé », :149 « un profil existant n'est jamais écrasé sans action explicite ».

<a id="63"></a>
### #63 — Réglages Electron › Clés API : « Configurées » affiché à tort, clés effacées par une sauvegarde à vide, erreurs d'écriture ignorées

**NOT APPLICABLE** · ⚪ bug · signalé dans `src/pages/SettingsPage.tsx:39`

La section Clés API (anthropicKey, supabaseUrl, supabaseServiceKey dans config.json, config:set) a disparu avec Anthropic et Supabase côté Electron. Elle est remplacée par une clé facultative pour un serveur d'IA distant, qui évite chacun des défauts décrits. Un champ vide conserve la clé. La suppression passe par une case explicite. Les valeurs sont nettoyées (trim) et l'URL validée. L'état hasApiKey vient de la réponse du processus principal, après écriture. Les erreurs d'écriture ou de chiffrement sont propagées et affichées. La clé est chiffrée et exige https.

*Preuves :* src/components/ai/AdvancedAIOptions.tsx (trim, validation, `apiKey.trim() ? … : removeKey ? '' : {}`, message selon le résultat), :320-336 ; electron/aiConfig.ts (persist → STORAGE_ERROR), :207-229 ; tests/electron/aiConfig.test.ts (clé chiffrée, jamais renvoyée, conservée si champ absent, supprimée si '').

<a id="64"></a>
### #64 — Script SQL non idempotent : une deuxième exécution échoue

**FIXED** · ⚪ build/déploiement · signalé dans `supabase-schema.sql:36`

supabase-schema.sql est idempotent : suppression dynamique des politiques, CREATE INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS avant CREATE TRIGGER, CREATE OR REPLACE FUNCTION, DROP CONSTRAINT IF EXISTS avant ADD, migrations conditionnelles. Vérifié sur un PostgreSQL 16 local : 3 exécutions sur une base vide donnent 0 erreur. Avec l'ancien schéma (commit 5a7c4b5) et des données, le nouveau schéma exécuté 2 fois donne 0 erreur et les données sont migrées. À titre de contrôle, l'ancien schéma exécuté deux fois donne 14 erreurs. Nouvel essai sur la version modifiée entre-temps : toujours 0 erreur.

*Preuves :* supabase-schema.sql (« IDEMPOTENT »), :31-43, :60, :178-193, :210 (DROP TRIGGER IF EXISTS) puis CREATE TRIGGER ; exécutions psql conservées dans script de vérification ponctuel hors dépôt : verif-55-72 (old-schema.sql, new-schema.sql, new-schema2.sql).

<a id="65"></a>
### #65 — tsconfig ne couvre que src/ : api/ et electron/ ne sont jamais typecheckés (7 erreurs cachées)

**FIXED** · ⚪ qualité de code · signalé dans `tsconfig.json:22`

tsconfig.json est une configuration à références (app, node, test). tsconfig.node.json couvre shared, server, api, electron, scripts et vite.config.ts avec la lib ES2023 sans DOM et types ["node"]. `tsc -b` est lancé par build, typecheck et la CI. api/*.ts n'importe plus @vercel/node. Le typecheck est bien effectif : `npx tsc -p tsconfig.node.json` couvre 36 fichiers de api/, electron/ et server/. Il signale actuellement une erreur réelle (server/handlers.ts : registerRequest absent de GenerationStore) due à la modification de server/store.ts en cours par un autre agent.

*Preuves :* tsconfig.json ; tsconfig.node.json (include shared, server, api, electron, scripts, vite.config.ts ; lib ES2023 ; types node) ; package.json scripts build/typecheck = « tsc -b » ; .github/workflows/ci.yml ; api/generate.ts (createRouteHandler de server/node.js).

*Remarque :* Aucun reste pour ce problème. À noter : le dépôt de travail actuel ne passe pas tsc (état transitoire des modifications concurrentes de server/store.ts et server/handlers.ts), et tests/server/supabaseStore.test.ts échoue (1 test) pour la même raison.

<a id="66"></a>
### #66 — .env.example copié tel quel : l'app reste bloquée au lieu de passer en mode démo

**FIXED** · ⚪ docs · signalé dans `.env.example:2`

.env.example laisse VITE_CLERK_PUBLISHABLE_KEY vide, et une valeur vide donne undefined, donc le mode démo. Après `cp .env.example .env`, le site démarre en démonstration. Si une clé invalide est saisie à la main, l'écran n'est plus blanc : un message « service de connexion indisponible » s'affiche (ClerkFailed).

*Preuves :* .env.example:13 (`VITE_CLERK_PUBLISHABLE_KEY=`) ; src/lib/runtime/context.ts et 16-20 ; src/App.tsx et 92-98 ; src/components/guards.tsx ; src/pages/LandingPage.tsx ; tests/server/deploy.test.ts.

*Remarque :* Facultatif : valider la clé (isPublishableKey) pour qu'une valeur fictive saisie à la main bascule aussi en mode démo.

<a id="67"></a>
### #67 — API Vercel : corps de requête absent → exception non gérée ou 500 au lieu de 400

**FIXED** · ⚪ bug · signalé dans `api/favorite.ts:14`

Toutes les routes passent par handleNodeRequest et handleApi, qui ne lèvent jamais d'exception. readJsonBody renvoie 400 INVALID_REQUEST « Corps de requête manquant. » si le corps est absent, vide, non JSON ou déjà analysé comme undefined par Vercel.

*Preuves :* server/node.ts et 89-117 (l.105 : body undefined/null → 400), :203-250 ; server/handlers.ts (requireObject) ; tests/server/node.test.ts. Script script de vérification ponctuel hors dépôt : verif-55-72/api6768.test.ts : PATCH sans corps → 400, POST /api/generate sans corps → 400, fonction Vercel avec req.body undefined → 400 JSON.

<a id="68"></a>
### #68 — API Vercel favorite/delete : succès renvoyé même si aucune ligne n'est modifiée, isFavorite non validé

**FIXED** · ⚪ bug · signalé dans `api/favorite.ts:28`

PATCH et DELETE demandent les lignes modifiées (.select('id')) et renvoient NOT_FOUND (404) si aucune ligne ne correspond, y compris pour une ligne d'un autre compte. isFavorite doit être un booléen, sinon 400.

*Preuves :* server/store.ts et 445-455 (0 ligne → NOT_FOUND) ; server/handlers.ts ; tests/server/supabaseStore.test.ts « aucune ligne renvoyée donne NOT_FOUND » (réussi) ; script de vérification ponctuel hors dépôt : verif-55-72/api6768.test.ts : PATCH {} → 400, isFavorite "oui" → 400, DELETE d'un id inconnu → 404.

<a id="69"></a>
### #69 — Date du quota incohérente : UTC côté serveur, CURRENT_DATE côté SQL, heure locale côté Dashboard

**NOT APPLICABLE** · ⚪ cohérence des données · signalé dans `api/generate.ts:56`

Il n'y a plus de quota quotidien : plus de date UTC côté serveur, plus de CURRENT_DATE ni de compteur SQL. L'anti-abus restant est une fenêtre glissante en secondes basée sur now() en SQL, donc indépendante du fuseau. La seule notion de « jour » restante est la statistique « Aujourd'hui ». Elle est calculée à un seul endroit, côté serveur, dans le fuseau de l'enseignant envoyé par le navigateur (Europe/Paris par défaut).

*Preuves :* supabase-schema.sql (suppression de usage et increment_usage) ; fonction magistra_stats (date_trunc dans p_tz) ; src/lib/runtime/web.ts (envoi de tz) ; server/handlers.ts (stats → normalizeTimeZone) ; tests/server/auth.test.ts « statistiques exactes selon le fuseau » (0 h 30 à Paris compté aujourd'hui) ; magistra_stats exécutée sur PostgreSQL 16 local.

<a id="70"></a>
### #70 — tokens_used ne compte que les tokens de sortie : suivi de consommation et de coût faux

**NOT APPLICABLE** · ⚪ cohérence des données · signalé dans `api/generate.ts:444`

La nouvelle architecture ne fait plus aucun suivi de consommation ni de coût : pas d'API payante (Anthropic supprimé ; Ollama local ou serveur de l'établissement), colonne tokens_used et table usage supprimées, génération illimitée. Les fournisseurs lisent les tokens d'entrée et de sortie, mais rien n'est enregistré : aucun chiffre faux ne peut plus être stocké.

*Preuves :* supabase-schema.sql (DROP TABLE usage) et :163 (DROP COLUMN IF EXISTS tokens_used) ; README.md ; shared/ai/openaiCompatible.ts et 220 et shared/ai/ollama.ts (promptTokens + completionTokens, non persistés) ; aucune occurrence de tokens_used dans server/, electron/ ni src/.

<a id="71"></a>
### #71 — Paramètres de génération partiellement persistés : texte de l'élève, type de courrier, trimestre et profils perdus

**FIXED** · ⚪ cohérence des données · signalé dans `api/generate.ts:452`

Les paramètres sont enregistrés (colonne params, web et Windows) : trimestre, profil, type de courrier, nombre d'appréciations, profils de différenciation, contenu adapté, durée, objectifs, consignes, difficulté, format, mode de recherche, noms des documents. Le détail de l'historique les affiche (« Paramètres de la demande ») et propose « Reprendre cette demande », qui préremplit le formulaire Générer (valeurs stockées revalidées une à une). Le travail d'élève n'est volontairement pas conservé (donnée personnelle, seule sa longueur est notée) : c'est affiché (« non conservé (N caractères) »), rappelé lors de la reprise (« collez-le à nouveau ») et documenté dans le README et l'aide du champ.

*Preuves :* shared/pipeline.ts (recordParams) ; src/lib/generation/reuse.ts ; src/components/history/GenerationDetail.tsx ; src/pages/GeneratePage.tsx ; tests/generate/reuse.test.ts (reprise fidèle, valeurs hostiles ignorées) ; README (Confidentialité)

*Remarque :* Afficher les paramètres enregistrés (trimestre, profil, type de courrier, profils de différenciation, contenu adapté, documents) dans le détail de l'historique. Ajouter une action « Reprendre cette demande / Régénérer » qui préremplit le formulaire. Documenter dans l'interface ou le README le choix de ne pas conserver la copie de l'élève.

<a id="72"></a>
### #72 — design/untitled.pen : 73 % de gabarit Pencil sans rapport avec Magistra

**FIXED** · ⚪ docs · signalé dans `design/untitled.pen:1`

Le fichier est renommé design/magistra.pen et ne contient plus que les maquettes « Tableau de bord » et « Générer » (gabarits Pencil sans rapport supprimés). Les maquettes sont remises en accord avec l'application : « Généré par Claude » devient « Généré par Magistra · à relire avant usage », le badge de quota « 12 / 20 générations » devient « Générations illimitées », « +18% vs semaine dernière » (statistique inexistante) devient « 12 cette semaine », « 180+ bulletins automatiques » devient « Commentaires de bulletin ». Le README mentionne le dossier design/ et précise qu'il s'agit d'illustrations, pas de la référence fonctionnelle.

*Preuves :* design/magistra.pen (JSON valide) ; README (Structure)

*Remarque :* Mettre les maquettes en accord avec l'application : retirer Claude, le quota « / 20 », « 180+ bulletins » et « +18% ». Mentionner design/magistra.pen (outil Pencil) dans le README.

<a id="73"></a>
### #73 — Build Windows : icône absente (remplacée en silence) et build impossible hors Windows sans wine

**FIXED** · ⚪ build/déploiement · signalé dans `electron-builder.json:31`

Une icône Magistra existe désormais : build/icon.png (512×512) et build/icon.ico (7 tailles). Elle est référencée dans win/linux/mac.icon, copiée dans resources/ via extraResources, et main.ts la lit à cet endroit dans l'application empaquetée. package.json contient description et author (éditeur de l'installeur), le README indique que l'installeur se construit sous Windows, et la CI empaquette sur windows-latest. J'ai vérifié par un `electron-builder --win --x64 --dir` réel sous Linux (sortie dans un dossier temporaire hors dépôt) : aucun avertissement « default Electron icon », « description/author is missed » ni « wine is required », et les 7 images de l'icône sont intégrées dans Magistra.exe.

*Preuves :* electron-builder.json et 45 ; electron/main.ts (iconPath → process.resourcesPath/icon.png) ; package.json (description, author « FutureAI ») ; README.md ; .github/workflows/ci.yml ; script de vérification ponctuel hors dépôt : verif-73-90/release-win/win-unpacked/resources/icon.png et Magistra.exe (7/7 images de .icon-ico/icon.ico retrouvées)

<a id="74"></a>
### #74 — Electron : variables d'environnement de secours avec des noms inattendus (ANTHROPICKEY au lieu d'ANTHROPIC_API_KEY)

**NOT APPLICABLE** · ⚪ bug · signalé dans `electron/main.ts:31`

cfg() et ses noms dérivés (ANTHROPICKEY, SUPABASESERVICEKEY) n'existent plus : Anthropic et Supabase ont disparu d'Electron (aucune occurrence de « anthropic » dans le code). L'IA locale est configurée par ai-config.json, avec une clé chiffrée par safeStorage (electron/aiConfig.ts), et aucun secret n'est lu dans l'environnement. Les seules variables Electron sont des options de développement ignorées quand l'app est empaquetée (electron/devOptions.ts). Côté web, server/config.ts lit des noms explicites (AI_BASE_URL, AI_MODEL, AI_API_KEY, SUPABASE_SERVICE_ROLE_KEY…) : un script de comparaison confirme qu'ils figurent tous dans .env.example, sauf NODE_ENV et VERCEL, fournis par l'hébergeur.

*Preuves :* electron/aiConfig.ts ; electron/devOptions.ts ; server/config.ts (env.AI_*, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.CLERK_*) ; .env.example ; tests/server/status.test.ts, deploy.test.ts

<a id="75"></a>
### #75 — Electron : corps de plus de 64 Ko, caractères accentués corrompus (U+FFFD) avant envoi à Claude

**NOT APPLICABLE** · ⚪ bug · signalé dans `electron/main.ts:94`

Electron n'a plus de serveur HTTP (aucun createServer dans electron/) : la fenêtre passe par l'IPC (ipcMain.handle, clonage structuré), sans découpage en chunks ni décodage de texte. Le chemin équivalent du serveur web accumule des Buffer, les concatène (Buffer.concat) puis décode une seule fois en UTF-8. Test maison : un JSON de 280 Ko coupé au milieu d'un « é » est relu à l'identique, avec 0 U+FFFD. Les flux IA sont décodés avec TextDecoder en mode stream.

*Preuves :* electron/ipc.ts (ipcMain.handle) ; server/node.ts (readStream, Buffer.concat l.74) et l.116 (toString('utf8')) ; shared/ai/streams.ts et 126 (decoder.decode(..., {stream:true})) ; script de vérification ponctuel hors dépôt : verif-73-90/t75 (égal=true, U+FFFD=0) ; tests/shared/ai.openai.test.ts

<a id="76"></a>
### #76 — Serveur Electron : écarts de parité mineurs avec api/*.ts

**NOT APPLICABLE** · ⚪ cohérence des données · signalé dans `electron/main.ts:338`

Le problème de parité disparaît : le serveur HTTP d'Electron n'existe plus, et une seule implémentation HTTP (server/handlers.ts) sert Vercel (api/*.ts → createRouteHandler), le serveur autonome et Vite. Electron (IPC) et le web utilisent le même pipeline (shared/pipeline.ts) et les mêmes prompts (shared/prompts). Les sous-points sont vérifiés côté web : 405 + Allow ; route reconnue par une expression exacte (plus de startsWith) ; message générique pour les erreurs non métier ; requêtes Supabase par supabase-js .eq() avec identifiants validés (USER_ID_PATTERN, UUID, curseur validé) ; prompts sans duplication.

*Preuves :* server/handlers.ts (routeFromPath /^\/api\/([a-z]+)\/?$/), methodNotAllowed ~l.96 ; shared/errors.ts ; server/ids.ts ; server/store.ts decodeCursor l.76-90 et .eq('user_id', uid) ; electron/generation.ts et server/handlers.ts (runGeneration) ; tests/server/generate.test.ts (405), node.test.ts, auth.test.ts

<a id="77"></a>
### #77 — setWindowOpenHandler contournable par préfixe (http://localhost.evil.example) et openExternal sans filtrage

**FIXED** · ⚪ sécurité · signalé dans `electron/main.ts:386`

Aucune fenêtre enfant n'est plus jamais créée : setWindowOpenHandler renvoie toujours {action:'deny'}, pour la fenêtre principale comme pour tout webContents (web-contents-created). Le lien est confié au navigateur du système seulement s'il passe isSafeExternalUrl (http/https uniquement, sans identifiants intégrés, sans caractère de contrôle, longueur bornée) et n'est pas une origine de l'application. L'origine est comparée exactement (originOf), jamais par préfixe. will-navigate, will-frame-navigate et will-redirect sont filtrés, et l'IPC shell:open-external applique le même filtre.

*Preuves :* electron/main.ts (openExternalSafely, deny global), 214-229 ; electron/security.ts (originOf), 66-69 (isTrustedUrl), 113-125 (isSafeExternalUrl) ; electron/ipc.ts ; tests/electron/security.test.ts ; e2e/electron-local.spec.ts (window.open → null, 1 seule fenêtre, liens envoyés au système)

<a id="78"></a>
### #78 — Electron mode dev : URL http://localhost:5173 codée en dur, VITE_DEV_SERVER_URL ignoré et pas de strictPort

**FIXED** · ⚪ bug · signalé dans `electron/main.ts:401`

Plus aucune URL codée en dur (aucun « 5173 » dans electron/ ni scripts/). scripts/dev-electron.mjs démarre Vite puis transmet à Electron l'URL réellement résolue (vite.resolvedUrls) dans VITE_DEV_SERVER_URL. main.ts charge devServerUrl ?? app://magistra/, et devOptions l'ignore dans l'application empaquetée ; seule une adresse de boucle locale est acceptée (parseDevServerUrl). Test maison avec 5173 déjà occupé par un autre serveur : l'URL transmise est http://127.0.0.1:5174/ et sert bien Magistra (strictPort devient inutile). __dirname est défini (main.ts).

*Preuves :* scripts/dev-electron.mjs et 38 ; electron/devOptions.ts ; electron/main.ts et 263 ; electron/security.ts ; tests/electron/security.test.ts ; script de vérification ponctuel hors dépôt : verif-73-90/t78/run.mjs (« URL transmise à Electron : http://127.0.0.1:5174/ | contenu Magistra : true | autre projet : false »)

<a id="79"></a>
### #79 — ESLint analyse les artefacts de build (dist-electron, release)

**FIXED** · ⚪ qualité de code · signalé dans `eslint.config.js:8`

globalIgnores exclut dist, dist-electron, dist-server, release, node_modules, playwright-report, test-results et coverage, et chaque zone du code a sa propre config (navigateur pour src, node pour server/api/electron/scripts). `npx eslint .` sur l'arbre actuel, où dist/, dist-electron/, dist-server/ et test-results/ existent : 207 fichiers analysés, dont aucun dans ces dossiers.

*Preuves :* eslint.config.js et 24-29 ; sortie `npx eslint . -f json` (script de vérification ponctuel hors dépôt : verif-73-90/eslint.json) : 207 fichiers, 0 chemin dist*/release/test-results

<a id="80"></a>
### #80 — Polices chargées depuis Google Fonts : transfert d'IP à Google sans consentement, et dépendance réseau de l'app desktop

**FIXED** · ⚪ sécurité · signalé dans `index.html:12`

Les polices sont auto-hébergées via @fontsource (DM Sans, Instrument Serif, JetBrains Mono), importées dans main.tsx et intégrées au build. index.html ne contient plus aucun lien vers Google, et le build (dist/) ne référence ni fonts.googleapis ni fonts.gstatic. Les CSP (Vercel, serveur autonome, Electron) limitent font-src à 'self' data:, et l'E2E web échoue à la moindre requête vers un domaine externe.

*Preuves :* src/main.tsx ; index.html (aucun lien externe) ; vercel.json et server/standalone.ts (font-src 'self' data:) ; electron/security.ts ; e2e/web-demo.spec.ts ; e2e/web-helpers.ts

<a id="81"></a>
### #81 — Aucun test, aucune CI : les régressions (lint, typecheck, Electron) passent inaperçues

**FIXED** · ⚪ qualité de code · signalé dans `package.json:7`

package.json fournit test (vitest), typecheck (tsc -b sur src, shared, server, api, electron, scripts, tests, e2e), lint et test:e2e. Le dépôt compte 50 fichiers de tests unitaires et d'intégration et 3 specs E2E (web démo, mobile, Electron avec Ollama simulé). La CI GitHub Actions lance à chaque push et PR : lint, typecheck, tests, build web, build serveur, audit prod et licences ; puis l'E2E web, le démarrage réel d'Electron sous xvfb avec l'E2E Electron, et l'empaquetage sous windows-latest. Il n'y a pas de hook pre-commit, que le correctif n'exigeait pas.

*Preuves :* package.json scripts (test, typecheck, lint, test:e2e, electron:smoke) ; tsconfig.json + tsconfig.node.json (include shared, server, api, electron, scripts) + tsconfig.test.json ; .github/workflows/ci.yml ; tests/** (50 *.test.*), e2e/*.spec.ts

<a id="82"></a>
### #82 — Vulnérabilités npm prod : 9 signalées, aucune exploitable en l'état, toutes corrigeables sans rupture

**FIXED** · ⚪ sécurité · signalé dans `package.json:16`

`npm audit --omit=dev` lancé aujourd'hui sur le lockfile actuel : 0 vulnérabilité (sur 166 dépendances de prod). Versions actuelles : jspdf 4.2.1 ; @clerk/react 6.17.2 (Core 3, à la place de @clerk/clerk-react) ; react-router(-dom) 7.18.4 ; dompurify 3.4.16 ; fflate 0.8.3 ; js-cookie 3.0.8. ws n'est plus installé (`npm ls ws` vide). La CI bloque toute vulnérabilité high ou critical en prod.

*Preuves :* script de vérification ponctuel hors dépôt : verif-73-90/audit-prod.json (total 0) ; package-lock.json (versions ci-dessus) ; .github/workflows/ci.yml (npm audit --omit=dev --audit-level=high)

<a id="83"></a>
### #83 — Dépendances inutilisées, manquante (@vercel/node), dépréciée ou obsolètes

**FIXED** · ⚪ qualité de code · signalé dans `package.json:18`

Dépendances inutilisées supprimées (file-saver, @types/file-saver, html2canvas direct, concurrently) ; @vercel/node n'est plus nécessaire (api/*.ts n'importe que server/node.js) ; @supabase/supabase-js est réellement utilisé côté serveur ; @clerk/clerk-react remplacé par @clerk/react 6. La dépendance dépréciée ESLint 9 est remplacée par ESLint 10 (avec @eslint/js 10, globals 17, eslint-plugin-react-refresh 0.5, typescript-eslint 8.71 ; la nouvelle règle no-useless-assignment est respectée) ; lucide-react passe en 1.x, React en 19.3, Tailwind en 4.3. Un script vérifie les licences de toutes les dépendances de production. npm audit : 0 vulnérabilité.

*Preuves :* package.json ; eslint.config.js ; scripts/check-licenses.mjs (npm run licenses : 184 dépendances compatibles) ; npm outdated

*Remarque :* Non migrés volontairement : TypeScript 7 (typescript-eslint exige typescript < 6.1) et Vite 8 (changement de moteur de build, à faire dans une branche dédiée) ; @playwright/test reste en 1.56 pour correspondre au navigateur installé dans l'environnement de test.

<a id="84"></a>
### #84 — Vulnérabilités de l'outillage de dev (vite, concurrently/shell-quote, electron-builder/tar)

**FIXED** · ⚪ sécurité · signalé dans `package.json:47`

L'audit complet `npm audit`, dépendances de dev comprises (738 paquets), donne 0 vulnérabilité. vite est en 7.3.6 (faille fs.deny/WebSocket corrigée), concurrently et shell-quote ont disparu, electron-builder est en 26.15.3 avec tar 7.5.22, et les transitifs (postcss, picomatch, brace-expansion, lodash, js-yaml, nanoid, xmldom) sont en versions corrigées. Seul l'audit de prod est imposé en CI, mais il n'y a actuellement plus aucune alerte.

*Preuves :* script de vérification ponctuel hors dépôt : verif-73-90/audit-all.json (metadata.vulnerabilities.total = 0) ; `npm ls --depth=0` : vite@7.3.6, electron-builder@26.15.3 ; package-lock.json : node_modules/tar 7.5.22, pas de concurrently ni de shell-quote

<a id="85"></a>
### #85 — Profil localStorage incomplet : écran blanc sur /app, /app/generate et /app/settings (pas de validation, pas d'ErrorBoundary)

**FIXED** · ⚪ bug · signalé dans `src/hooks/useTeacherProfile.ts:16`

Un ErrorBoundary racine empêche tout écran blanc et propose « Recharger », « Revenir à l'accueil » et « Refaire mon profil ». Tous les profils relus depuis un stockage passent par la validation partagée : Electron et serveur (validateProfile / sanitizeProfile), et désormais aussi le profil de démonstration (localStorage) et le cache hors ligne du site (safeStoredProfile : champ invalide ignoré, JSON illisible → nouvel onboarding, jamais d'exception). Le tableau de bord et les réglages accèdent aux niveaux de façon défensive.

*Preuves :* src/components/ErrorBoundary.tsx ; shared/validation.ts (validateProfile, safeStoredProfile) ; src/lib/runtime/demo.ts ; src/lib/runtime/web.ts ; src/pages/DashboardPage.tsx ; src/pages/SettingsPage.tsx ; tests/ui/demoProfile.test.tsx (profil corrompu, JSON cassé, profil sans niveaux)

*Remarque :* Faire passer tous les profils lus dans le navigateur (démo PROFILE_KEY, cache hors ligne web) par shared/validation.ts validateProfile. Rendre DashboardPage:124 et SettingsPage:526 défensifs (profile?.niveaux?.[0], (profile.niveaux ?? [])). Ajouter à l'ErrorBoundary une action « Réinitialiser le profil » ou un lien vers /onboarding.

<a id="86"></a>
### #86 — ai.ts (code mort) : le parsing du streaming SSE perd du texte et ignore les erreurs en cours de flux

**NOT APPLICABLE** · ⚪ bug · signalé dans `src/lib/ai.ts:219`

src/lib/ai.ts (code Anthropic mort) est supprimé, et plus aucun code Anthropic ne subsiste. Le nouveau lecteur de flux commun (shared/ai/streams.ts readLines/readSSE) conserve les lignes partielles entre chunks et décode l'UTF-8 en mode stream. openaiCompatible.ts transforme un objet « error » reçu en cours de flux en erreur et suit finish_reason : « length » ou « unknown » (flux coupé) sont signalés comme tronqués par le pipeline, et le texte partiel est renvoyé avec l'évènement d'erreur, pas comme un succès. L'annulation se fait par AbortSignal.

*Preuves :* git ls-files : src/lib/ai.ts absent ; shared/ai/streams.ts et 148-162 ; shared/ai/openaiCompatible.ts (apply → chunkError, sawDone/finishReason) ; shared/pipeline.ts et 307-308 ; tests/shared/ai.openai.test.ts

<a id="87"></a>
### #87 — Matière et niveau stockés sous forme de libellés : l'emoji de matière est toujours 📝 dans l'Historique et les Favoris

**FIXED** · ⚪ cohérence des données · signalé dans `src/lib/api.ts:23`

Les nouveaux contenus stockent des clés (validation par liste blanche), et l'affichage accepte clé ou libellé. Les anciennes lignes, qui stockent des libellés, sont maintenant reconnues sans modifier les données : resolveMatiere / resolveNiveau reconnaissent les libellés actuels et les 5 anciens libellés qui ont changé (« Sciences de l'ingénieur (SI) », « Arts Plastiques », « Management / STMG », « Gestion-Finance / Compta », « BUT (ex-DUT) »), avec l'apostrophe typographique ou droite ; l'emoji et le libellé s'affichent correctement. Les statistiques regroupent ancien libellé et clé actuelle (« Mathématiques » + « mathematiques ») : la fonction SQL magistra_stats renvoie les comptes par valeur stockée et le serveur les regroupe (vérifié sur PostgreSQL 16).

*Preuves :* shared/catalog.ts (resolveMatiere) ; shared/levels.ts (resolveNiveau) ; src/lib/runtime/history.ts (computeStats) ; server/store.ts (topMatiereOf) ; supabase-schema.sql (magistra_stats, matiere_counts) ; tests/shared/catalog.test.ts

*Remarque :* Une migration SQL qui réécrirait les anciennes lignes en clés (UPDATE massif de public.generations) a été préparée mais n'a pas été ajoutée : cette modification de données a été refusée par le contrôle de permissions de la session et reste à décider par l'administrateur. Elle n'est plus nécessaire au bon affichage.

<a id="88"></a>
### #88 — Prompts : règles communes inadaptées (note /20 en maternelle, compétences du socle dans un courrier aux parents)

**FIXED** · ⚪ bug · signalé dans `src/lib/prompts.ts:34`

Le courrier aux familles a un prompt système dédié : ni socle, ni programme, ni référentiel, ni notation. La notation dépend du cycle (aucune note en maternelle, échelle de maîtrise et pas de note sur 20 en élémentaire, note sur 20 à partir du collège). Le prompt utilisateur du courrier ne contient plus de ligne « Matière » (le profil de l'enseignant suffit à le situer) et le champ Matière est masqué pour cet outil.

*Preuves :* shared/prompts/index.ts (buildSystemPrompt, buildUserPrompt) ; shared/prompts/tools.ts ; src/components/generate/GenerateFormFields.tsx ; tests/shared/prompts.test.ts (lettre aux parents : aucune ligne Matière ; notation par cycle)

*Remarque :* Ne pas émettre la ligne « Matière » (ni la discipline) pour lettre_parents dans buildUserPrompt, et masquer ou rendre facultatif le champ Matière du formulaire pour cet outil.

<a id="89"></a>
### #89 — Statistiques du Dashboard plafonnées à 100 (Total généré, Favoris, Cette semaine)

**FIXED** · ⚪ bug · signalé dans `src/pages/DashboardPage.tsx:76`

Les statistiques ne dérivent plus d'une liste paginée : GET /api/stats appelle la fonction SQL magistra_stats (count(*) sur toutes les lignes de l'utilisateur, dans son fuseau horaire), Electron les calcule sur l'index complet des fichiers locaux, et la démo sur tout ce qu'elle stocke. Le Dashboard lit store.getStats() et ne charge que 5 éléments récents. Un test local avec 257 contenus donne total = 257.

*Preuves :* supabase-schema.sql (magistra_stats) ; server/handlers.ts stats() → store.getStats ; electron/localStore.ts ; src/lib/runtime/history.ts ; src/pages/DashboardPage.tsx ; tests/electron/localStore.test.ts et 190 ; tests/server/supabaseStore.test.ts ; tests/ui/dashboard.test.tsx

<a id="90"></a>
### #90 — ESLint échoue avec 8 erreurs, et 2 autres masquées dans DashboardPage

**FIXED** · ⚪ qualité de code · signalé dans `src/pages/DashboardPage.tsx:77`

Sur l'arbre actuel, `npx eslint .` sort avec le code 0 : 207 fichiers, 0 erreur, 0 avertissement. Les règles React Compiler en cause sont bien actives (react-hooks/purity, set-state-in-effect, preserve-manual-memoization, react-refresh/only-export-components, no-unused-vars) et aucune n'est désactivée par commentaire (seuls 5 eslint-disable no-control-regex, légitimes). Le Dashboard lit l'heure une seule fois via useState(() => new Date()), et les chargements utilisent des promesses avec annulation : les erreurs masquées ne réapparaissent pas.

*Preuves :* script de vérification ponctuel hors dépôt : verif-73-90/eslint.json (0 erreur, 0 avertissement) ; `npx eslint --print-config src/pages/DashboardPage.tsx` (règles react-hooks/* en erreur) ; src/pages/DashboardPage.tsx ; .github/workflows/ci.yml (lint en CI)

<a id="91"></a>
### #91 — Dashboard : la carte « Matière phare » affiche toujours « 0 générations »

**FIXED** · ⚪ bug · signalé dans `src/pages/DashboardPage.tsx:183`

La carte n'utilise plus typeCounts : le sous-titre affiche top.count, calculé par matière dans les trois magasins (serveur/Supabase via la RPC magistra_stats, stockage local Electron, démo). Le nombre de favoris reste affiché à côté de la matière phare, la carte « Favoris » ne disparaît donc plus sans information.

*Preuves :* src/pages/DashboardPage.tsx (l.214 `plural(top.count,'génération')`) ; server/store.ts et 490 ; electron/localStore.ts ; src/lib/runtime/history.ts ; test tests/ui/dashboard.test.tsx « statistiques exactes (matière phare avec son vrai nombre) » (attend « 7 générations » et « 2 favoris ») — réussi

<a id="92"></a>
### #92 — Dashboard : un élément « Récent » ouvre l'Historique sans sélectionner l'élément (et petits textes obsolètes)

**FIXED** · ⚪ UX · signalé dans `src/pages/DashboardPage.tsx:284`

Chaque élément « Récent » pointe vers /app/history?id=<id> et HistoryView charge le contenu complet via useGenerationRecord(searchParams.get('id')), même s'il n'est pas dans la page de liste chargée. La date utilise first-letter:uppercase (classe présente dans le CSS construit) au lieu de capitalize. La carte « Utilisation » obsolète des Réglages a disparu, et ?type= invalide est traité (voir n°94).

*Preuves :* src/pages/DashboardPage.tsx (`/app/history?id=${encodeURIComponent(item.id)}`), :143 (first-letter:uppercase) ; src/components/history/HistoryView.tsx ; src/components/history/useGenerationRecord.ts ; tests tests/ui/dashboard.test.tsx, tests/ui/historyView.test.tsx ; E2E e2e/web-demo.spec.ts

<a id="93"></a>
### #93 — Favoris moins complets que l'Historique ; Réglages obsolètes

**FIXED** · ⚪ UX · signalé dans `src/pages/FavoritesPage.tsx:98`

Favoris et Historique partagent désormais le même composant HistoryView (favoritesOnly), avec la même recherche, la pagination et les mêmes exports (Copier, Markdown, PDF, Imprimer, Supprimer). Les Réglages n'affichent plus de liste de types ni de formats obsolète. « Modifier mon profil » (Réglages et tableau de bord) ouvre /onboarding?edit=1, pré-rempli, au lieu d'une réinitialisation.

*Preuves :* src/pages/FavoritesPage.tsx ; src/components/history/HistoryView.tsx (recherche), src/components/history/GenerationDetail.tsx (export Markdown) ; src/pages/SettingsPage.tsx ; src/pages/DashboardPage.tsx ; test tests/ui/historyView.test.tsx « liste uniquement les favoris, avec recherche »

<a id="94"></a>
### #94 — Paramètre ?type= invalide : formulaire vide et bouton Générer désactivé en permanence

**FIXED** · ⚪ UX · signalé dans `src/pages/GeneratePage.tsx:30`

Le paramètre ?type= est validé par isTypeContenu. Une valeur inconnue retombe sur « cours » : le formulaire complet s'affiche et le bouton « Générer : Cours » est utilisable.

*Preuves :* src/lib/generation/request.ts (resolveInitialType), :93 ; src/pages/GeneratePage.tsx ; test tests/generate/request.test.ts « ?type= invalide → cours » ; E2E e2e/web-demo.spec.ts (/app/generate?type=inexistant → « Générer : Cours »)

<a id="95"></a>
### #95 — Copier : un échec de navigator.clipboard provoque une promesse rejetée non gérée, sans aucun retour

**FIXED** · ⚪ bug · signalé dans `src/pages/GeneratePage.tsx:110`

copyText ne rejette jamais. Il essaie navigator.clipboard (erreur interceptée, API absente tolérée), puis un repli textarea + execCommand('copy'), et renvoie un booléen. Les deux appelants encadrent aussi l'appel d'un try/catch et affichent un message d'échec visible (Générer : « Impossible de copier automatiquement… » ; Historique/Favoris : toast d'erreur).

*Preuves :* src/lib/export/index.ts ; src/components/generate/ResultPanel.tsx et 261 ; src/components/history/GenerationDetail.tsx ; tests tests/pdf/export.test.ts (écriture refusée → repli ; échec → false), tests/ui/historyView.test.tsx « copie refusée : erreur visible »

<a id="96"></a>
### #96 — Suggestions de sujets non filtrées par niveau (Pythagore et fonctions affines proposés en CP, dissertation en CE1)

**FIXED** · ⚪ UX · signalé dans `src/pages/GeneratePage.tsx:308`

Les suggestions de sujets sont filtrées par classe exacte, et non plus seulement par groupe de niveau : chaque suggestion propre à une partie du programme porte la liste des classes où elle est pertinente (« Le théorème de Pythagore » : 4e-3e ; « Les fonctions affines » : 3e ; « Les Gaulois » : CM1 ; « La dissertation » : 2de-1re ; philosophie : terminale). Des suggestions ont été ajoutées pour que chaque classe courante en ait au moins une.

*Preuves :* shared/catalog.ts (SUGGESTIONS, getSujetSuggestions) ; tests/shared/catalog.test.ts (6e sans Pythagore ni fonctions affines, CP sans décimaux, aucune suggestion vide ou dupliquée)

*Remarque :* Indexer les suggestions au moins par cycle (cycle 2 CP-CE2, cycle 3 CM1-6e, cycle 4 5e-3e) ou par classe, ou associer à chaque suggestion la liste des niveaux où elle est pertinente, et filtrer sur le niveau exact.

<a id="97"></a>
### #97 — Champ « Nombre d'appréciations » : vider le champ le remet à 10, bornes 1-35 non appliquées

**FIXED** · ⚪ bug · signalé dans `src/pages/GeneratePage.tsx:352`

Le champ stocke la saisie brute (string) : il peut être vidé sans revenir à 10. Il est borné entre 1 et 40 à la sortie du champ (onBlur) et à l'envoi. Une saisie vide ou invalide bloque la génération avec un message, et le résumé annonce exactement le nombre envoyé. Côté serveur et Electron, validateGenerationRequest refuse tout nombre hors de 1..40 (les valeurs 500 ou -3 ne peuvent plus atteindre le prompt).

*Preuves :* src/lib/generation/request.ts ; src/components/generate/GenerateFormFields.tsx ; shared/validation.ts et 169 (utilisé par server/handlers.ts et electron/generation.ts) ; tests tests/generate/request.test.ts « le champ peut être vidé sans revenir à 10 », 132

<a id="98"></a>
### #98 — En-tête du résultat et noms d'export suivent l'outil sélectionné, pas celui qui a généré le contenu

**FIXED** · ⚪ bug · signalé dans `src/pages/GeneratePage.tsx:553`

L'état de génération conserve un instantané de la GenerationRequest (action start). L'en-tête du résultat et le document d'export (titre, type, niveau, matière, nom de fichier) sont calculés uniquement à partir de state.request, jamais du formulaire courant : changer d'outil ou de niveau après une génération ne ré-étiquette plus le contenu.

*Preuves :* src/components/generate/ResultPanel.tsx (resultHeading(req)) et 159/204 (buildExportDoc(request, content)) ; src/lib/generation/result.ts ; src/lib/generation/state.ts ; tests tests/generate/state.test.ts « requête instantanée », :92 « en-tête issu de l'instantané de la requête »

<a id="99"></a>
### #99 — Squelette de chargement invisible pendant la génération (classes Tailwind construites dynamiquement)

**FIXED** · ⚪ UX · signalé dans `src/pages/GeneratePage.tsx:581`

Le squelette est désormais un composant dédié dont les classes sont écrites en entier (h-6, h-4, h-5…). Un build de vérification (vite build --outDir vers un dossier temporaire) confirme que .h-4, .h-5, .h-6 et .animate-shimmer existent dans le CSS produit. Aucune autre classe Tailwind construite dynamiquement ne subsiste dans src.

*Preuves :* src/components/generate/LoadingSkeleton.tsx ; utilisé dans src/components/generate/ResultPanel.tsx ; test tests/generate/components.test.tsx « classes statiques visibles » ; script de vérification ponctuel hors dépôt : verif-91-108/dist/assets/index-*.css contient `.h-4{height:calc(var(--spacing) * 4)}` et `.h-6{…}`

<a id="100"></a>
### #100 — Recherche de l'Historique sensible aux accents et limitée au sujet et à la matière

**FIXED** · ⚪ UX · signalé dans `src/pages/HistoryPage.tsx:28`

La recherche de l'historique est insensible aux accents et à la casse, et porte sur le sujet, la matière, la discipline, le niveau, l'outil et l'extrait. Le libellé d'outil est cherché à la fois sous sa forme générique et sous la forme affichée pour le niveau (« Examen » / « Évaluation », « TD » / « Exercices ») : ce que l'enseignant voit dans la liste est bien trouvable.

*Preuves :* src/lib/runtime/history.ts (matchesSearch) ; tests/ui/historySearch.test.ts

*Remarque :* Dans matchesSearch, indexer le libellé adapté au niveau (getToolLabel(item.type, niveau) / toolLabelFor(item)), idéalement en plus du libellé générique, et ajouter un test sur un élément du supérieur.

<a id="101"></a>
### #101 — Double-clic sur le cœur : l'interface et le serveur ne sont plus d'accord

**FIXED** · ⚪ bug · signalé dans `src/pages/HistoryPage.tsx:42`

toggleFavorite est protégé par une garde synchrone (useRef favoriteBusy) : un second clic pendant l'appel est ignoré, même avant le re-rendu. La valeur envoyée est calculée depuis l'enregistrement courant, avec bascule optimiste et retour arrière en cas d'erreur. Le bouton est aussi désactivé pendant l'appel (favoritePending). Le bouton Favori du résultat de génération est lui aussi désactivé pendant la requête.

*Preuves :* src/components/history/HistoryView.tsx et 91-117 ; src/components/history/GenerationDetail.tsx ; src/components/generate/ResultPanel.tsx (disabled={pending}) ; test tests/ui/historyView.test.tsx « favori : bascule optimiste, bouton désactivé pendant l'appel, retour arrière en cas d'erreur »

<a id="102"></a>
### #102 — Les CTA de la landing renvoient toujours à l'onboarding, même quand il est déjà fait

**FIXED** · ⚪ UX · signalé dans `src/pages/LandingPage.tsx:12`

AccessButton mène à /app (« Mon espace ») si un profil existe (démo), si l'utilisateur est connecté (web, Clerk) ou en mode local ; sinon à l'onboarding. Même si l'utilisateur ouvre /onboarding avec un profil existant, l'assistant passe en mode édition pré-rempli et n'enregistre rien sans « Enregistrer » explicite.

*Preuves :* src/pages/LandingPage.tsx (l.57-61 web connecté → /app, l.66-70 démo/local) ; src/pages/OnboardingPage.tsx ; tests tests/ui/landing.test.tsx « avec un profil : les boutons mènent directement à l'espace », tests/ui/onboarding.test.tsx « un profil existant n'est jamais écrasé sans action explicite »

<a id="103"></a>
### #103 — Affirmations produit non tenues : « programmes 2026 intégrés », « alignés sur le BO », « 180+ bulletins », « Retouchez si besoin »

**FIXED** · ⚪ docs · signalé dans `src/pages/LandingPage.tsx:105`

« Programmes 2026 intégrés », « alignés sur le BO » et « 180+ bulletins » ont disparu ; les prompts interdisent de citer une référence réglementaire absente des sources. La promesse de retouche est reformulée selon ce que l'application fait réellement : relire, copier ou exporter (Markdown, PDF), puis adapter dans son traitement de texte ; pour les appréciations, copier puis personnaliser dans le logiciel de vie scolaire ; « Recommencer » et les consignes permettent de régénérer.

*Preuves :* src/pages/LandingPage.tsx ; tests/ui/landing.test.tsx ; e2e/web-demo.spec.ts (accueil)

*Remarque :* Soit ajouter un mode édition (textarea Markdown) dont le contenu alimente Copier/Markdown/PDF/Imprimer, soit reformuler la landing (par exemple « exportez en Markdown ou PDF, puis adaptez dans votre traitement de texte »).

<a id="104"></a>
### #104 — Données collectées ou déclarées mais jamais utilisées (matière secondaire, VITE_ANTHROPIC_API_KEY, API IPC inutilisées)

**FIXED** · ⚪ qualité de code · signalé dans `src/pages/OnboardingPage.tsx:242`

La matière secondaire est maintenant utilisée : affichée dans les Réglages et sur la carte profil du tableau de bord, transmise au prompt (contexte enseignant), et utilisée comme matière de repli dans Générer. VITE_ANTHROPIC_API_KEY n'est plus déclarée (seule VITE_CLERK_PUBLISHABLE_KEY). Le pont IPC a été réécrit : getConfigRaw/hasConfig/minimize/maximize/close ont disparu, et un comptage montre que chacune des 31 méthodes exposées par preload est appelée dans src.

*Preuves :* src/pages/SettingsPage.tsx ; src/pages/DashboardPage.tsx ; shared/prompts/index.ts ; src/lib/generation/request.ts ; src/vite-env.d.ts ; electron/preload.ts ; shared/ipc.ts ; electron/ipc.ts

<a id="105"></a>
### #105 — « Reconfigurer mon profil » efface le profil sans le pré-remplir et bloque l'utilisateur dans l'onboarding

**FIXED** · ⚪ UX · signalé dans `src/pages/SettingsPage.tsx:161`

Le bouton « Reconfigurer » qui supprimait le profil n'existe plus. « Modifier mon profil » ouvre /onboarding?edit=1 : l'assistant est pré-rempli depuis le profil (draftFromProfile), propose « Annuler » (retour aux Réglages sans rien écrire) et n'enregistre qu'au clic sur « Enregistrer ». Le profil n'est jamais mis à null par l'édition, donc /app reste accessible. Seule la suppression explicite de toutes les données (avec confirmation) efface le profil.

*Preuves :* src/pages/SettingsPage.tsx ; src/pages/OnboardingPage.tsx ; tests tests/ui/onboarding.test.tsx « pré-remplit le profil ; Annuler revient aux Réglages sans rien enregistrer », :132, :149

<a id="106"></a>
### #106 — tsconfig.tsbuildinfo committé, périmé, réécrit à chaque build

**FIXED** · ⚪ qualité de code · signalé dans `tsconfig.tsbuildinfo:1`

tsconfig.tsbuildinfo n'est plus suivi par git (*.tsbuildinfo ignoré, fichiers dans node_modules/.tmp). La vérification de types est désormais incrémentale ("incremental": true dans les trois tsconfig) : `tsc -b --dry` indique « up to date » et un second `tsc -b` passe de ~15 s à ~3 s. baseUrl, déprécié, est retiré (les chemins restent relatifs).

*Preuves :* tsconfig.app.json, tsconfig.node.json, tsconfig.test.json ; .gitignore ; `npx tsc -b --verbose --dry`

*Remarque :* Ajouter "incremental": true dans tsconfig.app.json, tsconfig.node.json et tsconfig.test.json pour que tsc -b réutilise ses informations de build au lieu de tout revérifier.

<a id="107"></a>
### #107 — Web : aucun en-tête de sécurité (CSP, frame-ancestors, nosniff) sur le déploiement Vercel ou Netlify

**FIXED** · ⚪ sécurité · signalé dans `vercel.json:1`

vercel.json envoie sur toutes les routes X-Content-Type-Options: nosniff, Referrer-Policy, X-Frame-Options: DENY, Permissions-Policy et une CSP stricte (frame-ancestors 'none', object-src 'none', base-uri 'self', scripts limités à self et Clerk). Le serveur autonome envoie les mêmes en-têtes, et un test vérifie leur identité. Netlify a été retiré. Point d'exploitation : avec un domaine Clerk personnalisé (production), il faut ajouter ce domaine à la CSP de vercel.json à la main ; c'est documenté dans .env.example:101-105 mais pas dans la section Vercel du README.

*Preuves :* vercel.json ; server/standalone.ts ; tests tests/server/deploy.test.ts « vercel.json et le serveur autonome envoient les mêmes en-têtes de sécurité », :36-39 (netlify.toml absent), tests/server/standalone.test.ts

*Remarque :* Facultatif : mentionner dans la section Vercel du README l'ajout d'un domaine Clerk personnalisé à la CSP.

<a id="108"></a>
### #108 — `npm run dev` (web) : /api est proxifié vers 127.0.0.1:3721 (serveur Electron), toute requête API échoue en 500

**FIXED** · ⚪ build/déploiement · signalé dans `vite.config.ts:44`

Le proxy vers 127.0.0.1:3721 a disparu (Electron n'a plus de serveur HTTP). En `npm run dev`, le plugin magistraDevApi monte /api/* dans Vite avec le même code que la production (server/node.ts → handlers), et renvoie des erreurs JSON explicites. Vérifié en lançant Vite : sans configuration, /api renvoie 500 JSON SERVER_MISCONFIGURED avec un message clair (pas un corps vide). Avec un jeton Clerk simulé et un faux serveur d'IA, /api/status → 200, /api/generate → flux NDJSON complet enregistré, /api/history → l'élément généré.

*Preuves :* vite.config.ts (aucun proxy) ; server/viteDevApi.ts ; server/dev.ts ; README.md ; scripts script de vérification ponctuel hors dépôt : verif-91-108/devapi.mjs et dev-smoke2.mjs (generate 200 « sources,status,delta,delta,delta,status,done », saved=true ; history → ["Le contrat"])


---

## Revue finale : constats supplémentaires (hors des 108)

Après les corrections, cinq relectures adversariales indépendantes (sécurité web, sécurité Electron, IA et citations, interface, conformité au cahier des charges) ont cherché de nouveaux défauts. Chaque constat retenu a été corrigé, avec un test de non-régression qui échoue sur l'ancien code quand c'est possible.

| Domaine | Constat | Correction | Preuve |
|---|---|---|---|
| Sécurité web | Expression régulière du titre de page quadratique : une page de 1 Ko compressée bloquait le serveur 75 s | recherche linéaire bornée (`extractTitle`) | `tests/server/safeFetch.test.ts` |
| Sécurité web | Page compressée lente ou coupée : récupération jamais terminée | `stream.pipeline` + lecture interrompue par le délai | `tests/server/safeFetch.test.ts` |
| Sécurité web | Jeton anonyme avec un identifiant de clé inconnu : un appel à Clerk par requête | identifiants filtrés, recherche de clé inconnue limitée à une par minute | `tests/server/clerk.test.ts` |
| Sécurité web | Générations simultanées non bornées | plafonds par utilisateur, par instance et global (voir n° 4) | `tests/server/concurrency.test.ts` |
| Sécurité Electron | Clé API envoyée à un autre serveur en cas de redirection | redirections refusées sur les requêtes qui portent la clé | `tests/electron/ollamaSetup.test.ts` |
| Sécurité Electron | Blocage réseau de la fenêtre contournable par un SharedWorker ; scripts sans CSP | session propre à la fenêtre, tout réseau bloqué ; CSP sur toutes les réponses `app://` | `tests/electron/windowSession.test.ts`, E2E Electron n° 7 |
| Sécurité Electron | Options de test actives dans l'application installée | ignorées quand l'application est empaquetée | `tests/electron/devOptions.test.ts` |
| Sécurité Electron | Fusibles Electron non configurés | 7 fusibles (RunAsNode, NODE_OPTIONS, --inspect désactivés ; intégrité de l'asar) | `electron-builder.json`, `electron-fuses read` |
| Sécurité Electron | Empreinte SHA-256 de l'installateur Ollama facultative | obligatoire : sans empreinte valide, rien n'est lancé | `tests/electron/ollamaSetup.test.ts` |
| Sécurité Electron | `nvidia-smi` cherché dans le dossier courant sous Windows | chemins absolus connus seulement | `tests/electron/hardware.test.ts` |
| IA et citations | Citations vérifiées affichées « [1] », indiscernables d'un « [12] » inventé | forme « [S1] » conservée ; « [12] », « [4, p. 45] » retirés | `tests/shared/citations.test.ts` |
| IA et citations | Variantes « [S1, p14] », « (S1) », « [Source 1] » : page inventée affichée | normalisées, localisation du modèle retirée | `tests/shared/citations.test.ts` |
| IA et citations | Crochets dans du code modifiés | code et code en ligne jamais modifiés | `tests/shared/citations.test.ts` |
| IA et citations | Texte brut non vérifié affiché après « Arrêter » ou une erreur | texte partiel finalisé (citations, DOI, liens) | `tests/shared/pipeline.test.ts` |
| IA et citations | Estimation de tokens fausse pour le chinois, l'arabe, les nombres | estimation selon l'écriture | `tests/shared/prompts.test.ts` |
| IA et citations | Délimiteur `"""` modifié dans le travail d'élève et les documents | délimiteur absent du texte, texte transmis intact | `tests/shared/prompts.test.ts` |
| IA et citations | Indentation des TXT/MD supprimée (code cassé) | indentation conservée | `tests/documents/documents.test.ts` |
| IA et citations | Bibliographie inventée hors liste conservée ; sources seulement énumérées présentées comme utilisées | retrait des références après un pseudo-titre ; « Sources utilisées » = citées dans le texte | `tests/shared/citations.test.ts` |
| IA et citations | DOI fourni contenant des parenthèses mutilé | DOI fournis protégés | `tests/shared/citations.test.ts` |
| IA et citations | Passage tronqué cité « pages 14 à 18 » | mention « (extrait) » | `tests/shared/pipeline.test.ts` |
| IA et citations | BTS, BUT, CPGE : référentiels présentés comme connus | même réserve qu'au scolaire, « à vérifier dans le référentiel officiel » | `tests/shared/prompts.test.ts` |
| IA et citations | Ligne « DEMANDE » contradictoire avec la tâche | libellé seul | `tests/shared/prompts.test.ts` |
| IA et citations | Pages citées par position dans le fichier, pas par numéro imprimé | « page 47 (p. 3 du PDF) » d'après `/PageLabels` | `tests/documents/documents.test.ts` |
| IA et citations | Délai dépassé en local annoncé comme venant d'un « serveur » | message propre au moteur local | `tests/shared/ai.ollama.test.ts` |
| IA et citations | Liens inventés conservés dans le contenu | liens vérifiés comme les DOI | `tests/shared/citations.test.ts` |
| Interface | Double-clic sur « Arrêter » / « Recommencer » : action inverse déclenchée | second clic ignoré | `tests/generate/resultPanel.test.tsx` |
| Interface | Clerk injoignable : site bloqué sur « Connexion… », accueil sans bouton | message et « Réessayer » (vérifié dans Chromium, réseau coupé) | `src/App.tsx`, `src/pages/LandingPage.tsx` |
| Interface | Confidentialité annoncée « sur cet ordinateur » avec un Ollama distant | message selon l'adresse réelle du moteur | `src/lib/ai-ui/status.ts` |
| Interface | « Arrêter » puis « Recommencer » pendant le démarrage du moteur : « génération déjà en cours » | arrêt immédiat, relance qui attend la fin réelle ; erreur réessayable | `tests/generate/useGeneration.test.tsx`, `tests/electron/ollamaSetup.test.ts` |
| Interface | Erreurs des documents conservés affichées « Impossible d'enregistrer dans l'historique » | message précis propre à chaque action | `src/components/generate/useSourceDocuments.ts` |
| Interface | Documents conservés effacés sans avertissement | confirmation avec le nombre de documents ; mention dans « Effacer toutes les données » | `src/pages/SettingsPage.tsx` |
| Interface | Débordement horizontal sur mobile avec une URL ou une formule longue | `overflow-wrap: anywhere`, formules en ligne défilantes | E2E mobile 390 et 430 px |
| Interface | « Internet : Wikipédia seulement » annoncé même Wikipédia désactivé | disponibilité réelle annoncée (Wikipédia, académique, rien) | `tests/generate/research.test.ts` |
| Interface | Profil illisible : cause masquée, aucune sortie | cause réelle, « Réessayer », « Se reconnecter » | `tests/ui/guards.test.tsx` |
| Interface | Aides du formulaire qui promettaient trop | reformulées | `src/components/generate/GenerateFormFields.tsx` |
| Interface | Titre d'onglet identique partout ; changement de vue et fin de génération non annoncés | titre par vue, focus sur le contenu, annonce de fin | `tests/generate/resultPanel.test.tsx` |
| Conformité | PC « 16 Go » (15,7 visibles) privé de Magistra Standard | capacité nominale | `tests/shared/models.test.ts` |
| Conformité | Mentions du fournisseur retiré dans les maquettes et les tests | maquettes corrigées ; test qui parcourt tout le dépôt | `tests/server/deploy.test.ts` |
| Conformité | Messages renvoyant à un bouton « Télécharger Ollama » inexistant | libellé réel ; test de cohérence | `tests/electron/ollamaSetup.test.ts` |
| Conformité | Recherche limitée aux contenus déjà chargés | pages suivantes chargées automatiquement (500 contenus au plus) | `tests/ui/historyView.test.tsx` |
| Conformité | Sans moteur web, absence d'Éduscol / BO non signalée au scolaire | dit explicitement dans le choix du mode Internet | `tests/generate/research.test.ts` |
| Conformité | Nom technique du modèle dans le détail de l'historique | nom Magistra (Léger, Standard, Qualité) | `src/components/history/GenerationDetail.tsx` |

**Signalé mais non modifié** (décision de sécurité de la session) : deux retouches de tests Electron (`tests/electron/security.test.ts`, `tests/electron/preload.test.ts`) et une retouche cosmétique de `src/components/UpdateCheck.tsx` ont été refusées par le contrôle de permissions ; les comportements concernés sont couverts par `tests/electron/updateCheck.test.ts`. La migration SQL qui réécrirait les anciennes lignes de `generations` en clés (n° 87) a été refusée pour la même raison ; l'affichage et les statistiques n'en ont plus besoin.
