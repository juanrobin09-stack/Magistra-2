// Consignes spécifiques à chacun des 11 outils, adaptées au niveau, puis précisées par les options choisies par
// l'enseignant : format normé (shared/formats.ts), objectif de l'évaluation, notation, corrigé, nombres exacts,
// ton, besoins particuliers. Une option choisie prime toujours sur le comportement par défaut de l'outil, mais
// jamais sur une autre option : chaque consigne est formulée pour ne contredire aucune des autres (un petit modèle
// local suit la consigne la plus détaillée ou la dernière lue, pas une règle de priorité).

import { PROFILS_DIFFERENCIATION, PROFILS_ELEVE, TYPES_LETTRE, type ProfilDifferenciation, type TypeContenu } from '../catalog.js';
import {
  BAREMES, BESOINS_PARTICULIERS, countText, countUnit, getModalite, modalitePrompt, TONS, TYPES_EVALUATION, type CountUnit,
} from '../formats.js';
import { isClozeRequest } from '../cloze.js';
import type { LevelGroup } from '../levels.js';
import type { GenerationRequest } from '../types.js';

const SUP: LevelGroup[] = ['bts_but', 'cpge', 'licence', 'master', 'doctorat'];
const PRIMARY: LevelGroup[] = ['maternelle', 'elementaire'];

/** Consigne d'adaptation propre à chaque profil de différenciation. */
const DIFF_GUIDANCE: Record<ProfilDifferenciation, string> = {
  renforce: 'Accompagnement renforcé : consignes découpées, vocabulaire simple, aides visuelles décrites, quantité réduite, étayage.',
  standard: 'Standard : la version attendue pour le groupe.',
  approfondissement: 'Approfondissement : transfert, questions ouvertes, problème complexe ou mini-projet.',
};

/** Notation d'une copie corrigée, selon le choix de l'enseignant. */
const CORRECTION_GRADING: Record<NonNullable<GenerationRequest['bareme']>, string> = {
  sur20: 'NOTATION : note sur 20, justifiée critère par critère.',
  sur10: 'NOTATION : note sur 10, justifiée critère par critère.',
  competences: 'NOTATION : par compétences, sans note chiffrée : positionnement de chaque compétence (maîtrise insuffisante, fragile, satisfaisante, très bonne maîtrise), justifié par des éléments de la copie.',
};

/**
 * Attendus d'une copie selon le type de travail corrigé. La consigne du format (shared/formats.ts) sert à CONSTRUIRE
 * un sujet et son corrigé modèle : elle n'est jamais reprise pour corriger une copie. Sans entrée ici, des attendus
 * généraux s'appliquent.
 */
const ATTENDUS_COPIE: Record<string, string> = {
  dissertation: 'analyse des termes du sujet, problématique, plan en deux ou trois parties, arguments illustrés d’exemples précis, introduction (accroche, définition des termes, problématique, annonce du plan) et conclusion (réponse, ouverture)',
  commentaire: 'projet de lecture, plan en deux ou trois parties, citations analysées (procédés et effets), introduction et conclusion',
  contraction_essai: 'contraction fidèle au texte, reformulée et à la longueur demandée ; essai à la thèse claire, aux arguments organisés et illustrés',
  explication_lineaire: 'mouvements du texte, projet de lecture, explication qui suit le texte (citations, procédés, interprétations), introduction et conclusion, question de grammaire',
  redaction: 'respect du sujet (situation, destinataire, type de texte, longueur), organisation, cohérence, correction et richesse de la langue',
  explication_texte: 'thème, thèse, enjeu, structure argumentative, explication suivie, intérêt philosophique',
  developpement_construit: 'réponse organisée en paragraphes, notions clés définies, exemples précis, repères datés',
  composition: 'analyse du sujet (termes, bornes chronologiques et spatiales), problématique, plan en deux ou trois parties, arguments, exemples et repères précis, introduction et conclusion',
  etude_critique: 'présentation des documents (nature, auteur, date, contexte), analyse, regard critique (portée, limites), réponse organisée',
  croquis: 'titre, légende organisée en parties titrées, figurés adaptés (surfaces, points, lignes, flèches), lisibilité',
  epreuve_composee: 'mobilisation des connaissances, exploitation rigoureuse du document statistique, raisonnement appuyé sur le dossier',
  demonstration: 'hypothèses et conclusion identifiées, chaque étape justifiée par une propriété ou un théorème nommé, rigueur de la rédaction',
  algorithmique: 'algorithme ou programme correct (entrées, sorties, cas limites), lisible et commenté',
  expression_ecrite: 'réalisation de la tâche, cohérence, richesse et correction de la langue, nombre de mots',
  traduction: 'fidélité au sens, correction de la langue d’arrivée, aucun contresens ni omission, choix de traduction justifiables',
  cas_pratique: 'syllogisme juridique : qualification des faits, problème de droit, règle applicable, application aux faits, solution',
  commentaire_arret: 'fiche d’arrêt (faits, procédure, prétentions, problème de droit, solution), problématique, plan en deux parties et deux sous-parties (sens, valeur, portée)',
  etude_cas: 'réponses justifiées par les annexes, calculs exacts, vocabulaire de la discipline',
  note_synthese: 'plan en deux parties, reformulation neutre, renvoi aux documents, longueur respectée',
  probleme: 'démarche complète et justifiée, calculs exacts, unités, réponse à la question posée',
  etude_documents: 'informations prélevées avec exactitude, analyse, mise en relation avec les connaissances',
};

/** Sans corrigé : version élève seule, prête à distribuer. */
const NO_ANSWER_KEY = 'VERSION ÉLÈVE SEULE : ne rédige AUCUN corrigé, aucune réponse, aucune solution. Uniquement les énoncés, les consignes et, si utile, les espaces de réponse et le barème.';

