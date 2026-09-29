# Architecture IA de Magistra

Magistra est un projet **open source (licence MIT) et non lucratif**. Il ne dépend d'**aucune API payante** :

- **Application Windows** : une IA **locale**, open weights, qui tourne sur l'ordinateur de l'enseignant via [Ollama](https://ollama.com). Aucune clé, aucun compte, aucune limite d'utilisation.
- **Site web** : un **préréglage** (`AI_PRESET`, voir § 11 ; `ovhcloud` est gratuit, sans clé, hébergé en France) ou un serveur d'IA **compatible OpenAI** ou **Ollama** configuré par l'administrateur (serveur GPU d'une université sous vLLM, Ollama distant…). Un prestataire en ligne est **toujours annoncé** à l'enseignant.
- **En local** (`npm run dev`, `npm start` sur la boucle locale) : **mode personnel** sans compte (§ 12), avec l'IA de l'ordinateur **détectée automatiquement** (§ 13).

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
| Serveur distant en 5xx | « Le serveur universitaire est momentanément indisponible… » (libellé `AI_SERVER_LABEL`) → `AI_SERVER_UNAVAILABLE` |
| Adresse injoignable (connexion refusée, nom inconnu, TLS) | « Le serveur d'IA est injoignable à l'adresse configurée… » → `AI_SERVER_UNREACHABLE`, **sans** nouvel essai automatique |
| Clé refusée (401/403) | « … a refusé l'accès (clé d'accès refusée). L'administrateur du site doit vérifier AI_API_KEY. » → `AI_AUTH_FAILED` |
| Quota ou limite de débit (429 long, 402, quota du jour) | « … limite le nombre de demandes (offre gratuite ou quota) : réessayez dans 55 s. » → `AI_QUOTA_EXCEEDED` (§ 15) |
| Ollama trop ancien pour le modèle (412 du registre, « newer version ») | « Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour. » → `ENGINE_OUTDATED` (§ 17) |
| Contexte dépassé | « Trop de contenu pour ce modèle… » |
| Annulation | « Génération interrompue. » |
| `finish_reason = length` | avertissement « contenu peut-être incomplet » |
| Document illisible ou scanné | « Document impossible à lire. » / « … document scanné » |
| Recherche indisponible | « Recherche Internet indisponible : génération à partir des autres sources. » |

Les conseils s'adressent au bon **destinataire** (`recipient`) : « vérifiez dans les réglages » sur le poste Windows, « l'administrateur du site doit… » sur le site web, où l'enseignant n'a pas de réglage de serveur. Le contact de l'administrateur (`MAGISTRA_ADMIN_CONTACT`) et le code de l'erreur sont affichés pour qu'il puisse être prévenu. Côté serveur, chaque génération échouée est journalisée avec son **code**, le libellé du serveur et le nom du modèle, jamais avec le contenu de la demande, l'identité de l'enseignant ni une clé.

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

   Avant ces étapes, un document **entièrement entouré** d'un bloc « ```markdown … ``` » est déballé (`shared/markdownFence.ts`) : certains petits modèles le font souvent (Ministral 3 3B, constaté avec un vrai Ollama, § 18). Sans cela, tout le texte serait traité comme du code : aucune citation vérifiée et pas de « Sources utilisées ». Le même modèle produit aussi un bloc **sans langage** (« ``` » seul) : il n'est déballé que si ce qu'il entoure est manifestement un document rédigé (citation `[Sn]` ou gras, ou deux marques parmi titre, liste, citation « > ») et ne ressemble pas à du code ; un vrai bloc de code, ou du code suivi de prose, n'est jamais modifié.
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
status(research) → warning* → sources → [status(loading_model)] → status(generating) → delta* → status(finalizing) → [warning] → done | error
```

`loading_model` (« Chargement du modèle… ») n'existe qu'avec le moteur local (Windows, `preloadModel`) : Ollama charge d'abord le modèle en mémoire (`/api/chat` sans message, 10 min au plus), si bien que l'attente du premier mot ne compte plus ce chargement. Cette attente s'adapte ensuite à la taille de la demande sur un PC sans carte graphique : 120 s + 1 s par 10 tokens de prompt, au moins 300 s et au plus 30 min.

| Mode | Transport des évènements |
|---|---|
| Web | flux NDJSON sur `POST /api/generate`. La fermeture de la connexion interrompt le modèle. |
| Windows | `webContents.send('gen:event', { jobId, event })`. `gen:cancel` interrompt le modèle. |
| Démo | exemples pré-rédigés restitués en flux, clairement signalés comme tels. |

Dans l'interface, le texte apparaît progressivement, avec trois commandes : **Arrêter**, **Recommencer**, **Réessayer**.

- **Nouvel essai automatique** : si le serveur d'IA est surchargé ou momentanément indisponible (`AI_BUSY`, `AI_SERVER_UNAVAILABLE`) **avant le premier mot**, Magistra réessaie après 2 s puis 5 s en l'annonçant (ou après le délai `Retry-After` donné par le serveur, s'il ne dépasse pas 15 s). Jamais après le premier mot (le texte serait dupliqué), jamais après « Arrêter », jamais pour une adresse injoignable ni pour un quota (§ 15).
- **Arrêter** interrompt réellement le modèle, y compris pendant le démarrage du moteur local (qui se poursuit en arrière-plan pour la génération suivante). Le texte déjà produit est conservé, **après** vérification des citations et des liens.
- Une relance juste après « Arrêter » attend la fin réelle de la génération annulée (15 s au plus) au lieu d'échouer.

---

## 9. Configuration

### Serveur web (variables d'environnement)

| Variable | Rôle |
|---|---|
| `AI_PRESET` | préréglage (§ 11) : `ovhcloud`, `mistral`, `albert`, `scaleway`, `ollama` ; les variables ci-dessous l'emportent sur ses valeurs |
| `AI_PROVIDER` | `openai-compatible` (défaut) ou `ollama` ; `lmstudio`, `llamacpp`, `localai`, `vllm`… sont compris comme `openai-compatible`, `mistral`, `albert`, `ovhcloud`, `scaleway` comme le préréglage du même nom (avec un avertissement) |
| `AI_BASE_URL` | ex. `https://ia.mon-universite.fr/v1` (vLLM) ou `http://gpu:11434` (Ollama, sans `/v1`) ; sur Vercel, une adresse locale ou privée est signalée comme injoignable |
| `AI_MODEL` | nom du modèle servi |
| `AI_API_KEY` | facultative (obligatoire pour `mistral`, `albert`, `scaleway`), envoyée aussi à un Ollama derrière un proxy à clé, **jamais exposée au navigateur ni aux journaux** |
| `AI_SERVER_LABEL` | libellé affiché, ex. « Serveur universitaire » ; un prestataire en ligne reconnu reste toujours nommé : « Libellé (Prestataire) » |
| `AI_PROVIDER_PRIVACY_URL` | page des conditions du prestataire (https), affichée à l'enseignant |
| `AI_AUTODETECT` | détection automatique d'une IA locale (§ 13), `true` par défaut, sans effet sur Vercel |
| `AI_HEALTH_TIMEOUT_MS` | délai du test d'état affiché dans l'interface (10 s par défaut) ; au-delà : « non vérifié » (§ 16) |
| `AI_CONTEXT_TOKENS`, `AI_MAX_OUTPUT_TOKENS` | budget de contexte et de sortie (défaut : ceux du préréglage) |
| `MAGISTRA_AUTH` | `auto` (défaut), `clerk` ou `personal` (§ 12) |
| `MAGISTRA_ADMIN_CONTACT` | contact affiché aux enseignants quand l'IA ne répond pas |
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
| Web + prestataire en ligne (préréglage ou hôte reconnu) | « Les demandes et les extraits de vos documents sont envoyés à « OVHcloud AI Endpoints » (France, centre de données de Gravelines) pour la génération. » + conservation + entraînement + lien vers ses conditions ; vos fichiers originaux ne quittent pas votre navigateur | page Générer, Réglages |
| Web + serveur de l'établissement | la demande et les extraits de vos documents sont transmis au serveur Magistra puis au serveur d'IA configuré par l'administrateur (libellé) ; vos fichiers originaux ne quittent pas votre navigateur | page Générer |
| Mode personnel + IA de l'ordinateur | « … transmis au serveur Magistra puis à « IA locale du serveur Magistra » (même machine que le serveur Magistra) pour la génération. Aucune transmission à un service d'IA en ligne. » | page Générer, Réglages |
| Recherche en ligne choisie | seuls le sujet et les mots-clés sont transmis aux services de recherche, jamais les documents | page Générer |
| Démonstration | exemples pré-rédigés, aucune IA ; données dans ce navigateur | partout |

---

## 11. Préréglages et confidentialité par prestataire

Fichier : `shared/ai/presets.ts`. Un préréglage (`AI_PRESET`) fixe l'adresse, le modèle, le type d'API, la taille de contexte, la longueur de sortie et, surtout, la **fiche de confidentialité** du prestataire : pays, conservation, entraînement, lien vers ses conditions. Les faits sont ceux que le prestataire **annonce** ; quand ils ne sont pas connus, la fiche renvoie à ses conditions au lieu d'inventer.

| Préréglage | Prestataire, modèle | Clé | Accès gratuit | Pays | Conservation | Entraînement |
|---|---|---|---|---|---|---|
| `ovhcloud` (**défaut conseillé**, `DEFAULT_WEB_PRESET`) | OVHcloud AI Endpoints, `Mistral-Small-3.2-24B-Instruct-2506` (repli `Mistral-Nemo-Instruct-2407`) | facultative | oui, anonyme : 2 demandes/min par IP et par modèle ; avec clé : 400/min, paiement à l'usage | France (Gravelines) | aucune (annoncé) | non (annoncé) |
| `mistral` | Mistral AI (La Plateforme), `ministral-14b-2512` | obligatoire | offre « Experiment » | Union européenne | selon Mistral AI | **oui par défaut sur l'offre gratuite**, sauf refus dans l'Admin Console |
| `albert` | Albert API (DINUM), `openweight-medium` (alias) | obligatoire | agents de l'État, sur demande | France (SecNumCloud) | selon ses conditions | selon ses conditions |
| `scaleway` | Scaleway Generative APIs, `mistral-small-3.2-24b-instruct-2506` | obligatoire | 1 000 000 de tokens offerts | France | non collectés ni réutilisés (annoncé) | non (annoncé) |
| `ollama` | Ollama auto-hébergé, `ministral-3:14b`, API native | aucune | oui | votre serveur | rien ne sort | aucun |

Sources : [OVHcloud AI Endpoints](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities), [Mistral AI](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training), [Albert API](https://guides.ia.numerique.gouv.fr/albert-api), [Scaleway](https://www.scaleway.com/en/news/scaleway-launches-generative-apis-a-drop-in-alternative-to-openai-apis-100percent-made-in-europe/), [FAQ Ollama](https://docs.ollama.com/faq).

**Ce que reçoit le navigateur** : `providerInfoFor(baseUrl, AI_SERVER_LABEL)` produit une `ProviderInfo` (`label`, `thirdParty`, `country`, `retention`, `training`, `privacyUrl`), **sans URL de serveur ni clé**, publiée par `/api/status` (`ai.providerInfo`). Une adresse saisie à la main est décrite par `describeAIEndpoint` : préréglage reconnu par son hôte, prestataire connu, boucle locale (« IA locale du serveur Magistra »), réseau privé (« Serveur d'IA du réseau local ») ou prestataire inconnu (tiers par prudence). Un libellé d'administrateur ne masque jamais un prestataire en ligne : « Serveur du lycée (OVHcloud AI Endpoints) ». Dès que `thirdParty` est vrai, la page Générer et les Réglages **annoncent** l'envoi des demandes et des extraits à ce prestataire (§ 10), condition posée pour utiliser un service en ligne. La fiche statique de la configuration est aussi transmise par `GET /api/mode` (`ModeInfo.providerInfo`, lu avant le premier rendu, jamais en démonstration) : tant que `/api/status` n'a pas répondu ou s'il échoue, la page Générer nomme ce prestataire ; sans prestataire tiers annoncé, elle affiche une annonce prudente (« … qui peut être un service en ligne extérieur ») et le bouton Générer attend la fin de la première vérification.

## 12. Mode personnel (sans compte, sur l'ordinateur de l'enseignant)

Fichier : `server/personal.ts`. `MAGISTRA_AUTH=auto` (défaut) choisit : comptes **Clerk** si des clés Clerk sont renseignées ; sinon **mode personnel** avec `npm run dev`, ou avec `npm start` si `HOST` est une adresse de boucle locale ; sinon démonstration. Une clé Clerk **publiable seule** (sans `CLERK_SECRET_KEY` ni `CLERK_JWT_KEY` : `.env` d'une ancienne version, modèle non rempli) ne peut vérifier aucune session : sur la boucle locale (hors Vercel), elle est ignorée et le mode personnel est choisi, avec une ligne au journal ; ailleurs, Clerk reste choisi et l'erreur de configuration est explicite. Le mode personnel est **refusé** sur Vercel et quand le serveur écoute ailleurs que sur la boucle locale (le serveur autonome ne démarre pas). La route publique `GET /api/mode` (`ModeInfo` : `auth`, clé publiable Clerk, contact de l'administrateur ; aucun secret) indique le mode à l'interface ; une réponse 404 ou non JSON vaut « aucun ».

Sécurité (tous les garde-fous s'appliquent ensemble) :
- **jeton secret de 256 bits**, créé au premier démarrage dans `MAGISTRA_DATA_DIR/access-token`, exigé sur **chaque** requête (`Authorization: Bearer …`) et comparé en temps constant. Le dossier de données est réservé à son propriétaire : droits `0600`/`0700` sous Linux et macOS ; sous Windows, dossier par défaut `%LOCALAPPDATA%\Magistra\serveur` (profil de l'utilisateur) et ACL restreinte au démarrage (`restrictDataDirAcl` : `icacls` et `whoami` appelés par leur chemin absolu dans System32, sans shell ; avertissement clair en cas d'échec). `npm run dev` ne sert **jamais** ce dossier : le plugin `magistraDevApi` l'ajoute à `server.fs.deny` (valeurs par défaut de Vite conservées, `MAGISTRA_DATA_DIR` compris) et refuse en tête des middlewares toute adresse qui vise `.magistra-data` (encodée, en majuscules, par `/@fs/`…) ;
- adresse d'accès affichée dans le terminal : `http://localhost:PORT/#acces=<jeton>`. Le fragment `#` n'est jamais envoyé au serveur, ni journalisé, ni transmis dans l'en-tête `Referer` ; l'interface le retire de la barre d'adresse ;
- **boucle locale** : connexion venant de la machine elle-même ;
- en-tête **`Host`** limité à `localhost`, `127.0.0.1` et `[::1]` avec le port du serveur (protection contre le « DNS rebinding ») ; en-tête **`Origin`** identique quand le navigateur l'envoie (requêtes d'autres sites refusées) ;
- un seul utilisateur, d'identifiant fixe ; historique dans des fichiers (`MAGISTRA_STORE=file`), les limites anti-abus s'appliquent comme ailleurs.

Un proxy inverse placé devant (nginx…) n'ouvre donc pas l'accès : le jeton reste exigé. Pour un accès depuis le réseau, il faut Clerk.

## 13. Détection automatique d'une IA locale

Fichier : `server/localAI.ts`. Avec `npm run dev` ou `npm start` (jamais sur Vercel), si `AI_PRESET`, `AI_BASE_URL` et `AI_MODEL` sont vides et `AI_AUTODETECT` n'est pas `false`, Magistra sonde des **adresses fixes** en boucle locale (aucune adresse venant d'une requête : pas de SSRF) :
1. **Ollama** `http://127.0.0.1:11434` : `/api/version`, `/api/tags` (modèles installés), `/api/ps` (modèles déjà chargés) ;
2. **LM Studio** `http://127.0.0.1:1234` : `/api/v0/models`, à défaut `/v1/models`.

Les modèles « en ligne » d'Ollama (`shared/ai/ollamaRemote.ts` : nom terminé par `:cloud` ou `-cloud`, même règle qu'Ollama, ou champ `remote_host` de `/api/tags`) ne sont **jamais** retenus : Ollama relaierait les textes vers ollama.com ou un autre hôte alors que l'interface annonce une IA locale. S'il n'y a qu'eux, rien n'est branché et le message conseille d'installer un modèle local. Déclaré explicitement (`AI_MODEL`), un modèle cloud est annoncé « Ollama Cloud » (prestataire tiers) ; un modèle local à `remote_host` est vérifié dans `/api/tags` (réponse locale, jamais relayée) et la fiche de transparence nomme son vrai destinataire. L'application Windows écarte ces modèles de la liste « Modèle personnalisé », les refuse, et démarre Ollama avec `OLLAMA_NO_CLOUD=1`. `AI_API_KEY` n'est jamais transmise à une IA détectée automatiquement.

Le modèle retenu est un niveau Magistra installé, **alias compris** (`installedModelForTier` : `ministral-3:latest` = Magistra Léger, par exemple ; les variantes q8 et fp16 ne comptent pas), de préférence déjà chargé et adapté à la mémoire ; sinon le premier modèle de conversation (les modèles d'embedding et de reranking sont écartés). Ollama est utilisé par son **API native** (taille de contexte transmise). Une version d'Ollama trop ancienne (`ollamaVersionStatus`) est signalée. Rien n'est téléchargé : sans modèle, le terminal conseille « `ollama pull ministral-3:8b` ». Le terminal de `npm run dev` indique le résultat, puis l'adresse d'accès du mode personnel.

## 14. Vérifier la configuration : `npm run ai:check`

Fichier : `server/aiCheck.ts` (compilé à la volée par esbuild ; aussi `node dist-server/ai-check.js` après `npm run build:server`). Pour l'administrateur, en français, sans jamais afficher de clé :

```bash
npm run ai:check                                     # serveur autonome : lit .env
npm run ai:check -- --dev                            # comme npm run dev : .env, .env.local, .env.development
npx vercel env pull --environment=production .env.prod.local && npm run ai:check -- --vercel --env-file .env.prod.local
```

Étapes : mode du site (Clerk, personnel ou démonstration), stockage, configuration de l'IA (préréglage, détection automatique), joignabilité **classée par cause** (refus, nom inconnu, TLS, délai), présence du modèle (avec la liste des modèles disponibles), taille de contexte (par exemple Ollama branché par `/v1` : conseil `AI_PROVIDER=ollama` ou `OLLAMA_CONTEXT_LENGTH`), puis une génération d'essai de 16 tokens au plus, **annoncée** et désactivable (`--no-generate`). Avec `--vercel`, une adresse locale ou privée est une erreur. Code de sortie : 0 si tout est prêt, 1 sinon, 2 si les options sont invalides.

## 15. Quotas et limites des offres gratuites

Fichiers : `shared/ai/errorMapping.ts`, `shared/ai/streams.ts`. Les offres gratuites limitent le nombre de demandes (OVHcloud anonyme : 2 par minute ; quotas quotidiens ailleurs). Un 429 est lu avec ses en-têtes (`Retry-After`, `X-RateLimit-Reset…`) et son corps :
- attente courte (15 s au plus) et aucune mention de quota : `AI_BUSY`, nouvel essai automatique **après le délai annoncé** ;
- attente plus longue, quota du jour, crédits épuisés (402), limite de tokens par minute : **`AI_QUOTA_EXCEEDED`** (HTTP 429), message avec le **moment de reprise** quand le fournisseur le donne (« réessayez dans 55 s », « … dans environ 3 minutes », « … vers 14 h 32 (heure de Paris) », fuseau `DEFAULT_TIMEZONE`). **Aucun nouvel essai automatique** (il consommerait le quota) ; le bouton **Réessayer** reste disponible.

`MagistraError.retryAfterMs` transporte le délai côté serveur ; il n'est jamais sérialisé vers le navigateur.

## 16. État « non vérifié »

Le test d'état (`AIProvider.health`, affiché par `/api/status`, l'indicateur et les Réglages) ne lève jamais d'exception et ne bloque plus à tort. Quand le serveur met plus de `AI_HEALTH_TIMEOUT_MS` (10 s) à répondre, ne fournit pas de liste de modèles (`/models` absent : 404 sur une adresse en `/v…`, ou 405) ou en fournit une vide, le résultat est `ok: true` avec l'avertissement **`AI_STATUS_UNKNOWN`** : « … son état n'a pas pu être vérifié. La génération reste possible. » Un modèle absent d'une liste non vide (alias, modèle virtuel comme `mistral@latest`) donne aussi un avertissement non bloquant. Seules les causes certaines (clé refusée, adresse injoignable, modèle absent d'Ollama…) rendent l'IA « non prête », avec leur message précis (`Capabilities.notReady`) ; `AI_NOT_CONFIGURED` sans cause précise a son propre texte (« Aucune IA n'est branchée sur ce site… », avec la bonne commande de vérification : `npm run ai:check -- --dev` pour `npm run dev`, `--vercel --env-file .env.prod.local` pour Vercel), mais une cause précise du serveur (préréglage inconnu, clé manquante, `AI_MODEL` absent, Ollama ou LM Studio sans modèle, seulement des modèles en ligne…) est toujours affichée telle quelle.

## 17. Mise à jour du moteur Windows et proxy

Fichier : `electron/ollamaSetup.ts`.
- **Version minimale** : les modèles Ministral 3 exigent **Ollama 0.13.1** (`MIN_OLLAMA_VERSION`, `shared/ai/models.ts` ; [page du modèle](https://ollama.com/library/ministral-3), [v0.13.1](https://github.com/ollama/ollama/releases/tag/v0.13.1-rc1)). La version (`/api/version`) est comparée **avant** tout téléchargement de modèle : un moteur trop ancien est signalé (`AIStatus.engine.outdated`, phase « moteur trop ancien »), au lieu d'un téléchargement qui échouerait en boucle (412 du registre → `ENGINE_OUTDATED`, non réessayable, sans bouton « Reprendre »).
- **Mise à jour du moteur** : « Mettre à jour le moteur IA » appelle `installEngine({ update: true })` (même canal IPC `ai:install-engine`) : installateur officiel, empreinte SHA-256 vérifiée, taille annoncée avant le clic, modèles conservés, version revérifiée après l'installation. Si Ollama est installé dans `%ProgramFiles%` (service informatique, droits d'administrateur), `managedByAdmin` : Magistra invite à **demander la mise à jour au service informatique**, sans jamais demander d'élévation de droits.
- **Démarrage discret** : « ollama app.exe » est lancé avec `--hide --fast-startup`, comme la ligne de commande officielle d'Ollama : aucune fenêtre d'accueil ne s'ouvre par-dessus Magistra.
- **Démarrage lent ou impossible** : Magistra attend le moteur jusqu'à 120 s (détection des cartes graphiques, analyse antivirus au premier lancement) et affiche « Le moteur IA démarre, cela peut prendre une minute au premier lancement… » (`ENGINE_STARTING_MESSAGE`, `shared/ipc.ts`), pendant une génération comme sous le bouton « Démarrage… ». En cas d'échec, `ai:start-engine` lève une erreur qui donne la cause probable (exécutable mis en quarantaine par un antivirus, port déjà utilisé, dernières erreurs du journal du moteur, filtrées) au lieu de renvoyer simplement « faux ».
- **Proxy** : Ollama n'utilise pas le proxy de Windows, seulement `HTTPS_PROXY` ([FAQ Ollama](https://docs.ollama.com/faq#how-do-i-use-ollama-behind-a-proxy)). Quand Magistra démarre Ollama, il lui transmet le proxy du système (résolu par Electron) ; aucun identifiant de proxy n'est journalisé. Si Ollama tournait déjà sans proxy et que le téléchargement échoue, le message parle du proxy et « Reprendre le téléchargement » propose, avec l'accord de l'enseignant, de relancer le moteur avec ce réglage.

## 18. Validation avec une vraie IA (CI)

Les tests Vitest et Playwright utilisent des serveurs simulés. `scripts/real-ai-check.mjs` (`npm run test:real-ai`) vérifie Magistra contre un **vrai** Ollama, avec les **vrais** fournisseurs et la **vraie** chaîne (cœur `shared/` compilé à la volée par esbuild) :
1. API native (`OllamaProvider`) : version ≥ `MIN_OLLAMA_VERSION`, `health`, `listModels`, courte génération en français ;
2. même serveur par `/v1` (`OpenAICompatibleProvider`) : `health`, `listModels`, courte génération ;
3. `runGeneration` avec un court document texte, demande validée comme par le serveur et préchargement du modèle : étapes `loading_model → generating → finalizing`, une citation **`[S1]` vérifiée** dans le texte et la section **« Sources utilisées »** qui nomme le document. Un petit modèle peut oublier de citer : la chaîne est relancée une fois (`REAL_AI_ATTEMPTS`), puis l'échec est signalé.

Variables : `REAL_AI_URL`, `REAL_AI_MODEL`, `REAL_AI_API_KEY` (jamais affichée), `REAL_AI_CONTEXT_TOKENS`, `REAL_AI_TIMEOUT_S`, `REAL_AI_REPORT`. Le workflow `.github/workflows/real-ai.yml` l'exécute chaque lundi et à la demande : image Docker officielle `ollama/ollama` épinglée par empreinte, port ouvert sur la boucle locale seulement, modèle `ministral-3:3b` (Apache 2.0) gardé en cache, processeur seul avec des délais généreux, rapport JSON et journal d'Ollama joints à l'exécution. Cette validation a mis en évidence le déballage du bloc « ```markdown » décrit au § 5.

La publication de l'application Windows suit le même principe de chaîne vérifiable : `.github/workflows/release.yml` (tag `v*`) construit l'installateur NSIS et l'archive zip sous Windows, calcule `SHA256SUMS.txt` et crée une **release en brouillon** (actions épinglées par SHA, seul le job de publication peut écrire), qu'un mainteneur publie à la main.
