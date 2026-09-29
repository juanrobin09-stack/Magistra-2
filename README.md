# Magistra

**Assistant pédagogique IA open source pour les enseignants, de la maternelle au doctorat, avec un accent sur l'enseignement supérieur.**

Un projet non lucratif [FutureAI](https://futurai.space), publié sous licence [MIT](LICENSE).

Magistra aide à préparer :
- des cours et des TD ;
- des évaluations et des examens ;
- des séquences, des syllabus et des fiches de séance ;
- des appréciations ;
- des adaptations différenciées ;
- des courriers ;
- des cahiers journaux ;
- des corrigés annotés.

Il s'appuie sur **vos documents** et sur des **sources vérifiables**. L'enseignant relit et adapte toujours le contenu produit.

Magistra **ne dépend d'aucune API payante** :

| Mode | IA utilisée | Compte | Données |
|---|---|---|---|
| **Application Windows** | IA **locale** open weights via [Ollama](https://ollama.com) : Magistra Léger, Standard ou Qualité | aucun | restent sur l'ordinateur |
| **Site web** | un **préréglage** (par exemple OVHcloud AI Endpoints, gratuit, hébergé en France) ou le serveur d'IA de l'établissement (vLLM, Ollama…) | Clerk | serveur Magistra (Supabase), puis le prestataire d'IA **annoncé dans l'interface** |
| **En local** (`npm run dev`) | l'IA installée sur l'ordinateur (Ollama, LM Studio), **détectée automatiquement** | aucun (mode personnel) | restent sur l'ordinateur |
| **Démonstration** | aucune : exemples pré-rédigés, clairement signalés | aucun | navigateur |

Magistra n'impose ni quota ni compteur. Les seules limites sont celles de la machine, du service d'IA choisi (une offre gratuite limite souvent le nombre de demandes par minute), plus des protections techniques contre les abus sur un serveur public.

---

## Brancher une vraie IA

Trois chemins, du plus simple au plus autonome. Dans les trois cas, `npm run ai:check` (site) ou l'assistant de l'application (Windows) dit précisément ce qui manque.

### 1. Site en ligne (Vercel)

**La solution gratuite la plus simple : `AI_PRESET=ovhcloud`.** Aucune clé, aucune inscription : Magistra utilise [OVHcloud AI Endpoints](https://www.ovhcloud.com/fr/public-cloud/ai-endpoints/) avec le modèle **Mistral Small 3.2** (24B, open weights, licence Apache 2.0), hébergé en **France** (centre de données de Gravelines), **sans conservation des données** annoncée par OVHcloud.

> **Ce que voient les enseignants.** Les demandes et les **extraits** de leurs documents sont envoyés à ce prestataire pour la génération. L'interface l'annonce clairement (page Générer et Réglages) : nom du prestataire, pays, conservation, entraînement et lien vers ses conditions. Mentionnez-le aussi dans votre information RGPD. Les fichiers originaux ne quittent jamais le navigateur.

**Limite de l'accès gratuit** : **2 générations par minute et par adresse IP** ([documentation OVHcloud](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities)). Sur Vercel, l'adresse de sortie peut être partagée avec d'autres sites : la limite peut être atteinte plus vite. Au-delà, l'enseignant lit par exemple « OVHcloud AI Endpoints limite le nombre de demandes (offre gratuite ou quota) : réessayez dans 55 s. » et garde le bouton **Réessayer** (aucun nouvel essai automatique). **Pour plusieurs enseignants**, ajoutez une clé OVHcloud (`AI_API_KEY`, projet Public Cloud, paiement à l'usage de quelques centimes, 400 demandes par minute) ou choisissez un autre préréglage.

| Préréglage (`AI_PRESET`) | Prestataire | Pays | Clé (`AI_API_KEY`) | Gratuit ? | Conservation | Entraînement sur vos textes |
|---|---|---|---|---|---|---|
| `ovhcloud` | [OVHcloud AI Endpoints](https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/mistral-small-3-2-24b-instruct-2506/), Mistral Small 3.2 24B | France (Gravelines) | facultative | **oui**, sans compte (2 demandes/min par IP) ; avec clé : paiement à l'usage | aucune (annoncé) | non (annoncé) |
| `mistral` | Mistral AI (La Plateforme), Ministral 14B | Union européenne (France) | obligatoire | offre « Experiment » gratuite (téléphone vérifié, débit limité) | selon les conditions de Mistral AI | **oui par défaut sur l'offre gratuite**, sauf refus dans l'Admin Console ([aide Mistral](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training)) |
| `albert` | [Albert API](https://guides.ia.numerique.gouv.fr/albert-api) (IA de l'État, DINUM) | France (SecNumCloud) | obligatoire | oui, **réservé aux agents de l'État** (sur demande) | selon ses conditions | selon ses conditions |
| `scaleway` | [Scaleway Generative APIs](https://www.scaleway.com/en/news/scaleway-launches-generative-apis-a-drop-in-alternative-to-openai-apis-100percent-made-in-europe/), Mistral Small 3.2 | France | obligatoire | 1 000 000 de tokens offerts, puis payant | contenus ni collectés ni réutilisés (annoncé) | non (annoncé) |
| `ollama` | Ollama auto-hébergé (votre serveur) | votre serveur | aucune (sauf proxy à clé) | oui | rien ne sort de votre serveur | aucun |

Les faits de ce tableau sont ceux que chaque prestataire **annonce** ; ils sont repris dans `shared/ai/presets.ts` et affichés aux enseignants. Un site sur Vercel ne peut pas joindre une adresse locale ou privée (`127.0.0.1`, `192.168.…`) : `ollama` sert au serveur autonome ou à un Ollama exposé en HTTPS.

**Mise en production** — le site public (`magistra-2.vercel.app`) sert la branche **`master`** :
1. **Fusionnez la PR** de cette version dans `master` (sans cela, l'ancien code reste en ligne).
2. Dans Vercel → *Settings* → *Environment Variables* (environnement **Production**), renseignez :
   - `VITE_CLERK_PUBLISHABLE_KEY` et `CLERK_SECRET_KEY` (même instance Clerk ; une clé `pk_live_…` exige votre propre domaine, une instance de développement `pk_test_…` fonctionne sur `*.vercel.app` — [Clerk](https://clerk.com/docs/guides/development/deployment/vercel)) ;
   - `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` ;
   - `AI_PRESET=ovhcloud` (et, si vous en avez une, `AI_API_KEY`) ;
   - facultatif : `MAGISTRA_ADMIN_CONTACT` (adresse affichée aux enseignants si l'IA ne répond pas).

   L'IA seule ne suffit pas : sans les clés Clerk, le site reste en **démonstration** (aucune IA n'est utilisée) ; sans Supabase, il affiche une erreur de configuration. Supprimez la clé d'API commerciale de l'ancienne version si elle figure encore dans les variables : elle n'est plus utilisée. Révoquez-la aussi chez son fournisseur.
3. Dans Supabase → *SQL Editor*, exécutez **`supabase-schema.sql`** (réexécutable, sans perte de données).
4. **Redéployez** (Vercel → *Deployments* → *Redeploy*) : une variable modifiée ne s'applique qu'au déploiement suivant ([Vercel](https://vercel.com/docs/environment-variables)).
5. Vérifiez depuis votre ordinateur (dépôt cloné, `npm ci` fait) :
   ```bash
   npx vercel env pull --environment=production .env.prod.local && npm run ai:check -- --vercel --env-file .env.prod.local
   ```
   Chaque étape est expliquée en français (mode du site, stockage, IA joignable, modèle présent, courte génération d'essai annoncée ; `--no-generate` pour ne rien envoyer). Les clés ne sont jamais affichées. Les variables marquées « Sensitive » dans Vercel ne sont pas téléchargées : ajoutez-les à la main dans `.env.prod.local`, puis effacez ce fichier (il contient des secrets ; il est ignoré par git).

### 2. En local, sur votre ordinateur (`npm run dev`)

Aucun compte, aucun service en ligne : l'IA tourne sur votre machine.

1. Installez [Ollama](https://ollama.com/download) (version **Ollama 0.13.1** ou plus récente, exigée par les modèles Ministral 3 — [page du modèle](https://ollama.com/library/ministral-3)).
2. Téléchargez un modèle : `ollama pull ministral-3:8b` (≈ 6 Go ; `ministral-3:14b` sur un PC de 16 Go ou plus).
3. Dans le dossier de Magistra : `npm ci` puis `npm run dev`.
4. Ouvrez **le lien affiché dans le terminal** (`http://localhost:5173/#acces=…`) : il contient votre clé d'accès secrète (mode personnel, un seul utilisateur, accessible depuis cet ordinateur seulement). Ne le partagez pas.

L'IA est **détectée automatiquement** (Ollama sur `127.0.0.1:11434`, sinon LM Studio sur `127.0.0.1:1234`) ; le terminal indique le modèle retenu, ou la commande à lancer s'il n'y en a pas. Les modèles « en ligne » d'Ollama (`…:cloud`, `…-cloud`) ne sont jamais choisis automatiquement, car les textes partiraient sur Internet. Pour utiliser plutôt un service en ligne, écrivez `AI_PRESET=ovhcloud` dans un fichier `.env` (voir [`.env.example`](.env.example)) : l'interface annonce alors l'envoi des textes à ce prestataire. Vérification : `npm run ai:check -- --dev` (sans `--dev`, la commande vérifie `npm start`).

Votre historique et votre clé d'accès sont enregistrés dans `.magistra-data` à la racine du projet (sous Windows : `%LOCALAPPDATA%\Magistra\serveur`), réservé à votre compte ; `npm run dev` ne sert jamais ce dossier.

### 3. Application Windows

1. Téléchargez **`Magistra-Setup-x.y.z.exe`** sur la [page des versions](https://github.com/juanrobin09-stack/magistra-2/releases) (chaque version y publie aussi `SHA256SUMS.txt`).
2. Installez-le, puis laissez-vous guider : Magistra installe le moteur d'IA locale (Ollama) et un modèle adapté à votre ordinateur, sans ligne de commande, sans compte ni clé. Détails ci-dessous : « [Application Windows : installation pour l'enseignant](#application-windows--installation-pour-lenseignant) ».

Les versions sont produites par le workflow [`release.yml`](.github/workflows/release.yml) : un tag `vX.Y.Z` (égal à la version de `package.json`) construit l'installateur et l'archive sous Windows, calcule les empreintes et crée une **release en brouillon**, qu'un mainteneur relit puis publie.

---

## Fonctionnalités

- **11 outils** : cours, exercices/TD, évaluation/examen, séquence/plan de module, fiche de séance, progression/syllabus, appréciations, différenciation, courrier (parents ou étudiants), cahier journal/planning, corrigé annoté. Les libellés et les exigences s'adaptent au niveau.
- **Niveaux** : maternelle, élémentaire, collège, lycée, lycée professionnel, BTS/BUT, CPGE, licence, master, doctorat. Au supérieur, vos documents, objectifs et consignes sont la référence principale.
- **Sources** :
  - ajoutez des PDF, DOCX, PPTX, TXT ou MD : le texte est extrait **localement**, et le fichier original n'est jamais envoyé ;
  - recherche facultative dans HAL, Crossref, Wikipédia et le web (SearXNG), avec priorité à Éduscol et au Bulletin officiel pour le scolaire.
- **Citations vérifiables** : la liste « Sources utilisées » (document, pages, diapositives, section, ou publication réelle avec son DOI) est construite par le code, jamais inventée par le modèle.
- **Génération en direct** : le texte apparaît au fur et à mesure, avec les boutons Arrêter, Recommencer et Réessayer.
- **Historique, favoris, recherche sans accents, statistiques**, sur le web comme sous Windows.
- **Exports** :
  - PDF fidèle : les accents, les symboles mathématiques, les tableaux, les titres et les listes sont conservés à l'identique ;
  - Markdown, impression, copie.
- **Accessibilité** : navigation au clavier, lecteurs d'écran, contrastes AA, interface utilisable sur mobile.

---

## Application Windows : installation pour l'enseignant

1. Installez `Magistra-Setup-x.y.z.exe`, téléchargé depuis la [page officielle des versions](https://github.com/juanrobin09-stack/magistra-2/releases).
   > **Avertissement Windows SmartScreen.** L'installateur n'est pas encore signé numériquement : Windows peut afficher « Windows a protégé votre ordinateur » (éditeur inconnu). Cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**. Cet avertissement ne signale pas un problème détecté dans le fichier : il vient de l'absence de certificat de signature de code, un certificat payant renouvelé chaque année, que ce projet non lucratif n'a pas encore acquis. N'exécutez l'installateur que s'il provient de la page officielle ci-dessus.
   >
   > Vérification facultative : dans PowerShell, `Get-FileHash .\Magistra-Setup-x.y.z.exe -Algorithm SHA256` doit donner l'empreinte indiquée dans `SHA256SUMS.txt` sur la même page.
2. Au premier lancement, Magistra vérifie automatiquement si le moteur d'IA locale (Ollama) est installé et en marche, dans une version assez récente (Ollama 0.13.1 au moins), et si un modèle est disponible.
3. **Si le moteur manque**, cliquez sur **Installer le moteur IA**. La taille du téléchargement et l'espace disque nécessaire sont affichés avant toute action. L'installateur officiel n'est lancé qu'après vérification de son empreinte SHA-256. En cas de problème, Magistra ouvre la page officielle et détecte seul la fin de l'installation. **Si le moteur est trop ancien**, Magistra propose **Mettre à jour le moteur IA** (vos modèles sont conservés) ; si Ollama a été installé pour tout l'ordinateur par le service informatique, Magistra vous invite à lui demander la mise à jour.
4. Magistra analyse l'ordinateur (mémoire, processeur, carte graphique, disque) et **recommande un modèle**. Cliquez sur **Installer Magistra Standard** (ou un autre niveau). La progression s'affiche, et un téléchargement interrompu peut reprendre.
5. **✓ Intelligence artificielle prête** : cliquez sur **Commencer**.

| Niveau | Pour | Téléchargement |
|---|---|---|
| Magistra Léger | PC modestes (8 à 16 Go de mémoire) | ≈ 6 Go |
| Magistra Standard | PC récents (16 Go et plus) | ≈ 9 Go |
| Magistra Qualité | PC avec carte graphique ≥ 16 Go | ≈ 15 Go |

Aucune clé, aucun compte, **aucune ligne de commande**. Hors connexion, Magistra fonctionne avec le modèle local et vos documents.

**Mises à jour** : Magistra ne vérifie rien automatiquement. Dans Réglages → À propos, **Rechercher une mise à jour** interroge la page des versions et, si une nouvelle version existe, propose d'ouvrir sa page pour la télécharger (rien n'est téléchargé ni installé automatiquement).

En mode avancé (Réglages), un établissement peut aussi connecter l'application à son propre serveur d'IA. Magistra indique alors clairement que les données de génération sont transmises à ce serveur.

---

## Site web : déploiement

### Prérequis
- Un **service d'IA** : un préréglage (`AI_PRESET`, voir « [Brancher une vraie IA](#brancher-une-vraie-ia) » ; `ovhcloud` est gratuit et sans clé), ou votre propre **serveur compatible OpenAI** (vLLM sur le GPU de l'université, llama.cpp, LM Studio…) ou **Ollama** (`AI_PROVIDER=ollama`).
- Un projet **Supabase** : exécutez `supabase-schema.sql` dans l'éditeur SQL. Le script est réexécutable et migre l'ancien schéma.
- Une application **Clerk** pour l'authentification.

### Restreindre les inscriptions (recommandé pour un établissement)
Par défaut, toute personne peut créer un compte Clerk et utiliser le serveur d'IA de l'établissement. Dans le tableau de bord Clerk (**Configure → Restrictions**) :
- mode d'inscription **Restricted** : seules les personnes invitées (ou ajoutées par un administrateur) peuvent créer un compte ;
- ou **Allowlist** : seules les adresses ou les domaines autorisés (par exemple `@univ-exemple.fr`) peuvent s'inscrire et se connecter.

Les plafonds `RATE_LIMIT_*` et `MAX_CONCURRENT_GENERATIONS*` limitent les abus, mais ne remplacent pas cette restriction.

### Variables d'environnement
Toutes les variables sont documentées dans [`.env.example`](.env.example). Les principales :

| Variable | Rôle |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | seule variable publique (navigateur) |
| `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` | vérification des jetons côté serveur |
| `CLERK_WEBHOOK_SECRET` | webhook Clerk : effacement des données d'un compte supprimé chez Clerk (voir ci-dessous) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | base de données, **serveur uniquement** |
| `AI_PRESET` | préréglage du service d'IA : `ovhcloud` (gratuit, sans clé), `mistral`, `albert`, `scaleway`, `ollama` |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_SERVER_LABEL`, `AI_PROVIDER_PRIVACY_URL` | serveur d'IA au choix, ou réglages qui l'emportent sur le préréglage (la clé n'est jamais exposée au navigateur ni aux journaux) |
| `MAGISTRA_AUTH`, `MAGISTRA_ADMIN_CONTACT` | mode d'accès (`auto`, `clerk`, `personal`) et contact affiché aux enseignants quand l'IA ne répond pas |
| `SEARXNG_URL`, `CROSSREF_MAILTO` | recherche (facultatif) |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_GLOBAL_PER_MINUTE`, `MAX_CONCURRENT_GENERATIONS_PER_USER`, `MAX_CONCURRENT_GENERATIONS` | protection technique : demandes par minute par utilisateur (10) et pour tout le déploiement (120), générations simultanées par utilisateur (2) et par instance du serveur (8) ; 0 = sans limite |

Après une mise à jour de Magistra, réexécutez `supabase-schema.sql` : il ajoute les tables et fonctions nouvelles sans toucher aux données.

### Suppression d'un compte depuis Clerk (webhook)
Un enseignant peut supprimer son compte depuis « Gérer mon compte » (Clerk). Pour que ses données Magistra (historique, profil, traces anti-abus) soient alors effacées automatiquement :
1. Clerk Dashboard → **Webhooks** → **Add Endpoint** : URL `https://<votre-domaine>/api/clerk-webhook` ;
2. abonnez l'endpoint à l'évènement **`user.deleted`** (les autres évènements sont ignorés) ;
3. copiez le **Signing Secret** (`whsec_…`) dans la variable `CLERK_WEBHOOK_SECRET` du serveur ;
4. sur Vercel uniquement, ajoutez `NODEJS_HELPERS=0` : la signature (Svix) est vérifiée sur le corps brut de la requête.

Le webhook est authentifié par sa signature (HMAC-SHA256, horodatage accepté à ± 5 minutes), jamais par une session ; la suppression est idempotente (un renvoi par Clerk est sans effet). Sans `CLERK_WEBHOOK_SECRET`, la route répond 503 et le problème est signalé dans les journaux du serveur. La suppression depuis Magistra (Réglages) reste disponible dans tous les cas.

### Vercel
Importez le dépôt, renseignez les variables, puis déployez (étapes détaillées et vérification dans « [Brancher une vraie IA](#brancher-une-vraie-ia) »). Toute modification de variable demande un **nouveau déploiement**. `vercel.json` configure :
- les fonctions `api/*`, avec une durée maximale de 300 s pour la génération ;
- la réécriture des routes vers l'interface ;
- les en-têtes de sécurité (CSP, anti-framing, nosniff).

### Serveur Node autonome (auto-hébergement, par exemple dans une université)
```bash
npm ci
npm run build          # interface
npm run build:server   # serveur → dist-server/standalone.js
npm start              # http://127.0.0.1:3000 avec le .env d'exemple (PORT, HOST configurables)
```

Avec le `.env` copié depuis `.env.example`, `HOST=127.0.0.1` : le serveur n'écoute que sur cet ordinateur. Sans Clerk, il démarre alors en **mode personnel** : ouvrez le lien affiché dans le terminal (`#acces=…`). Pour un serveur d'établissement accessible sur le réseau, configurez Clerk et Supabase, puis videz `HOST` (toutes les interfaces) ou placez le serveur derrière un proxy inverse HTTPS. Si `HOST` n'est pas une adresse locale, le mode personnel n'est jamais activé : sans Clerk, l'interface reste en démonstration (et `MAGISTRA_AUTH=personal` est alors refusé).

> Netlify n'est plus proposé : les fonctions serveur de Magistra n'y sont pas compatibles telles quelles.

---

## Développement

```bash
npm ci
cp .env.example .env     # facultatif : sans Clerk, `npm run dev` démarre en mode personnel (voir « Brancher une vraie IA »)
npm run dev              # site + API (/api/*) sur http://localhost:5173 : ouvrez le lien affiché (#acces=…)
npm run dev:electron     # application Windows en développement (Vite + Electron)
```

| Commande | Effet |
|---|---|
| `npm run lint` | ESLint (0 erreur exigée) |
| `npm run typecheck` | TypeScript sur `src`, `shared`, `server`, `api`, `electron`, `tests` |
| `npm test` | tests unitaires et d'intégration (Vitest) |
| `npm run test:e2e` | tests de bout en bout Playwright : `--project=web` (site) ou `--project=electron` (application réelle avec Ollama simulé) |
| `npm run ai:check` | vérifie la configuration et l'IA branchée (`--dev`, `--start`, `--vercel`, `--env-file`, `--no-generate`) |
| `npm run test:real-ai` | validation avec une **vraie** IA (Ollama) : voir ci-dessous |
| `npm run build` | build web |
| `npm run electron:smoke` | build puis test de démarrage réel de l'application |
| `npm run build:electron` | installeur Windows (NSIS + zip), à lancer sous Windows |
| `npm run build:electron:dir` | application empaquetée sans installeur |

La CI (GitHub Actions) exécute sur chaque push et chaque PR ([`ci.yml`](.github/workflows/ci.yml)) :
- `npm ci`, lint, typecheck, tests, build web et build serveur ;
- les tests de bout en bout du site ;
- le démarrage réel d'Electron et les tests de bout en bout de l'application avec Ollama simulé ;
- l'empaquetage Windows (sans installeur) sur `windows-latest`.

Deux autres workflows :
- [`release.yml`](.github/workflows/release.yml) (tag `v*` ou lancement manuel) : installateur et archive Windows, `SHA256SUMS.txt`, **release GitHub en brouillon** (voir « Brancher une vraie IA », chemin 3) ;
- [`real-ai.yml`](.github/workflows/real-ai.yml) (chaque lundi et à la main) : validation avec une vraie IA, décrite ci-dessous.

### Valider avec une vraie IA

Les tests automatisés utilisent des serveurs simulés. `npm run test:real-ai` ([`scripts/real-ai-check.mjs`](scripts/real-ai-check.mjs)) exerce les **vrais** fournisseurs de Magistra contre un **vrai** Ollama :
1. API native d'Ollama (comme l'application Windows) : version (Ollama 0.13.1 au moins), état, liste des modèles, courte génération en français ;
2. le même Ollama par `/v1` (comme un serveur compatible OpenAI ou un préréglage en ligne) : mêmes vérifications ;
3. la chaîne complète de génération avec un court document : une citation `[S1]` vérifiée et la section « Sources utilisées » doivent apparaître.

```bash
ollama pull ministral-3:3b                  # petit modèle (≈ 3 Go, Apache 2.0) de la même famille
npm run test:real-ai                        # Ollama sur http://127.0.0.1:11434, modèle ministral-3:3b
REAL_AI_URL=http://gpu.lan:11434 REAL_AI_MODEL=ministral-3:8b npm run test:real-ai -- --report rapport.json
```

Variables : `REAL_AI_URL` (sans `/v1`), `REAL_AI_MODEL`, `REAL_AI_API_KEY` (proxy à clé, jamais affichée), `REAL_AI_CONTEXT_TOKENS`, `REAL_AI_TIMEOUT_S` (900 s par défaut : processeur seul), `REAL_AI_ATTEMPTS`. En CI, `real-ai.yml` lance l'image Docker officielle d'Ollama (épinglée par empreinte) sur le processeur du runner, garde le modèle en cache et joint le rapport à l'exécution. Aucun modèle n'est téléchargé par le script lui-même.

### Tester sur un vrai PC Windows (avec Ollama réel)

Les tests automatisés utilisent un Ollama simulé. Pour valider l'application avec le vrai moteur :

1. Sous Windows 10/11 (16 Go de mémoire conseillés) : installez la dernière **release** (`Magistra-Setup-x.y.z.exe`, voir « Brancher une vraie IA ») ; ou, avec Node 22, `npm ci`, puis `npm run build:electron:dir`, et lancez `release\win-unpacked\Magistra.exe` (ou `npm run build:electron` et installez `release\Magistra-Setup-*.exe`).
2. **Sans Ollama installé** : l'assistant affiche « Installer le moteur IA », avec la taille et l'espace disque. Cliquez : l'installateur officiel est vérifié (SHA-256) puis lancé. Vérifiez qu'aucune fenêtre PowerShell **ni fenêtre d'Ollama** (accueil, connexion) n'apparaît : Magistra démarre Ollama en arrière-plan (`--hide --fast-startup`), et détecte seul la fin de l'installation.
3. **Ollama trop ancien** (version inférieure à 0.13.1, par exemple une ancienne installation conservée) : Magistra affiche que le moteur est trop ancien **avant** tout téléchargement de modèle, avec **Mettre à jour le moteur IA** ; vérifiez qu'après la mise à jour les modèles déjà présents sont conservés. Si Ollama est installé dans `C:\Program Files` (installation par le service informatique), le message doit inviter à **demander la mise à jour au service informatique**, sans bouton qui échouerait.
4. **Installer Magistra Standard** : la progression s'affiche. Coupez le réseau pendant le téléchargement : un message clair apparaît, et « Reprendre » repart du point atteint. Un modèle déjà installé sous un autre nom (`ministral-3:latest`, `ministral-3:8b-instruct-2512-q4_K_M`…) doit être reconnu sans nouveau téléchargement. Attendez « ✓ Intelligence artificielle prête », puis **Commencer**.
5. **Réseau d'établissement avec proxy** : Ollama n'utilise pas le proxy de Windows, seulement la variable `HTTPS_PROXY` ([FAQ Ollama](https://docs.ollama.com/faq#how-do-i-use-ollama-behind-a-proxy)). Magistra transmet le proxy du système à Ollama quand il le démarre. Si Ollama tournait déjà sans ce réglage, le téléchargement échoue avec un message qui parle du proxy, et « Reprendre le téléchargement » propose de relancer le moteur avec le proxy.
6. Créez un profil (par exemple Master 1), puis dans **Générer** : choisissez « Cours », ajoutez un PDF et un DOCX, « Mes documents uniquement ». Vérifiez « Chargement du modèle… » puis le texte progressif, puis « Sources utilisées » avec les pages ou sections exactes. Recommencez en cliquant sur **Arrêter** en cours de route.
7. Coupez Internet et relancez une génération : elle doit aboutir. En mode « Internet », l'application doit signaler que la recherche est indisponible.
8. Vérifiez l'historique (recherche, favori, suppression), l'export PDF (accents, « x > 3 », « H₂O », tableaux), puis Réglages : changement de niveau (Léger / Qualité), « Rechercher une mise à jour » (la release publiée, et non un brouillon, doit être proposée).
9. Quittez Ollama (icône de la barre des tâches), puis relancez une génération : Magistra doit redémarrer le moteur, ou afficher « Moteur IA non démarré. ».

### Structure

```
shared/     cœur commun (IA, prompts, documents, recherche, citations, pipeline, validation)
src/        interface React (pages, composants, runtime web/local/démo)
server/     serveur web (auth Clerk, Supabase, flux de génération, protection SSRF, serveur autonome)
api/        fonctions Vercel (adaptateurs minces vers server/)
electron/   application Windows (protocole app://, IPC sécurisé, données locales, Ollama)
scripts/    builds, test de démarrage, Ollama simulé, validation avec une vraie IA, icône
tests/      tests Vitest · e2e/ tests Playwright
design/     maquettes (magistra.pen, à ouvrir avec l'éditeur Pencil) : illustrations, pas la référence fonctionnelle
```

L'architecture IA est détaillée dans [ARCHITECTURE_IA.md](ARCHITECTURE_IA.md). Les 108 problèmes de l'audit ([ANALYSE.md](ANALYSE.md)) et leur traitement sont listés dans [CORRECTIONS.md](CORRECTIONS.md).

---

## Confidentialité

| Situation | Ce qui est transmis |
|---|---|
| **Windows + IA locale** | Vos documents et générations restent sur l'ordinateur. |
| **En local** (`npm run dev`, IA détectée sur l'ordinateur) | Rien ne sort de l'ordinateur. |
| **Recherche en ligne** (si vous la choisissez) | Seuls le sujet et les mots-clés partent vers HAL, Crossref, Wikipédia ou SearXNG ; jamais vos documents. |
| **Site web** | La demande et les **extraits** sélectionnés de vos documents sont transmis au serveur Magistra puis au service d'IA configuré par l'administrateur. Quand c'est un prestataire en ligne (OVHcloud, Mistral AI, Albert, Scaleway…), l'interface le **nomme**, avec son pays, sa conservation des données, son usage pour l'entraînement et un lien vers ses conditions. Les fichiers originaux restent dans votre navigateur. |
| **Suppression** | Réglages → « Supprimer toutes mes données » (web) ou « Effacer toutes les données locales » (Windows). |

Le travail d'élève collé pour un corrigé n'est **pas enregistré** dans l'historique (seule sa longueur est notée) : le corrigé enregistré peut toutefois en citer des passages. Pour reprendre une demande depuis l'historique (« Reprendre cette demande »), il faut donc recoller la copie et rajouter les documents.

Les polices sont auto-hébergées : aucune requête vers Google.

---

## Licence

[MIT](LICENSE). Toutes les dépendances d'exécution sont sous licence libre compatible :

| Dépendances | Licence |
|---|---|
| React, Vite, jsPDF, KaTeX, unified/remark | MIT |
| pdf.js | Apache-2.0 |
| JSZip | MIT/GPL |
| polices DejaVu | licence libre Bitstream Vera |
| polices Fontsource | OFL |

Les modèles proposés (Ministral 3, Mistral Small 3.2) sont publiés sous licence Apache 2.0.
