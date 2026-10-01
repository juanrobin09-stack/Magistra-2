# Architecture IA de Magistra

Magistra est un projet **open source (licence MIT) et non lucratif**. Il ne dépend d'**aucune API payante** :

- **Application Windows** : une IA **locale**, open weights, qui tourne sur l'ordinateur de l'enseignant via [Ollama](https://ollama.com). Aucune clé, aucun compte, aucune limite d'utilisation.
- **Site web** : un **préréglage** (`AI_PRESET`, voir § 11 ; `ovhcloud` est gratuit, sans clé, hébergé en France) ou un serveur d'IA **compatible OpenAI** ou **Ollama** configuré par l'administrateur (serveur GPU d'une université sous vLLM, Ollama distant…). Un prestataire en ligne est **toujours annoncé** à l'enseignant.
- **En local** (`npm run dev`, `npm start` sur la boucle locale) : **mode personnel** sans compte (§ 12), avec l'IA de l'ordinateur **détectée automatiquement** (§ 13).
- **Site web + application Windows** (« Magistra locale ») : le site confie la génération à l'IA locale de l'application par son **connecteur local**, après appairage accepté par l'enseignant ; le navigateur n'accède jamais au moteur lui-même (§ 19).

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

Troisième chemin, entre les deux colonnes du schéma : le navigateur du site peut joindre le processus principal de l'application par le **connecteur local** (HTTP sur `127.0.0.1`, requêtes signées) ; la génération passe alors par le même `GenerationManager` que la fenêtre de l'application (§ 19).

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
  → fusion des passages contigus, par passages d'au plus ≈ 3 000 caractères (« pages 14 à 15 ») : une citation désigne
    1 à 3 pages ou quelques diapositives que l'enseignant peut relire
  → contexte du modèle, sous forme de sources numérotées [S1], [S2]…
```

- **Sélection des passages.** Le classement BM25 ignore, dans la requête, les mots pédagogiques génériques (« élèves », « savoir », « expliquer »…) et donne plus de poids au sujet qu'aux objectifs et aux consignes ; quand le sujet est court (différenciation, correction), le début du texte à adapter ou de la copie complète la requête. Racinisation : seul le pluriel en -aux est ramené à -al.
- **Qualité d'extraction.** Les exposants et indices des PDF restent dans leur ligne (CO₂, mc²) ; l'en-tête et le pied de page répétés sont retirés des pages suivantes (première occurrence gardée) ; les lignes de tableau PPTX redeviennent « a | b | c » ; un DOCX avec un seul style « Titre » est découpé en blocs de paragraphes.
- **Fichiers piégés.** L'extraction est en temps linéaire (aucune expression rationnelle à retour arrière sur le contenu) et la décompression des DOCX/PPTX est bornée (80 Mo par entrée XML, 200 Mo au total, 10 000 entrées), avec une erreur claire ; les documents sont analysés deux par deux.
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
     [S1] Cours_Economie_M1.pdf — pages 14 à 15
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

**Formats normés et options** (`shared/formats.ts`) : chaque outil propose des formats propres au niveau et à la matière (dissertation, commentaire, sujet type brevet ou bac, dictée, développement construit, épreuve composée, cas pratique, fiche de synthèse…) et des options (nombre exact d'exercices ou de séances, notation, corrigé, objectif de l'évaluation, ton, besoins particuliers). La même liste sert à l'interface et à la validation (serveur et application Windows) : un format hors de propos est ignoré, jamais transmis. Le format choisi ajoute sa consigne de structure, qui prime sur la forme par défaut de l'outil. Chaque format dit aussi ce qui se compte : « Nombre de questions » pour un QCM, « Nombre d'affirmations » pour un vrai/faux, « Nombre de mots à compléter » pour un texte à trous ; un travail d'un seul tenant (dissertation, dictée, commentaire, étude de cas…) n'a pas de nombre : le champ est masqué, et un nombre reçu est ignoré par la validation, pour que le modèle rédige un seul sujet complet et non une série d'exercices. Les formats les plus exposés aux erreurs des petits modèles (QCM, vrai/faux, dictée) donnent une présentation modèle et une structure numérotée. Le **texte à trous** est construit par Magistra (`shared/cloze.ts`) : le modèle écrit le texte complet en entourant de doubles crochets chaque mot à trouver (`[[mot]]`) ; le pipeline remplace chaque mot par un blanc numéroté pendant la rédaction, puis ajoute la banque de mots et le corrigé, toujours alignés sur les blancs, et jamais plus de blancs que le nombre demandé (la banque et le corrigé éventuellement rédigés par le modèle sont remplacés ; un mot mis en gras au lieu d'être marqué, dans un paragraphe qui contient des mots marqués, est compté). Les consignes de format imposent le même principe d'honnêteté : jamais d'extrait attribué à un auteur réel, de décision de justice ou de statistique inventés ; un emplacement [Texte à coller] est laissé à l'enseignant.

**Cohérence des consignes** : une option ne contredit jamais une autre. En version élève seule, le format s'applique aux énoncés seulement (ses parties « corrigé » sont écartées) ; pour une séquence ou une fiche de séance, la démarche choisie s'applique à chaque séance sans remplacer la structure demandée ; une évaluation diagnostique sans notation choisie est sans note ; pour une langue vivante ou ancienne, les textes et les réponses attendues sont dans la langue étudiée (`shared/languages.ts`) ; le livret scolaire donne des appréciations annuelles (sans trimestre, y compris côté serveur) et le conseil de classe un bilan toutes disciplines.

**Contrôles après génération** (sans appel supplémentaire au modèle) : la mise en page des QCM et des questions numérotées est rétablie en Markdown valide (`shared/exerciseLayout.ts`, choix en liste, une question par paragraphe) ; les formules écrites \( … \) ou \[ … \] sont affichées et exportées comme $…$ (`shared/markdownMath.ts`, à l'affichage seulement : le texte enregistré reste celui du modèle) ; quand le nombre d'exercices, de questions, d'affirmations, de mots à compléter, de séances ou d'appréciations ne correspond pas à la demande, un avertissement le dit à l'enseignant (`shared/outputChecks.ts`, jamais bloquant). Une application Windows antérieure à 2.0.3 appelée par le site n'applique pas ces options et ne connaît pas les matières ajoutées depuis (maternelle « Se repérer dans le temps et l'espace ») : le site refuse avant d'envoyer, en nommant les choix concernés et la version nécessaire ; si la version est inconnue, il vérifie les paramètres renvoyés, signale un choix non appliqué, et n'enregistre jamais dans l'historique un contenu rédigé pour une autre matière, un autre outil ou un autre niveau.

**Qualité** : une section « QUALITÉ ATTENDUE » demande la structure exacte, les nombres exacts (vérifiés avant de terminer) et un français soigné ; les nombres et le format sont rappelés en fin de demande (un petit modèle suit mieux la dernière consigne lue). **Température** selon l'outil (`generationTemperature`) : 0,3 pour les documents qui doivent être exacts (évaluations, corrigés, exercices, plans), 0,4 pour les cours et la différenciation, 0,6 pour les textes rédigés (appréciations, courriers).

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
| Web + Magistra locale | flux NDJSON sur `POST /v1/generate` du connecteur local (§ 19). La fermeture de la connexion ou `POST /v1/cancel` interrompt le modèle de l'ordinateur. |
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
| `MAGISTRA_RELEASES_REPO`, `GITHUB_TOKEN` | facultatives : dépôt GitHub dont la dernière version stable est proposée par `GET /api/windows-release` (défaut : dépôt officiel) et jeton en lecture seule, envoyé seulement à `api.github.com` (§ 19) |

Les générations en cours sont comptées dans Supabase (table `active_generations`, fonctions `magistra_begin_generation` / `magistra_end_generation`) : la concurrence, le débit de l'utilisateur et le débit global sont vérifiés dans une même transaction, sous un verrou par utilisateur (plus un verrou commun pour le débit global), donc de façon atomique même avec plusieurs instances serverless. La place est libérée à la fin du flux (succès, erreur, arrêt, déconnexion du client) ; si cette libération échoue, elle expire après `AI_TIMEOUT_SECONDS` + 90 s. Si le compteur est indisponible, la demande est acceptée (journalisée) et seuls les plafonds de l'instance s'appliquent.

### Application Windows

Réglages → Intelligence artificielle :
- **mode local** (Ollama sur 127.0.0.1, par défaut) ;
- ou **serveur distant**, compatible OpenAI ou Ollama. La clé éventuelle est chiffrée avec `safeStorage`, reste dans le processus principal et n'est jamais renvoyée à la fenêtre.

Réglages → « Site web Magistra » : « Permettre au site Magistra d’utiliser l’IA de cet ordinateur » (activé par défaut), navigateurs autorisés et bouton **Retirer** (§ 19). Réglée sur un serveur distant, l'application refuse les générations du site (`LOCAL_ENGINE_REMOTE`) : jamais de relais vers un tiers.

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
| Web + Magistra locale (IA de l'ordinateur par l'application Windows) | « IA locale — Vos contenus sont générés sur cet ordinateur. » (bandeau) + « IA locale : vos contenus sont générés sur cet ordinateur par l'application Magistra ; les extraits de vos documents n'en sortent pas. Le résultat et les paramètres de la demande (sujet, objectifs, consignes, contenu à adapter, profils, noms des documents) sont enregistrés dans l'historique de votre compte en ligne. » | page Générer |
| Web, passage de Magistra locale au serveur en ligne | confirmation obligatoire : « Cette génération sera traitée par [prestataire] (serveur distant). Vos demandes et les extraits de vos documents quitteront cet ordinateur. » | Réglages, page Générer |
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

La publication de l'application Windows suit le même principe de chaîne vérifiable : `.github/workflows/release.yml` (tag `v*`) construit l'installateur NSIS et l'archive zip sous Windows, calcule `SHA256SUMS.txt` et crée une **release en brouillon** (actions épinglées par SHA, seul le job de publication peut écrire), qu'un mainteneur publie à la main. Une fois publiée, elle est proposée par le site (`GET /api/windows-release`, et téléchargée par son lien `/telecharger`, § 19).

## 19. Connecteur local (site web → IA de l'ordinateur)

Le site public (compte Clerk obligatoire) peut utiliser l'IA **locale** de l'ordinateur de l'enseignant, par l'application Windows, sans jamais donner au navigateur un accès au moteur (pas de « navigateur → `http://localhost:11434` »). Parcours de l'enseignant, autorisation du navigateur et publication des versions : README, « Utiliser l'IA de votre ordinateur depuis le site ».

| Rôle | Fichiers |
|---|---|
| Contrat (constantes, routes, formats, chaînes canoniques, analyse stricte de `magistra://`) | `shared/localConnector.ts` |
| Application : cryptographie, demandes d'appairage, navigateurs autorisés, serveur HTTP, service, état transmis au site | `electron/connector/crypto.ts`, `pairing.ts`, `clients.ts`, `server.ts`, `service.ts`, `status.ts`, `userAgent.ts` (modules Node purs, sans Electron) |
| Application : générations « externes », `magistra://`, boîte de consentement, IPC des réglages | `electron/generation.ts`, `electron/main.ts` |
| Site : WebCrypto, appairage mémorisé, autorisation du navigateur, client, état, choix du moteur | `src/lib/localConnector/` (`webCrypto.ts`, `pairingStore.ts`, `permission.ts`, `client.ts`, `controller.ts`, `engineChoice.ts`, `texts.ts`) |
| Site : génération locale ou en ligne, sans repli silencieux | `src/lib/runtime/hybrid.ts` |
| Interface | `src/components/localEngine/` (carte du tableau de bord, réglages, bandeau et panneau de la page Générer, « Magistra pour Windows », « Site web Magistra » de l'application) |
| Serveur | `server/windowsRelease.ts` (`GET /api/windows-release`), `server/handlers.ts` (`POST /api/generation` ; `GET /telecharger` = `/api/download`, lien de téléchargement du site : redirection vers l'installateur de la dernière version stable, adresse vérifiée, jamais tirée de la requête) |

```
 navigateur : site officiel https://magistra-2.vercel.app (compte Clerk)
   │  fetch http://127.0.0.1:{47831|47832|47833} : CORS, sans cookie ni Referer, requêtes signées (HMAC)
   │  autorisation « Applications sur l'appareil » (Local Network Access) du navigateur
   ▼
 connecteur local : application Windows, electron/connector/server.ts, écoute sur 127.0.0.1 uniquement
   │  cinq routes Magistra ; aucun relais, aucun fichier, aucune commande, aucun réglage
   ▼
 GenerationManager (electron/generation.ts) : même pipeline, MÊME créneau unique que la fenêtre
   ▼
 moteur d'IA local (Ollama, jamais exposé au navigateur)  ──▶  modèle (Magistra Léger, Standard, Qualité)

 évènement « done » (record) ──▶ navigateur ──HTTPS + jeton Clerk──▶ POST /api/generation ──▶ historique (Supabase)
```

### Routes

Toute autre route donne 404 (chemin exact, sans normalisation : `/v1/../v1/hello` → 404), toute autre méthode 405 (avec `Allow`).

| Route | Méthode | Signée | Rôle |
|---|---|---|---|
| `/v1/hello` | GET | non | présence : `{ app: 'magistra', protocol: 2, version }` ; aucune configuration, aucun chemin, aucune adresse |
| `/v1/pair` | POST | non | appairage en deux temps (ci-dessous) : 202 `pending`, 200 `consented`, 200 `approved` ; erreurs 403 `CONNECTOR_PAIRING_REFUSED`, 410 `CONNECTOR_PAIRING_EXPIRED`, 404 (demande inconnue ou épuisée), 401 (vérificateur faux), 403 `FORBIDDEN` (origine différente de celle de la demande) |
| `/v1/pair` | DELETE | oui | ce navigateur retire sa propre autorisation : `{ ok: true }` |
| `/v1/status` | GET | oui | `ConnectorStatus` : moteur prêt, local ou non, libellé du modèle, cause s'il n'est pas prêt, capacités (`maxDocumentChars`, recherche), `busy` |
| `/v1/generate` | POST | oui | demande validée par `validateGenerationRequest` ; réponse `application/x-ndjson` (un `GenerationEvent` par ligne), en-tête `X-Magistra-Job` ; avant le flux, en JSON : 409 `GENERATION_BUSY` (`Retry-After: 10`), 409 `LOCAL_ENGINE_REMOTE`, 400 `INVALID_REQUEST`, 413 |
| `/v1/cancel` | POST | oui | `{ jobId }` : n'arrête qu'une génération de CE navigateur ; réponse `{ ok: true }` identique que la génération existe ou non |

Le protocole est versionné (`CONNECTOR_PROTOCOL_VERSION` = 2). Un site et une application de versions de protocole différentes ne dialoguent pas :
- le site n'utilise jamais une application Magistra d'une autre version : aucune demande d'appairage, aucun contenu, aucune requête signée vers un port où elle se présente (`hello`). Seul le port mémorisé d'un navigateur appairé reçoit d'abord, comme tout programme qui l'occuperait, une requête signée sans contenu (état, retrait), dont la réponse sans preuve valide n'est pas utilisée. Si elle est seule à répondre, il le dit au lieu d'annoncer Magistra « pas encore détectée » ou « fermée » : application plus ancienne → « doit être mise à jour » (`APP_UPDATE_REQUIRED_MESSAGE`, avec **Télécharger Magistra**, appairé ou non) ; plus récente → « rechargez la page » (`PAGE_RELOAD_REQUIRED_MESSAGE`) ;
- l'application ignore l'URL `magistra://pair` d'une autre version.

### Contrôles, dans l'ordre, pour chaque requête (`electron/connector/server.ts`)

1. pair distant de la boucle locale (`127.0.0.1`, `::ffff:127.0.0.1`), en plus de l'écoute sur `127.0.0.1` seulement ; une requête d'au moins 40 en-têtes est refusée (431), car Node ignorerait les suivants en silence ;
2. en-tête `Host` unique et **exactement** `127.0.0.1:<port d'écoute>` (anti DNS rebinding), sinon 403 **sans** en-tête CORS et connexion fermée ;
3. en-tête `Origin` présent, unique et **exactement** dans la liste autorisée (`OFFICIAL_WEB_ORIGINS`), sinon 403 sans CORS (`null`, absent, autre site, `localhost`…). Jamais `Access-Control-Allow-Origin: *`, jamais `Access-Control-Allow-Credentials` ;
4. route exacte (404), puis méthode (405) ;
5. `OPTIONS` (pré-vérification CORS) : si la méthode demandée est autorisée pour la route et si tous les en-têtes demandés figurent dans `CONNECTOR_ALLOWED_REQUEST_HEADERS` (casse ignorée), réponse 204 avec l'origine exacte, `Access-Control-Max-Age: 600` et, quand le navigateur le demande, `Access-Control-Allow-Private-Network: true` (ancien mécanisme « Private Network Access » de Chrome) ; sinon 403. Ensuite, après plus de 30 échecs d'authentification en une minute, 429 pendant 60 s (toutes les routes sauf `hello`) ;
6. `POST` : `Content-Type: application/json` (`charset=utf-8` toléré), sinon 415 ; taille annoncée au plus 1 100 000 octets pour `/v1/generate` et 4 096 pour les autres routes, sinon 413 ;
7. routes signées, **avant** de lire le corps :
   - format des en-têtes ;
   - navigateur connu et appairé pour **cette** origine, sinon 401 `CONNECTOR_UNPAIRED`, avec la marque de retrait si cette application l'a retiré ;
   - horodatage à ± 120 s et postérieur au début de l'écoute. Ce début est exprimé dans l'horloge **actuelle** : la durée de l'écoute est mesurée par une horloge monotone, si bien qu'une heure du système corrigée vers l'arrière (synchronisation de Windows, réglage manuel) ne fait pas refuser toutes les requêtes du site (401 puis 429) jusqu'à ce qu'elle rattrape l'ancien début ; le recul est journalisé une fois ;
   - nonce jamais vu.

   Ensuite : lecture du corps, bornée, 20 s au plus (sinon 408) ; autorisation toujours valable (elle a pu être retirée pendant la lecture) ; signature HMAC sur les octets exacts du corps et l'hôte joint, comparée à temps constant (401 `UNAUTHENTICATED`). Le nonce n'est mémorisé qu'après une signature valide : une requête forgée ne remplit pas la mémoire ;
8. toutes les réponses : `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Vary: Origin` ; pour l'origine officielle, `Access-Control-Allow-Origin` exacte et `Access-Control-Expose-Headers` ; après une authentification réussie (erreurs comprises), `X-Magistra-Proof`. Corps d'erreur : `ApiErrorBody` en français, sans trace, adresse, port, chemin, secret, nom ni réglage du moteur.

Serveur Node : `headersTimeout` 10 s, `requestTimeout` 30 s, `keepAliveTimeout` 5 s, 32 connexions au plus, écoute exclusive. Les ports sont essayés dans l'ordre (port occupé ou réservé par Windows : suivant). Si aucun n'est libre, l'application réessaie toutes les minutes et affiche la cause, sans port, dans ses réglages. Le journal ne contient jamais de clé, de vérificateur, de signature ni de contenu.

Les messages qui partent vers le site sont filtrés deux fois :
- par l'application (`electron/connector/status.ts`) : aucune URL, adresse IP, port, chemin, ni le mot « Ollama » ; textes neutres de `LOCAL_ENGINE_SITE_MESSAGES` pour les codes du moteur ; un moteur distant est décrit « Serveur d’IA distant », jamais par son nom d'hôte ;
- puis par le site (`src/lib/localConnector/texts.ts`).

### Appairage en deux temps

Aucun secret de longue durée ne circule dans une adresse.

1. **Le site prépare la demande** :
   - `pairingId` (16 octets) et `verifier` (32 octets), tirés au hasard ;
   - `challenge` = SHA-256 des octets du vérificateur ;
   - une paire ECDH P-256 dont la clé privée est **non extractible** ;
   - un **code de vérification** (`K7F-2QX`) dérivé du défi.

   Il ouvre ensuite `magistra://pair?v=2&id=<pairingId>&challenge=<challenge>&origin=<origine>`. Le vérificateur n'y figure jamais.
2. **L'application reçoit l'URL** : premier lancement (argument), deuxième instance (`second-instance`) ou macOS (`open-url`). `parseAppUrl` l'analyse strictement : paramètres exacts, formats, version. Une origine hors de la liste est ignorée (journal seulement, aucune boîte). Une seule demande existe à la fois (une nouvelle remplace l'ancienne), avec au plus 3 boîtes de consentement par minute. La boîte native (« Autoriser [site] à utiliser l’intelligence locale de cet ordinateur ? ») affiche le même code et **Refuser** par défaut. Elle dit que le site n'aura accès ni aux fichiers, ni aux autres applications, ni aux réglages, et que l'autorisation se retire dans Réglages → « Site web Magistra ».
3. **Premier temps : accusé de réception, sans secret.** Le site envoie `POST /v1/pair { pairingId }` à chaque port où Magistra répond. L'application renvoie `ack` = SHA-256(`canonicalPairAck(pairingId, challenge, hôte)`), avec 202 `pending`, puis 200 `consented` après l'accord.

   Le défi n'est présent que dans l'URL `magistra://`, jamais dans une requête HTTP : seule l'application qui a reçu l'URL peut calculer l'accusé. Un port dont l'accusé est absent ou faux est ignoré. C'est le cas d'un autre programme, de l'application d'une autre session Windows, ou d'un relais installé sur un autre port. Ce premier temps ne modifie jamais la demande.
4. **Second temps**, seulement après `consented` et seulement vers le port dont l'accusé est valide : `POST /v1/pair { pairingId, verifier, clientPublicKey }`. L'application vérifie :
   - SHA-256(vérificateur) = défi, à temps constant ; au 5ᵉ essai faux, la demande est supprimée ;
   - l'en-tête `Origin` identique à celui de la demande ;
   - l'accord de l'enseignant ;
   - le délai : 5 minutes depuis l'ouverture de l'URL.

   La demande est à usage unique. L'application tire alors une paire ECDH éphémère, calcule le secret, puis dérive la clé HMAC-SHA-256 : `HKDF-SHA-256(secret, sel = pairingId, info = « magistra-connector-v1 hmac-sha256 »)`. Elle répond `{ status: 'approved', clientId, connectorPublicKey, version, ack }`.
5. **Le site dérive la même clé**, `CryptoKey` HMAC **non extractible**, et la conserve dans IndexedDB « magistra-local-connector » (en mémoire seulement si IndexedDB est indisponible). L'application enregistre `{ clientId, origine, navigateur, dates, clé }` dans `<userData>/local-connector.json`, par écriture atomique :
   - la clé est chiffrée par `safeStorage` (**DPAPI** sous Windows), jamais écrite en clair ;
   - sans chiffrement du système, l'autorisation reste en mémoire (`persistent: false`).

   Au plus 10 navigateurs sont autorisés ; au-delà, le plus ancien est retiré. Le site termine par un `GET /v1/status` prouvé : la clé est la même des deux côtés.

Le site attend 2 minutes au plus : recherche de l'application toutes les secondes, essais d'appairage toutes les 1,5 s. La clé n'a jamais circulé. Côté navigateur, ni le site, ni une extension, ni un script injecté ne peuvent en lire les octets.

### Requêtes signées et preuve de l'application

Chaque requête signée porte :
- `X-Magistra-Client` (identifiant attribué par l'application) ;
- `X-Magistra-Timestamp` (millisecondes, 13 chiffres) ;
- `X-Magistra-Nonce` (16 octets) ;
- `X-Magistra-Signature` = HMAC(clé, `canonicalRequest`). La chaîne signée contient la méthode, l'**hôte joint** (`127.0.0.1:<port>`), le chemin, l'origine, le client, l'horodatage, le nonce et le SHA-256 du corps exact.

Chaque réponse porte `X-Magistra-Proof` = HMAC(clé, `canonicalProof(client, nonce, hôte)`).

Le navigateur **refuse toute réponse sans preuve valide** : un autre programme sur le port, l'application d'une autre session ou un relais donnent `CONNECTOR_UNREACHABLE`, et le texte de leur réponse n'est jamais affiché. Aucun contenu de génération (demande, extraits) n'est envoyé à un port qui n'a pas prouvé détenir la clé depuis moins de 30 s : sinon, le site refait d'abord `GET /v1/status`.

Accusé, signature et preuve sont liés au **port**. Un programme qui occuperait un autre port dédié et relaierait tout à la vraie application n'obtient rien d'utilisable :
- s'il garde l'en-tête `Host`, l'application refuse la requête ;
- s'il le réécrit, la signature ne vaut plus ;
- il ne peut pas calculer lui-même l'accusé ni la preuve pour son port.

Côté navigateur, `fetch` est appelé en mode `cors`, avec `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'` et `targetAddressSpace: 'loopback'` (option Local Network Access de Chrome, ignorée ailleurs). La présence est recherchée avec un délai de 1,5 s par port. Les réponses lues sont bornées (16 Ko, 64 Ko pour l'état). La CSP du site ajoute à `connect-src`, et à cette seule directive, les trois origines exactes `http://127.0.0.1:47831`, `http://127.0.0.1:47832` et `http://127.0.0.1:47833` : ni `localhost`, ni joker de port.

### Autorisation du navigateur (Local Network Access)

Chrome (depuis la version 142) et Edge exigent l'accord de l'utilisateur avant qu'un site public ne joigne la boucle locale. `src/lib/localConnector/permission.ts` lit l'état **sans le demander** : `navigator.permissions.query` avec `loopback-network`, puis `local-network-access` ; tout échec donne `unsupported`.

- La vérification automatique (`autoCheck`, `refresh`) ne déclenche **jamais** la demande. Si l'autorisation est encore à demander et que le navigateur est appairé, l'état `needs-permission` explique la demande avant qu'elle n'apparaisse. Sans appairage, rien n'est sondé, sauf si l'autorisation est déjà accordée.
- Seules les actions de l'enseignant (`detect`, `connect`, `openApp`, `disconnect`) peuvent la faire apparaître.
- Chromium ouvre la connexion **avant** de poser sa question, et l'application ferme une connexion muette au bout de 10 s. Une recherche commencée à `prompt` et terminée à `granted` est donc refaite aussitôt.
- Un refus donne l'état `permission-denied`, avec la marche à suivre (« Applications sur l'appareil » ou « Réseau local » → Autoriser).
- Navigateur sans cette autorisation (Firefox, Chromium qui ne l'applique pas) et jamais appairé : la vérification automatique ne sonde rien, donc n'apprend rien ; « ✓ Magistra trouvée » par une recherche de l'enseignant reste affiché (avec **Connecter Magistra locale**) quand les pages Générer et Réglages relisent l'état.
- Rien n'est contourné. En parc géré, la stratégie `LocalNetworkAccessAllowedForUrls` (ou `LoopbackNetworkAllowedForUrls`, Chrome 146 et suivants) supprime la demande pour le site officiel ; l'accord dans l'application reste exigé.

### Générations du site dans l'application

`GenerationManager.startExternal` (`electron/generation.ts`) utilise le même moteur, le même pipeline et le **même créneau unique** que la fenêtre : une génération à la fois au total, et `GENERATION_BUSY` avec un message propre à chaque côté.

- **`requireLocal`** : si l'application est réglée sur un serveur distant, la génération est refusée (`LOCAL_ENGINE_REMOTE`) avant toute préparation du moteur, puis vérifiée à nouveau sur le fournisseur préparé.
- **Évènements** : ils vont au flux NDJSON, jamais à la fenêtre. Seul le navigateur propriétaire peut arrêter sa génération, et le rechargement de la fenêtre n'arrête que les générations de la fenêtre.
- **Aucun enregistrement dans l'historique de l'application** : le pipeline tourne avec `includeRecord`, et l'évènement `done` porte `record`. Ce `record` contient le résultat, les sources citées et les paramètres de la demande (`recordParams` : sujet, objectifs, consignes, contenu à adapter, profils, noms des documents), jamais le texte des extraits ni le travail d'élève.
- **Enregistrement par le site** : `HybridGenerationClient` retire `record` de l'évènement et l'envoie à `POST /api/generation`. Le serveur vérifie le jeton, applique le débit (`RATE_LIMIT_PER_MINUTE` ; jamais le plafond global, réservé au serveur d'IA : colonne `kind` de `api_requests`), valide entièrement le contenu (`validateGenerationRecordDraft`) puis l'enregistre. En cas d'échec, l'avertissement `STORAGE_ERROR` s'affiche et le contenu reste affiché.
- **Choix du moteur** (`engineChoice.ts`, `localStorage` « magistra_engine_choice ») : choix explicite de l'enseignant, sinon Magistra locale si le navigateur est appairé. Un appairage réussi mémorise Magistra locale, sauf choix déjà fait. `HybridGenerationClient` ne se replie **jamais** vers le serveur : Magistra locale injoignable ou pas prête donne des capacités « non prête » (route `local-connector`) et une erreur. Seul un choix explicite, confirmé en nommant le prestataire, passe au serveur en ligne.

### Révocation

- **Retrait par l'application**, par Réglages → « Site web Magistra » → **Retirer**, `DELETE /v1/pair` ou éviction au-delà de 10 navigateurs : effet immédiat. Les requêtes suivantes de ce navigateur sont refusées, et sa génération en cours est arrêtée. Pour un retrait, l'état en mémoire change avant l'écriture sur le disque : une écriture lente ne laisse jamais tourner sa génération.
- **Marque de retrait** : avant d'effacer la clé, l'application calcule `X-Magistra-Revoked` = HMAC(clé, `canonicalRevoked(clientId)`), et en conserve 50 au plus. Elle la joint ensuite à ses 401 `CONNECTOR_UNPAIRED` pour ce navigateur. Pour une **éviction**, la marque n'est servie qu'une fois l'éviction enregistrée : pendant l'écriture, le navigateur évincé est refusé sans marque ; si l'écriture échoue, l'éviction est annulée (il reste autorisé, avec la même clé), et aucune marque, qui resterait valable et rejouable pour un appairage toujours valide, n'a été servie.
- **Oubli de l'appairage par le site** : un 401 ne peut pas porter de preuve, et l'application d'une autre session Windows, qui ne connaît pas ce navigateur, le renvoie légitimement. Le site n'oublie donc son appairage que sur une **marque valide**. Sans marque, il garde l'appairage et affiche « Une application Magistra répond sur cet ordinateur, mais elle ne reconnaît pas ce navigateur (…) ».
- **« Déconnecter Magistra locale »** (site) : `DELETE /v1/pair` au mieux, puis oubli local même si l'application est fermée. Autorisation du navigateur à demander : comme la recherche et l'état, la requête attend la réponse de l'enseignant à la question du navigateur (60 s), puis elle est refaite si l'autorisation est accordée après la coupure de la connexion retenue. Si l'application n'a pas confirmé, ou si le navigateur bloque l'accès (le retrait n'a alors pas pu être demandé), le site demande de retirer l'autorisation dans l'application ; la boîte de confirmation le dit d'avance quand le navigateur bloque l'accès.
- **Réglage désactivé** : effet immédiat, comme un retrait : le réglage change en mémoire, puis le connecteur cesse d'écouter, la demande d'appairage en cours est annulée et les générations du site sont interrompues **avant** l'attente de l'écriture sur le disque (lente sous un verrou d'antivirus, ou impossible). Une clé illisible au démarrage (profil Windows changé, fichier copié) est abandonnée, sans marque de retrait : le site propose alors de reconnecter.

### Limites connues

- **Safari** : sans objet sous Windows. Sur Mac, aucune application Magistra n'est publiée, et Safari peut bloquer une requête `http://127.0.0.1` depuis une page `https` (contenu mixte). Ce cas n'est pas testé ; sur Mac, le serveur en ligne reste le chemin prévu.
- **Firefox** : il met en place sa propre protection (autorisations `local-network` et `loopback-network`). Le site lit `loopback-network` s'il est exposé. Les explications à l'écran sont écrites pour Chrome et Edge, et aucun test automatique ne couvre Firefox.
- **Chrome ou Edge sans Local Network Access** (versions antérieures, ou protection désactivée par stratégie) : aucune demande n'apparaît, et la sécurité repose alors entièrement sur le connecteur (origine exacte, appairage, signatures). Par ces ports, un autre site ne peut rien lire ni rien déclencher : 403 sans CORS, `Content-Type` JSON exigé, requêtes signées. Il peut au plus constater qu'un programme y écoute (connexion acceptée ou refusée).
- **Sessions Windows multiples** (PC partagé, bureaux à distance) : les ports de la boucle locale sont communs à toutes les sessions.
  - Trois applications au plus écoutent en même temps, une par port ; la quatrième affiche la cause dans ses réglages.
  - L'application d'une autre session peut répondre à `hello`, et le site affiche alors « ✓ Magistra trouvée ». Elle ne reçoit pourtant jamais le vérificateur (accusé), ne peut pas se faire passer pour l'application de l'enseignant (preuve) et ne peut pas faire oublier l'appairage (marque de retrait).
- **`magistra://pair` depuis un autre site** : n'importe quelle page peut ouvrir cette URL, après la question du navigateur « ouvrir Magistra ? », et faire apparaître la boîte de consentement.
  - Seule une origine officielle est acceptée, avec 3 boîtes par minute au plus. La boîte affiche un code qu'aucun onglet du site officiel n'affiche : « Refuser ».
  - Même accepté, un tel appairage ne peut être terminé que par une requête portant l'en-tête `Origin` officiel, ce qu'une page web ne peut pas forger.
- **Programme local malveillant sous le compte de l'enseignant** : hors du modèle de menace. Il lit déjà les fichiers de l'utilisateur. DPAPI protège les clés contre la copie du fichier vers un autre compte ou un autre ordinateur, pas contre un programme de la même session.
- **Autres contraintes** :
  - l'application doit rester ouverte (fermer sa fenêtre la quitte) ;
  - une seule génération à la fois ;
  - en navigation privée stricte, l'appairage ne dure que jusqu'au rechargement de la page ;
  - un nouveau domaine du site exige une nouvelle version de l'application (`OFFICIAL_WEB_ORIGINS` est compilé dans l'application) ;
  - le site nécessite Internet, même quand la génération est locale.

### Développement

Options ignorées dans l'application installée (`electron/devOptions.ts`) :
- `MAGISTRA_CONNECTOR_PORTS` (« p1,p2 ») ;
- `MAGISTRA_CONNECTOR_DEV_ORIGINS` (origines http(s) de la **boucle locale** seulement, les autres sont ignorées) ;
- `MAGISTRA_CONNECTOR_DISABLED=1`.

`magistra://` n'est inscrit que par l'application installée, **à son premier lancement** (sous Windows, electron-builder n'applique `protocols` d'`electron-builder.json` qu'à macOS, Linux et AppX, pas à l'installateur NSIS) : l'installateur lance l'application à la fin de l'installation (`runAfterFinish`), puis l'application vérifie l'inscription à chaque lancement avec la commande `"<exe>" -- "%1"` : après `--`, une URL piégée ne peut injecter aucune option de Chromium. Conséquences : après une installation silencieuse (`/S`), le schéma n'existe qu'une fois Magistra ouverte à la main ; la clé `HKCU\Software\Classes\magistra` n'est pas retirée à la désinstallation. Le connecteur reste éteint pendant le test de démarrage (`--smoke-test`).

### Tests

- **Unitaires** :
  - application : `tests/electron/connectorCrypto`, `connectorPairing`, `connectorClients`, `connectorServer`, `connectorService`, `connectorStatus` (`.test.ts`), `tests/electron/generation.test.ts` (générations externes), `tests/electron/devOptions.test.ts` ;
  - site : `tests/localConnector/webCrypto`, `pairingStore`, `permission`, `client`, `controller`, `hybrid` (`.test.ts`), `engineChoice.test.tsx`, `provider.test.tsx` ;
  - interface : `tests/ui/localEngineCard`, `localEngineGenerate`, `localEngineSettings`, `localEngineWindows` (`.test.tsx`) ;
  - serveur : `tests/server/windowsRelease.test.ts`, `saveGeneration.test.ts`, `deploy.test.ts` (CSP : exactement les trois ports, dans `connect-src` seulement).
- **Interopérabilité** : `tests/localConnector/interop.test.ts`. Le vrai client du site (WebCrypto, clés non extractibles, preuve exigée) dialogue avec le vrai connecteur (serveur HTTP sur `127.0.0.1`, magasin sur le disque) et le vrai `GenerationManager`, avec une IA simulée. Scénarios :
  - appairage accepté ou refusé, génération en flux, annulation ;
  - redémarrage de l'application sur un autre port ;
  - programme qui occupe un port ou relaie depuis un autre port ;
  - retrait prouvé par la marque, application d'une autre session Windows ;
  - éviction, autre origine, moteur distant, application occupée.
- **De bout en bout, avec Local Network Access active** : `e2e/connector-local.spec.ts`, projets Playwright `connector` (Chromium de Playwright, exécuté par la CI) et `connector-edge` (les mêmes tests dans **Microsoft Edge** installé sur la machine, canal `msedge` ; ignorés proprement si Edge est absent, jamais lancés par la CI). Commande : `xvfb-run -a npx playwright test --project=connector --project=connector-edge`, après `npx vite build` et `node scripts/build-electron.mjs`.
  - Le harnais du site (`e2e/connector-harness/` : vrais composants, vrai contrôleur, vrai client WebCrypto et IndexedDB) tourne avec `--enable-features=LocalNetworkAccessChecks`. `--ip-address-space-overrides` le fait traiter comme un site **public**.
  - L'autorisation est accordée, refusée ou remise « à demander » par le test, jamais par le site : `Browser.setPermission` (CDP), pour chaque nom connu du navigateur (`loopback-network`, `local-network-access` ; un nom inconnu est ignoré), avec une session CDP gardée ouverte (la fermer annule l'autorisation dans Edge). L'état est lu comme le site le lit : `loopback-network`, sinon `local-network-access`.
  - **Vérifié dans Edge 154** (Chromium 154) : autorisation `loopback-network` (`context.grantPermissions(['local-network-access'])` n'y suffit pas), `fetch` avec `targetAddressSpace: 'loopback'`, navigateur listé « Microsoft Edge » par l'application. Sans écran, Edge enregistre la réponse automatique à sa demande comme un **refus** (le site affiche alors « bloque l'accès », l'état réel), là où le Chromium de Playwright (141) la laisse « à demander » ; une simple réinitialisation des autorisations fait réapparaître ce refus, d'où la remise « à demander » explicite.
  - En CI (Linux), le trousseau de clés est exigé : sans lui, le test échoue au lieu de passer par la branche « autorisations en mémoire ».
  - En face tourne la vraie application Electron, avec un Ollama simulé. Le test joue seulement le rôle du système : remise des URL `magistra://`, réponse à la boîte native, trousseau de clés sous Linux.
  - Parcours couverts : parcours complet (absente, trouvée, refus, accord, flux, arrêt, fermeture, relance sans nouvel appairage, retrait), moteur non prêt, autre site refusé, programme sur le premier port, explication puis refus puis accord de l'autorisation du navigateur.
- **Vraie IA** : le test « vraie IA » du même fichier exécute appairage puis génération d'un cours en français, en flux, par site → connecteur → application → vrai Ollama. Il est ignoré sans `MAGISTRA_E2E_REAL_OLLAMA_URL` et n'est pas lancé par la CI. Exemple : `MAGISTRA_E2E_REAL_OLLAMA_URL=http://127.0.0.1:11434 xvfb-run -a npx playwright test --project=connector -g "vraie IA"`, avec `ministral-3:8b` installé.
