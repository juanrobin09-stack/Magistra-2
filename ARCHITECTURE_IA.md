# Architecture IA de Magistra

Magistra est un projet **open source (licence MIT) et non lucratif**. Il ne dépend d'**aucune API commerciale** :

- **Application Windows** : une IA **locale**, open weights, qui tourne sur l'ordinateur de l'enseignant via [Ollama](https://ollama.com). Aucune clé, aucun compte, aucune limite d'utilisation.
- **Site web** : un serveur d'IA **compatible OpenAI** configuré par l'administrateur, par exemple le serveur GPU d'une université sous vLLM, ou un Ollama distant.

---

## 1. Vue d'ensemble

```
                         ┌───────────────────────────────────────────────┐
                         │                 shared/ (TypeScript)          │
                         │  catalog · levels · types · errors · validation│
                         │  prompts/ · documents/ · research/ · citations │
                         │  ai/ (AIProvider) · pipeline.ts (runGeneration)│
                         └──────────────┬──────────────────┬──────────────┘
                                        │                  │
   APPLICATION WINDOWS                  │                  │                 SITE WEB
┌──────────────────────┐   IPC sécurisé │                  │  HTTPS + jeton  ┌──────────────────────┐
│ React (renderer)     │◄──────────────►│                  │◄───────────────►│ React (navigateur)   │
│ sandbox, pas de Node │                │                  │   Clerk         │                      │
└──────────────────────┘                ▼                  ▼                 └──────────────────────┘
                         ┌──────────────────────┐  ┌──────────────────────────┐
                         │ Electron (processus  │  │ Serveur Magistra          │
                         │ principal)           │  │ (Vercel ou Node autonome) │
                         │ ├ données locales    │  │ ├ vérif. jeton Clerk      │
                         │ └ Ollama (127.0.0.1) │  │ ├ Supabase (service_role) │
                         └──────────────────────┘  │ └ serveur IA configuré    │
                                                   └──────────────────────────┘
```

Le **même pipeline** (`shared/pipeline.ts`) sert le web et Windows. Les **mêmes prompts** (`shared/prompts/`) sont utilisés partout : il n'existe plus trois copies divergentes.

---

## 2. L'abstraction `AIProvider`

Fichier : `shared/ai/provider.ts`.

```ts
interface AIProvider {
  kind: 'ollama' | 'openai-compatible' | 'mock';
  model: string;          // nom technique (« ministral-3:14b »)
  label: string;          // nom lisible (« Magistra Standard », « Serveur universitaire »)
  local: boolean;         // vrai si le moteur tourne sur cette machine
  contextTokens: number;  // taille de contexte à respecter
  stream(opts): AsyncIterable<{type:'delta',text} | {type:'end',finishReason,usage}>;
  generate(opts): Promise<GenerateResult>;
  health(): Promise<HealthStatus>;
  listModels(): Promise<ModelInfo[]>;
}
```

| Fournisseur | Fichier | Usage |
|---|---|---|
| `OllamaProvider` | `shared/ai/ollama.ts` | Windows (local) ou Ollama distant. API native `/api/chat` en flux NDJSON, avec `num_ctx` réglé pour exploiter les documents. `OllamaClient` gère aussi `/api/version`, `/api/tags` et `/api/pull` (installation des modèles avec progression et reprise). |
| `OpenAICompatibleProvider` | `shared/ai/openaiCompatible.ts` | vLLM, llama.cpp server, LM Studio, LocalAI, Ollama `/v1`, passerelles d'établissement : `POST {base}/chat/completions` en flux SSE, `GET {base}/models`. |
| `MockProvider` | `shared/ai/mock.ts` | Tests automatiques. |

`createProvider(config)` (`shared/ai/factory.ts`) construit le bon fournisseur. Le reste de Magistra, c'est-à-dire l'interface, l'historique et les exports, **ignore totalement** quel moteur est utilisé.

Pour ajouter un moteur futur, il suffit d'implémenter `AIProvider`, puis de l'ajouter à la fabrique.

### Erreurs compréhensibles

Chaque fournisseur convertit les erreurs techniques en `MagistraError` (`shared/errors.ts`) avec un message en français. Aucune trace technique, aucun jeton et aucune clé ne sont jamais affichés.

| Situation | Message |
|---|---|
| Connexion refusée vers Ollama local | « Moteur IA non démarré. » |
| `404 model not found` | « Le modèle Magistra Standard n'est pas encore installé. » |
| `requires more system memory` / OOM | « Mémoire insuffisante pour ce modèle… » |
| Serveur distant injoignable ou en 5xx | « Serveur universitaire indisponible… » (libellé `AI_SERVER_LABEL`) |
| Contexte dépassé | « Trop de contenu pour ce modèle… » |
| Annulation | « Génération interrompue. » |
| `finish_reason = length` | avertissement « contenu peut-être incomplet » |
| Document illisible ou scanné | « Document impossible à lire. » / « … document scanné » |
| Recherche indisponible | « Recherche Internet indisponible : génération à partir des autres sources. » |

---

## 3. Modèles locaux (Windows)

Fichier : `shared/ai/models.ts`. L'enseignant ne voit **que trois choix**. Les noms techniques n'apparaissent que dans les « Options avancées ».

| Choix affiché | Modèle Ollama | Licence | Téléchargement | Mémoire minimale |
|---|---|---|---|---|
| **Magistra Léger** | `ministral-3:8b` (Ministral 3 8B) | Apache 2.0 | ≈ 6 Go | 8 Go |
| **Magistra Standard** *(par défaut)* | `ministral-3:14b` (Ministral 3 14B) | Apache 2.0 | ≈ 9 Go | 16 Go |
| **Magistra Qualité** | `mistral-small3.2:24b` (Mistral Small 3.2 24B) | Apache 2.0 | ≈ 15 Go | 32 Go, ou GPU ≥ 16 Go |

**Recommandation automatique** (`recommendTier`) à partir de la RAM, du processeur, de la carte graphique (VRAM via `nvidia-smi` quand elle est disponible) et de l'espace disque :

| Machine | Critère | Recommandation |
|---|---|---|
| PC modeste | moins de 16 Go de RAM | Magistra Léger |
| PC correct | 16 Go et plus, ou GPU ≥ 10 Go | Magistra Standard |
| PC puissant | GPU ≥ 16 Go et RAM ≥ 16 Go | Magistra Qualité |

La RAM est comparée à sa **capacité nominale** (`nominalRamGB`) : le système ne voit pas toute la mémoire installée (réservations matérielles, carte graphique intégrée), si bien qu'un PC vendu « 16 Go » en déclare souvent 15,7, voire 14. La capacité commerciale immédiatement supérieure est retenue quand l'écart est de 15 % au plus ; l'écran indique alors « 16 Go (15,7 Go utilisables) ».

Un modèle n'est **jamais** présenté comme recommandé s'il risque de rendre la machine inutilisable. Un modèle trop gros pour la RAM ou le disque est marqué « Déconseillé », et le modèle Qualité sans GPU est marqué « Très lent ». L'utilisateur reste libre de choisir un autre niveau.

> Les noms de modèles sont centralisés dans `MODEL_TIERS`. S'ils évoluent dans la bibliothèque Ollama, il suffit de les modifier à cet endroit. Ils peuvent aussi être remplacés par un modèle personnalisé en mode avancé.

---

## 4. Documents de l'enseignant

Fichiers : `shared/documents/`, `src/lib/documents/`.

```
fichier (PDF, DOCX, PPTX, TXT, MD)
  → extraction LOCALE du texte (pdf.js / JSZip, dans la fenêtre)
  → unités localisées : page n · diapositive n · section « Titre » · paragraphes a–b · lignes a–b
  → découpage intelligent (paragraphes puis phrases, ≈ 1 200 caractères)
  → recherche des passages utiles (BM25 + racinisation légère du français)
  → sélection sous budget (au moins un passage par document ; tout le document s'il tient)
  → fusion des passages contigus (« pages 14 à 18 »)
  → contexte du modèle, sous forme de sources numérotées [S1], [S2]…
```

- **Pas de base vectorielle persistante.** La récupération est éphémère et recalculée à chaque génération.
- **Le fichier original n'est jamais envoyé ni stocké.**
  - Sous Windows, seul le texte extrait peut être conservé, et seulement si l'enseignant l'a choisi dans les réglages.
  - Sur le web, seuls les **extraits sélectionnés** partent vers le serveur, avec la demande.
- Les PDF scannés sans texte sont détectés et signalés clairement. La reconnaissance de caractères n'est pas incluse.
- Les PDF qui définissent des numéros de page imprimés (`/PageLabels` : « xii », « 47 ») sont cités avec ce numéro, suivi de la position dans le fichier : « page 47 (p. 3 du PDF) ».
- L'indentation des fichiers TXT et MD est conservée (code, poésie, listes imbriquées).

---

## 5. Citations sans hallucination

Fichier : `shared/citations.ts`.

1. Le **code** numérote les sources fournies au modèle, qu'il s'agisse d'extraits de documents ou de résultats de recherche : [S1], [S2]…
2. Le modèle a pour consigne de ne citer que ces numéros, sans y ajouter de page, et de ne jamais rédiger lui-même de bibliographie.
3. À la fin de la génération (et aussi sur le texte partiel conservé après « Arrêter » ou une erreur), le code :
   - normalise les variantes de citation (`[S1, p. 14]`, `[Source 1]`, `(S1)`, `[S1; S2]`) en `[S1]` et **retire toute localisation proposée par le modèle** ;
   - retire toute citation `[Sn]` qui ne correspond à aucune source fournie, ainsi que les pseudo-citations numériques jamais vérifiées (`[12]`, `[4, p. 45]`) ;
   - neutralise tout DOI qui n'appartient pas aux sources (« [référence non vérifiée retirée] ») ; les DOI fournis, même avec parenthèses, sont protégés ;
   - vérifie de même les **liens** : un lien est gardé s'il appartient à une source fournie (ou à une page plus précise du même site), s'il figure dans les documents transmis ou dans la demande de l'enseignant ; sinon le texte du lien est gardé sans l'adresse, et une adresse nue devient « [lien non vérifié retiré] » ;
   - supprime une éventuelle section « Bibliographie », « Références », « Lectures complémentaires »… rédigée par le modèle, y compris les références hors liste qui suivent un pseudo-titre ;
   - ne touche **jamais** aux blocs de code ni au code en ligne ;
   - ajoute la section **« Sources utilisées »**, construite **uniquement** à partir des sources citées dans le corps du texte, avec leurs localisations exactes :
     ```
     [S1] Cours_Economie_M1.pdf — pages 14 à 18
     [S2] Chapitre_Strategie.docx — section « Stratégie d'entreprise »
     [S3] CM4.pptx — diapositives 8 à 12 (extrait)
     [S4] Dupont, J. Titre réel (2021). *Revue*. — HAL. https://doi.org/…
     ```
     « (extrait) » signale qu'une partie seulement du passage a été transmise au modèle (budget de contexte).
   - ajoute une note visible lorsqu'il a retiré des citations ou des DOI : « Vérifiez toute référence avant diffusion. »
4. Les citations vérifiées gardent leur forme `[S1]` dans le texte final : elles se distinguent ainsi de tout « [1] » (intervalle, numérotation) et renvoient à la liste « Sources utilisées ». « [0, 1] » n'est jamais modifié.

---

## 6. Recherche sur Internet

Fichier : `shared/research/`.

```
question (sujet, discipline, objectifs — JAMAIS le texte des documents)
  → recherche : HAL · Crossref · SearXNG (facultatif) · Wikipédia
  → récupération de vraies sources (métadonnées d'origine : auteurs, année, DOI, URL)
  → extraction (résumés, pages web nettoyées et recentrées sur la question)
  → modèle
  → réponse sourcée, avec citations vérifiées
```

Le modèle n'est **pas réentraîné**. Les informations récentes arrivent par récupération dynamique, et l'interface affiche clairement quand Internet a été utilisé.

| Mode choisi dans « Générer » | Scolaire (maternelle → lycée) | Supérieur |
|---|---|---|
| Mes documents uniquement | aucune recherche (hors ligne) | aucune recherche (hors ligne) |
| Sources académiques | documents + HAL + Crossref | documents + HAL + Crossref |
| Internet | Éduscol, education.gouv.fr (Bulletin officiel) *via SearXNG* → web → Wikipédia | HAL → Crossref → web → Wikipédia |
| Documents + Internet | documents en priorité + le mode Internet | documents en priorité + le mode Internet |

- HAL, Crossref et Wikipédia sont des API publiques : **aucune configuration n'est nécessaire**.
- SearXNG, qui donne la recherche web générale et les sites institutionnels, est **facultatif**. Il se configure avec `SEARXNG_URL` sur le serveur, ou dans les Réglages sous Windows.
- Wikipédia peut être désactivé (`RESEARCH_WIKIPEDIA=false` sur le serveur, Réglages sous Windows). L'interface annonce ce qui sera réellement consulté : « Wikipédia seulement », « sources académiques seulement », ou mode Internet indisponible si rien n'est interrogeable.
- **Sans Internet**, Magistra continue de fonctionner avec le modèle local et les documents. Un avertissement est affiché.
- Côté serveur et côté Windows, les pages web sont récupérées avec une protection SSRF (`server/safeFetch.ts`) : adresses privées refusées, redirections vérifiées, taille bornée.

---

## 7. Prompts et enseignement supérieur

Fichier : `shared/prompts/`.

**Règles d'honnêteté**, pour tous les niveaux :
- ne jamais inventer de référence, d'auteur, de DOI, de page, de texte officiel ou de statistique précise ;
- ne citer que les sources fournies.

**Scolaire** (maternelle, élémentaire, collège, lycée, lycée professionnel) :
- appui sur les programmes et référentiels officiels **sans prétendre les connaître parfaitement** ;
- aucune référence réglementaire précise (numéro de BO, date) si elle ne figure pas dans les sources : elle est alors signalée « à vérifier sur eduscol ».

**Supérieur** : les **documents, objectifs et consignes de l'enseignant sont la source principale**. BTS, BUT et CPGE s'appuient sur leurs référentiels nationaux, avec la même réserve qu'au scolaire : connaissance possiblement incomplète, aucun intitulé exact de bloc de compétences ou d'épreuve hors sources fournies (« à vérifier dans le référentiel officiel »). Comportements par niveau :

| Niveau | Attendus |
|---|---|
| Licence | rigueur, notions fondamentales, références (issues des sources), exercices d'application, méthodologie |
| Master | problématisation, littérature scientifique, analyse critique, études de cas, débats académiques, bibliographie, méthodologie avancée |
| Doctorat | état de l'art, controverses scientifiques, positionnement théorique, méthodologie de recherche, limites, perspectives, bibliographie avancée |

Les 11 outils ont des consignes adaptées au niveau. Au supérieur, par exemple, « Progression » devient un syllabus, « Évaluation » un examen, « Courrier parents » un message aux étudiants et « Appréciations » des commentaires d'évaluation.

---

## 8. Flux de génération (streaming)

`runGeneration()` produit des évènements `GenerationEvent` :

```
status(research) → warning* → sources → status(generating) → delta* → status(finalizing) → [warning] → done | error
```

| Mode | Transport des évènements |
|---|---|
| Web | flux NDJSON sur `POST /api/generate`. La fermeture de la connexion interrompt le modèle. |
| Windows | `webContents.send('gen:event', { jobId, event })`. `gen:cancel` interrompt le modèle. |
| Démo | exemples pré-rédigés restitués en flux, clairement signalés comme tels. |

Dans l'interface, le texte apparaît progressivement, avec trois commandes : **Arrêter**, **Recommencer**, **Réessayer**.

- **Nouvel essai automatique** : si le serveur d'IA est surchargé ou momentanément indisponible (`AI_BUSY`, `AI_SERVER_UNAVAILABLE`) **avant le premier mot**, Magistra réessaie après 2 s puis 5 s en l'annonçant. Jamais après le premier mot (le texte serait dupliqué), jamais après « Arrêter ».
- **Arrêter** interrompt réellement le modèle, y compris pendant le démarrage du moteur local (qui se poursuit en arrière-plan pour la génération suivante). Le texte déjà produit est conservé, **après** vérification des citations et des liens.
- Une relance juste après « Arrêter » attend la fin réelle de la génération annulée (15 s au plus) au lieu d'échouer.

---

## 9. Configuration

### Serveur web (variables d'environnement)

| Variable | Rôle |
|---|---|
| `AI_PROVIDER` | `openai-compatible` (défaut) ou `ollama` |
| `AI_BASE_URL` | ex. `https://ia.mon-universite.fr/v1` (vLLM) ou `http://gpu:11434` (Ollama) |
| `AI_MODEL` | nom du modèle servi |
| `AI_API_KEY` | facultative, **jamais exposée au navigateur** |
| `AI_SERVER_LABEL` | libellé affiché, ex. « Serveur universitaire » |
| `AI_CONTEXT_TOKENS`, `AI_MAX_OUTPUT_TOKENS` | budget de contexte et de sortie |
| `SEARXNG_URL`, `CROSSREF_MAILTO` | recherche (facultatif) |
| `AI_TIMEOUT_SECONDS` | durée maximale d'une génération (280 s par défaut) |
| `RATE_LIMIT_PER_MINUTE` | demandes de génération par minute et par utilisateur (10 ; 0 = désactivé) → `RATE_LIMITED` (429) |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | demandes de génération par minute pour tout le déploiement (120 ; 0 = désactivé) → `AI_BUSY` (503, réessayable) |
| `MAX_CONCURRENT_GENERATIONS_PER_USER` | générations en cours par utilisateur, toutes instances confondues (2 ; 0 = sans limite) → `GENERATION_BUSY` (429) |
| `MAX_CONCURRENT_GENERATIONS` | générations en cours par instance du serveur, vers le serveur d'IA (8 ; 0 = sans limite) → `AI_BUSY` (503, réessayable) |
| `CLERK_WEBHOOK_SECRET` | webhook Clerk `POST /api/clerk-webhook` (signature Svix vérifiée) : `user.deleted` efface les données du compte, comme `DELETE /api/account` |

Les générations en cours sont comptées dans Supabase (table `active_generations`, fonctions `magistra_begin_generation` / `magistra_end_generation`) : la concurrence, le débit de l'utilisateur et le débit global sont vérifiés dans une même transaction, sous un verrou par utilisateur (plus un verrou commun pour le débit global), donc de façon atomique même avec plusieurs instances serverless. La place est libérée à la fin du flux (succès, erreur, arrêt, déconnexion du client) ; si cette libération échoue, elle expire après `AI_TIMEOUT_SECONDS` + 90 s. Si le compteur est indisponible, la demande est acceptée (journalisée) et seuls les plafonds de l'instance s'appliquent.

### Application Windows

Réglages → Intelligence artificielle :
- **mode local** (Ollama sur 127.0.0.1, par défaut) ;
- ou **serveur distant**, compatible OpenAI ou Ollama. La clé éventuelle est chiffrée avec `safeStorage`, reste dans le processus principal et n'est jamais renvoyée à la fenêtre.

---

## 10. Confidentialité (messages affichés)

Les messages dépendent du mode réel et ne promettent rien qui ne soit garanti.

| Situation | Message affiché | Où |
|---|---|---|
| Windows + IA locale (Ollama sur 127.0.0.1) | « IA locale : les contenus sont rédigés sur cet ordinateur, sans aucun service d'IA en ligne. » + « Vos documents et générations restent sur cet ordinateur. » | page Générer |
| Windows + IA locale | « IA locale — Vos documents et générations restent sur cet ordinateur. » | Réglages |
| Windows + serveur distant | « Les données utilisées pour la génération seront transmises au serveur IA configuré (libellé). » | page Générer, Réglages |
| Web | la demande et les extraits de vos documents sont transmis au serveur Magistra puis au serveur d'IA configuré par l'administrateur ; vos fichiers originaux ne quittent pas votre navigateur | page Générer |
| Recherche en ligne choisie | seuls le sujet et les mots-clés sont transmis aux services de recherche, jamais les documents | page Générer |
| Démonstration | exemples pré-rédigés, aucune IA ; données dans ce navigateur | partout |
