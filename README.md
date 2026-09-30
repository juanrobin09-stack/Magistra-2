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

## Installer Magistra (enseignants)

Installez Magistra sur votre ordinateur Windows (10 ou 11, 64 bits) : l'IA y fonctionne **gratuitement, en privé, même sans Internet**. Aucun compte, aucune clé, aucune ligne de commande.

1. **Téléchargez Magistra** : sur le site Magistra, cliquez sur **Télécharger Magistra pour Windows**, ou ouvrez directement le lien du site [magistra-2.vercel.app/telecharger](https://magistra-2.vercel.app/telecharger). Le fichier `Magistra-Setup-x.y.z.exe` (dernière version) se télécharge aussitôt, sans autre page.
2. **Ouvrez le fichier téléchargé.** Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires** puis **Exécuter quand même**.
3. **Magistra s'installe en quelques secondes**, sans droits d'administrateur, et s'ouvre toute seule.

**Déjà installée ?** Ouvrez Magistra depuis le menu Démarrer ou l'icône du Bureau, ou avec **Ouvrir Magistra** sur le site.

Ensuite, dans Magistra, **Activer l'IA** prépare l'intelligence artificielle en un clic : la taille du téléchargement (moteur d'IA et modèle adapté à votre ordinateur, plusieurs Go) est annoncée avant, et vous pouvez utiliser l'application pendant ce temps. Ce téléchargement n'a lieu qu'une fois.

> **Pourquoi cet avertissement de Windows ?** L'installateur n'est pas encore signé numériquement : un certificat de signature de code est payant et se renouvelle chaque année, et ce projet non lucratif ne l'a pas encore acquis. L'avertissement ne signale aucun problème détecté dans le fichier. N'exécutez l'installateur que s'il vient du site Magistra ou de la [page officielle des versions](https://github.com/juanrobin09-stack/magistra-2/releases).

Vous administrez le site de l'établissement ou vous développez Magistra ? Voir « [Brancher une vraie IA](#brancher-une-vraie-ia) ».

---

## Brancher une vraie IA

*Pour les administrateurs et les développeurs : l'enseignant, lui, n'a que les trois étapes de « [Installer Magistra](#installer-magistra-enseignants) ».*

Magistra **ne dépend d'aucune API payante** :

| Mode | IA utilisée | Compte | Données |
|---|---|---|---|
| **Application Windows** | IA **locale** open weights via [Ollama](https://ollama.com) : Magistra Léger, Standard ou Qualité | aucun | restent sur l'ordinateur |
| **Site web** | un **préréglage** (par exemple OVHcloud AI Endpoints, gratuit, hébergé en France) ou le serveur d'IA de l'établissement (vLLM, Ollama…) | Clerk | serveur Magistra (Supabase), puis le prestataire d'IA **annoncé dans l'interface** |
| **Site web + application Windows** (« Magistra locale ») | l'IA **locale** de l'application Windows, utilisée depuis le site ([détails](#utiliser-lia-de-votre-ordinateur-depuis-le-site-magistra-pour-windows)) | Clerk | extraits de documents et génération sur l'ordinateur ; résultat et paramètres de la demande dans l'historique en ligne |
| **En local** (`npm run dev`) | l'IA installée sur l'ordinateur (Ollama, LM Studio), **détectée automatiquement** | aucun (mode personnel) | restent sur l'ordinateur |
| **Démonstration** | aucune : exemples pré-rédigés, clairement signalés | aucun | navigateur |

Magistra n'impose ni quota ni compteur. Les seules limites sont celles de la machine, du service d'IA choisi (une offre gratuite limite souvent le nombre de demandes par minute), plus des protections techniques contre les abus sur un serveur public.

Trois chemins, du plus simple au plus autonome. Dans les trois cas, `npm run ai:check` (site) ou l'application elle-même (Windows) dit précisément ce qui manque.

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
   - recommandé : `GITHUB_TOKEN`, jeton GitHub « fine-grained » en lecture seule, **sans aucune permission** (dépôts publics). Sur Vercel, les fonctions sortent par des adresses IP partagées avec d'autres clients : sans jeton, la limite de l'API GitHub (60 requêtes par heure et par adresse) peut être déjà atteinte : « Télécharger Magistra pour Windows » télécharge alors toujours la dernière version, mais sans afficher ni sa version, ni sa taille, ni son empreinte ;
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

**Installation** : les trois étapes de « [Installer Magistra](#installer-magistra-enseignants) ». L'installateur NSIS s'installe pour l'utilisateur seul (`perMachine: false`, aucune élévation), crée les raccourcis du Bureau et du menu Démarrer et lance Magistra à la fin (`electron-builder.json`) ; c'est à ce premier lancement que Magistra enregistre le lien `magistra://` (bouton **Ouvrir Magistra** du site). Chaque version publie aussi `SHA256SUMS.txt` ; vérification facultative de l'empreinte par le service informatique : voir « [Mainteneurs](#mainteneurs--versions-variables-domaine-ports) ».

**Activer l'IA** : un seul bouton, qui annonce avant toute action la taille totale du téléchargement (moteur d'IA locale, Ollama, puis modèle open weights recommandé pour cet ordinateur d'après sa mémoire, son processeur, sa carte graphique et son disque). Magistra enchaîne ensuite seule : installation du moteur s'il manque (Ollama 0.13.1 au moins ; l'installateur officiel n'est lancé qu'après vérification de son empreinte SHA-256), démarrage, téléchargement du modèle, avec une progression, **Annuler** et des messages précis (espace disque, réseau, proxy…). Un téléchargement interrompu reprend. Si le moteur est trop ancien, Magistra propose de le mettre à jour (vos modèles sont conservés) ; s'il a été installé pour tout l'ordinateur par le service informatique, elle invite à lui demander la mise à jour. Rien n'est jamais téléchargé sans ce clic.

| Niveau | Pour | Téléchargement |
|---|---|---|
| Magistra Léger | PC modestes (8 à 16 Go de mémoire) | ≈ 6 Go |
| Magistra Standard | PC récents (16 Go et plus) | ≈ 9 Go |
| Magistra Qualité | PC avec carte graphique ≥ 16 Go | ≈ 15 Go |

Hors connexion, Magistra fonctionne avec le modèle local et vos documents. **Mises à jour** : Magistra ne vérifie rien automatiquement. Dans Réglages → À propos, **Rechercher une mise à jour** interroge la page des versions et, si une nouvelle version existe, propose d'ouvrir sa page pour la télécharger (rien n'est téléchargé ni installé automatiquement). En mode avancé (Réglages), un établissement peut aussi connecter l'application à son propre serveur d'IA : Magistra indique alors clairement que les données de génération sont transmises à ce serveur.

Facultatif : connectez l'application au site pour y générer avec l'IA de l'ordinateur (« [Utiliser l'IA de votre ordinateur depuis le site](#utiliser-lia-de-votre-ordinateur-depuis-le-site-magistra-pour-windows) »).

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

## Utiliser l'IA de votre ordinateur depuis le site (Magistra pour Windows)

Le site web peut confier vos générations à l'IA **locale** de l'application Windows (« Magistra locale ») :

```
site web (navigateur) ──▶ connecteur local de l'application Magistra ──▶ moteur d'IA (Ollama) ──▶ modèle
```

Le navigateur ne parle jamais au moteur d'IA lui-même : l'application n'accepte que cinq opérations Magistra (présence, appairage, état, génération en direct, arrêt), et seulement de la part du site officiel, après votre accord. Aucune clé API, aucune adresse à saisir, aucune ligne de commande. Le fonctionnement détaillé et la sécurité sont décrits dans [ARCHITECTURE_IA.md](ARCHITECTURE_IA.md#19-connecteur-local-site-web--ia-de-lordinateur) (§ 19).

### Parcours de l'enseignant

1. **Compte** : sur l'ordinateur Windows 10 ou 11 où Magistra sera installée, connectez-vous au site (`https://magistra-2.vercel.app`), de préférence avec Chrome ou Edge.
2. **Tableau de bord** : la carte « Magistra locale » affiche « Activez l’intelligence Magistra sur votre ordinateur. ».
3. **Télécharger** : **Télécharger Magistra pour Windows** (lien du site `/telecharger`) télécharge directement l'installateur de la dernière version **stable** publiée. Sa version, sa taille, sa date et son empreinte SHA-256 sont affichées dans Réglages → « Magistra pour Windows » et sur la page d'accueil, avec les trois étapes d'installation et **Ouvrir Magistra** si elle est déjà installée.
4. **Installer** : ouvrez `Magistra-Setup-x.y.z.exe` (avertissement SmartScreen : voir « [Installer Magistra](#installer-magistra-enseignants) ») ; Magistra s'installe et s'ouvre toute seule. Dans l'application, **Activer l'IA** prépare le moteur et le modèle (taille annoncée avant). **Laissez l'application ouverte** : fermer sa fenêtre la quitte, et le site ne la trouve plus.
5. **Détection** : sur le tableau de bord, cliquez sur **J'ai déjà Magistra : la rechercher** (ou, dans la section « Magistra pour Windows », sur **Détecter maintenant**, sous « J’ai installé Magistra »). Si le navigateur doit demander son autorisation, le site l'explique **avant** (voir ci-dessous), puis affiche « Recherche de Magistra sur cet ordinateur… » et « ✓ Magistra trouvée ». Si l'application n'est pas trouvée, il affiche « Magistra n’est pas encore détectée. », avec **Réessayer** et **Télécharger Magistra**.
6. **Connecter Magistra locale** : si le navigateur demande d'ouvrir Magistra, acceptez. Le site affiche « Confirmez dans l’application Magistra… » et un **code de vérification** (par exemple `K7F-2QX`).
7. **Autoriser dans l'application** : Magistra demande « Autoriser magistra-2.vercel.app à utiliser l’intelligence locale de cet ordinateur ? », avec le même code. Si le code est identique, cliquez sur **Autoriser** ; sinon, ou si vous n'avez rien demandé, cliquez sur **Refuser** (bouton par défaut). Le site affiche « ✓ Intelligence locale connectée ». Il attend l'accord 2 minutes au plus ; la demande expire au bout de 5 minutes dans l'application.
8. **Générer** : la page Générer indique « IA locale — Vos contenus sont générés sur cet ordinateur. ». Le texte apparaît au fur et à mesure, et **Arrêter** interrompt réellement le modèle de l'ordinateur. Le résultat est enregistré dans l'historique de votre compte.

Aux visites suivantes, le site retrouve seul l'application ouverte (« ✓ Magistra locale connectée ») tant que l'autorisation du navigateur reste accordée : il n'y a rien à refaire. L'ordinateur traite **une génération à la fois**, application et site confondus. Si le moteur n'est pas prêt (modèle pas encore installé, application réglée sur un serveur distant…), le site en donne la cause et propose **Ouvrir Magistra**. Si l'application est fermée, il propose **Ouvrir Magistra** et **Réessayer**. Si elle répond sans pouvoir servir ce navigateur (elle ne le reconnaît pas, reconnexion refusée, ancienne version à mettre à jour…), le site en donne la cause, jamais « fermée ».
Après une mise à jour du site, une application Magistra d'une version plus ancienne du protocole n'est plus utilisée : le site affiche « L'application Magistra de cet ordinateur doit être mise à jour… », avec le téléchargement de la dernière version.

### Autorisation du navigateur (« Applications sur l'appareil » / « Réseau local »)

**Pourquoi** : le site est public, et l'application écoute sur l'ordinateur lui-même (adresse de boucle locale). Chrome (depuis la version 142) et Edge exigent votre accord avant qu'un site public ne contacte l'ordinateur ou le réseau local (protection « Local Network Access » contre les sites qui attaqueraient une imprimante, une box ou un programme local). Magistra ne contourne jamais cette protection :
- la vérification automatique à l'ouverture d'une page ne déclenche jamais la demande ;
- seul un clic de votre part peut la faire apparaître (rechercher, connecter, ouvrir ou déconnecter Magistra) ;
- le site l'explique avant : « Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil : acceptez-la. Elle permet uniquement à ce site de dialoguer avec l’application Magistra installée sur cet ordinateur. »

**L'accorder** : acceptez la demande du navigateur. Si vous l'avez refusée, le site affiche « Votre navigateur bloque l’accès à l’application Magistra. ». Dans ce cas :
1. cliquez sur l'icône à gauche de l'adresse du site ;
2. ouvrez les autorisations du site ;
3. à la ligne « Applications sur l'appareil » (« Réseau local » dans les versions plus anciennes), choisissez **Autoriser** ;
4. puis cliquez sur **Réessayer**.

**La retirer** : au même endroit, choisissez **Bloquer**. Le site ne peut alors plus joindre l'application. Son appairage reste enregistré : pour le supprimer, voir « Retirer les autorisations ».

**Parcs gérés** : l'administrateur peut accorder l'autorisation au site officiel par stratégie, sans demande à l'enseignant.
- La stratégie [`LocalNetworkAccessAllowedForUrls`](https://chromeenterprise.google/policies/local-network-access-allowed-for-urls/) existe pour Chrome à partir de la version 140, et sous le même nom pour [Edge](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/localnetworkaccessallowedforurls). Sa valeur est la liste des origines autorisées : `https://magistra-2.vercel.app`.
- Sous Windows (Chrome), elle s'écrit dans `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls`, avec une valeur `REG_SZ` nommée `1` et contenant `https://magistra-2.vercel.app`. Pour Edge, la clé est `…\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls`.
- Les versions qui séparent « Réseau local » et « Applications sur l'appareil » (Chrome 146 et suivants) proposent aussi [`LoopbackNetworkAllowedForUrls`](https://chromeenterprise.google/policies/loopback-network-allowed-for-urls/). Elle est limitée à l'ordinateur lui-même, donc plus restreinte. Une stratégie `…BlockedForUrls` qui vise le même site l'emporte sur ces deux stratégies.

La stratégie supprime seulement la demande du navigateur : l'accord dans l'application Magistra (**Autoriser**) reste exigé pour chaque navigateur.

**Navigateurs vérifiés** : le parcours est vérifié de bout en bout, avec cette protection active, dans Chromium (tests automatiques de la CI, autorisation « local-network-access ») et dans **Microsoft Edge 154** (projet `connector-edge`, lancé à la main là où Edge est installé ; autorisation « loopback-network » des versions récentes). Dans Edge 154 :
- le site lit bien l'autorisation « loopback-network » (celle qu'il lit en premier) et joint l'application une fois qu'elle est accordée ;
- un refus affiche « Votre navigateur bloque l’accès à l’application Magistra. » et la marche à suivre ;
- tout le parcours passe : absente, trouvée, refus puis accord dans l'application, génération en flux, arrêt, fermeture, relance sans nouvel appairage, retrait, ainsi que « moteur non prêt », « autre site » et « programme sur le premier port ».

Sans écran (tests), Edge enregistre sa réponse automatique à la demande comme un refus (l'état réel du navigateur, que le site affiche), là où Chromium la laisse « à demander ». Le libellé de la ligne des réglages du site (« Applications sur l'appareil ») n'est pas visible par les tests.

**Autres navigateurs** : Google Chrome n'est pas testé automatiquement (même moteur que Chromium et Edge). Firefox met en place une protection comparable ; s'il demande une autorisation, acceptez-la, mais ce cas n'est pas couvert par les tests. Safari n'existe pas sous Windows ; sur Mac, aucune application Magistra n'est publiée. Utilisez-y le serveur en ligne.

### Ce qui reste sur l'ordinateur, ce qui est enregistré en ligne

| Donnée | Où elle va |
|---|---|
| Fichiers originaux (PDF, DOCX…) | nulle part : le texte est extrait dans le navigateur, comme toujours |
| Demande complète et **extraits** sélectionnés de vos documents | uniquement à l'application Magistra de cet ordinateur, jamais au serveur Magistra en ligne ni à un prestataire d'IA |
| Rédaction par le modèle | sur cet ordinateur |
| Recherche Internet ou académique (si vous la choisissez) | faite par l'application, depuis cet ordinateur, avec ses propres réglages : seuls le sujet et les mots-clés partent vers HAL, Crossref, Wikipédia ou SearXNG |
| **Résultat**, sources citées (nom du document, pages…), paramètres de la demande (sujet, objectifs, consignes, contenu à adapter, profils, noms des documents), nom du modèle | enregistrés dans l'**historique de votre compte** en ligne (serveur Magistra, Supabase) ; l'application ne les garde pas dans son propre historique |
| Travail d'élève collé pour un corrigé | jamais enregistré (seule sa longueur est notée) |
| Appairage de ce navigateur | navigateur : clé **non extractible** (IndexedDB « magistra-local-connector ») ; application : fichier `local-connector.json` de son dossier de données (site, navigateur, dates, clé chiffrée par Windows avec DPAPI) |

La page Générer le rappelle : « IA locale : vos contenus sont générés sur cet ordinateur par l'application Magistra ; les extraits de vos documents n'en sortent pas. Le résultat et les paramètres de la demande (…) sont enregistrés dans l'historique de votre compte en ligne. »

### Choix du moteur et priorité

Réglages → **Intelligence artificielle** affiche l'ordre de priorité :
1. **Magistra locale** (son état) ;
2. **Serveur IA de l’établissement** (le serveur d'IA du site, s'il n'est pas un prestataire tiers) ;
3. **Fournisseur web configuré** (nom du prestataire, par exemple OVHcloud AI Endpoints).

Chaque ligne indique « non configuré » si elle ne s'applique pas.

- **Par défaut** : Magistra locale dès que ce navigateur est connecté (le choix est alors mémorisé), sinon le serveur en ligne. Le choix est propre à chaque navigateur (`localStorage`, clé `magistra_engine_choice`).
- **Passer au serveur en ligne** : choisissez « Serveur en ligne : [prestataire] » dans les réglages, ou **Utiliser le serveur en ligne…** sur la page Générer. Une confirmation s'affiche toujours : « Cette génération sera traitée par [prestataire] (serveur distant). Vos demandes et les extraits de vos documents quitteront cet ordinateur. ».
- **Jamais de bascule silencieuse** : si Magistra locale est choisie mais fermée ou pas prête, la page Générer affiche « Magistra locale n’est pas prête » et sa cause, et n'envoie rien au serveur.
- **Revenir à l'IA locale** est immédiat (**Utiliser l’IA locale**).
- Sans installation possible (Mac, Linux, poste partagé de l'établissement), le serveur en ligne reste disponible.

### Hors connexion

- **L'application Windows** fonctionne sans Internet, avec le modèle local et vos documents.
- **Le site**, lui, nécessite Internet, même quand la génération est faite par l'ordinateur : chargement des pages, connexion au compte, enregistrement dans l'historique. Sans Internet, utilisez directement l'application.

### Retirer les autorisations

- **Depuis le site** : Réglages → Intelligence artificielle → **Déconnecter Magistra locale**. Le navigateur demande à l'application de retirer son autorisation, puis l'oublie, même si l'application est fermée. Si l'application n'a pas pu confirmer (fermée, injoignable, ou navigateur qui bloque l'accès à l'application : le retrait n'a alors pas même pu être demandé), le site demande de la retirer aussi dans l'application ; cet avertissement reste affiché jusqu'à la prochaine action.
- **Depuis l'application** : Réglages → « **Site web Magistra** » liste les navigateurs autorisés (site, navigateur, dates). **Retirer** prend effet immédiatement et arrête la génération en cours de ce navigateur.
- **Couper tout accès du site** : dans la même section, décochez « Permettre au site Magistra d’utiliser l’IA de cet ordinateur ». L'application n'écoute alors plus du tout. Recochez-la pour rétablir l'accès.
- **Depuis le navigateur** : bloquer l'autorisation « Applications sur l'appareil » empêche tout contact. Effacer les données du site oublie l'appairage de ce navigateur : retirez-le aussi dans l'application.

Au-delà de 10 navigateurs autorisés, le plus ancien est retiré automatiquement. Si le système ne permet pas de chiffrer les clés (Linux sans trousseau de clés, par exemple ; sous Windows, DPAPI est normalement disponible), les autorisations ne durent que jusqu'à la fermeture de l'application, et les réglages le signalent.

### Mainteneurs : versions, variables, domaine, ports

**Publier une version de l'application** — `"version": "X.Y.Z"` doit être dans `package.json` (commité). Deux façons :
- **Sans ligne de commande (le plus simple).** Sur GitHub : **Releases → Draft a new release** → *Choose a tag* : tapez `vX.Y.Z` puis « Create new tag: vX.Y.Z on publish » → *Target* : la branche à publier → titre « Magistra X.Y.Z » → **Publish release** (laissez cochée « Set as the latest release »). Le workflow [`release.yml`](.github/workflows/release.yml) construit alors l'installateur, l'archive et `SHA256SUMS.txt` (≈ 10 à 15 minutes) et les **joint à cette release** (il n'y remplace jamais un fichier existant ; il ajoute les notes de version si vous n'en avez pas écrit). Pendant la construction, le bouton du site reste inactif (« Pas encore disponible… ») ; ensuite, il télécharge l'installateur.
- **Avec git.** `git tag vX.Y.Z && git push origin vX.Y.Z` : le workflow crée une **release en brouillon** avec les fichiers ; relisez-la puis **publiez-la** (même case cochée).

Dans les deux cas, une fois la release publiée avec son installateur, le site la propose **automatiquement** : `GET /api/windows-release` interroge l'API GitHub (`/releases/latest`). Il affiche la version, la taille, la date, l'empreinte SHA-256 (champ `digest` de GitHub, sinon `SHA256SUMS.txt`) et « Windows 10 ou 11 (64 bits) ». Aucune version n'est écrite dans le code.

**Délai d'affichage** : tant qu'aucune version n'est téléchargeable (rien de publié, ou installateur encore en construction après « Publish release »), la réponse n'est gardée qu'**une minute** (mémoire du serveur, navigateur et CDN) : le bouton « Télécharger » s'active une à trois minutes après l'arrivée de l'installateur. Une version trouvée est gardée 10 minutes en mémoire par le serveur, 5 minutes dans le navigateur et 10 minutes sur le CDN, qui peut ensuite resservir l'ancienne réponse le temps de la renouveler (`stale-while-revalidate`) : une version suivante apparaît donc après quelques minutes, parfois un peu plus, et le bouton télécharge la précédente en attendant.

**Vérifier l'empreinte d'un installateur** (service informatique, facultatif) : sous Windows, `Get-FileHash .\Magistra-Setup-x.y.z.exe -Algorithm SHA256` doit donner l'empreinte affichée sur le site (Réglages → « Magistra pour Windows ») et dans `SHA256SUMS.txt` de la release. Les textes destinés aux enseignants ne demandent jamais de ligne de commande.

Ne sont **jamais** proposés : un brouillon, une préversion (tag `vX.Y.Z-rc.1`), une étiquette autre que `vX.Y.Z`, une release sans `Magistra-Setup-X.Y.Z.exe` du même numéro, ni un lien de téléchargement hors de `https://github.com/<dépôt>/releases/download/`.

**Lien de téléchargement du site : `/telecharger`** (par exemple `https://magistra-2.vercel.app/telecharger`, à partager tel quel). C'est l'adresse du bouton « Télécharger » : le serveur y répond par une redirection vers le fichier, et le navigateur télécharge l'installateur sans quitter la page. Même route que `GET /api/download` (réécriture dans `vercel.json` ; `npm start` et `npm run dev` la servent aussi). Le fichier lui-même reste hébergé par la release GitHub : un installateur d'environ 100 Mo ne peut pas être versionné dans le dépôt (limite de 100 Mo par fichier) et épuiserait vite la bande passante gratuite de Vercel ; l'enseignant ne voit jamais de page GitHub.

Le bouton télécharge **toujours un fichier**, jamais une page GitHub :
- version connue : le lien du site, qui renvoie à son installateur `Magistra-Setup-X.Y.Z.exe` ;
- GitHub momentanément injoignable depuis le serveur, ou limite de l'API atteinte : le lien du site, qui renvoie à `…/releases/latest/download/Magistra-Setup.exe`, le **même installateur sous un nom fixe**, que `release.yml` publie dans chaque version et que GitHub résout vers la dernière version stable ;
- serveur du site injoignable (hébergement statique sans API) : directement `…/releases/latest/download/Magistra-Setup.exe` ;
- aucune version stable publiée : le bouton est inactif et le site l'explique (« Pas encore disponible… ») ; le lien `/telecharger` ouvert directement renvoie à la section « Magistra pour Windows » de l'accueil, qui le dit aussi.

**Variables du serveur (facultatives)**

| Variable | Rôle |
|---|---|
| `MAGISTRA_RELEASES_REPO` | dépôt GitHub `propriétaire/dépôt` dont les versions sont proposées. Vide : dépôt officiel `juanrobin09-stack/magistra-2`. Valeur invalide : dépôt officiel, avec un avertissement dans le journal. À changer seulement pour une copie qui publie ses propres versions : l'application, elle, cherche ses mises à jour sur le dépôt officiel (`electron/updateCheck.ts`). |
| `GITHUB_TOKEN` | **recommandé sur Vercel** et sur tout hébergement dont l'adresse de sortie est partagée : jeton « fine-grained » en lecture seule, sans aucune permission (dépôts publics). Sans jeton, l'API GitHub accepte 60 requêtes par heure et par adresse IP, **partagées avec les autres clients de l'hébergeur** ; le cache (10 minutes) est propre à chaque instance du serveur, et une instance qui démarre commence sans lui. Limite atteinte : `/api/windows-release` renvoie `unavailable` ; le bouton télécharge toujours la dernière version (nom fixe), sans afficher sa version, sa taille ni son empreinte. Le jeton est envoyé seulement à `api.github.com`, jamais au navigateur ni dans les journaux. |

`POST /api/generation` enregistre le résultat d'une génération locale. Cette route compte pour `RATE_LIMIT_PER_MINUTE`, pas pour `RATE_LIMIT_GLOBAL_PER_MINUTE`. Après la mise à jour, réexécutez `supabase-schema.sql` : il ajoute la colonne `kind` de `api_requests`.

**Domaine personnalisé** : l'application n'accepte que les origines de `OFFICIAL_WEB_ORIGINS` (`shared/localConnector.ts`, aujourd'hui `https://magistra-2.vercel.app`). Cette liste est **compilée dans l'application**. Pour servir le site sur un autre domaine (ou sur un serveur autonome d'établissement) :
1. ajoutez l'origine exacte (`https://mon-domaine.fr`, sans chemin ni barre finale) ; gardez l'ancienne tant qu'elle sert ;
2. **publiez une nouvelle version de l'application** et faites-la installer. Les versions déjà installées ignorent les demandes de connexion du nouveau domaine et refusent ses requêtes (403) : le site y affiche « Magistra n’est pas encore détectée. » ;
3. la **CSP reste inchangée** : `connect-src` vise les ports du connecteur (`http://127.0.0.1:47831 http://127.0.0.1:47832 http://127.0.0.1:47833`), pas le domaine du site.

Une autorisation est liée à l'origine du site : sur le nouveau domaine, chaque navigateur doit se reconnecter.

**Ports 47831–47833** : l'application écoute sur `127.0.0.1` uniquement, jamais sur le réseau.
- Elle prend le premier port libre des trois ; le site les essaie tous. Aucune règle de pare-feu ni aucun droit d'administrateur n'est nécessaire.
- Si les trois ports sont occupés, par un autre programme ou par des plages que Windows réserve (Hyper-V : `netsh interface ipv4 show excludedportrange protocol=tcp`), Réglages → « Site web Magistra » l'indique, et l'application réessaie toutes les minutes.
- Chaque session Windows où Magistra est ouverte en même temps sur le même PC occupe un port : trois sessions au plus peuvent utiliser Magistra locale simultanément.
- Pour changer les ports, modifiez :
  - `CONNECTOR_PORTS` dans `shared/localConnector.ts` ;
  - la CSP de `vercel.json` (le serveur autonome la déduit de `CONNECTOR_PORTS`, et `tests/server/deploy.test.ts` vérifie les deux) ;
  - puis publiez une nouvelle version de l'application.

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
| `npm run test:e2e` | tests de bout en bout Playwright : `--project=web` (site), `--project=electron` (application réelle avec Ollama simulé), `--project=connector` (site ⇄ connecteur local ⇄ application réelle, protection « Local Network Access » de Chromium active) ou `--project=connector-edge` (les mêmes tests dans Microsoft Edge installé ; ignorés s'il est absent, jamais lancés par la CI) |
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
- les tests de bout en bout du connecteur local (site ⇄ application, dans Chromium avec la protection « Local Network Access » active) ;
- l'installateur Windows NSIS sur `windows-latest`, avec les mêmes options qu'une version publiée ; il est gardé 14 jours dans l'exécution (**Artifacts** → `magistra-installateur-windows`), pour l'essayer avant de publier.

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
2. **Premier lancement** : l'animation « Magistra » (≈ 2 s ; un clic ou une touche la passe), puis la page d'accueil de Magistra : **Commencer**, puis créez un profil (par exemple Master 1). **Sans Ollama installé**, la carte « Activez l’IA de Magistra sur cet ordinateur » du tableau de bord annonce la taille totale (moteur et modèle recommandé) et une durée indicative. Cliquez sur **Activer l’IA** : l'installateur officiel du moteur est vérifié (SHA-256) puis lancé, et le modèle suit tout seul. Vérifiez qu'aucune fenêtre PowerShell **ni fenêtre d'Ollama** (accueil, connexion) n'apparaît : Magistra démarre Ollama en arrière-plan (`--hide --fast-startup`), et détecte seul la fin de l'installation.
3. **Ollama trop ancien** (version inférieure à 0.13.1, par exemple une ancienne installation conservée) : la taille annoncée par **Activer l’IA** comprend la mise à jour du moteur, faite **avant** tout téléchargement de modèle (Réglages affiche aussi le moteur trop ancien, avec **Mettre à jour le moteur IA**) ; vérifiez qu'après la mise à jour les modèles déjà présents sont conservés. Si Ollama est installé dans `C:\Program Files` (installation par le service informatique), la carte doit inviter à **demander la mise à jour au service informatique**, sans bouton qui échouerait.
4. **Téléchargement du modèle** : une seule progression (étape, pourcentage, reste), reprise dans la barre latérale ; naviguez librement pendant ce temps. Coupez le réseau pendant le téléchargement : un message clair apparaît, et « Reprendre le téléchargement » repart du point atteint. Fermez Magistra pendant le téléchargement puis rouvrez-la : l'activation reprend toute seule, sans repartir de zéro. Un modèle déjà installé sous un autre nom (`ministral-3:latest`, `ministral-3:8b-instruct-2512-q4_K_M`…) doit être reconnu sans nouveau téléchargement. Attendez « L’IA de Magistra est prête. ». Avant l'activation, **Générer** propose **Voir un exemple pré-rédigé** : il doit être marqué « Exemple pré-rédigé — ce n’est pas l’IA » et n'apparaître ni dans l'historique ni dans les statistiques.
5. **Réseau d'établissement avec proxy** : Ollama n'utilise pas le proxy de Windows, seulement la variable `HTTPS_PROXY` ([FAQ Ollama](https://docs.ollama.com/faq#how-do-i-use-ollama-behind-a-proxy)). Magistra transmet le proxy du système à Ollama quand il le démarre. Si Ollama tournait déjà sans ce réglage, le téléchargement échoue avec un message qui parle du proxy, et « Reprendre le téléchargement » propose de relancer le moteur avec le proxy.
6. Dans **Générer** : choisissez « Cours », ajoutez un PDF et un DOCX, « Mes documents uniquement ». Vérifiez « Chargement du modèle… » puis le texte progressif, puis « Sources utilisées » avec les pages ou sections exactes. Recommencez en cliquant sur **Arrêter** en cours de route.
7. Coupez Internet et relancez une génération : elle doit aboutir. En mode « Internet », l'application doit signaler que la recherche est indisponible.
8. Vérifiez l'historique (recherche, favori, suppression), l'export PDF (accents, « x > 3 », « H₂O », tableaux), puis Réglages : changement de niveau (Léger / Qualité), « Rechercher une mise à jour » (la release publiée, et non un brouillon, doit être proposée).
9. Quittez Ollama (icône de la barre des tâches), puis relancez une génération : Magistra doit redémarrer le moteur, ou afficher « Moteur IA non démarré. ».

### Structure

```
shared/     cœur commun (IA, prompts, documents, recherche, citations, pipeline, validation)
src/        interface React (pages, composants, runtime web/local/démo)
server/     serveur web (auth Clerk, Supabase, flux de génération, protection SSRF, serveur autonome)
api/        fonctions Vercel (adaptateurs minces vers server/)
electron/   application Windows (protocole app://, IPC sécurisé, données locales, Ollama, connecteur local du site)
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
| **Site web + Magistra locale** | La demande et les **extraits** de vos documents vont uniquement à l'application Magistra de cet ordinateur. Seuls le résultat, les sources citées et les paramètres de la demande (sujet, objectifs, consignes, contenu à adapter, profils, noms des documents) sont enregistrés dans l'historique de votre compte en ligne. |
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