/**
 * Texte à trous sans corrigé : les mots à trouver restent marqués, sinon Magistra ne peut poser aucun blanc
 * (shared/cloze.ts) ; c'est Magistra qui laisse le corrigé de côté.
 */
const NO_ANSWER_KEY_CLOZE = 'VERSION ÉLÈVE SEULE : Magistra n’ajoutera pas de corrigé. Marque quand même chaque mot à trouver entre doubles crochets, comme indiqué ci-dessus (c’est ce qui permet de poser les blancs), sans écrire de blanc ni de corrigé toi-même.';

/** Texte à trous « différencié » : un seul texte, des mots de difficulté graduée (plusieurs textes casseraient les blancs). */
const CLOZE_GRADED = 'Un seul texte : les mots à trouver sont de difficulté graduée (des plus évidents aux plus exigeants) ; n’écris ni plusieurs textes ni plusieurs versions.';

/**
 * Formats évalués en pratiquant (EPS, arts plastiques, éducation musicale) : ni copie, ni questions sur copie, ni
 * corrigé écrit ; la situation et sa grille d'évaluation sont celles que décrit le format.
 */
const PRACTICE_FORMATS: ReadonlySet<string> = new Set(['situation_eps', 'pratique_artistique']);

/**
 * Formats d'épreuve qui portent leur propre barème (interrogation, partiel, devoir surveillé, sujets type brevet, bac,
 * bac pro, BTS, épreuve composée de SES). Sans notation choisie, ce barème s'applique, même pour une évaluation
 * diagnostique : la règle « sans note » du diagnostic ne vaut que pour une évaluation dont le format n'impose pas de
 * barème. Tout format d'évaluation dont la consigne prévoit un barème figure ici (vérifié par les tests).
 */
const EPREUVES_AVEC_BAREME: ReadonlySet<string> = new Set([
  'interro', 'partiel', 'devoir_surveille', 'sujet_bts', 'sujet_brevet', 'sujet_bac', 'sujet_bac_pro', 'epreuve_composee',
]);

export function isPracticeFormat(modalite: string | undefined): boolean {
  return !!modalite && PRACTICE_FORMATS.has(modalite);
}

export function hasOwnBareme(modalite: string | undefined): boolean {
  return !!modalite && EPREUVES_AVEC_BAREME.has(modalite);
}

/**
 * Notation d'une évaluation quand l'enseignant n'en choisit aucune (hors école primaire, qui positionne sans note) :
 * - 'format' : celle du format (barème d'une épreuve, grille d'une situation pratique), même pour un diagnostic ;
 * - 'aucune' : sans note, pour une évaluation diagnostique ;
 * - 'sur20' : sinon.
 * Source unique pour le prompt et pour l'indication « Par défaut : … » du formulaire.
 */
export function defaultEvaluationNotation(req: Pick<GenerationRequest, 'typeEvaluation' | 'modalite'>): 'format' | 'aucune' | 'sur20' {
  if (hasOwnBareme(req.modalite) || isPracticeFormat(req.modalite)) return 'format';
  return req.typeEvaluation === 'diagnostique' ? 'aucune' : 'sur20';
}

/** Notation choisie pour une situation pratique : elle porte sur la grille d'évaluation (il n'y a pas de questions). */
const PRACTICE_NOTATION: Record<NonNullable<GenerationRequest['bareme']>, string> = {
  sur20: 'NOTATION : note sur 20 ; la grille d’évaluation répartit exactement 20 points entre ses critères.',
  sur10: 'NOTATION : note sur 10 ; la grille d’évaluation répartit exactement 10 points entre ses critères.',
  competences: 'NOTATION : par compétences, sans note chiffrée : grille de positionnement à 4 niveaux (maîtrise insuffisante, fragile, satisfaisante, très bonne maîtrise) avec les indicateurs observables de chaque niveau.',
};

/** Situation pratique sans corrigé : ce que les élèves reçoivent (il n'y a ni énoncé écrit ni espace de réponse). */
const NO_ANSWER_KEY_PRACTICE = 'VERSION ÉLÈVE SEULE : ne rédige AUCUN corrigé ni élément de correction. Uniquement ce que les élèves reçoivent : la situation, les consignes, les critères de réussite et, si utile, les fiches d’observation à remplir.';

/** Notation d'une évaluation : celle choisie par l'enseignant ; sinon voir defaultEvaluationNotation. */
type Notation = NonNullable<GenerationRequest['bareme']> | 'aucune';

interface Ctx {
  req: GenerationRequest;
  group: LevelGroup;
  sup: boolean;
  primary: boolean;
  /** Format évalué en pratiquant (voir PRACTICE_FORMATS). */
  practice: boolean;
  /** Format de séance du supérieur (CM, TD, TP, séminaire), en toutes lettres ; vide sinon. */
  fmt: string;
  /** Corrigé à rédiger par le modèle (vrai par défaut ; faux pour une version élève seule, un texte à trous ou une situation pratique). */
  withKey: boolean;
  /** Notation de l'outil Évaluation (voir Notation). */
  notation: Notation;
}

function formatLabel(format?: string): string {
  switch (format) {
    case 'cm': return 'cours magistral (CM)';
    case 'td': return 'travaux dirigés (TD)';
    case 'tp': return 'travaux pratiques (TP)';
    case 'seminaire': return 'séminaire';
    default: return '';
  }
}

/** « 3 exercices », « 1 séance » : accord du nom avec le nombre. */
function plural(n: number, singular: string): string {
  return `${n} ${n > 1 ? `${singular}s` : singular}`;
}

/**
 * Consigne du format normé choisi par l'enseignant (vide sans format), avec sa portée :
 * - en général, le format prime sur la forme par défaut de l'outil ;
 * - pour une version élève seule, il ne prime jamais sur l'absence de corrigé (la plupart des formats décrivent le
 *   corrigé qu'ils prévoient) ;
 * - pour une séquence ou une fiche de séance, le format est une démarche : il s'applique DANS la structure de l'outil
 *   (tableau, détail des séances, nombre de séances), sans la remplacer.
 */
