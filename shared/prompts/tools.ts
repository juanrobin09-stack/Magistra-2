// Consignes spécifiques à chacun des 11 outils, adaptées au niveau, puis précisées par les options choisies par
// l'enseignant : format normé (shared/formats.ts), objectif de l'évaluation, notation, corrigé, nombres exacts,
// ton, besoins particuliers. Une option choisie prime toujours sur le comportement par défaut de l'outil.

import { PROFILS_DIFFERENCIATION, PROFILS_ELEVE, TYPES_LETTRE, type ProfilDifferenciation, type TypeContenu } from '../catalog.js';
import {
  BAREMES, BESOINS_PARTICULIERS, countText, countUnit, getModalite, modalitePrompt, TONS, TYPES_EVALUATION,
} from '../formats.js';
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

/** Sans corrigé : version élève seule, prête à distribuer. */
const NO_ANSWER_KEY = 'VERSION ÉLÈVE SEULE : ne rédige AUCUN corrigé, aucune réponse, aucune solution. Uniquement les énoncés, les consignes et, si utile, les espaces de réponse et le barème.';

interface Ctx {
  req: GenerationRequest;
  group: LevelGroup;
  sup: boolean;
  primary: boolean;
  /** Format de séance du supérieur (CM, TD, TP, séminaire), en toutes lettres ; vide sinon. */
  fmt: string;
  /** Corrigé demandé (vrai par défaut). */
  withKey: boolean;
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

/** Consigne du format normé choisi par l'enseignant (vide sans format). */
function modaliteLine(req: GenerationRequest): string {
  const text = modalitePrompt(req.modalite, { niveau: req.niveau, matiere: req.matiere });
  return text ? `${text}\nCe format prime sur toute autre indication de forme ci-dessus.` : '';
}

function difficultyLine(req: GenerationRequest): string {
  switch (req.difficulte) {
    case 'facile': return 'Niveau de difficulté : facile (vérification des connaissances et savoir-faire essentiels).';
    case 'moyen': return 'Niveau de difficulté : moyen.';
    case 'difficile': return 'Niveau de difficulté : exigeant (transfert, situations complexes).';
    case 'differencie': return 'Questions de difficulté graduée, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé).';
    default: return '';
  }
}

export function toolInstructions(req: GenerationRequest, group: LevelGroup): string {
  const ctx: Ctx = {
    req,
    group,
    sup: SUP.includes(group),
    primary: PRIMARY.includes(group),
    fmt: formatLabel(req.format),
    withKey: !req.sansCorrige,
  };
  const extra: string[] = [];
  if (req.type === 'evaluation') {
    const objective = TYPES_EVALUATION.find(t => t.value === req.typeEvaluation)?.prompt;
    if (objective) extra.push(objective);
  }
  // Cours : la forme choisie remplace la structure par défaut (voir BY_TOOL.cours).
  if (req.type !== 'cours') {
    const format = modaliteLine(req);
    if (format) extra.push(format);
  }
  if (req.type === 'exercices' || req.type === 'evaluation') {
    const bareme = BAREMES.find(b => b.value === req.bareme)?.prompt;
    if (bareme) extra.push(`${bareme} Cette notation prime sur celle indiquée ci-dessus.`);
  }
  // Correction d'une copie : la note se justifie critère par critère (il n'y a pas de questions à pondérer).
  if (req.type === 'corrige' && req.bareme) extra.push(`${CORRECTION_GRADING[req.bareme]} Cette notation remplace celle du point 5.`);
  if ((req.type === 'exercices' || req.type === 'evaluation') && req.sansCorrige) extra.push(NO_ANSWER_KEY);
  if (req.type === 'appreciations') {
    const ton = TONS.find(t => t.value === req.ton)?.prompt;
    if (ton) extra.push(ton);
  }
  if (req.type === 'differenciation' && req.besoins?.length) {
    const lines = BESOINS_PARTICULIERS.filter(b => req.besoins!.includes(b.value)).map(b => `- ${b.prompt}`);
    extra.push(`BESOINS PARTICULIERS à prendre en compte dans chaque version (aménagements pédagogiques, jamais de diagnostic ni de terme médical appliqué à un élève) :\n${lines.join('\n')}`);
  }
  return [BY_TOOL[req.type](ctx), ...extra].filter(Boolean).join('\n');
}

const BY_TOOL: Record<TypeContenu, (ctx: Ctx) => string> = {
  cours: ({ req, group, sup, fmt }) => {
    if (getModalite(req.modalite)) {
      return `TÂCHE : produire un support de cours ${sup ? 'de niveau universitaire' : 'prêt à être utilisé en classe'}, sous la forme demandée ci-dessous et seulement celle-ci.
${modaliteLine(req)}
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

  exercices: ({ req, group, sup, primary, fmt, withKey }) => {
    // Ce que l'on compte (exercices, questions, ateliers…) ; null : un travail d'un seul tenant (dissertation, dictée…).
    const unit = countUnit(req.modalite, group);
    const count = unit ? req.nombreExercices : undefined;
    const exact = unit && count
      ? `EXACTEMENT ${countText(count, unit)}, numéroté${unit.feminine ? 'e' : ''}s de 1 à ${count}`
      : '';
    const diff = req.difficulte === 'facile' ? 'Niveau de difficulté : facile (consolidation des bases).'
      : req.difficulte === 'moyen' ? 'Niveau de difficulté : moyen.'
        : req.difficulte === 'difficile' ? 'Niveau de difficulté : difficile (transfert, problèmes complexes).'
          : req.difficulte === 'differencie' ? 'Propose trois niveaux clairement identifiés (★ facile, ★★ intermédiaire, ★★★ avancé) travaillant les mêmes compétences.'
            : 'Progression du plus simple au plus complexe.';
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

  evaluation: ({ req, group, sup, primary, withKey }) => {
    const base = sup
      ? `TÂCHE : rédiger un sujet d'examen${req.duree ? '' : ' (précise la durée)'}.
Structure : en-tête (intitulé, durée, documents autorisés), consignes, exercices/questions/cas avec barème par question (total sur 20)${withKey ? ", puis « Corrigé et grille d'évaluation » (réponses attendues, critères, niveaux d'exigence)" : ''}.`
      : group === 'maternelle'
        ? `TÂCHE : concevoir une situation d'observation des apprentissages en maternelle (évaluation positive).
Structure : objectif observé, domaine d'apprentissage, matériel, déroulement (activité ou jeu, consigne orale), critères de réussite observables, grille d'observation (non encore acquis / en cours d'acquisition / acquis) à reporter dans le carnet de suivi. Aucune note, aucun écrit demandé à l'élève.`
        : primary
          ? `TÂCHE : concevoir une évaluation adaptée à l'école primaire.
Structure : en-tête (prénom, date), consignes très claires, exercices courts, compétences évaluées pour chaque exercice, puis ${withKey ? 'corrigé et ' : ''}grille de positionnement (non atteint / partiellement atteint / atteint / dépassé). Pas de note sur 20.`
          : `TÂCHE : rédiger une évaluation complète.
Structure :
1. En-tête : établissement, nom, prénom, classe, date, durée, note sur 20.
2. Consignes générales (matériel autorisé, conseils).
3. 3 ou 4 parties progressives (connaissances, compréhension, application, synthèse) avec les points de chaque question ; le total doit faire exactement 20 points.
4. Compétences évaluées pour chaque partie.${withKey ? '\n5. Corrigé détaillé, barème point par point et grille critériée pour les questions ouvertes.' : ''}`;
    return [base, difficultyLine(req)].filter(Boolean).join('\n');
  },

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
    // Accord en genre et en nombre : « 7 appréciations différentes, numérotées », « 1 commentaire ».
    const noun: { singular: string; plural: string; feminine: boolean } = sup
      ? { singular: "commentaire d'évaluation", plural: "commentaires d'évaluation", feminine: false }
      : group === 'maternelle'
        ? { singular: 'commentaire pour le carnet de suivi des apprentissages', plural: 'commentaires pour le carnet de suivi des apprentissages', feminine: false }
        : { singular: 'appréciation de bulletin', plural: 'appréciations de bulletin', feminine: true };
    const e = noun.feminine ? 'e' : '';
    const who = sup ? "l'étudiant" : "l'élève";
    const period = req.trimestre && !sup ? `, pour le trimestre ${req.trimestre}` : '';
    const head = n > 1
      ? `TÂCHE : rédiger EXACTEMENT ${n} ${noun.plural} différent${e}s, numéroté${e}s de 1 à ${n}${period}. Ni plus, ni moins.`
      : `TÂCHE : rédiger EXACTEMENT 1 ${noun.singular}${period}. ${noun.feminine ? 'Une seule' : 'Un seul'}, pas davantage.`;
    return `${head}
Profil de ${who} : ${profil}.
Pour chaque texte : 2 à 3 phrases (300 caractères maximum), un point positif d'abord, ${group === 'maternelle' ? 'les réussites observées' : 'les compétences travaillées'}, un conseil concret et bienveillant pour progresser.
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
    return `TÂCHE : corriger et annoter le travail ${sup ? "d'étudiant" : "d'élève"} fourni.${work ? `\nTYPE DE TRAVAIL : ${work.label.toLowerCase()}. Évalue-le avec les attendus méthodologiques de ce format, rappelés ci-dessous : structure, démarche, argumentation, expression.` : ''}
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
