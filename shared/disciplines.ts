// Règles propres à chaque discipline : ce qui rend un document « carré, précis » dans la matière (notations, terminologie,
// démarche, normes de présentation), d'après les programmes et référentiels officiels. Une règle générale (« default »)
// et, au besoin, des variantes par groupe de niveau (« groups ») qui la remplacent. Chaque règle tient en une ligne
// (300 caractères au plus : elle est ajoutée au prompt de chaque génération, donc comptée dans le budget de tokens).
// Les sources officielles consultées figurent en commentaire, à la fin de chaque entrée, pour les mainteneurs.
// La règle d'une matière de langue vient en complément de la règle de langue (shared/prompts/index.ts, languageRule) :
// elle ne dit jamais dans quelle langue écrire, seulement ce qui est exact dans la langue étudiée.

import type { Matiere } from './catalog.js';
import type { LevelGroup } from './levels.js';

export interface DisciplineRule {
  /** Règle valable pour tous les niveaux sans variante propre. Vide : aucune règle (matière « autre »). */
  default: string;
  /** Variantes par groupe de niveau, qui remplacent la règle par défaut. */
  groups?: Partial<Record<LevelGroup, string>>;
}

/** Longueur maximale d'une règle, en caractères. */
export const DISCIPLINE_RULE_MAX_CHARS = 300;