function modaliteLine(req: GenerationRequest, studentOnly: boolean): string {
  const text = modalitePrompt(req.modalite, { niveau: req.niveau, matiere: req.matiere });
  if (!text) return '';
  switch (req.type) {
    case 'sequence': {
      const flipped = req.modalite === 'classe_inversee'
        ? ' En classe inversée, les séances s’appuient chacune sur une capsule préparée à la maison avant la séance, puis sur des activités en classe.'
        : '';
      return `${text}\nApplique cette démarche à toute la séquence et à chacune de ses séances, en conservant la structure demandée ci-dessus (tableau des séances, détail de chaque séance) et le nombre de séances indiqué.${flipped}`;
    }
    case 'fiche_prep':
      return `${text}\nOrganise le déroulement (tableau) selon cette démarche, en conservant toutes les rubriques de la fiche demandées ci-dessus.`;
    default:
      return studentOnly
        ? `${text}\nCe format prime sur toute autre indication de forme ci-dessus, sauf pour le corrigé : c’est une version élève seule, donc n’écris ni le corrigé, ni les réponses, ni les solutions, ni les éléments de correction que ce format prévoit.`
        : `${text}\nCe format prime sur toute autre indication de forme ci-dessus.`;
  }
}

/** « Différencié » sans écrit (maternelle, situation pratique) : des variantes de la situation, jamais des questions. */
const GRADED_VARIANTS = 'Variantes de difficulté graduée de la même situation, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé).';

/** Difficulté d'une évaluation (texte à trous : les mots ; maternelle et situation pratique : des variantes). */
function difficultyLine(req: GenerationRequest, group: LevelGroup): string {
  switch (req.difficulte) {
    case 'facile': return 'Niveau de difficulté : facile (vérification des connaissances et savoir-faire essentiels).';
    case 'moyen': return 'Niveau de difficulté : moyen.';
    case 'difficile': return 'Niveau de difficulté : exigeant (transfert, situations complexes).';
    case 'differencie':
      if (isClozeRequest(req)) return CLOZE_GRADED;
      return group === 'maternelle' || isPracticeFormat(req.modalite)
        ? GRADED_VARIANTS
        : 'Questions de difficulté graduée, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé).';
    default: return '';
  }
}

/** Ce qui se manipule ou se joue (maternelle, ateliers, jeux) : ni questions ni écrit, des variantes. */
const HANDS_ON_UNITS: ReadonlySet<string> = new Set(['activité', 'atelier', 'jeu']);

/**
 * Difficulté d'une série d'exercices. « Différencié » : trois niveaux parmi le nombre demandé (au total, jamais par
 * niveau) ; un seul texte pour un texte à trous ; des aides graduées pour un travail d'un seul tenant ; pour une ou
 * deux activités, ateliers ou jeux, des variantes graduées de chacun (des élèves qui ne lisent pas encore).
 */
function exercicesDifficulty(req: GenerationRequest, unit: CountUnit | null, count: number | undefined): string {
  switch (req.difficulte) {
    case 'facile': return 'Niveau de difficulté : facile (consolidation des bases).';
    case 'moyen': return 'Niveau de difficulté : moyen.';
    case 'difficile': return 'Niveau de difficulté : difficile (transfert, problèmes complexes).';
    case 'differencie':
      if (isClozeRequest(req)) return CLOZE_GRADED;
      if (!unit) return 'Un seul travail, différencié par des aides graduées clairement identifiées (★ aide forte, ★★ aide légère, ★★★ prolongement en autonomie) ; n’écris pas plusieurs versions du travail.';
      if (count && count >= 3) {
        return `Les ${countText(count, unit)} se répartissent, au total et non par niveau, en trois niveaux clairement identifiés (★ facile, ★★ intermédiaire, ★★★ avancé), du plus simple au plus avancé, travaillant les mêmes compétences.`;
      }
      if (count) {
        return HANDS_ON_UNITS.has(unit.one)
          ? `Chaque ${unit.one} prévoit trois variantes de difficulté graduée, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé), sans rien ajouter au nombre demandé (${countText(count, unit)} au total).`
          : `Questions de difficulté graduée, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé), sans rien ajouter au nombre demandé (${countText(count, unit)} au total).`;
      }
      return `Répartis les ${unit.many} en trois niveaux clairement identifiés (★ facile, ★★ intermédiaire, ★★★ avancé), travaillant les mêmes compétences.`;
    default: return 'Progression du plus simple au plus complexe.';
  }
}

/**
 * Besoins particuliers d'une différenciation. Les aménagements d'accessibilité (DYS, TDAH, allophones, TSA,
 * malvoyance) valent pour chaque version : un élève concerné peut être dans n'importe quel groupe. Le haut potentiel,
 * lui, relève de l'approfondissement : l'appliquer à la version « Accompagnement renforcé » en retirerait l'étayage.
 */
function besoinsLines(req: GenerationRequest): string[] {
  const besoins = req.besoins ?? [];
  const lines: string[] = [];
  const access = BESOINS_PARTICULIERS.filter(b => b.value !== 'hpi' && besoins.includes(b.value));
  if (access.length) {
    lines.push(`BESOINS PARTICULIERS à prendre en compte dans chaque version (aménagements pédagogiques, jamais de diagnostic ni de terme médical appliqué à un élève) :\n${access.map(b => `- ${b.prompt}`).join('\n')}`);
  }
  const hpi = BESOINS_PARTICULIERS.find(b => b.value === 'hpi');
  if (hpi && besoins.includes('hpi')) {
    const profiles = req.profilsDifferenciation?.length ? req.profilsDifferenciation : PROFILS_DIFFERENCIATION.map(p => p.value);
    const approfondissement = PROFILS_DIFFERENCIATION.find(p => p.value === 'approfondissement')!.label;
    lines.push(profiles.includes('approfondissement')
      ? `HAUT POTENTIEL (aménagement pédagogique, jamais un diagnostic appliqué à un élève) : dans la version « ${approfondissement} » seulement. ${hpi.prompt} Ne retire ni l’étayage ni les aides des autres versions.`
      : `HAUT POTENTIEL (aménagement pédagogique, jamais un diagnostic appliqué à un élève) : ajoute à la fin de chaque version un « Défi » facultatif (tâche ouverte à plusieurs solutions, transfert), sans rien modifier du reste de la version.`);
  }
  return lines;
}

