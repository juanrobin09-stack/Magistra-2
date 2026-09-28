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

Magistra **ne dépend d'aucune API commerciale** :

| Mode | IA utilisée | Compte | Données |
|---|---|---|---|
| **Application Windows** | IA **locale** open weights via [Ollama](https://ollama.com) : Magistra Léger, Standard ou Qualité | aucun | restent sur l'ordinateur |
| **Site web** | serveur d'IA **compatible OpenAI** de l'établissement (vLLM, Ollama distant…) | Clerk | serveur Magistra (Supabase) |
| **Démonstration** | aucune : exemples pré-rédigés, clairement signalés | aucun | navigateur |

La génération est **illimitée** : il n'y a ni quota ni compteur. Les seules limites sont celles de la machine ou du serveur d'IA, plus des protections techniques contre les abus sur un serveur public.

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
2. Au premier lancement, Magistra vérifie automatiquement si le moteur d'IA locale (Ollama) est installé et en marche, et si un modèle est disponible.
3. **Si le moteur manque**, cliquez sur **Installer le moteur IA**. La taille du téléchargement et l'espace disque nécessaire sont affichés avant toute action. En cas de problème, Magistra ouvre la page officielle et détecte seul la fin de l'installation.
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
- Un **serveur d'IA compatible OpenAI**, par exemple vLLM sur le GPU de l'université, ou un Ollama distant.
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
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_SERVER_LABEL` | serveur d'IA (la clé n'est jamais exposée au navigateur) |
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
Importez le dépôt, renseignez les variables, puis déployez. `vercel.json` configure :
- les fonctions `api/*`, avec une durée maximale de 300 s pour la génération ;
- la réécriture des routes vers l'interface ;
- les en-têtes de sécurité (CSP, anti-framing, nosniff).

### Serveur Node autonome (auto-hébergement, par exemple dans une université)
```bash
npm ci
npm run build          # interface
npm run build:server   # serveur → dist-server/standalone.js
npm start              # http://0.0.0.0:3000 (PORT, HOST configurables)
```

> Netlify n'est plus proposé : les fonctions serveur de Magistra n'y sont pas compatibles telles quelles.

---

## Développement

```bash
npm ci
cp .env.example .env     # facultatif : sans Clerk, le site démarre en mode démonstration
npm run dev              # site + API (/api/*) sur http://localhost:5173
npm run dev:electron     # application Windows en développement (Vite + Electron)
```

| Commande | Effet |
|---|---|
| `npm run lint` | ESLint (0 erreur exigée) |
| `npm run typecheck` | TypeScript sur `src`, `shared`, `server`, `api`, `electron`, `tests` |
| `npm test` | tests unitaires et d'intégration (Vitest) |
| `npm run test:e2e` | tests de bout en bout Playwright : `--project=web` (site) ou `--project=electron` (application réelle avec Ollama simulé) |
| `npm run build` | build web |
| `npm run electron:smoke` | build puis test de démarrage réel de l'application |
| `npm run build:electron` | installeur Windows (NSIS + zip), à lancer sous Windows |
| `npm run build:electron:dir` | application empaquetée sans installeur |

La CI (GitHub Actions) exécute sur chaque push et chaque PR :
- `npm ci`, lint, typecheck, tests, build web et build serveur ;
- les tests de bout en bout du site ;
- le démarrage réel d'Electron et les tests de bout en bout de l'application avec Ollama simulé ;
- l'empaquetage Windows (sans installeur) sur `windows-latest`.

### Structure

```
shared/     cœur commun (IA, prompts, documents, recherche, citations, pipeline, validation)
src/        interface React (pages, composants, runtime web/local/démo)
server/     serveur web (auth Clerk, Supabase, flux de génération, protection SSRF, serveur autonome)
api/        fonctions Vercel (adaptateurs minces vers server/)
electron/   application Windows (protocole app://, IPC sécurisé, données locales, Ollama)
scripts/    builds, test de démarrage, Ollama simulé, icône
tests/      tests Vitest · e2e/ tests Playwright
design/     maquettes (magistra.pen, à ouvrir avec l'éditeur Pencil) : illustrations, pas la référence fonctionnelle
```

L'architecture IA est détaillée dans [ARCHITECTURE_IA.md](ARCHITECTURE_IA.md). Les 108 problèmes de l'audit ([ANALYSE.md](ANALYSE.md)) et leur traitement sont listés dans [CORRECTIONS.md](CORRECTIONS.md).

---

## Confidentialité

| Situation | Ce qui est transmis |
|---|---|
| **Windows + IA locale** | Vos documents et générations restent sur l'ordinateur. |
| **Recherche en ligne** (si vous la choisissez) | Seuls le sujet et les mots-clés partent vers HAL, Crossref, Wikipédia ou SearXNG ; jamais vos documents. |
| **Site web** | La demande et les **extraits** sélectionnés de vos documents sont transmis au serveur Magistra puis au serveur d'IA configuré par l'administrateur. Les fichiers originaux restent dans votre navigateur. |
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