export const DISCIPLINES: Record<Matiere, DisciplineRule> = {
  mathematiques: {
    default: "Notations françaises : virgule décimale, intervalles $[a\\,;\\,b]$, $\\mathbb{R}$, $\\vec{u}$, $P(A)$. Calculs exacts (fractions, radicaux) avant tout arrondi, précision indiquée. Démonstration : hypothèses, théorème nommé, conclusion. Unités écrites.",
    groups: {
      maternelle: "Premiers outils mathématiques : comparer, dénombrer, constituer des collections ; formes, grandeurs, tris, suites organisées ; jeux et manipulation, matériel nommé. Aucun calcul posé ni exercice écrit de calcul.",
      elementaire: "Domaines des cycles 2-3 : nombres et calcul, grandeurs et mesures, espace et géométrie, organisation et gestion de données ; résolution de problèmes. Calcul mental, en ligne, posé ; schéma en barres pour modéliser ; nombres simples, unités écrites.",
      college: "Cycles 3-4 : automatismes (calcul mental, fractions, pourcentages, proportionnalité) ; chaque étape justifiée ; notation $f(x)$, valeur exacte puis arrondie, unités écrites ; algorithmique en Scratch ou Python ; figures aux points nommés et codées.",
      lycee: "Automatismes ; démonstrations complètes avec propriété ou théorème nommé ; notations $\\mathbb{R}$, $f'(x)$, $\\vec{u}$, $P_A(B)$ ; Python pour programmer et simuler ; valeurs exactes avant l'arrondi ; en évaluation, calculatrice autorisée ou non précisée.",
      lycee_pro: "Situations professionnelles et de la vie courante ; proportionnalité, pourcentages, grandeurs et unités, fonctions, statistiques ; tableur et calculatrice ; résultat arrondi avec unité et phrase de conclusion.",
      bts_but: "Mathématiques outils de la spécialité : modéliser une situation professionnelle, calculer (valeurs exactes puis approchées, unités), interpréter le résultat dans son contexte ; tableur ou Python ; notations rigoureuses.",
      cpge: "Rigueur de classe préparatoire : quantificateurs explicites, démonstrations complètes (récurrence, analyse-synthèse), théorèmes cités avec hypothèses vérifiées ; notations $\\mathbb{K}$, $\\mathcal{M}_n(\\mathbb{R})$, $o$, $O$ ; Python pour calculer et simuler.",
      licence: "Définitions et énoncés exacts, quantificateurs explicites ; démonstrations complètes citant les théorèmes avec hypothèses vérifiées ; contre-exemples ; condition nécessaire, suffisante, équivalence distinguées ; notations $\\forall$, $\\exists$, $\\varepsilon$.",
      master: "Énoncés précis (cadre, hypothèses minimales), démonstrations rigoureuses ; distinguer résultat démontré, admis, conjecturé ; énonce chaque théorème cité avec ses hypothèses ; notations cohérentes, structures et espaces utilisés explicités.",
      doctorat: "Énoncés précis (cadre, hypothèses minimales), démonstrations rigoureuses ; distinguer résultat démontré, admis, conjecturé ; énonce chaque théorème cité avec ses hypothèses ; notations cohérentes, limites de validité des méthodes indiquées.",
    },
  }, // sources : https://www.education.gouv.fr/media/227316/download ; https://eduscol.education.gouv.fr/media/126080/download?attachment= ; https://www.education.gouv.fr/sites/default/files/document/CSP%20-%20Projets%20de%20programme%20de%20math%C3%A9matiques%20du%20cycle%203%20-%20d%C3%A9cembre%202024-405042.pdf ; https://www.education.gouv.fr/sites/default/files/document/Annexe%202%20%E2%80%93%20Programme%20d%E2%80%99enseignement%20pour%20l%E2%80%99acquisition%20des%20premiers%20outils%20math%C3%A9matiques%20du%20cycle%201-403815.pdf
  statistiques: {
    default: "Distinguer population, échantillon, variable, paramètre, estimateur ; notations $\\bar{x}$, $\\sigma$, $s$, $H_0$, $\\alpha$ ; hypothèses des tests vérifiées ; p-valeur et intervalles interprétés sans causalité abusive ; données fictives annoncées ; R ou Python.",
    groups: {
      bts_but: "Statistique appliquée : indicateurs (moyenne, médiane, écart type, quartiles), graphique adapté, lecture critique ; régression, intervalle de confiance, tests simples ; tableur, R ou Python ; résultats interprétés en contexte ; données fictives annoncées.",
    },
  }, // sources : https://www.enseignementsup-recherche.gouv.fr/sites/default/files/2023-12/science-des-donn-es-30879.pdf
  informatique: {
    default: "Code complet, exécutable, indenté, en bloc de code, noms explicites, commentaires utiles, exemple d'appel et sortie attendue exacte ; Python par défaut ; complexité en $O(\\cdot)$ ; distinguer spécification, algorithme, implémentation ; entrées validées.",
    groups: {
      bts_but: "Mise en situation professionnelle : cahier des charges, jeu d'essai, code court exécutable (Python, SQL, web selon le cours), tests, versionnement, sécurité et protection des données.",
    },
  }, // sources : https://www.enseignementsup-recherche.gouv.fr/sites/default/files/annexe-2-licence-professionnelle-bachelor-universitaire-de-technologie-informatique-29016.pdf
  nsi: {
    default: "Python 3 et SQL. Code complet, exécutable, avec docstring (rôle, préconditions, postconditions), assertions et jeu de tests. Première : listes, tuples, dictionnaires, tris. Terminale : POO, piles, files, arbres, graphes, récursivité, SQL.",
  }, // sources : https://sti.eduscol.education.fr/formations/bac-voie-generale/specialite-nsi-numerique-et-sciences-informatiques ; https://eduscol.education.gouv.fr/
  sciences_numeriques: {
    default: "SNT de seconde : vocabulaire exact, Python très simple. Sept thèmes : internet, web, réseaux sociaux, données structurées, localisation-cartographie-mobilité, informatique embarquée et objets connectés, photographie numérique ; enjeux : données personnelles.",
  }, // sources : https://groupe-reussite.fr/ressources/programme-seconde-snt/ ; https://www.nsi-lycee.fr/blog/le-programme-snt-en-seconde-tout-comprendre ; https://www.snes.edu/IMG/pdf/snt_annexe_2e_bo.pdf
  systemes_information: {
    default: "Distinguer système d'information et système informatique ; modéliser données et processus (MCD, MLD, UML selon le cours) ; SQL standard (SELECT, JOIN, GROUP BY) ; disponibilité, intégrité, confidentialité ; RGPD ; organisation fictive présentée comme telle.",
    groups: {
      bts_but: "Situations professionnelles d'une organisation fictive : support et services informatiques, administration systèmes et réseaux ou développement d'applications, cybersécurité ; incidents, procédures, SQL.",
    },
  }, // sources : https://www.reseaucerta.org/sites/default/files/sio/GuideAccompagnement16mars.pdf ; https://www.reseaucerta.org/sites/default/files/formationsiec/SIEC7MAI-SISR-BLOC3.pdf
  sciences_ingenieur: {
    default: "Ingénierie système : besoin, exigences, performances attendues puis mesurées ou simulées, écarts commentés. Chaîne d'information (acquérir, traiter, communiquer) et d'énergie (alimenter, distribuer, convertir, transmettre) ; SysML selon le cours ; unités SI.",
    groups: {
      bts_but: "Étude d'un système technique réel : cahier des charges, exigences, modèle, simulation, validation expérimentale, écart et conclusion ; chaînes d'information et d'énergie, schémas normalisés ; grandeurs en unités SI, valeurs plausibles.",
      cpge: "Sciences industrielles de l'ingénieur : modélisation (schémas-blocs, fonctions de transfert, transformée de Laplace, cinématique, dynamique), performances en précision, rapidité, stabilité ; écarts entre modèle, simulation et mesure ; unités SI.",
    },
  }, // sources : https://sti.eduscol.education.fr/formations/bac-voie-generale/specialite-si-sciences-de-lingenieur ; https://sti.eduscol.education.fr/textes/programme-de-sciences-de-lingenieur-de-premiere-et-terminale-generales-0 ; https://www.schoolmouv.fr/cours/le-sysml/fiche-de-cours
  physique_chimie: {
    default: "Grandeurs en italique, unités SI en romain précédées d'une espace ($\\mathrm{m\\cdot s^{-1}}$). Formule littérale, application numérique, résultat avec unité et chiffres significatifs cohérents. Équations de réaction équilibrées.",
    groups: {
      college: "Cycle 4 : démarche scientifique (observer, expérimenter, modéliser) à partir de phénomènes du quotidien. Modèles simples : atome, molécule, ion ; force représentée par un vecteur. Calculs simples, peu de littéral, unités SI.",
      lycee: "Démarche scientifique : modéliser, mesurer avec incertitude, valider ou critiquer. Formule littérale avant application numérique, chiffres significatifs, unités SI en romain, vecteurs $\\vec{F}$, équations équilibrées avec états physiques, ordres de grandeur.",
      cpge: "Système et hypothèses explicités ; homogénéité dimensionnelle ; résultat littéral avant application numérique ; ordres de grandeur ; approximations justifiées ; vecteurs $\\vec{v}$ ; résultat commenté physiquement.",
    },
  }, // sources : https://eduscol.education.fr/296/physique-chimie-cycle-4
  svt: {
    default: "Raisonnement scientifique : problème, hypothèse, exploitation de données citées avec valeurs et unités, conclusion limitée aux données. Vocabulaire exact ; schémas titrés et légendés ; noms d'espèces en binôme latin en italique.",
    groups: {
      college: "Cycle 4 : trois thèmes (corps humain et santé ; vivant et évolution ; planète Terre, environnement et action humaine). Démarche d'investigation, vocabulaire du programme, schémas simples ; pas de biochimie détaillée.",
      lycee: "Exploiter des documents (courbes, tableaux, images avec échelle) : relever des valeurs, comparer, relier à une notion, conclure sans extrapoler. Distinguer corrélation et causalité, hypothèse et résultat ; mécanismes moléculaires exacts.",
    },
  }, // sources : https://www.education.gouv.fr/bo/19/Special1/MENE1901647A.htm
  technologie: {
    default: "Analyse fonctionnelle : besoin, fonction d'usage, fonctions techniques, contraintes. Chaîne d'énergie (alimenter, distribuer, convertir, transmettre) et d'information (acquérir, traiter, communiquer). Matériaux ; programmation ; démarche de projet.",
    groups: {
      lycee_pro: "Contexte professionnel : analyse fonctionnelle, dossier technique, schémas normalisés, cotation et tolérances, matériaux, énergie, sécurité. Vocabulaire de métier exact, unités SI, mises en situation d'atelier.",
    },
  }, // sources : https://www.education.gouv.fr/sites/default/files/document/projet-de-programme-de-technologie-du-cycle-4-477200.pdf
  sciences_primaire: {
    default: "Cycle 3 : démarche d'investigation (question, hypothèse, expérience en ne changeant qu'un facteur à la fois, observation, conclusion). Traces de l'élève : schéma, dessin d'observation, tableau. Vocabulaire précis et limité ; manipulations sans danger.",
  }, // sources : https://eduscol.education.gouv.fr/6878/ressources-d-accompagnement-du-programme-de-sciences-et-technologie-au-cycle-3
  decouverte_monde: {
    default: "Cycle 2 : partir de l'observation et de la manipulation de l'environnement proche (vivant, matière, objets, espace, temps). Question, hypothèse simple, vérification. Traces : dessin légendé, classement, tableau simple ; phrases courtes, vocabulaire limité.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  physique: {
    default: "Définir système, référentiel et hypothèses ; formule littérale avant application numérique ; homogénéité dimensionnelle, ordres de grandeur ; unités SI en romain, grandeurs en italique, vecteurs $\\vec{F}$ ; incertitudes ; limites du modèle.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  chimie: {
    default: "Nomenclature IUPAC ; formules brutes, semi-développées ou topologiques ; équations équilibrées (éléments, charges) avec états physiques ; $n$ en mol, concentrations en $\\mathrm{mol\\cdot L^{-1}}$ ; chiffres significatifs ; sécurité (EPI, pictogrammes).",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  biologie: {
    default: "Binôme latin en italique (genre majuscule, espèce minuscule) ; gènes en italique, protéines en romain ; échelles et unités (µm, nm) ; schémas annotés ; témoins, réplicats, moyenne, écart-type ; corrélation distincte de causalité.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  sciences_terre: {
    default: "Temps géologiques en Ma et Ga, distances et profondeurs avec unités ; roches, minéraux et structures nommés exactement ; raisonnement actualiste ; cartes, coupes, diagrammes et données de terrain interprétés ; ordres de grandeur.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  medecine_sante: {
    default: "Terminologie médicale exacte ; médicaments en DCI ; cas cliniques fictifs et anonymes ; démarche : anamnèse, examen, hypothèses, examens complémentaires, prise en charge ; valeurs biologiques avec unités et références ; niveau de preuve.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  francais: {
    default: "Terminologie grammaticale et littéraire exacte (registres, figures, genres) ; citations brèves, procédé nommé puis effet ; étude de la langue en contexte ; textes et œuvres réels, texte écrit pour l'exercice présenté comme tel.",
    groups: {
      elementaire: "Lecture à voix haute et compréhension, copie, dictée, écriture ; étude de la langue articulée à la lecture (accords, conjugaison, sujet, verbe, groupe nominal) ; littérature de jeunesse et patrimoniale ; oral.",
      college: "Lecture de textes patrimoniaux et contemporains ; étude de la langue (nature, fonction, accords, temps verbaux, lexique) ; écriture ; oral ; citations exactes, procédé nommé puis effet.",
      lycee: "Explication linéaire suivant l'ordre du texte ; commentaire ou dissertation à problématique et plan construits ; citations courtes, procédé nommé puis interprétation ; question de grammaire sur une phrase de l'extrait ; œuvres et parcours réels.",
      lycee_pro: "Lire, écrire, dire, écouter à partir de supports variés (textes, images) liés à la vie sociale et au métier ; vocabulaire expliqué ; consignes courtes ; une compétence visée par activité.",
    },
  }, // sources : https://sites.ac-nancy-metz.fr/ien57stavoldouest/IMG/pdf/pre_sentation_programme_cycle_2_franc_ais_2025_v3.pdf ; https://www.education.gouv.fr/media/199169/download ; https://eduscol.education.gouv.fr/sites/default/files/document/2025livretaccompagnementfrancaiscp-112431_0.pdf ; https://www.ecoledesmetiers.fr/sites/default/files/ressources-cadrage-officiel/fichiers/2021-11/Programme_BacPro_Fran%C3%A7ais_2020.pdf ; https://pedagogie.ac-strasbourg.fr/fileadmin/pedagogie/lettres/Examens/EAF/Dossier_vademecum_EAF.pdf ; https://eduscol.education.fr/document/24379/download
  lettres: {
    default: "Analyse littéraire rigoureuse : genres, registres, figures et procédés nommés précisément ; citations exactes et brèves, puis interprétation ; contexte historique et esthétique sans anachronisme ; problématique explicite ; œuvres et auteurs réels.",
    groups: {
      cpge: "Dissertation à problématique nette, commentaire ou explication de texte selon la consigne ; lecture précise du texte avant toute généralisation ; œuvres et mouvements réels, contexte sans anachronisme.",
      master: "Problématisation de la recherche : corpus délimité, cadre théorique nommé (poétique, narratologie, histoire littéraire, théorie critique), analyse stylistique fondée sur des citations exactes ; discuter les interprétations sans inventer de référence.",
    },
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  philosophie: {
    default: "Concepts définis puis distingués ; problème explicite ; thèse exposée fidèlement, objection, réfutation ; auteurs réels et doctrines exactes ; raisonnement continu, exemples précis, sans simple énumération d'opinions.",
    groups: {
      lycee: "Notions et repères du programme de terminale ; dissertation : analyse du sujet, problématique, plan progressif ; explication de texte : question, thèse, étapes de l'argumentation, enjeu ; auteurs du programme, citations seulement si sûres.",
    },
  }, // sources : https://groupe-reussite.fr/ressources/programme-terminale-s-philosophie/ ; https://www.laboiteabac.fr/programme-philosophie-terminale-17-notions/ ; https://eduscol.education.gouv.fr/5826/programmes-et-ressources-en-philosophie-voie-gt
  latin: {
    default: "Lexique : nominatif, génitif et genre des noms ; verbes : présent, infinitif, parfait, supin ; analyse morphologique (cas, nombre, temps, voix) puis syntaxe avant toute traduction ; texte latin authentique ou adapté signalé ; auteurs et mots réels.",
    groups: {
      college: "Cycle 4 : lire le texte latin sans traduire d'abord (formes et mots reconnus, sens global), puis traduire un texte court et accessible ; déclinaisons et conjugaisons de base ; mots latins et dérivés français ; culture antique liée au texte.",
      lycee: "Textes authentiques plus longs : syntaxe (infinitive, participe, ablatif absolu, subordonnées au subjonctif), traduction rigoureuse et justifiée, commentaire de texte, mise en relation avec la culture et la littérature antiques.",
    },
  }, // sources : https://eduscol.education.gouv.fr/5715/langues-et-cultures-de-l-antiquite-au-cycle-4 ; https://eduscol.education.fr/document/17137/download ; https://www.education.gouv.fr/bo/16/Hebdo11/MENE1603855A.htm
  grec: {
    default: "Alphabet, esprits et accents exacts ; lexique : nominatif, génitif, article et genre des noms ; verbes : présent, futur, aoriste ; analyse morphologique puis syntaxe avant toute traduction ; noms propres en français usuel ; auteurs et œuvres réels.",
    groups: {
      college: "Cycle 4 : lire le texte grec avec aides, repérer formes, mots connus et sens global avant de traduire un court texte accessible ; alphabet, déclinaisons et conjugaisons de base ; mots grecs dans le français savant ; culture antique.",
      lycee: "Textes authentiques plus longs : syntaxe (participes, infinitives, subordonnées, optatif et subjonctif), traduction rigoureuse et justifiée, commentaire de texte, lien avec la culture, la mythologie et la littérature antiques.",
    },
  }, // sources : https://eduscol.education.gouv.fr/5715/langues-et-cultures-de-l-antiquite-au-cycle-4 ; https://eduscol.education.fr/document/17137/download
  linguistique: {
    default: "Terminologie exacte (phonétique, phonologie, morphologie, syntaxe, sémantique, pragmatique) ; transcription API entre [ ] (phonétique) ou / / (phonologie) ; exemples glosés, astérisque pour l'agrammatical ; décrire sans prescrire ; données de langues réelles.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  theatre: {
    default: "Distinguer texte dramatique et représentation ; vocabulaire exact (didascalies, réplique, tirade, aparté, dramaturgie, scénographie, mise en scène, jeu) ; décrire les choix scéniques (espace, lumière, voix, corps) avant d'interpréter ; spectacles réels.",
    groups: {
      lycee: "Articuler pratique du jeu, analyse de représentations et culture théâtrale ; texte et mise en scène : choix scéniques observés puis interprétation ; spectacles et mises en scène réels, jamais inventés.",
    },
  }, // sources : https://eduscol.education.fr/document/24271/download ; https://eduscol.education.fr/1710/programmes-et-ressources-en-theatre-voie-gt ; https://www.education.gouv.fr/bo/20/Hebdo21/MENE2009200N.htm
  cinema: {
    default: "Décrire avant d'interpréter : échelle et angle de plan, mouvement de caméra, champ et contrechamp, raccord, montage, son diégétique ou off ; images et sons relevés précisément dans la séquence ; films et cinéastes réels, sans date ni générique incertains.",
    groups: {
      lycee: "Axes du programme : émotion(s), motifs et représentations, écritures, histoire(s) et techniques, économie(s) ; analyse de séquence argumentée, du plan au montage ; films réels, sans date ni générique incertains.",
    },
  }, // sources : https://eduscol.education.fr/2339/cinema-audiovisuel ; https://eduscol.education.fr/document/23602/download ; https://www.education.gouv.fr/sites/default/files/document/Cin%C3%A9ma-audiovisuel-235815.pdf
  histoire_geo: {
    default: "Repères chronologiques et spatiaux exacts (dates, lieux, acteurs). Histoire : causes, déroulement, conséquences. Géographie : échelles, localisation, vocabulaire précis. Document : nature, auteur, date, contexte. Frise et croquis : titre, légende ordonnée.",
    groups: {
      elementaire: "Peu de repères, du proche au lointain ; frise chronologique, plan, carte, globe. Documents courts (image, carte, texte simple), vocabulaire défini. Trace écrite brève, récit simple.",
      lycee_pro: "Repères exacts mais peu nombreux ; documents courts identifiés (nature, date), vocabulaire défini. Géographie : situation, croquis simple avec légende. Histoire, géographie et EMC distinguées ; liens avec la vie et le métier.",
      lycee: "Problématique, périodisation, notions définies ; réponse construite à une question problématisée ; analyse de document(s) : nature, auteur, date, contexte, apport, limites. Géographie : échelles, croquis ou schéma, légende organisée en parties titrées.",
    },
  }, // sources : https://www.education.gouv.fr/media/228384/download ; https://www.education.gouv.fr/media/228385/download ; https://eduscol.education.gouv.fr/5730/ressources-d-accompagnement-du-programme-d-histoire-geographie-au-cycle-4
  emc: {
    default: "Valeurs et principes de la République (liberté, égalité, fraternité, laïcité), droits et devoirs ; textes juridiques réels, jamais d'article inventé. Démarches : débat argumenté, dilemme, cas concret. Neutralité stricte : aucune opinion partisane.",
    groups: {
      elementaire: "Situations vécues à l'école et dans la vie quotidienne : règles, respect d'autrui, droits de l'enfant, symboles de la République. Débat oral guidé, dilemme simple, mots civiques définis (règle, loi, droit, devoir). Aucune opinion partisane.",
      lycee_pro: "Cas concrets proches des élèves et du monde du travail (droits et devoirs, égalité, laïcité, numérique, engagement). Notions juridiques définies simplement, textes réels. Débat argumenté ; neutralité stricte, aucune opinion partisane.",
    },
  }, // sources : https://www.education.gouv.fr/bo/2024/Hebdo24/MENE2413934A ; https://www.education.gouv.fr/media/160329/download
  hggsp: {
    default: "Approche géopolitique : acteurs (États, organisations, entreprises, ONG), territoires, rapports de puissance, échelles. Notions définies, exemples précis et localisés. Exercices : dissertation, étude critique de document(s).",
  }, // sources : https://eduscol.education.gouv.fr/5802/programmes-et-ressources-en-histoire-geographie-geopolitique-et-sciences-politiques-voie-g ; https://www.digischool.fr/articles/lycee/bac/specialite-hggsp/
  histoire: {
    default: "Problématiser, périodiser, contextualiser. Dates, noms et lieux exacts. Critique de source : nature, auteur, date, contexte, portée, limites ; sources primaires et secondaires distinguées. Historiographie : courants réels seulement.",
    groups: {
      cpge: "Dissertation et commentaire de documents : problématique, plan argumenté, cadrage chronologique et spatial, connaissances factuelles exactes et précises, bilan historiographique succinct.",
    },
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  geographie: {
    default: "Raisonnement multiscalaire (local à mondial) : territoires, acteurs, flux, réseaux. Termes précis (aménagement, métropolisation, mobilités, risques). Cartes, croquis, schémas : titre, échelle, orientation, légende. Données chiffrées datées, avec unité.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  histoire_arts: {
    default: "Œuvre située : titre, artiste, date, lieu, domaine (arts de l'espace, du langage, du quotidien, du son, du spectacle vivant, du visuel), courant, contexte. Décrire, situer, interpréter avec le lexique du domaine ; détail incertain non affirmé.",
  }, // sources : https://eduscol.education.fr/document/19564/download ; https://www.education.gouv.fr/bo/2000/hs6/histart.htm
  science_politique: {
    default: "Concepts définis (pouvoir, légitimité, État, régime, démocratie, représentation). Distinguer analyse empirique et jugement normatif. Institutions, élections et partis exacts, comparaison de cas. Aucune prise de parti.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  sociologie: {
    default: "Concepts définis (socialisation, norme, déviance, capital, habitus, rôle, stratification). Distinguer fait observé, mesure et interprétation. Méthodes : enquête, entretien, observation, statistiques. Neutralité axiologique.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  evar: {
    default: "Thèmes : émotions, connaissance de soi et de son corps, respect de l'intimité, relations, égalité filles-garçons, prévention des violences, adultes ressources. Mots exacts adaptés à l'âge, rien d'explicite, aucun récit personnel demandé.",
    groups: {
      maternelle: "Activités orales et observables : nommer ses émotions, albums, marionnettes, jeux de rôle, regroupement. Respect du corps et de l'intimité, savoir dire non, adulte de confiance. Mots justes pour le corps ; aucun écrit.",
      elementaire: "Cycle 2 : émotions, respect du corps et des autres, stéréotypes, savoir dire non, personnes ressources. CM1-CM2 : puberté (vocabulaire scientifique exact), égalité, harcèlement, numérique. Sexualité non abordée ; aucun récit personnel demandé.",
    },
  }, // sources : https://www.education.gouv.fr/bo/2025/Hebdo6/MENE2503064A ; https://www.education.gouv.fr/sites/default/files/2025-08/-duquer-la-vie-affective-et-relationnelle-en-cm1-et-cm2-441933.pdf ; https://www.ih2ef.gouv.fr/publication-des-programmes-deducation-la-vie-affective-et-relationnelle-et-la-sexualite-evars
  evars: {
    default: "Champs : biologique, psycho-émotionnel, juridique et social. Informations exactes (anatomie, puberté, contraception, IST, consentement, droit), neutres, sans jugement moral. Égalité, prévention des violences et du harcèlement ; aucun récit intime demandé.",
  }, // sources : https://www.education.gouv.fr/bo/2025/Hebdo6/MENE2503064A ; https://www.ih2ef.gouv.fr/publication-des-programmes-deducation-la-vie-affective-et-relationnelle-et-la-sexualite-evars
  anglais: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). Une seule variété, britannique ou américaine, sans mélange (colour/color). Verbes irréguliers exacts ; accent de mot et intonation. Culture : pays anglophones.",
    groups: {
      bts_but: "Langue de spécialité : situations professionnelles (courriel, réunion, présentation, compte rendu), lexique technique exact. Une seule variété (britannique ou américaine).",
      licence: "Anglais universitaire : LLCER (littérature, civilisation, linguistique) ou LEA (langue appliquée) ; terminologie exacte, une seule variété.",
    },
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html
  espagnol: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). ¿ ¡ d'ouverture, accents écrits et ñ exacts ; ser/estar ; tú/usted. Variété cohérente : Espagne (vosotros) ou Amérique latine (ustedes).",
    groups: {
      bts_but: "Langue de spécialité : situations professionnelles (courriel, réunion, présentation, compte rendu), lexique technique exact. Usted de politesse.",
    },
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html
  allemand: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). Majuscule aux noms ; ä ö ü ß exacts ; article avec le nom (genre, pluriel) ; quatre cas ; verbe en 2e position, en fin de subordonnée ; particules séparables ; du/Sie.",
    groups: {
      bts_but: "Langue de spécialité : situations professionnelles (courriel, réunion, présentation, compte rendu), lexique technique exact. Sie de politesse ; majuscule aux noms.",
    },
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html
  italien: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). Accents et consonnes doubles exacts ; articles (il, lo, l', la, i, gli, le) et prépositions articulées ; essere/avere au passato prossimo ; tu/Lei.",
    groups: {
      bts_but: "Langue de spécialité : situations professionnelles (courriel, réunion, présentation, compte rendu), lexique technique exact. Lei de politesse.",
    },
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html
  portugais: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). Une seule variété (Portugal ou Brésil) : lexique, orthographe, tu/você. Accents, ã, õ, ç exacts ; prépositions contractées (no, da, ao) ; ser/estar.",
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html
  chinois: {
    default: "Activités langagières (compréhension orale et écrite, expression orale et écrite, interaction). Caractères simplifiés ; pinyin avec marques de tons pour les mots nouveaux ; classificateurs, ordre des mots, particules (le, de, ma) ; ponctuation chinoise ; peu de caractères nouveaux par séance.",
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html ; https://www.education.gouv.fr/sites/default/files/annexe-7-programme-de-chinois-pour-les-classes-de-coll-ge-441435.pdf
  arabe: {
    default: "Activités langagières variées (compréhension orale et écrite, expression orale et écrite, interaction). Arabe standard moderne, écriture de droite à gauche ; voyelles brèves notées pour les débutants puis allégées ; signaler tout dialectal ; racines, accords, duel, pluriel brisé.",
  }, // sources : https://www.education.gouv.fr/les-langues-vivantes-etrangeres-et-regionales-11249 ; https://eduscol.education.gouv.fr/sites/default/files/document/programme-d-enseignement-du-cycle-4-67722.pdf ; https://www.education.gouv.fr/bo/2010/special09/mene1019796a.html ; https://www.education.gouv.fr/sites/default/files/annexe-5-programme-d-arabe-pour-les-classes-de-coll-ge-440364.pdf
  ses: {
    default: "Mobiliser notions et mécanismes du programme en croisant économie, sociologie et science politique ; chaîne causale explicite. Lire les données avec précision : unité, coefficient multiplicateur, taux de variation, points de pourcentage, indice base 100.",
  }, // sources : https://eduscol.education.gouv.fr/31329/domaines-enseignement/sciences-economiques-et-sociales-lycee-gt
  economie: {
    default: "Distinguer micro/macro et positif/normatif. Poser hypothèses, variables, unités (réel/nominal, taux de croissance, élasticité) ; calculs détaillés ; mécanismes causaux et limites du modèle.",
    groups: {
      master: "Modèle formel ou stratégie d'identification (causalité, endogénéité, biais), hypothèses explicites, robustesse et limites ; calculs détaillés.",
      doctorat: "Modèle formel ou stratégie d'identification (causalité, endogénéité, biais), hypothèses explicites, robustesse et limites ; calculs détaillés.",
    },
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  gestion: {
    default: "Comptabilité : plan comptable général (classes 1 à 7) ; chaque écriture équilibrée (débit = crédit), bilan actif = passif ; TVA et ratios calculés explicitement ; montants en euros, virgule décimale, espace entre milliers ; vérifier tous les totaux.",
    groups: {
      lycee: "Partir d'une situation d'entreprise ; information comptable, performance (profitabilité, rentabilité), équilibre financier ; calculs détaillés ; montants en euros, virgule décimale ; vérifier débit = crédit et les totaux.",
      bts_but: "Analyse financière : soldes intermédiaires de gestion, CAF, FRNG, BFR, trésorerie, ratios, seuil de rentabilité ; calculs détaillés ; montants en euros, virgule décimale ; vérifier l'équilibre des totaux.",
    },
  }, // sources : https://stmg.education/Fichiers/referentiels-stmg/stmg-gestion-finance-referentiel.pdf ; https://eduscol.education.gouv.fr/5862/programmes-et-ressources-en-serie-stmg
  management: {
    default: "Analyser une organisation : acteurs et parties prenantes, objectifs, structure, stratégie, performance, ressources humaines. Diagnostic argumenté puis recommandation justifiée ; nommer un modèle (SWOT, PESTEL, cinq forces) seulement s'il est pertinent.",
    groups: {
      lycee: "Partir d'une situation concrète d'une organisation variée (entreprise, association, organisation publique) : observer, analyser ; parties prenantes, performance, numérique ; réponse argumentée appuyée sur les données fournies.",
    },
  }, // sources : https://www.education.gouv.fr/bo/12/Hebdo12/MENE1135676A.htm ; https://eduscol.education.gouv.fr/5862/programmes-et-ressources-en-serie-stmg
  droit_economie: {
    default: "Distinguer question de droit et question d'économie. Droit : qualification des faits, règle applicable, application, conclusion. Économie : mécanismes et indicateurs avec unités.",
    groups: {
      lycee_pro: "Partir d'une situation de la vie quotidienne ou professionnelle ; distinguer question économique et question juridique ; thèmes : cadre juridique, consommation, production, rôle de l'État, travail ; règle de droit exacte, indicateurs avec unités.",
    },
  }, // sources : https://www.education.gouv.fr/bo/19/Special5/MENE1908617A.htm ; https://eduscol.education.gouv.fr/sites/default/files/document/spe262annexe11159139pdf-84612.pdf ; https://eduscol.education.gouv.fr/31104/domaines-enseignement/economie-droit-lycee-professionnel
  droit: {
    default: "Distinguer droit privé et public, ordre judiciaire et administratif. Hiérarchie des normes : Constitution, traités, lois, règlements. Termes exacts : jugement (tribunal), arrêt (cour), décision (Conseil constitutionnel). Qualifier les faits d'abord.",
  }, // sources : https://www.justice.gouv.fr/justice-france/fondements-principes/sources-du-droit ; https://fr.wikipedia.org/wiki/Hi%C3%A9rarchie_des_normes_en_droit_fran%C3%A7ais
  communication: {
    default: "Distinguer information, communication, médiation et média. Analyser un dispositif : acteurs, message, canal, contexte, enjeux, réception. Citer un modèle (Shannon, Lasswell) ou l'école de Palo Alto seulement s'il est pertinent, avec ses limites.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  psychologie: {
    default: "Distinguer faits observés, explication théorique et interprétation ; vocabulaire exact. Méthode : variables, échantillon, corrélation ≠ causalité. Jamais de diagnostic ni d'étiquette clinique appliquée à une personne réelle.",
    groups: {
      master: "Méthodologie rigoureuse : hypothèses, plan expérimental, variables, statistiques inférentielles (test, seuil, taille d'effet), limites et éthique de la recherche ; normes APA ; jamais de diagnostic.",
      doctorat: "Méthodologie rigoureuse : hypothèses, plan expérimental, variables, statistiques inférentielles (test, seuil, taille d'effet), limites et éthique de la recherche ; normes APA ; jamais de diagnostic.",
    },
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  sciences_education: {
    default: "Distinguer apprentissage, enseignement, éducation, formation, évaluation. Distinguer pédagogie (pratiques, relation éducative) et didactique (savoirs disciplinaires). Situer les notions dans un courant : behaviorisme, constructivisme, socioconstructivisme.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  arts_plastiques: {
    default: "Pratique d'abord : consigne ouverte avec contraintes (support, outil, geste, matériau), critères d'observation, temps de verbalisation. Vocabulaire plastique précis (valeur, composition, trace, médium). Œuvre citée seulement si artiste et titre sont certains.",
  }, // sources : https://eduscol.education.gouv.fr/5718/ressources-d-accompagnement-du-programme-d-arts-plastiques-au-cycle-4 ; https://eduscol.education.fr/350/arts-plastiques-concevoir-et-mettre-en-oeuvre-son-enseignement
  musique: {
    default: "Alterner écoute guidée et production (chanter, jouer, créer). Vocabulaire précis : hauteur, durée, intensité, timbre, tempo, nuance, forme. Œuvre citée seulement si compositeur et titre sont certains ; ne jamais inventer de partition.",
    groups: {
      elementaire: "Voix, rythme et écoute d'abord : chants, jeux rythmiques, écoute comparée. Vocabulaire simple (fort/doux, aigu/grave, lent/rapide). Œuvre citée seulement si compositeur et titre sont certains.",
    },
  }, // sources : https://eduscol.education.gouv.fr/sites/default/files/document/9rac2c3dynamique-competences-em570453pdf-74913.pdf ; https://eduscol.education.fr/319/education-musicale-competences-et-evaluation
  arts: {
    default: "Analyse d'œuvre : description, contexte, analyse formelle, interprétation. Concepts d'esthétique et d'histoire de l'art définis précisément ; distinguer fait et interprétation. Œuvre citée seulement si artiste, titre et date sont certains.",
  }, // sources : conventions disciplinaires usuelles (pas de programme national consulté en ligne)
  eps: {
    default: "Situation : but, dispositif (espace, matériel, effectifs, durée), consignes, critères de réussite observables, variables, sécurité. Temps d'engagement moteur élevé. Vocabulaire des APSA et rôles (joueur, arbitre, observateur).",
    groups: {
      lycee: "Cinq champs d'apprentissage, dont le 5e : réaliser et orienter son activité physique en vue du développement et de l'entretien de soi. Attendus de fin de lycée, critères observables, rôles (arbitre, observateur, coach), sécurité.",
      lycee_pro: "Cinq champs d'apprentissage, dont le 5e : réaliser et orienter son activité physique en vue du développement et de l'entretien de soi. Attendus de fin de lycée, critères observables, rôles (arbitre, observateur, coach), sécurité.",
    },
  }, // sources : https://eduscol.education.gouv.fr/sites/default/files/document/ra19lyceepbpcapepsenjeuxprogramme1211545pdf-85143.pdf ; https://ent2d.ac-bordeaux.fr/disciplines/eps/category/ressources-pour-lenseignant/ressources-didactiques-et-pedagogiques/apsa-ressources-academiques/cp5/
  langage_oral: {
    default: "Activités orales, sans écrit à lire : écouter, dire, raconter, reformuler, dialoguer. Vocabulaire en contexte, comptines, phonologie (syllabes, rimes, sons). L'adulte modélise et reformule ; prévoir le langage attendu des enfants.",
  }, // sources : https://www.education.gouv.fr/media/14156/download
  graphisme_ecriture: {
    default: "Geste graphique avant l'écriture : posture, tenue de l'outil, lignes, boucles, ponts, vagues, sens du tracé, supports variés (grands formats, sol, sable). Prénom : capitales d'imprimerie puis cursive en grande section. Geste observé.",
  }, // sources : https://www.education.gouv.fr/media/14156/download
  nombres_formes: {
    default: "Manipuler d'abord : collections, doigts, constellations, comptine numérique ; quantité (cardinal) puis rang (ordinal). Formes, grandeurs, suites organisées manipulées. Problèmes avec objets, sans calcul posé. Vocabulaire mathématique précis.",
  }, // sources : https://www.pass-education.fr/que-sont-les-5-domaines-en-maternelle-crpe/ ; https://www.education.gouv.fr/media/14156/download
  temps_espace: {
    default: "Vécu et corps d'abord : repères dans le temps (avant, après, ordre, durée, rituels, frise) et dans l'espace (devant, derrière, sur, sous, parcours, plan simple, maquette). Manipuler, se déplacer ; pas de notion abstraite.",
  }, // sources : https://www.pass-education.fr/que-sont-les-5-domaines-en-maternelle-crpe/
  explorer_monde: {
    default: "Observer, manipuler, questionner, comparer, trier, classer le vivant, la matière et les objets ; hypothèses simples dites à l'oral. Vocabulaire précis (vivant, non vivant, matière, objet). Sécurité du matériel et du vivant ; traces par dessin ou photo.",
  }, // sources : https://www.pass-education.fr/que-sont-les-5-domaines-en-maternelle-crpe/
  activites_artistiques: {
    default: "Dessin, peinture, collage, voix, chants, écoute musicale, expression corporelle : explorer, produire, exprimer, verbaliser. Matériaux variés ; production personnelle, ni copie de modèle ni coloriage dirigé. Œuvres et chants réels seulement si certains.",
  }, // sources : https://www.pass-education.fr/que-sont-les-5-domaines-en-maternelle-crpe/
  activites_physiques: {
    default: "Situation motrice : but clair, espace, matériel, effectifs, durée courte, règle simple. Actions variées (se déplacer, équilibrer, lancer, danser, coopérer, s'opposer), réussite observable, variables, sécurité. Pas de jeu d'élimination.",
  }, // sources : https://patrickbayeux.com/actualites/nouveau-programme-de-lecole-maternelle-leps-premiere-ecole-du-corps/
  autre: {
    default: "",
  }, // aucune règle : matière non précisée
};

/** Règle de la matière pour ce groupe de niveau : la variante du groupe, sinon la règle par défaut, sinon ''. */
export function disciplineRule(matiere: Matiere, group: LevelGroup): string {
  const entry = DISCIPLINES[matiere];
  if (!entry) return '';
  return entry.groups?.[group] || entry.default || '';
}