/**
 * Objectif de l'évaluation. Texte à trous ou situation pratique : l'objectif ne demande jamais d'autres questions que
 * le format (un diagnostic n'y ajoute pas de « questions courtes ») ni de corrigé commenté (celui d'un texte à trous
 * est établi par Magistra ; une situation pratique n'en a pas). Version élève seule : aucune partie pour l'enseignant.
 */
function objectiveLine(req: GenerationRequest, cloze: boolean, practice: boolean): string {
  const objective = TYPES_EVALUATION.find(t => t.value === req.typeEvaluation);
  if (!objective) return '';
  if (objective.value === 'diagnostique' && (cloze || practice)) {
    const support = cloze
      ? 'le texte à trous porte sur les prérequis, et les mots à trouver repèrent les acquis et les représentations des élèves.'
      : 'la situation, pratiquée, repère les acquis et les représentations des élèves (ce qu’ils savent déjà faire).';
    const table = cloze
      ? ' Après le texte, pour l’enseignant, un tableau « mot manqué ou erreur observée → besoin repéré → piste de remédiation » (sans doubles crochets).'
      : ' Pour l’enseignant, un tableau « réussite ou difficulté observée → besoin repéré → piste de remédiation ».';
    return `OBJECTIF : évaluation diagnostique, avant l’apprentissage : ${support}${req.sansCorrige ? '' : table}`;
  }
  const noKey = req.sansCorrige || ((cloze || practice) && objective.value === 'formative');
  return noKey ? objective.promptSansCorrige ?? objective.prompt : objective.prompt;
}

export function toolInstructions(req: GenerationRequest, group: LevelGroup): string {
  const cloze = isClozeRequest(req);
  const travail = req.type === 'exercices' || req.type === 'evaluation';
  const practice = travail && isPracticeFormat(req.modalite);
  const ctx: Ctx = {
    req,
    group,
    sup: SUP.includes(group),
    primary: PRIMARY.includes(group),
    practice,
    fmt: formatLabel(req.format),
    // Texte à trous : le corrigé est établi par Magistra à partir des mots marqués (shared/cloze.ts).
    withKey: !req.sansCorrige && !cloze && !practice,
    notation: req.bareme ?? (req.type === 'evaluation' && defaultEvaluationNotation(req) === 'aucune' ? 'aucune' : 'sur20'),
  };
  // Version élève seule : le format ne fait pas écrire son corrigé (texte à trous : voir NO_ANSWER_KEY_CLOZE).
  const studentOnly = travail && !!req.sansCorrige && !cloze;
  const extra: string[] = [];
  if (req.type === 'evaluation') {
    const objective = objectiveLine(req, cloze, practice);
    if (objective) extra.push(objective);
  }
  // Cours : la forme choisie remplace la structure par défaut (voir BY_TOOL.cours). Correction d'une copie : le
  // format construit un sujet et son corrigé modèle ; seul le type de travail compte (voir BY_TOOL.corrige).
  if (req.type !== 'cours' && req.type !== 'corrige') {
    const format = modaliteLine(req, studentOnly);
    if (format) extra.push(format);
  }
  if (travail) {
    // Notation choisie : elle prime, y compris sur le barème d'un format d'épreuve. Sans notation choisie, le barème
    // d'un format d'épreuve prime sur le « sans note » d'une évaluation diagnostique (voir defaultEvaluationNotation).
    const bareme = req.bareme && (practice ? PRACTICE_NOTATION[req.bareme] : BAREMES.find(b => b.value === req.bareme)?.prompt);
    if (bareme) extra.push(`${bareme} Cette notation prime sur celle indiquée ci-dessus.`);
    else if (req.type === 'evaluation' && req.typeEvaluation === 'diagnostique' && hasOwnBareme(req.modalite)) {
      extra.push('NOTATION : le barème de ce format d’épreuve s’applique, même pour une évaluation diagnostique.');
    }
  }
  // Correction d'une copie : la note se justifie critère par critère (il n'y a pas de questions à pondérer).
  if (req.type === 'corrige' && req.bareme) extra.push(`${CORRECTION_GRADING[req.bareme]} Cette notation remplace celle du point 5.`);
  if (travail && req.sansCorrige) extra.push(cloze ? NO_ANSWER_KEY_CLOZE : practice ? NO_ANSWER_KEY_PRACTICE : NO_ANSWER_KEY);
  if (req.type === 'appreciations') {
    const ton = TONS.find(t => t.value === req.ton)?.prompt;
    if (ton) extra.push(ton);
  }
  if (req.type === 'differenciation') extra.push(...besoinsLines(req));
  return [BY_TOOL[req.type](ctx), ...extra].filter(Boolean).join('\n');
}

/** En-tête de la copie selon la notation de l'évaluation. */
const NOTATION_HEADER: Record<Notation, string> = {
  sur20: 'note sur 20',
  sur10: 'note sur 10',
  competences: 'positionnement par compétences (sans note chiffrée)',
  aucune: 'sans note',
};

/** Points des questions selon la notation (collège, lycée). */
const NOTATION_POINTS: Record<Notation, string> = {
  sur20: 'avec les points de chaque question ; le total doit faire exactement 20 points',
  sur10: 'avec les points de chaque question ; le total doit faire exactement 10 points',
  competences: 'chaque question rattachée à la compétence qu’elle évalue, sans points',
  aucune: 'sans points ni note',
};

