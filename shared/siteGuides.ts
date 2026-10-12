/** Conseils éditoriaux publics : aucun accès à la configuration ou aux documents de l'application. */
export interface SiteGuideData {
  path: string;
  category: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  sections: readonly {
    id: string;
    title: string;
    paragraphs?: readonly string[];
    steps?: readonly string[];
    bullets?: readonly string[];
    example?: string;
  }[];
  faq: readonly { question: string; answer: string }[];
  related: readonly string[];
}

export const SITE_GUIDES_TITLE = 'Guides IA pour enseignants — Magistra';
export const SITE_GUIDES_DESCRIPTION = 'Des méthodes concrètes pour préparer cours, TD, examens et syllabus avec une IA, lire vos PDF et utiliser Magistra sur Windows, en local ou avec une clé API.';

export const SITE_GUIDES: readonly SiteGuideData[] = [
  {
    path: '/guides/ia-gratuite-enseignants',
    category: 'Bien commencer',
    title: 'IA gratuite pour enseignants : choisir son usage — Magistra',
    description: 'Découvrez comment utiliser une IA gratuite pour préparer vos cours et exercices, choisir entre IA locale et API, et vérifier les contenus avec Magistra.',
    heading: 'Une IA gratuite pour enseignants : par où commencer ?',
    intro: 'Une IA devient utile lorsqu’elle accompagne une tâche précise : structurer un cours, varier un exercice ou préparer un corrigé. Magistra réunit ces outils dans une application gratuite pour Windows, sans compte Magistra. Commencez par une préparation courte, fondée sur vos documents, pour évaluer ce que l’assistant vous apporte réellement.',
    sections: [
      {
        id: 'choisir-tache', title: 'Choisir une préparation que vous connaissez bien',
        paragraphs: ['Prenez un chapitre déjà enseigné, avec des objectifs et un public clairement identifiés. Vous pourrez juger la pertinence du résultat, repérer les omissions et comparer le brouillon à votre propre démarche. Le premier essai sert à apprendre à formuler une demande et à apprécier le temps de relecture nécessaire.'],
        bullets: ['Un plan de séance à partir d’une fiche existante.', 'Trois exercices progressifs sur une notion déjà étudiée.', 'Un corrigé expliqué pour un petit ensemble de questions.'],
      },
      {
        id: 'gratuit-local-api', title: 'Comprendre ce qui est gratuit et ce qui dépend d’un fournisseur',
        paragraphs: ['L’application Magistra est gratuite. Avec une IA locale, le moteur et le modèle s’installent sur votre ordinateur ; leur téléchargement initial nécessite Internet. Une fois cette installation terminée, la génération locale peut fonctionner hors ligne, selon les capacités de votre machine.', 'Vous pouvez aussi renseigner une clé personnelle OpenAI, Mistral, Gemini ou Anthropic. Cette option évite d’installer un moteur local, mais nécessite Internet. Les tarifs, crédits et quotas sont ceux de votre compte chez le fournisseur ; la gratuité de Magistra ne supprime pas une éventuelle facturation API.'],
      },
      {
        id: 'premiere-demande', title: 'Donner un contexte court et exploitable',
        steps: ['Choisissez le niveau, la matière et l’outil correspondant à votre préparation.', 'Ajoutez un document pertinent plutôt qu’un dossier entier sans indication.', 'Précisez les acquis attendus, la durée et la forme du support.', 'Lancez une première version, puis demandez une adaptation ciblée.'],
        example: '« Pour un TD de première année de licence, propose trois exercices sur les pourcentages. Les étudiants savent calculer une proportion mais confondent variation relative et points de pourcentage. Prévois 45 minutes, avec un corrigé qui explique cette distinction. Appuie-toi sur ma fiche jointe. »',
      },
      {
        id: 'evaluer-resultat', title: 'Mesurer l’aide apportée et garder votre jugement',
        paragraphs: ['Relisez les faits, refaites les calculs et vérifiez que le vocabulaire convient au public. Un texte fluide peut contenir une erreur. Conservez les passages utiles et modifiez ceux qui ne correspondent pas à votre cours. Une comparaison sur plusieurs petites tâches sera plus instructive qu’une seule génération très longue.', 'Avant d’utiliser une API avec des travaux d’élèves, retirez les informations personnelles inutiles et respectez les règles de votre établissement. En mode API, les consignes et extraits utilisés pour générer sont transmis au fournisseur sélectionné.'],
      },
    ],
    faq: [
      { question: 'Faut-il un abonnement ChatGPT pour utiliser Magistra ?', answer: 'Non. Magistra peut utiliser une IA locale. Une clé API personnelle constitue une autre option ; son accès et sa facturation dépendent du fournisseur, séparément d’un éventuel abonnement à son interface de chat.' },
      { question: 'Magistra remplace-t-il la préparation de l’enseignant ?', answer: 'L’assistant propose des brouillons. Le choix des objectifs, la vérification scientifique, l’adaptation aux élèves et la décision de distribuer un support restent du ressort de l’enseignant.' },
    ],
    related: ['/guides/preparer-cours-ia', '/guides/ia-locale-hors-ligne', '/guides/cles-api-ia'],
  },
  {
    path: '/guides/preparer-cours-ia',
    category: 'Préparer ses enseignements',
    title: 'Préparer un cours avec une IA : méthode et exemple — Magistra',
    description: 'Une méthode pour préparer un cours avec une IA : objectifs, documents, déroulé, exemple de consigne et vérifications avant la séance avec Magistra.',
    heading: 'Préparer un cours avec une IA à partir de vos documents',
    intro: 'Un cours cohérent part des apprentissages visés, puis choisit les explications et les activités qui les rendent accessibles. Avec Magistra, vous pouvez demander un premier déroulé à partir de vos supports et du contexte de la classe. L’IA aide à organiser la matière ; votre expérience permet de décider ce qui doit être enseigné.',
    sections: [
      {
        id: 'cadrage', title: 'Définir le résultat attendu avant de demander un plan',
        paragraphs: ['Indiquez ce que les élèves ou étudiants doivent savoir expliquer, reconnaître ou réaliser à la fin. Une formulation comme « comprendre les probabilités » est trop large pour une séance. Préférez une action observable, par exemple « distinguer fréquence observée et probabilité dans une situation simple ».'],
        bullets: ['Le niveau et les prérequis réellement maîtrisés.', 'Le temps disponible et les contraintes de matériel.', 'Deux ou trois objectifs, avec une priorité explicite.', 'La place de la séance dans le chapitre ou le semestre.'],
      },
      {
        id: 'documents', title: 'Sélectionner les supports et préciser leur rôle',
        paragraphs: ['Joignez la fiche de chapitre, un extrait de programme ou un document de référence directement utile. Expliquez si un document fixe le contenu à enseigner, fournit des exemples ou sert uniquement de contexte. Cette distinction évite de mélanger une contrainte institutionnelle avec une simple illustration.', 'Lorsqu’une recherche en ligne complète vos supports, demandez de distinguer les éléments trouvés des propositions pédagogiques. Ouvrez les références citées pour vérifier leur contenu : une source annoncée n’est pas automatiquement une preuve de toutes les phrases du cours.'],
      },
      {
        id: 'deroule', title: 'Construire une séance avec des transitions explicites',
        steps: ['Demandez un plan avec une entrée dans le sujet, les notions essentielles et une activité.', 'Vérifiez la durée cumulée, en ajoutant le temps de consigne et les échanges.', 'Repérez les passages où une démonstration ou un exemple est indispensable.', 'Demandez ensuite une synthèse courte et une question de vérification des acquis.'],
        example: '« Prépare une séance de 55 minutes en seconde sur la variation d’une fonction, à partir de ma fiche. Les élèves savent lire un graphique. Propose une situation de départ, deux exemples expliqués, une activité de 15 minutes et trois questions de bilan. Signale les prérequis absents plutôt que de les supposer acquis. »',
      },
      {
        id: 'avant-classe', title: 'Adapter le brouillon à votre manière d’enseigner',
        paragraphs: ['Relisez les définitions et la progression des explications. Testez les activités dans l’ordre proposé : un exercice peut demander une notion présentée plus tard. Ajustez les exemples à votre contexte et retirez les formulations qui ajouteraient une difficulté inutile.', 'Préparez une version courte du déroulé pour la séance et conservez les développements utiles dans vos notes. Après le cours, notez les obstacles rencontrés. Ces observations servent de contexte pour une prochaine adaptation ; elles valent davantage qu’une demande vague de rendre le cours « meilleur ».'],
      },
    ],
    faq: [
      { question: 'Peut-on préparer un cours sans joindre de document ?', answer: 'Oui, mais indiquez précisément le niveau, les objectifs et les limites du chapitre. Vos documents améliorent l’ancrage dans votre enseignement et permettent de vérifier plus facilement le brouillon.' },
      { question: 'Comment éviter un cours trop long ?', answer: 'Fixez une durée, limitez le nombre d’objectifs et demandez une séparation entre le contenu indispensable et les prolongements. Vérifiez vous-même le temps nécessaire aux activités.' },
    ],
    related: ['/guides/exercices-td-ia', '/guides/pdf-scannes-documents', '/guides/sources-fiabilite-ia'],
  },
  {
    path: '/guides/exercices-td-ia',
    category: 'Préparer ses enseignements',
    title: 'Créer des exercices et des TD avec une IA — Magistra',
    description: 'Préparez des exercices progressifs et un TD avec une IA : compétences, difficulté, consignes, éléments de correction et vérification des solutions.',
    heading: 'Créer des exercices et des TD progressifs avec une IA',
    intro: 'Une série d’exercices réussie fait travailler un apprentissage identifiable, puis augmente la difficulté sans changer brusquement les règles du jeu. L’outil Exercices de Magistra, appelé « TD / Exercices » dans le supérieur, peut proposer des énoncés et des éléments de correction. Pour obtenir une série exploitable, précisez la compétence visée et la manière dont les étudiants devront la mobiliser.',
    sections: [
      {
        id: 'competence', title: 'Passer du thème à une compétence observable',
        paragraphs: ['« Exercices sur les statistiques » laisse ouvertes trop de possibilités. Dites plutôt si vous souhaitez calculer une médiane, interpréter une dispersion ou choisir un indicateur. Précisez les outils autorisés : calculatrice, tableur, formulaire, logiciel ou raisonnement sans matériel. Ce choix modifie la difficulté et le temps de réalisation.'],
        bullets: ['Un exercice d’entrée pour vérifier les prérequis.', 'Un exercice d’application accompagné d’une consigne précise.', 'Un problème de transfert dans une situation différente.', 'Une question de retour sur la méthode et les erreurs possibles.'],
      },
      {
        id: 'niveau', title: 'Construire une progression sans multiplier les obstacles',
        paragraphs: ['Faites varier une dimension à la fois : le nombre d’étapes, l’autonomie, le type de données ou le contexte. Un énoncé plus long n’est pas nécessairement un exercice plus difficile. Demandez de nommer ce qui change entre deux exercices afin de voir si la progression sert votre objectif.', 'Dans le supérieur, précisez la place du TD par rapport au cours magistral. Une séance destinée à appliquer une méthode déjà présentée n’a pas la même structure qu’un TD d’exploration. Indiquez aussi si les étudiants travaillent seuls, en binômes ou avec une mise en commun.'],
      },
      {
        id: 'consigne', title: 'Demander une série courte avec un corrigé explicatif',
        steps: ['Sélectionnez l’outil « Exercices » ou « TD / Exercices » selon le niveau, puis renseignez le public.', 'Joignez un exemple de votre cours pour fixer les notations et les méthodes.', 'Demandez une difficulté progressive et une estimation du temps par exercice.', 'Exigez les étapes du raisonnement, pas seulement les réponses finales.'],
        example: '« Prépare un TD de 90 minutes en licence 1 sur la moyenne et la médiane. Propose quatre exercices : calcul simple, comparaison de deux séries, données avec valeur extrême, puis interprétation critique. Utilise de petits jeux de données que je peux vérifier. Fournis un corrigé détaillé et indique les erreurs fréquentes. »',
      },
      {
        id: 'verification', title: 'Résoudre les exercices avant de les distribuer',
        paragraphs: ['Reprenez chaque énoncé comme le ferait un étudiant. Vérifiez que toutes les données sont présentes, que les notations restent cohérentes et que les solutions respectent les hypothèses. Pour un calcul, refaites l’opération avec un outil indépendant ; pour une étude de texte, revenez au passage original.', 'Ajustez le nombre de questions après cette vérification. Conservez une activité complémentaire pour les étudiants qui terminent tôt et une aide graduée pour ceux qui bloquent. Ces deux extensions gagnent à être préparées à partir du même objectif plutôt qu’en ajoutant un nouveau chapitre.'],
      },
    ],
    faq: [
      { question: 'L’IA peut-elle fournir un corrigé faux ?', answer: 'Oui. Un raisonnement présenté avec assurance peut contenir une erreur ou une donnée incohérente. Résolvez les exercices et contrôlez les résultats avant toute distribution.' },
      { question: 'Comment demander une version plus accessible du TD ?', answer: 'Gardez la compétence visée et précisez l’aide attendue : étapes intermédiaires, exemple résolu, glossaire ou données simplifiées. Vérifiez que cette aide conserve le travail intellectuel recherché.' },
    ],
    related: ['/guides/differenciation-pedagogique-ia', '/guides/examens-corriges-ia', '/guides/preparer-cours-ia'],
  },
  {
    path: '/guides/examens-corriges-ia',
    category: 'Évaluer les apprentissages',
    title: 'Préparer examens, évaluations et corrigés avec une IA — Magistra',
    description: 'Construisez une évaluation ou un examen avec une IA : objectifs, barème, corrigé, temps de passation et contrôle de la cohérence avant diffusion.',
    heading: 'Préparer un examen et son corrigé avec une IA',
    intro: 'Une évaluation doit renseigner sur les apprentissages annoncés, avec des questions compréhensibles et un barème cohérent. Magistra aide à préparer un brouillon d’examen, d’évaluation et de corrigé. Il appartient à l’enseignant de vérifier l’adéquation au programme, l’équité des consignes et la validité des réponses avant la passation.',
    sections: [
      {
        id: 'objectifs', title: 'Relier chaque question à un apprentissage',
        paragraphs: ['Listez d’abord les compétences évaluées et leur poids. Distinguez restitution, application et raisonnement : une accumulation de questions de mémoire ne mesure pas nécessairement la capacité à analyser une situation. Vous pouvez demander à l’IA d’expliciter, pour chaque question, le savoir ou la démarche qu’elle cherche à observer.'],
        bullets: ['Les notions étudiées et les limites du programme.', 'La durée, le matériel autorisé et la forme des réponses.', 'Le nombre de points et la répartition entre compétences.', 'Les adaptations prévues conformément aux décisions de votre établissement.'],
      },
      {
        id: 'bareme', title: 'Construire le barème avec le corrigé',
        paragraphs: ['Préparez les éléments de correction en même temps que les questions. Le barème doit reconnaître les étapes pertinentes du raisonnement, les réponses équivalentes et les unités attendues. Une réponse ouverte appelle des critères explicites plutôt qu’un unique paragraphe modèle.', 'Vérifiez la somme des points, mais aussi leur rapport au travail demandé. Une question très longue ne doit pas peser lourd uniquement parce que l’énoncé est volumineux. En cas de réponses alternatives plausibles, indiquez ce qui permet de les accepter ou de les écarter.'],
      },
      {
        id: 'exemple', title: 'Formuler une demande complète et limitée',
        steps: ['Choisissez l’outil d’évaluation et indiquez le niveau ainsi que la durée.', 'Joignez le chapitre ou les objectifs effectivement travaillés.', 'Demandez un sujet élève séparé du corrigé enseignant.', 'Précisez le barème total et les critères de réussite.'],
        example: '« Propose une évaluation de 45 minutes sur 20 points pour une première, à partir de ces objectifs de chapitre. Prévois une restitution courte, une application et une question de raisonnement. N’introduis aucune notion absente du document. Sépare le sujet et le corrigé, détaille les points et signale les questions pouvant admettre plusieurs formulations. »',
      },
      {
        id: 'controle', title: 'Tester le sujet avant la passation',
        paragraphs: ['Résolvez le sujet sans consulter le corrigé. Vérifiez qu’une question ne révèle pas la réponse d’une autre et que les documents nécessaires sont disponibles. Pour un questionnaire à choix multiples, contrôlez chaque proposition et assurez-vous que le nombre de réponses attendues est annoncé sans ambiguïté.', 'Estimez le temps à partir des tâches réelles : lecture, choix d’une méthode, calcul, rédaction et relecture. Écartez les détails sans rapport avec la compétence évaluée. Conservez ensuite votre version validée ; une nouvelle génération peut modifier des hypothèses et doit faire l’objet d’un nouveau contrôle.'],
      },
    ],
    faq: [
      { question: 'Peut-on distribuer directement le sujet généré ?', answer: 'Une validation enseignante reste nécessaire. Relisez les consignes, résolvez les questions, vérifiez le barème et assurez-vous que l’évaluation porte sur les apprentissages réellement travaillés.' },
      { question: 'L’outil décide-t-il automatiquement des notes des élèves ?', answer: 'Ce guide concerne la préparation de sujets et de corrigés. La décision d’évaluation relève de l’enseignant, avec les critères et procédures de son établissement.' },
    ],
    related: ['/guides/exercices-td-ia', '/guides/differenciation-pedagogique-ia', '/guides/sources-fiabilite-ia'],
  },
  {
    path: '/guides/differenciation-pedagogique-ia',
    category: 'Adapter les supports',
    title: 'Différenciation pédagogique avec une IA — Magistra',
    description: 'Préparez des adaptations pédagogiques avec une IA : objectifs communs, aides graduées, consignes accessibles et vérification des versions avec Magistra.',
    heading: 'Utiliser une IA pour préparer la différenciation pédagogique',
    intro: 'Différencier un support consiste à ajuster les conditions d’apprentissage tout en gardant un objectif lisible. L’outil Différenciation de Magistra, appelé « Adaptations » dans le supérieur, peut aider à préparer plusieurs parcours ou aides. Décrivez les obstacles observés dans une tâche, plutôt que de demander à l’IA de classer les élèves dans des catégories figées.',
    sections: [
      {
        id: 'obstacle', title: 'Identifier ce qui empêche d’entrer dans l’activité',
        paragraphs: ['Un élève peut connaître la notion mais être bloqué par le vocabulaire, la densité du document ou la succession des consignes. Un autre aura besoin de consolider un prérequis. Formulez l’obstacle de manière concrète et observable ; vous pourrez ensuite vérifier si l’adaptation y répond.'],
        bullets: ['Comprendre les mots essentiels de la consigne.', 'Repérer les informations utiles dans un document.', 'Organiser les étapes d’une résolution.', 'Exprimer un raisonnement à l’écrit ou à l’oral.'],
      },
      {
        id: 'objectif-commun', title: 'Garder la même compétence comme point de repère',
        paragraphs: ['Demandez plusieurs modalités d’accès à une même activité, en indiquant ce qui doit rester commun. Pour interpréter un graphique, l’aide peut porter sur la lecture des axes sans fournir directement la conclusion. Pour argumenter, un plan ou une liste de connecteurs peut faciliter la rédaction tout en laissant le choix des arguments.', 'Les aménagements individuels et les besoins particuliers ne se déduisent pas d’un prompt. Appuyez-vous sur vos observations et sur les décisions déjà établies avec les personnes compétentes. Évitez de transmettre des informations personnelles ou médicales inutiles à une génération.'],
      },
      {
        id: 'aides', title: 'Préparer des aides graduées et réversibles',
        steps: ['Partez du support initial et décrivez l’objectif à préserver.', 'Demandez une première aide légère, puis une aide plus guidée.', 'Vérifiez que chaque aide laisse un travail à réaliser par l’apprenant.', 'Prévoyez un prolongement pour ceux qui peuvent aller plus loin.'],
        example: '« À partir de cet exercice de lecture de graphique en quatrième, propose trois aides graduées. L’objectif reste de justifier une comparaison. Première aide : vocabulaire et axes ; deuxième : étapes de lecture ; troisième : exemple sur un autre graphique. Ne donne pas la conclusion de l’exercice. Prévois aussi une question de prolongement. »',
      },
      {
        id: 'verifier', title: 'Comparer les versions avant de les proposer',
        paragraphs: ['Relisez les versions côte à côte. Une simplification peut enlever une donnée essentielle ou modifier involontairement la question. Vérifiez les chiffres, les supports et les termes techniques qui doivent rester identiques. Testez les aides dans l’ordre : certaines devraient suffire sans recourir immédiatement au guidage le plus fort.', 'Présentez les aides comme des ressources disponibles et observez leur usage. Après la séance, notez ce qui a permis aux élèves de progresser. Une adaptation efficace doit pouvoir évoluer ; le support préparé par l’IA est une hypothèse de travail à confronter à la classe.'],
      },
    ],
    faq: [
      { question: 'Différencier signifie-t-il rendre tout plus facile ?', answer: 'L’adaptation peut faciliter l’accès à la tâche sans réduire l’objectif. Elle peut aussi proposer un prolongement plus exigeant. Le critère reste l’apprentissage que vous souhaitez observer.' },
      { question: 'Peut-on demander à l’IA un diagnostic sur un élève ?', answer: 'Ces outils servent à préparer des supports, pas à établir un diagnostic. Décrivez des difficultés observées dans une activité et appliquez les aménagements définis avec les professionnels concernés.' },
    ],
    related: ['/guides/exercices-td-ia', '/guides/preparer-cours-ia', '/guides/examens-corriges-ia'],
  },
  {
    path: '/guides/syllabus-progression-ia',
    category: 'Organiser son enseignement',
    title: 'Construire un syllabus ou une progression avec une IA — Magistra',
    description: 'Planifiez un semestre ou une année avec une IA : objectifs, prérequis, calendrier, cours et TD, évaluations et cohérence du syllabus ou de la progression.',
    heading: 'Construire une progression ou un syllabus avec une IA',
    intro: 'Un syllabus ou une progression met en relation des objectifs, un calendrier et des activités d’apprentissage. L’outil de planification de Magistra aide à organiser une première proposition annuelle ou semestrielle. Le point de départ reste votre programme, votre maquette et le temps réellement disponible, avec des marges pour les imprévus.',
    sections: [
      {
        id: 'contraintes', title: 'Rassembler les contraintes avant de répartir les chapitres',
        paragraphs: ['Indiquez les semaines d’enseignement, le volume horaire, la répartition entre cours et travaux dirigés et les dates d’évaluation déjà fixées. Une liste de chapitres bien présentée peut être irréaliste si elle suppose davantage de séances que votre calendrier n’en comporte.'],
        bullets: ['Les acquis attendus à l’entrée et à la fin du parcours.', 'Les contenus obligatoires et les thèmes facultatifs.', 'Le calendrier réel, avec interruptions et séances indisponibles.', 'Les modalités d’évaluation et le travail personnel prévu.'],
      },
      {
        id: 'dependances', title: 'Organiser les notions selon leurs dépendances',
        paragraphs: ['Demandez d’expliciter les prérequis de chaque étape. Une notion technique doit arriver après les outils nécessaires à sa compréhension. Cette vérification est particulièrement utile lorsque l’IA répartit les thèmes de façon uniforme : tous les chapitres ne demandent pas le même temps, et certains nécessitent des retours réguliers.', 'Dans le supérieur, reliez les séances de TD aux notions abordées en cours magistral. Précisez ce que les étudiants doivent préparer avant la séance et ce qui sera travaillé ensemble. Une charge de travail annoncée doit rester compatible avec le reste de leur formation.'],
      },
      {
        id: 'demande', title: 'Produire un tableau de travail, puis le corriger',
        steps: ['Joignez le programme ou la maquette et indiquez le calendrier.', 'Demandez une répartition par semaine avec objectifs et activités.', 'Faites apparaître les évaluations et une marge de reprise.', 'Contrôlez le total d’heures et déplacez les étapes mal placées.'],
        example: '« Construis un premier syllabus de licence 2 sur 12 semaines, avec 18 heures de cours et 12 heures de TD, à partir de cette maquette. Pour chaque semaine, indique les objectifs, les prérequis et l’activité de TD. Prévois deux évaluations et une séance de reprise. Signale les contenus qui ne tiennent pas dans ce volume plutôt que de les ajouter. »',
      },
      {
        id: 'publication', title: 'Transformer la proposition en document fiable pour les étudiants',
        paragraphs: ['Vérifiez l’alignement entre objectifs, activités et évaluations. Si une compétence est annoncée mais n’apparaît jamais dans les séances, la progression doit être revue. Identifiez aussi les périodes trop chargées, les lectures indispensables et les moments où un bilan des acquis permettra d’ajuster la suite.', 'Avant de partager le syllabus, confirmez les horaires, règles et modalités d’évaluation avec vos documents institutionnels. L’IA ne connaît pas vos décisions locales si vous ne les fournissez pas. Conservez une version datée et mettez à jour les changements pour que les étudiants disposent d’un repère clair.'],
      },
    ],
    faq: [
      { question: 'Le syllabus généré respecte-t-il automatiquement ma maquette ?', answer: 'Il faut joindre la maquette et vérifier chaque contrainte. Une IA peut omettre une exigence ou répartir incorrectement les heures ; la validation appartient à l’équipe pédagogique.' },
      { question: 'Peut-on utiliser cet outil pour une progression scolaire ?', answer: 'Oui. Précisez le niveau, le programme, les périodes et les contraintes du calendrier. Adaptez ensuite la proposition aux acquis de vos élèves et à la progression de votre établissement.' },
    ],
    related: ['/guides/preparer-cours-ia', '/guides/exercices-td-ia', '/guides/examens-corriges-ia'],
  },
  {
    path: '/guides/pdf-scannes-documents',
    category: 'Documents et sources',
    title: 'PDF scannés et documents : lecture OCR dans Magistra',
    description: 'Comprenez la différence entre PDF texte et PDF scanné, la reconnaissance OCR locale, ses limites et les vérifications utiles avant une génération dans Magistra.',
    heading: 'Utiliser vos PDF, même lorsqu’ils contiennent des pages scannées',
    intro: 'Un PDF peut contenir du texte sélectionnable, des images de pages ou un mélange des deux. Un message indiquant qu’il n’y a pas de texte sélectionnable ne signifie pas que le fichier est vide. La lecture des pages scannées nécessite une reconnaissance de caractères, appelée OCR, puis une vérification du texte reconnu.',
    sections: [
      {
        id: 'texte-scan', title: 'Identifier ce que contient le PDF',
        paragraphs: ['Ouvrez le document et essayez de sélectionner une phrase. Si chaque page se comporte comme une image, il s’agit probablement d’un scan sans couche de texte. Certains documents possèdent déjà une couche OCR, parfois incomplète ; le fait de pouvoir sélectionner du texte ne garantit donc pas que les caractères reconnus sont corrects.', 'Magistra extrait le texte disponible et peut utiliser une reconnaissance locale pour les pages qui en ont besoin. Les langues de reconnaissance prévues incluent le français, l’anglais et le japonais. La qualité dépend du fichier, de la netteté et de la mise en page.'],
      },
      {
        id: 'preparer-fichier', title: 'Préparer un document facile à lire',
        bullets: ['Privilégiez un scan net, droit et suffisamment contrasté.', 'Évitez les photos avec ombres, reflets ou bords de page coupés.', 'Utilisez un document sans mot de passe si vous devez en extraire le contenu.', 'Pour un long dossier, sélectionnez les pages nécessaires à votre demande.'],
        paragraphs: ['Les colonnes, tableaux, formules et annotations manuscrites demandent une attention particulière. L’ordre de lecture peut être imparfait même lorsque les mots sont reconnus. Une photographie moins compressée ou une nouvelle numérisation peut améliorer le résultat davantage qu’une simple relance de l’analyse.'],
      },
      {
        id: 'controle-lecture', title: 'Vérifier les informations avant la génération',
        steps: ['Ajoutez le fichier dans Magistra et attendez la fin de son analyse.', 'Lisez les avertissements : certaines pages peuvent être incomplètes ou non reconnues.', 'Comparez quelques passages avec le PDF original, notamment les données importantes.', 'Indiquez à l’IA les pages ou sections à utiliser et les éléments à ignorer.'],
        example: 'Pour une fiche de vocabulaire japonais, vérifiez quelques mots, leur lecture et leur traduction avant de demander des exercices. Une confusion entre deux caractères ou une ligne déplacée pourrait produire une série d’activités cohérente en apparence, mais fondée sur une mauvaise transcription.',
      },
      {
        id: 'limites', title: 'Traiter les cas difficiles sans supposer que tout a été lu',
        paragraphs: ['Un document très long peut atteindre des limites de traitement ; un scan peu lisible peut échouer sur certaines pages. Les pages exploitables peuvent néanmoins être conservées. Les avertissements servent à distinguer une lecture partielle d’un contenu intégralement disponible.', 'Si une information essentielle manque, ajoutez un extrait plus court, fournissez un PDF avec texte ou recopiez le passage après vérification. L’OCR est local, mais si vous sélectionnez ensuite un fournisseur API, les extraits utilisés pour la génération lui sont transmis. Le mode de lecture du document et le mode de génération sont deux choix distincts.'],
      },
    ],
    faq: [
      { question: 'La reconnaissance OCR garantit-elle une copie exacte ?', answer: 'Non. Des erreurs restent possibles, notamment sur les nombres, tableaux, formules ou caractères japonais. Vérifiez les passages dont dépend votre activité et corrigez les informations importantes.' },
      { question: 'Pourquoi une page de PDF peut-elle ne pas être lue ?', answer: 'Elle peut être trop floue, protégée, mal encodée ou dépasser une limite de traitement. Consultez les avertissements et essayez un extrait plus net ou un document avec texte sélectionnable.' },
    ],
    related: ['/guides/preparer-cours-ia', '/guides/ia-locale-hors-ligne', '/guides/sources-fiabilite-ia'],
  },
  {
    path: '/guides/ia-locale-hors-ligne',
    category: 'Choisir son IA',
    title: 'IA locale et hors ligne pour enseignants — Magistra',
    description: 'Utilisez une IA locale dans Magistra : installation du moteur et du modèle, mode hors ligne, performances et premier essai sur Windows.',
    heading: 'Utiliser une IA locale, y compris sans Internet',
    intro: 'Avec une IA locale, le modèle qui produit les réponses fonctionne sur votre ordinateur. Magistra permet ce mode pour préparer vos supports sans passer par un fournisseur API. Il faut d’abord installer le moteur et télécharger un modèle ; ensuite, la génération locale peut fonctionner hors ligne si l’environnement est prêt.',
    sections: [
      {
        id: 'ce-qui-est-local', title: 'Distinguer la génération locale des fonctions en ligne',
        paragraphs: ['Le moteur exécute le modèle sur votre machine et utilise ses ressources. Cette configuration demande une installation initiale plus importante qu’une simple connexion API. Elle peut convenir lorsque vous souhaitez travailler sans connexion pendant la préparation, avec vos propres documents comme base.', 'Le téléchargement de Magistra, du moteur et du modèle nécessite Internet. La recherche de publications ou de pages Web, ainsi que la recherche de mises à jour, restent aussi des fonctions en ligne. Choisir l’IA locale ne rend pas une recherche sur Internet disponible hors connexion.'],
      },
      {
        id: 'ordinateur', title: 'Choisir un modèle adapté à votre ordinateur',
        paragraphs: ['La mémoire disponible, la puissance du processeur et les ressources graphiques influencent la vitesse. Un modèle plus volumineux peut demander davantage de mémoire et de temps ; il n’est pas automatiquement le bon choix pour chaque préparation. Commencez par l’option conseillée dans l’application et une demande courte.', 'Fermez les programmes inutiles si votre ordinateur manque de ressources. Une génération longue mobilise davantage le modèle qu’un plan de séance. Si le résultat devient lent, réduisez la quantité de documents et traitez une partie du travail à la fois, sans perdre les objectifs essentiels.'],
      },
      {
        id: 'demarrage', title: 'Préparer et tester le mode hors ligne',
        steps: ['Installez Magistra depuis le site officiel sur Windows 10 ou 11 en 64 bits.', 'Avec Internet, activez l’IA locale et attendez la fin des téléchargements.', 'Vérifiez dans l’application que l’IA est prête, puis lancez une petite génération.', 'Testez ensuite une demande sans recherche Web après avoir coupé la connexion.', 'Gardez à disposition les documents nécessaires à votre séance de travail.'],
        example: 'Avant de préparer un cours pendant un déplacement, réalisez un essai avec un document court déjà enregistré. Demandez un plan de 30 minutes, vérifiez que la réponse arrive et enregistrez votre travail. Vous saurez ainsi si le modèle et les supports sont réellement disponibles hors ligne.',
      },
      {
        id: 'choisir-mode', title: 'Passer à une API lorsque ce mode vous convient mieux',
        paragraphs: ['Une clé personnelle peut être une solution si votre machine n’a pas les ressources nécessaires ou si vous préférez utiliser un service en ligne. OpenAI, Mistral, Gemini et Anthropic sont proposés dans Magistra. Les consignes et les extraits utilisés pour générer sont alors transmis au fournisseur ; la connexion et les quotas de ce compte deviennent nécessaires.', 'Quel que soit le mode choisi, les contenus restent à vérifier. Le lieu d’exécution du modèle ne garantit ni la justesse d’un calcul ni la fiabilité d’une référence. Relisez les productions et utilisez les mêmes critères pédagogiques que pour un support préparé à la main.'],
      },
    ],
    faq: [
      { question: 'L’IA locale fonctionne-t-elle dès l’installation de Magistra ?', answer: 'Il faut activer le moteur et télécharger un modèle. Vérifiez que l’application indique une IA prête avant de compter sur la génération hors ligne.' },
      { question: 'Puis-je rechercher des sources académiques hors ligne ?', answer: 'La recherche de sources en ligne exige Internet. Hors connexion, préparez vos documents à l’avance et travaillez sur les informations déjà disponibles sur votre ordinateur.' },
    ],
    related: ['/guides/installer-magistra-windows', '/guides/cles-api-ia', '/guides/pdf-scannes-documents'],
  },
  {
    path: '/guides/cles-api-ia',
    category: 'Choisir son IA',
    title: 'Clé API OpenAI, Mistral, Gemini ou Anthropic dans Magistra',
    description: 'Configurez une clé API personnelle dans Magistra : choix du fournisseur et du modèle, frais, confidentialité, dépannage et retour à l’IA locale.',
    heading: 'Utiliser votre clé API dans Magistra',
    intro: 'Une clé API permet à Magistra de demander une génération à un fournisseur en ligne, sans installer de moteur IA sur votre ordinateur. Les fournisseurs proposés sont OpenAI, Mistral, Gemini et Anthropic. L’application reste gratuite ; l’accès au modèle, les frais et les quotas dépendent de votre compte chez le fournisseur choisi.',
    sections: [
      {
        id: 'avant-configuration', title: 'Vérifier l’accès API et les coûts de votre compte',
        paragraphs: ['Un abonnement à une interface de conversation ne signifie pas nécessairement que vous disposez de crédits API. Consultez votre compte fournisseur pour créer une clé, vérifier la facturation et connaître les modèles auxquels vous avez accès. Les offres évoluent ; utilisez les informations actuelles de ce compte plutôt qu’un tarif recopié dans un ancien guide.', 'Définissez un budget ou des limites lorsque le fournisseur les propose. Une génération longue et des documents volumineux peuvent utiliser davantage de ressources. Pour découvrir le mode API, commencez avec un support court, sans donnée personnelle et avec un objectif bien délimité.'],
      },
      {
        id: 'configuration', title: 'Enregistrer le fournisseur, le modèle et la clé',
        steps: ['Ouvrez les réglages de Magistra, dans « IA avec une clé API personnelle ».', 'Choisissez OpenAI, Mistral, Gemini ou Anthropic.', 'Vérifiez le nom du modèle proposé et son accès dans votre compte.', 'Collez la clé dans le champ prévu, puis utilisez « Enregistrer et utiliser l’API ».', 'Attendez le résultat du contrôle et lancez une petite génération de test.'],
        paragraphs: ['Une seule configuration en ligne est conservée à la fois. Changer de fournisseur remplace la précédente. La clé est chiffrée sur cet ordinateur et n’est pas affichée en clair après l’enregistrement. Ne la recopiez pas dans une consigne, un document, un courriel ou une capture d’écran.'],
      },
      {
        id: 'donnees', title: 'Comprendre quelles informations partent vers le fournisseur',
        paragraphs: ['En mode API, les consignes et les extraits de documents utilisés pour générer sont envoyés au fournisseur sélectionné. Le fait que l’application soit installée sur votre PC ne rend pas cette génération entièrement locale. Vérifiez les conditions de traitement du fournisseur et les règles de votre établissement avant d’utiliser des contenus sensibles.'],
        example: 'Pour tester une évaluation, utilisez une fiche de chapitre sans noms d’élèves. Demandez trois questions et un corrigé court. Vérifiez la réponse, puis consultez les informations de consommation dans votre compte API. Vous pourrez ajuster votre usage avant d’envoyer une préparation plus volumineuse.',
      },
      {
        id: 'depannage-retour', title: 'Résoudre un refus d’accès ou revenir au mode local',
        paragraphs: ['En cas d’échec, vérifiez la connexion, la validité de la clé, le modèle sélectionné et les crédits ou quotas disponibles. Une erreur de modèle ne se corrige pas en répétant une longue génération. Consultez le message affiché et le tableau de bord du fournisseur, sans partager votre clé pour demander de l’aide.', 'Le bouton « Utiliser l’IA locale » permet de changer de mode tout en conservant la configuration en ligne pour plus tard. « Supprimer la clé API » retire la clé et sa configuration de Magistra. Si une clé a été divulguée, révoquez-la également dans votre compte fournisseur.'],
      },
    ],
    faq: [
      { question: 'La clé API est-elle obligatoire ?', answer: 'Non. Vous pouvez choisir une IA locale. Le mode API est une possibilité supplémentaire, utile si vous préférez un service en ligne ou ne souhaitez pas installer de moteur local.' },
      { question: 'Est-ce que l’API fonctionne sans Internet ?', answer: 'Non. Elle contacte le fournisseur choisi. Le mode local constitue l’option permettant une génération hors ligne après installation du moteur et du modèle.' },
    ],
    related: ['/guides/ia-locale-hors-ligne', '/guides/ia-gratuite-enseignants', '/guides/sources-fiabilite-ia'],
  },
  {
    path: '/guides/installer-magistra-windows',
    category: 'Installer et mettre à jour',
    title: 'Installer Magistra sur Windows 10 et 11 — Guide officiel',
    description: 'Installez Magistra sur Windows 10 ou 11 en 64 bits, configurez une IA locale ou une clé API et vérifiez votre première préparation pédagogique.',
    heading: 'Installer Magistra sur Windows et lancer votre première préparation',
    intro: 'Magistra est une application gratuite pour Windows 10 et Windows 11 en 64 bits. Le site officiel propose l’installateur de la version publiée. Après l’installation, vous choisissez comment utiliser l’IA : un moteur local sur votre ordinateur ou une clé personnelle chez OpenAI, Mistral, Gemini ou Anthropic.',
    sections: [
      {
        id: 'preparer-installation', title: 'Vérifier l’ordinateur et la source du téléchargement',
        paragraphs: ['Utilisez le lien de téléchargement du site officiel de Magistra. Vérifiez que votre ordinateur utilise bien une version Windows en 64 bits et qu’il dispose d’espace pour l’application. Si vous choisissez une IA locale, prévoyez aussi la place nécessaire au moteur et au modèle : ces téléchargements sont distincts de l’installateur.', 'Sur un poste d’établissement, les règles d’installation peuvent être gérées par le service informatique. Suivez la procédure habituelle de votre organisation. Si Windows ou un outil de sécurité affiche un message, lisez-le et vérifiez la provenance du fichier ; ne désactivez pas systématiquement les protections.'],
      },
      {
        id: 'installation', title: 'Télécharger, ouvrir puis configurer Magistra',
        steps: ['Ouvrez la section « Magistra pour Windows » sur le site officiel.', 'Téléchargez l’installateur proposé et attendez la fin du téléchargement.', 'Ouvrez le fichier téléchargé et suivez les étapes affichées.', 'Lancez Magistra et renseignez le contexte pédagogique utile à vos préparations.', 'Choisissez l’IA locale ou une clé API personnelle, puis vérifiez que l’IA est prête.'],
        paragraphs: ['Si une ancienne version de Magistra est déjà ouverte, enregistrez votre travail et fermez l’application avant d’installer la version téléchargée. Pour une mise à jour, utilisez la procédure dédiée : une désinstallation préalable n’est pas une étape normale de cette démarche.'],
      },
      {
        id: 'premier-essai', title: 'Faire un essai simple avant d’ajouter un long document',
        paragraphs: ['En mode local, activez le moteur et le modèle avec une connexion Internet, puis attendez la fin des téléchargements. En mode API, enregistrez le fournisseur, le modèle et votre clé dans les réglages. Une configuration enregistrée ne suffit pas si le modèle n’est pas accessible ou si un téléchargement est encore en cours.'],
        example: 'Commencez par demander un plan de séance sur une notion que vous maîtrisez, pour un niveau précis et une durée de 30 minutes. Relisez les objectifs et les activités proposées. Ajoutez ensuite une petite fiche de cours pour vérifier la lecture des documents avant de préparer un dossier complet.',
      },
      {
        id: 'apres-installation', title: 'Identifier les prochaines étapes et les éventuels blocages',
        paragraphs: ['Si la génération ne démarre pas, regardez d’abord l’état de l’IA dans l’application. Selon le mode choisi, un moteur manquant, une connexion absente ou une clé refusée ne demandent pas la même solution. Conservez le message affiché pour comprendre la cause, sans y ajouter de clé ou de contenu personnel.', 'Une fois le premier essai validé, préparez un cours, un TD ou un corrigé à partir de vos propres supports. Vérifiez toujours le résultat avant de l’utiliser. Consultez régulièrement les mises à jour dans les réglages pour bénéficier des corrections disponibles sur le site officiel.'],
      },
    ],
    faq: [
      { question: 'Existe-t-il une version officielle pour macOS ou Linux ?', answer: 'L’installateur actuellement proposé sur ce site concerne Windows 10 et Windows 11 en 64 bits. Vérifiez les plateformes annoncées sur le site avant de télécharger une application ailleurs.' },
      { question: 'Dois-je créer un compte Magistra ?', answer: 'L’application peut être utilisée sans compte Magistra. Si vous choisissez une API personnelle, son fournisseur nécessite un compte et une clé selon ses propres conditions.' },
    ],
    related: ['/guides/ia-locale-hors-ligne', '/guides/cles-api-ia', '/guides/mise-a-jour-magistra'],
  },
  {
    path: '/guides/mise-a-jour-magistra',
    category: 'Installer et mettre à jour',
    title: 'Mettre à jour Magistra sur Windows et résoudre un blocage',
    description: 'La procédure officielle pour mettre à jour Magistra depuis l’application, comprendre le cas des versions 2.0.7 à 2.0.9 et conserver vos données.',
    heading: 'Mettre à jour Magistra et comprendre les anciennes versions',
    intro: 'Les mises à jour apportent des corrections et des améliorations à Magistra. La version disponible est annoncée dans l’application et sur la page de téléchargement officielle. Avant une installation, enregistrez votre travail : Magistra doit se fermer pour remplacer ses fichiers. La procédure dépend notamment de la version déjà installée.',
    sections: [
      {
        id: 'version-installee', title: 'Comparer la version installée à la version proposée',
        paragraphs: ['Ouvrez les réglages et utilisez « Rechercher une mise à jour ». L’application indique la version installée et celle qui est disponible. Une mention des versions 2.0.7 à 2.0.9 dans une aide désigne les anciennes versions concernées par un blocage ; elle ne désigne pas nécessairement la dernière version à télécharger.', 'La correction du parcours de mise à jour a été publiée avec la version 2.0.10. Pour connaître la version la plus récente aujourd’hui, fiez-vous à l’information de l’application et de la page officielle, plutôt qu’à un numéro repris dans un ancien message.'],
      },
      {
        id: 'versions-corrigees', title: 'Utiliser la mise à jour depuis une version corrigée',
        steps: ['Enregistrez les préparations en cours et vérifiez votre connexion Internet.', 'Dans les réglages, recherchez la mise à jour puis utilisez le bouton proposé.', 'Attendez la fin du téléchargement sans lancer une seconde installation.', 'Suivez les étapes affichées ; l’application peut se fermer pour installer la version.', 'Rouvrez Magistra et vérifiez le numéro de version ainsi que vos réglages.'],
        paragraphs: ['Le téléchargement a besoin d’espace disque et d’une connexion disponible. Si une erreur apparaît, relevez son texte et vérifiez ces conditions. Évitez de multiplier les clics pendant le téléchargement : une nouvelle tentative doit intervenir après avoir compris l’état affiché.'],
      },
      {
        id: 'versions-anciennes', title: 'Faire le passage nécessaire depuis les versions 2.0.7 à 2.0.9',
        paragraphs: ['Pour ces anciennes versions, ouvrez Réglages → Rechercher une mise à jour, puis « Ouvrir la page de la nouvelle version ». Téléchargez l’installateur officiel proposé, enregistrez votre travail, fermez Magistra et ouvrez le fichier téléchargé. Ce passage permet d’installer une version dont le mécanisme de mise à jour a été corrigé.', 'Les documents, réglages, clés API et modèles sont conservés par cette procédure de mise à jour. Il n’est pas nécessaire de supprimer vos dossiers ou vos modèles pour appliquer le correctif. Comme pour toute installation, une sauvegarde de vos travaux importants reste une bonne pratique.'],
        example: 'Si vous avez Magistra 2.0.9 et que la page parle de « versions 2.0.7 à 2.0.9 », vous êtes dans le cas décrit. Téléchargez la version effectivement proposée par le bouton Windows ; le texte explique votre point de départ, pas un retour vers une ancienne version.',
      },
      {
        id: 'incident', title: 'En cas de nouvel incident, conserver une information utile',
        paragraphs: ['Notez le numéro installé, la version proposée, le message exact et le moment de l’échec : recherche, téléchargement ou installation. Ces éléments permettent de distinguer un problème de connexion d’un refus d’exécuter le fichier. Ne transmettez jamais votre clé API dans une capture ou un message d’assistance.', 'Le site officiel reste une possibilité de réinstallation de la version publiée si le parcours automatique rencontre un incident. Utilisez la même précaution : travail enregistré, application fermée et fichier obtenu depuis la page officielle.'],
      },
    ],
    faq: [
      { question: 'Une mise à jour supprime-t-elle mes modèles IA ?', answer: 'La procédure de mise à jour conserve les modèles, documents, réglages et clés API. Enregistrez toutefois votre travail avant l’installation, car l’application doit se fermer.' },
      { question: 'Pourquoi l’aide mentionne-t-elle encore la version 2.0.9 ?', answer: 'Elle décrit la plage des anciennes versions touchées par un problème de mise à jour. La dernière version à installer est celle annoncée par l’application et par le téléchargement officiel.' },
    ],
    related: ['/guides/installer-magistra-windows', '/guides/ia-locale-hors-ligne', '/guides/cles-api-ia'],
  },
  {
    path: '/guides/sources-fiabilite-ia',
    category: 'Documents et sources',
    title: 'Vérifier les sources et la fiabilité d’un cours généré par IA',
    description: 'Vérifiez un support pédagogique créé avec une IA : documents prioritaires, recherche académique, références, calculs et séparation des faits et propositions.',
    heading: 'Vérifier les sources et la fiabilité des contenus générés',
    intro: 'Une réponse bien rédigée n’est pas une preuve de justesse. Pour préparer un support pédagogique avec une IA, combinez un contexte précis, des sources identifiables et une relecture méthodique. Magistra permet de partir de vos documents et, si vous activez la recherche, de compléter la préparation avec des sources en ligne.',
    sections: [
      {
        id: 'documents-prioritaires', title: 'Donner un rôle clair à vos documents',
        paragraphs: ['Distinguez le programme qui fixe les contenus, le cours qui donne les notations et les documents qui apportent des exemples. Précisez la priorité en cas de différence entre deux textes. Pour un long fichier, indiquez le chapitre concerné : la quantité de documents ne remplace pas la pertinence des passages effectivement disponibles.', 'Vérifiez les avertissements de lecture, en particulier pour un PDF scanné. Si un extrait a été mal reconnu ou si des pages n’ont pas été lues, la génération peut manquer d’informations. Revenez au document original pour contrôler les données centrales.'],
      },
      {
        id: 'recherche', title: 'Comprendre ce que la recherche en ligne apporte',
        paragraphs: ['Selon le sujet et la disponibilité des services, Magistra peut récupérer des publications via HAL, Crossref et OpenAlex, ainsi que des pages de sites institutionnels reconnus, notamment Éduscol, les ministères, l’UNESCO ou le CNRS. La sélection effective dépend de la demande et du mode de recherche.', 'Une notice bibliographique indique l’existence d’une publication ; elle ne signifie pas que son texte complet a été lu. L’IA reçoit les extraits disponibles pour étayer la préparation. Si Wikipédia complète une recherche, considérez cette encyclopédie comme un point de départ à recouper.'],
      },
      {
        id: 'controle', title: 'Utiliser une vérification courte mais systématique',
        steps: ['Repérez les faits, dates, chiffres, citations et affirmations techniques.', 'Ouvrez les références et cherchez le passage qui soutient chaque point essentiel.', 'Refaites les calculs et vérifiez les unités, les hypothèses et les notations.', 'Distinguez les informations sourcées des exemples inventés pour la pédagogie.', 'Retirez ou reformulez les points qui ne peuvent pas être confirmés.'],
        example: 'Pour un cours sur une étude scientifique, vérifiez la population étudiée, la date et les limites avant de reprendre une conclusion. Une corrélation trouvée dans un résumé ne suffit pas à affirmer une causalité. Demandez à l’IA de signaler les informations manquantes, puis consultez la publication disponible.',
      },
      {
        id: 'validation', title: 'Valider le support selon son usage en classe',
        paragraphs: ['Le degré de contrôle dépend de la tâche : une idée d’activité exige une vérification pédagogique ; un corrigé de calcul exige une résolution indépendante ; une référence bibliographique exige une vérification de son existence et de son contenu. Demander à la même IA si elle est certaine ne remplace pas ces contrôles.', 'Conservez les références utiles avec votre version finale et adaptez le langage au public. Si une information reste incertaine, marquez-la dans vos notes ou écartez-la du support distribué. La génération sert à préparer ; votre validation transforme le brouillon en ressource enseignable.'],
      },
    ],
    faq: [
      { question: 'Une liste de références garantit-elle la fiabilité du cours ?', answer: 'Non. Vérifiez que les références existent, qu’elles correspondent au sujet et que leur contenu soutient les affirmations retenues. Une source citée peut être mal interprétée.' },
      { question: 'Le mode local produit-il moins d’erreurs qu’une API ?', answer: 'Le lieu d’exécution ne garantit pas la justesse. Le modèle, les documents et la demande influencent la réponse. Dans les deux modes, contrôlez les faits et les raisonnements importants.' },
    ],
    related: ['/guides/pdf-scannes-documents', '/guides/preparer-cours-ia', '/guides/examens-corriges-ia'],
  },
];

export function getSiteGuide(path: string): SiteGuideData | undefined {
  return SITE_GUIDES.find(guide => guide.path === path);
}