/** Points des questions selon la notation (supérieur). */
const SUP_POINTS: Record<Notation, string> = {
  sur20: 'avec barème par question (total sur 20)',
  sur10: 'avec barème par question (total sur 10)',
  competences: 'chacun rattaché à l’acquis d’apprentissage évalué (sans note chiffrée)',
  aucune: 'sans barème ni note',
};

/** Texte à trous : le barème porte sur les mots trouvés (les blancs sont posés et numérotés par Magistra). */
const CLOZE_POINTS: Record<Notation, string> = {
  sur20: '10 à 20 mots à trouver, points par mot trouvé, total exactement 20 points (par exemple 20 mots à 1 point, ou 10 mots à 2 points)',
  sur10: '10 à 20 mots à trouver, points par mot trouvé, total exactement 10 points (par exemple 10 mots à 1 point, ou 20 mots à 0,5 point)',
  competences: '10 à 20 mots à trouver, sans points : positionnement sur la compétence évaluée',
  aucune: '10 à 20 mots à trouver, sans points ni note',
};

/**
 * Structure de l'évaluation, selon le niveau et la notation effective (celle choisie, sinon sans note pour un
 * diagnostic dont le format n'impose pas de barème, sinon sur 20) : l'en-tête et les points ne contredisent jamais la
 * notation. Texte à trous : une évaluation faite UNIQUEMENT de texte à trous, dont Magistra établit la banque de mots
 * et le corrigé. Situation pratique (EPS, arts) : ni copie ni corrigé, la grille du format.
 */
function evaluationBase({ req, group, sup, primary, practice, withKey, notation }: Ctx): string {
  const graded = notation === 'sur20' || notation === 'sur10';
  if (sup) {
    return `TÂCHE : rédiger un sujet d'examen${req.duree ? '' : ' (précise la durée)'}.
Structure : en-tête (intitulé, durée, documents autorisés), consignes, exercices/questions/cas ${SUP_POINTS[notation]}${withKey ? ", puis « Corrigé et grille d'évaluation » (réponses attendues, critères, niveaux d'exigence)" : ''}.`;
  }
  if (group === 'maternelle') {
    return `TÂCHE : concevoir une situation d'observation des apprentissages en maternelle (évaluation positive).
Structure : objectif observé, domaine d'apprentissage, matériel, déroulement (activité ou jeu, consigne orale), critères de réussite observables, grille d'observation (non encore acquis / en cours d'acquisition / acquis) à reporter dans le carnet de suivi. Aucune note, aucun écrit demandé à l'élève.`;
  }
  if (practice) {
    // EPS, arts : ni copie, ni parties de questions, ni corrigé ; la grille (et sa notation) est celle du format.
    return `TÂCHE : concevoir une situation d'évaluation pratique, au format ci-dessous : les élèves sont évalués en pratiquant, sans devoir écrit ni questions sur copie.
Structure : en-tête (classe, date, durée), puis la situation et sa grille d'évaluation telles que décrites par le format.`;
  }
  const cloze = isClozeRequest(req);
  if (primary) {
    // Pas de note à l'école primaire, sauf note chiffrée choisie par l'enseignant (sa notation suit, et prime).
    const noNote = req.bareme === 'sur20' || req.bareme === 'sur10' ? '' : ' Pas de note sur 20.';
    return cloze
      ? `TÂCHE : concevoir une évaluation adaptée à l'école primaire, sous forme de texte à trous et UNIQUEMENT de texte à trous (aucune autre question).
Structure : en-tête (prénom, date), une consigne unique et très claire (« Complète le texte avec les mots de la banque. »), un seul texte à trous avec un nombre de mots à trouver adapté à l'âge, compétences évaluées, puis grille de positionnement (non atteint / partiellement atteint / atteint / dépassé).${noNote}`
      : `TÂCHE : concevoir une évaluation adaptée à l'école primaire.
Structure : en-tête (prénom, date), consignes très claires, exercices courts, compétences évaluées pour chaque exercice, puis ${withKey ? 'corrigé et ' : ''}grille de positionnement (non atteint / partiellement atteint / atteint / dépassé).${noNote}`;
  }
  if (cloze) {
    return `TÂCHE : rédiger une évaluation sous forme de texte à trous, et UNIQUEMENT de texte à trous (aucune question ouverte, aucun QCM, aucune autre question).
Structure :
1. En-tête : établissement, nom, prénom, classe, date, durée, ${NOTATION_HEADER[notation]}.
2. Consigne unique : « Complète le texte avec les mots de la banque. » ; ${CLOZE_POINTS[notation]}.
3. Un seul texte à trous, suivi et cohérent, qui couvre les notions évaluées.
4. Compétences évaluées.`;
  }
  const parts = req.typeEvaluation === 'diagnostique'
    ? '2 à 4 parties de questions courtes, une par prérequis ou notion à repérer'
    : '3 ou 4 parties progressives (connaissances, compréhension, application, synthèse)';
  return `TÂCHE : rédiger une évaluation complète.
Structure :
1. En-tête : établissement, nom, prénom, classe, date, durée, ${NOTATION_HEADER[notation]}.
2. Consignes générales (matériel autorisé, conseils).
3. ${parts}, ${NOTATION_POINTS[notation]}.
4. Compétences évaluées pour chaque partie.${withKey ? `\n5. Corrigé détaillé, ${graded ? 'barème point par point' : 'réponses attendues'} et grille critériée pour les questions ouvertes.` : ''}`;
}

const BY_TOOL: Record<TypeContenu, (ctx: Ctx) => string> = {
  cours: ({ req, group, sup, fmt }) => {
    if (getModalite(req.modalite)) {
      return `TÂCHE : produire un support de cours ${sup ? 'de niveau universitaire' : 'prêt à être utilisé en classe'}, sous la forme demandée ci-dessous et seulement celle-ci.
${modaliteLine(req, false)}
Contenu exact et complet sur le sujet : définitions précises, notions clés, exemples adaptés au niveau.`;
    }
    if (sup) {
      return `TÂCHE : rédiger un cours${fmt ? ` au format ${fmt}` : ' magistral'} complet.
Structure attendue :
1. Titre, public, durée, prérequis.
2. Introduction problématisée : enjeux, question directrice, plan annoncé.
3. Développement en parties numérotées : définitions précises, concepts, modèles ou théories, exemples et cas concrets.
4. Encadrés « À retenir » et, si utile, « Point de vigilance ».
${group === 'master' || group === 'doctorat' ? '5. Débats et controverses, limites des approches présentées.\n6.' : '5.'} Conclusion et ouverture.
${group === 'master' || group === 'doctorat' ? '7.' : '6.'} Questions de révision ou d'approfondissement.
Si des sources sont fournies, construis le cours d'abord à partir d'elles et cite-les.`;
    }
    if (group === 'maternelle') {
      return `TÂCHE : concevoir une séance (ou une série d'ateliers) de maternelle.
Structure : objectif, domaine d'apprentissage, matériel, organisation (regroupement / ateliers), déroulé en phases courtes avec consignes orales, rôle de l'enseignant, critères de réussite observables, prolongements.`;
    }
    return `TÂCHE : rédiger un cours complet, prêt à être utilisé en classe.
Structure :
1. En-tête : titre, niveau, matière, durée, place dans la progression.
2. Objectifs (verbes d'action) et prérequis.
3. Déroulé : accroche, découverte / apports, application guidée, synthèse — avec des durées cohérentes avec la durée indiquée.
4. Encadrés : définitions, « À retenir », « Attention », « Pour aller plus loin ».
5. Trace écrite (ce que l'élève garde dans son cahier).
6. Prolongement (travail personnel, séance suivante).`;
  },

  exercices: ({ req, group, sup, primary, practice, fmt, withKey }) => {
    // Ce que l'on compte (exercices, questions, ateliers…) ; null : un travail d'un seul tenant (dissertation, dictée…).
    const unit = countUnit(req.modalite, group);
    const count = unit ? req.nombreExercices : undefined;
    if (practice) {
      // EPS, arts : on apprend en pratiquant ; ni exercice écrit, ni corrigé (les observables sont dans le format).
      return [
        'TÂCHE : concevoir UNE situation de pratique complète, au format demandé ci-dessous : les élèves apprennent en pratiquant, sans exercice écrit ni corrigé.',
        exercicesDifficulty(req, unit, count),
        'Un titre et les compétences travaillées, puis la situation telle que décrite par le format.',
      ].join('\n');
    }
    const exact = !unit || !count
      ? ''
      : isClozeRequest(req)
        ? `EXACTEMENT ${countText(count, unit)}, chacun entre doubles crochets`
        : `EXACTEMENT ${countText(count, unit)}, numéroté${unit.feminine ? 'e' : ''}s de 1 à ${count}`;
    const diff = exercicesDifficulty(req, unit, count);
    if (group === 'maternelle') {
      return `TÂCHE : proposer ${count && unit ? (unit.many === 'activités' ? `EXACTEMENT ${plural(count, 'activité')} ou atelier${count > 1 ? 's' : ''}` : `EXACTEMENT ${countText(count, unit)}`) : '4 à 6 activités ou ateliers'} de maternelle sur le sujet.
${diff}
Les élèves ne lisent pas encore : activités de manipulation, jeux, langage oral, tri, graphisme ou motricité, avec consigne orale courte à dire à l'élève, matériel et organisation (atelier, regroupement).
Pour chaque activité : ce que l'on observe (critères de réussite observables), aide possible, prolongement. Aucune note ni barème.`;
    }
    const key = !withKey
      ? ''
      : sup
        ? 'Termine par une partie « Éléments de correction » détaillée (démarche, résultats, erreurs fréquentes).'
        : primary
          ? 'Termine par une partie « Corrigé » complète (réponses et démarche attendue) et les critères de réussite ; pas de note sur 20.'
          : 'Termine par une partie « Corrigé » complète (réponses et démarche) et un barème indicatif.';
    if (!unit) {
      return [
        `TÂCHE : rédiger ${sup ? `pour une séance de ${fmt || 'travaux dirigés'} ` : ''}UN SEUL travail complet, au format demandé ci-dessous (et non une série d'exercices).`,
        diff,
        'Un titre, une consigne claire (verbes d’action) et les compétences travaillées.',
        key,
      ].filter(Boolean).join('\n');
    }
    const byDefault = unit.many === 'exercices';
    if (sup) {
      return `TÂCHE : rédiger un sujet de ${fmt || 'travaux dirigés'} : ${exact ? (byDefault ? `EXACTEMENT ${plural(count!, 'exercice')} (problèmes ou études de cas compris), numérotés de 1 à ${count}` : exact) : byDefault ? '4 à 8 exercices, problèmes ou études de cas' : `des ${unit.many} en nombre adapté au niveau`}.
${diff}
Chaque énoncé est complet (données, hypothèses, questions numérotées).${key ? ` ${key}` : ''}`;
    }
    return [
      `TÂCHE : rédiger ${exact || (byDefault ? 'une série de 6 à 10 exercices' : `un travail au format demandé ci-dessous, avec un nombre de ${unit.many} adapté au niveau`)}.`,
      diff,
      req.modalite ? '' : 'Varie les formats (QCM, vrai/faux justifié, texte à trous, calcul, rédaction, analyse de document, tableau à compléter) selon ce qui convient au niveau.',
      byDefault
        ? 'Chaque exercice a un titre court, une consigne claire (un verbe d’action) et la compétence travaillée. Ajoute un « Coup de pouce » pour les exercices difficiles.'
        : 'Consignes claires (un verbe d’action), compétence travaillée indiquée.',
      key,
    ].filter(Boolean).join('\n');
  },

  evaluation: (ctx) => [evaluationBase(ctx), difficultyLine(ctx.req, ctx.group)].filter(Boolean).join('\n'),

  sequence: ({ req, group, sup, primary }) => {
    const n = req.nombreSeances;
    const seances = n ? `EXACTEMENT ${plural(n, 'séance')}, numérotées de 1 à ${n}` : '4 à 6 séances';
    if (sup) {
      return `TÂCHE : organiser un module (unité d'enseignement) en ${n ? seances : 'séances'}.
Structure : acquis d'apprentissage visés, prérequis, tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant), détail de chaque séance, modalités d'évaluation (contrôle continu, examen), lectures recommandées (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, les types de lectures à constituer).`;
    }
    if (group === 'maternelle') {
      return `TÂCHE : concevoir une séquence de maternelle de ${seances}.
Structure : titre, section, domaine d'apprentissage, objectifs, tableau synoptique (séance | titre | objectif | activités | durée | organisation), détail de chaque séance (déroulé en phases courtes, consignes orales, matériel, ateliers, rôle de l'enseignant), évaluation positive (réussites observées, carnet de suivi des apprentissages), prolongements.`;
    }
    return `TÂCHE : concevoir une séquence pédagogique de ${seances}.
Structure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation ${primary ? 'finale (positionnement sur les objectifs, sans note sur 20)' : 'sommative'}, prolongements.`;
  },

  fiche_prep: ({ group, sup, fmt }) => (sup
    ? `TÂCHE : rédiger une fiche de séance${fmt ? ` (${fmt})` : ''}.
Structure : objectifs, prérequis, déroulé minuté en tableau (phase | durée | activité enseignant | activité étudiants | supports), consignes données aux étudiants, évaluation formative, points de vigilance.`
    : `TÂCHE : rédiger une fiche de préparation de séance.
Structure : en-tête (niveau, matière, titre, durée, place dans la séquence), objectifs, compétences visées, matériel, prérequis, déroulement en tableau (phase | durée | activité enseignant | activité élève | modalité | matériel), différenciation, critères de réussite, trace écrite, bilan.${group === 'maternelle' ? '\nEn maternelle : ateliers, manipulation, regroupements, lien avec les domaines d’apprentissage.' : ''}`),

  progression: ({ req, sup }) => {
    if (sup) {
      return `TÂCHE : rédiger un syllabus (plan de cours semestriel).
Structure : présentation, prérequis, acquis d'apprentissage, calendrier en tableau (semaine | thème | CM | TD/TP | travail personnel), modalités d'évaluation, charge de travail estimée, ressources (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, indique les types de ressources à constituer).`;
    }
    if (req.modalite === 'periode') {
      return `TÂCHE : construire la progression d'une période.
Structure : volume horaire estimé, tableau semaine par semaine (semaine | thème ou chapitre | notions | compétences | évaluation), repères de progressivité, liens interdisciplinaires.`;
    }
    return `TÂCHE : construire une progression annuelle.
Structure : volume horaire estimé, tableau par période (période | semaines | thème ou chapitre | notions | compétences | évaluation), repères de progressivité, liens interdisciplinaires, projets possibles.
Découpe l'année en 5 périodes séparées par les vacances scolaires.`;
  },

  appreciations: ({ req, group, sup }) => {
    const n = req.nombreAppreciations ?? 10;
    const profil = PROFILS_ELEVE.find(p => p.value === req.profilEleve)?.label ?? 'Bon niveau';
    // Destination : bulletin du trimestre par défaut ; livret scolaire du bac (annuel : aucun trimestre) ; conseil de
    // classe (avis du professeur principal sur l'ensemble des disciplines).
    const livret = !sup && req.modalite === 'livret_bac';
    const conseil = !sup && req.modalite === 'conseil_classe';
    // Accord en genre et en nombre : « 7 appréciations différentes, numérotées », « 1 commentaire ».
    const noun: { singular: string; plural: string; feminine: boolean } = sup
      ? { singular: "commentaire d'évaluation", plural: "commentaires d'évaluation", feminine: false }
      : group === 'maternelle'
        ? { singular: 'commentaire pour le carnet de suivi des apprentissages', plural: 'commentaires pour le carnet de suivi des apprentissages', feminine: false }
        : livret
          ? { singular: 'appréciation annuelle du livret scolaire', plural: 'appréciations annuelles du livret scolaire', feminine: true }
          : conseil
            ? { singular: 'appréciation générale du conseil de classe', plural: 'appréciations générales du conseil de classe', feminine: true }
            : { singular: 'appréciation de bulletin', plural: 'appréciations de bulletin', feminine: true };
    const e = noun.feminine ? 'e' : '';
    const who = sup ? "l'étudiant" : "l'élève";
    const period = req.trimestre && !sup && !livret ? `, pour le trimestre ${req.trimestre}` : '';
    const head = n > 1
      ? `TÂCHE : rédiger EXACTEMENT ${n} ${noun.plural} différent${e}s, numéroté${e}s de 1 à ${n}${period}. Ni plus, ni moins.`
      : `TÂCHE : rédiger EXACTEMENT 1 ${noun.singular}${period}. ${noun.feminine ? 'Une seule' : 'Un seul'}, pas davantage.`;
    const content = livret
      ? "le bilan de l'année entière (compétences et méthodes, régularité du travail), puis le potentiel et les perspectives ; registre sobre et précis"
      : conseil
        ? "un point positif d'abord, les points forts et les axes de progrès sur l'ensemble des disciplines (jamais une seule matière), le comportement et l'investissement, un conseil concret et bienveillant pour la suite"
        : `un point positif d'abord, ${group === 'maternelle' ? 'les réussites observées' : 'les compétences travaillées'}, un conseil concret et bienveillant pour progresser`;
    return `${head}
Profil de ${who} : ${profil}.
Pour chaque texte : 2 à 3 phrases (300 caractères maximum), ${content}.
Varie les formulations d'un texte à l'autre ; évite les formules toutes faites (« peut mieux faire »). N'invente pas de prénom : rédige de façon neutre.
L'enseignant choisira et personnalisera ensuite.`;
  },

  differenciation: ({ req, sup }) => {
    const selected = req.profilsDifferenciation?.length ? req.profilsDifferenciation : PROFILS_DIFFERENCIATION.map(p => p.value);
    const chosen = PROFILS_DIFFERENCIATION.filter(p => selected.includes(p.value));
    const list = chosen.map((p, i) => `${i + 1}. Version « ${p.label} » (${p.description}) — ${DIFF_GUIDANCE[p.value]}`).join('\n');
    return `TÂCHE : adapter ${req.contenuSource ? "l'exercice ou le contenu fourni ci-dessous" : 'un exercice sur le sujet indiqué'} en ${chosen.length} version${chosen.length > 1 ? 's' : ''}, et UNIQUEMENT ${chosen.length > 1 ? 'celles-ci' : 'celle-ci'} :
${list}
${chosen.length > 1 ? 'Toutes les versions travaillent les MÊMES compétences ; seul le chemin change.' : 'La version travaille les mêmes compétences que le contenu de départ.'}
Ne rédige aucune autre version que ${chosen.length > 1 ? 'celles listées' : 'celle indiquée'}.${sup ? '\nDans le supérieur, pense aussi aux aménagements (tiers-temps, supports accessibles).' : ''}`;
  },

  lettre_parents: ({ req, sup }) => {
    const type = TYPES_LETTRE.find(t => t.value === req.typeLettre)?.label ?? 'Information';
    const who = req.profile?.displayName ? `Signataire : ${req.profile.displayName}.` : 'Signataire : laisse [Nom de l’enseignant].';
    const where = req.profile?.etablissement ? `Établissement : ${req.profile.etablissement}.` : 'Établissement : laisse [Établissement].';
    if (sup) {
      return `TÂCHE : rédiger un message (courriel ou courrier) aux étudiants. Objet : ${type}.
${who} ${where}
Ton professionnel, clair et respectueux (les étudiants sont adultes). Structure : objet, formule d'appel, exposé factuel, informations pratiques ou actions attendues, formule de politesse, signature.
N'invente aucun fait : utilise uniquement le contexte fourni et laisse des champs entre crochets pour ce qui manque ([Date], [Salle]…).`;
    }
    const structure = req.modalite === 'carnet'
      ? 'Structure : formule d’appel, l’information ou la demande en quelques lignes, formule de politesse courte, signature.'
      : req.modalite === 'mail'
        ? 'Structure : objet explicite, formule d’appel, exposé factuel et sans jugement, propositions concrètes (rendez-vous, accompagnement), ouverture au dialogue, formule de politesse, signature.'
        : "Structure : en-tête (établissement, lieu, date), objet, formule d'appel, exposé factuel et sans jugement, propositions concrètes (rendez-vous, accompagnement), ouverture au dialogue, formule de politesse, signature.";
    return `TÂCHE : rédiger un courrier aux parents ou responsables légaux. Objet : ${type}.
${who} ${where}
${structure}
Ton toujours professionnel et bienveillant, jamais accusateur.
N'invente aucun fait : utilise uniquement le contexte fourni et laisse des champs entre crochets pour ce qui manque ([Nom de l'élève], [Date]…).
C'est un courrier, pas un document pédagogique : ne mentionne ni compétences, ni programme, ni référentiel, ni évaluation chiffrée.`;
  },

  cahier_journal: ({ group, sup, primary }) => (primary
    ? `TÂCHE : rédiger le cahier journal d'une journée de classe.
Tableau horaire complet : horaire | domaine / matière | intitulé | objectif | déroulement résumé | matériel | modalité.
Inclure accueil, récréations, pause méridienne${group === 'maternelle' ? ', temps de repos ou de sieste, passages aux toilettes, habillage' : ''}.
Horaires indicatifs 8h30-11h30 / 13h30-16h30, à adapter ; répartition cohérente avec les volumes horaires hebdomadaires du cycle.`
    : `TÂCHE : rédiger le planning détaillé d'une journée d'enseignement.
Tableau : horaire | ${sup ? 'groupe / formation' : 'classe'} | séance | objectif | déroulement résumé | matériel.
Prévoir les pauses et un temps de préparation / correction.`),

  corrige: ({ req, group, sup }) => {
    const grading = group === 'maternelle' || group === 'elementaire'
      ? 'Positionnement sur une échelle de maîtrise (non atteint / partiellement atteint / atteint / dépassé), sans note sur 20.'
      : 'Note indicative sur 20 avec justification du barème.';
    const work = getModalite(req.modalite);
    // Le type de travail oriente la correction (ses attendus), sans jamais faire construire un sujet ni un corrigé modèle.
    const attendus = work ? ATTENDUS_COPIE[work.value] ?? 'structure, démarche, argumentation, expression, respect de la consigne' : '';
    const typeLine = work
      ? `\nTYPE DE TRAVAIL : ${work.label.toLowerCase()}. Évalue la copie avec les attendus méthodologiques de ce type de travail : ${attendus}. Ne rédige ni nouveau sujet, ni texte support, ni corrigé modèle complet : corrige le travail fourni.`
      : '';
    return `TÂCHE : corriger et annoter le travail ${sup ? "d'étudiant" : "d'élève"} fourni.${typeLine}
Structure :
1. Appréciation globale (2 à 3 phrases).
2. Points réussis.
3. Erreurs classées (contenu / méthode / langue / présentation) : pour chacune, citation exacte du passage, explication, correction proposée, notion à revoir.
4. Trois conseils prioritaires de progression.
5. ${grading}
6. Appréciation finale bienveillante et exigeante.
Ne cite que des passages réellement présents dans le travail fourni.`;
  },
};
