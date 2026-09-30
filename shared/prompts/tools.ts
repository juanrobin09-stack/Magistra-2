// Consignes spécifiques à chacun des 11 outils, adaptées au niveau.

import { PROFILS_DIFFERENCIATION, PROFILS_ELEVE, TYPES_LETTRE, type ProfilDifferenciation, type TypeContenu } from '../catalog.js';
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

function formatLabel(format?: string): string {
  switch (format) {
    case 'cm': return 'cours magistral (CM)';
    case 'td': return 'travaux dirigés (TD)';
    case 'tp': return 'travaux pratiques (TP)';
    case 'seminaire': return 'séminaire';
    default: return '';
  }
}

export function toolInstructions(req: GenerationRequest, group: LevelGroup): string {
  const sup = SUP.includes(group);
  const primary = PRIMARY.includes(group);
  const fmt = formatLabel(req.format);

  const difficultyLine = req.difficulte === 'facile' ? '\nNiveau de difficulté : facile (vérification des connaissances et savoir-faire essentiels).'
    : req.difficulte === 'moyen' ? '\nNiveau de difficulté : moyen.'
      : req.difficulte === 'difficile' ? '\nNiveau de difficulté : exigeant (transfert, situations complexes).'
        : req.difficulte === 'differencie' ? '\nQuestions de difficulté graduée, clairement identifiées (★ facile, ★★ intermédiaire, ★★★ avancé).'
          : '';

  const byTool: Record<TypeContenu, () => string> = {
    cours: () => sup
      ? `TÂCHE : rédiger un cours${fmt ? ` au format ${fmt}` : ' magistral'} complet.
Structure attendue :
1. Titre, public, durée, prérequis.
2. Introduction problématisée : enjeux, question directrice, plan annoncé.
3. Développement en parties numérotées : définitions précises, concepts, modèles ou théories, exemples et cas concrets.
4. Encadrés « À retenir » et, si utile, « Point de vigilance ».
${group === 'master' || group === 'doctorat' ? '5. Débats et controverses, limites des approches présentées.\n6.' : '5.'} Conclusion et ouverture.
${group === 'master' || group === 'doctorat' ? '7.' : '6.'} Questions de révision ou d'approfondissement.
Si des sources sont fournies, construis le cours d'abord à partir d'elles et cite-les.`
      : group === 'maternelle'
        ? `TÂCHE : concevoir une séance (ou une série d'ateliers) de maternelle.
Structure : objectif, domaine d'apprentissage, matériel, organisation (regroupement / ateliers), déroulé en phases courtes avec consignes orales, rôle de l'enseignant, critères de réussite observables, prolongements.`
        : `TÂCHE : rédiger un cours complet, prêt à être utilisé en classe.
Structure :
1. En-tête : titre, niveau, matière, durée, place dans la progression.
2. Objectifs (verbes d'action) et prérequis.
3. Déroulé : accroche, découverte / apports, application guidée, synthèse — avec des durées cohérentes avec la durée indiquée.
4. Encadrés : définitions, « À retenir », « Attention », « Pour aller plus loin ».
5. Trace écrite (ce que l'élève garde dans son cahier).
6. Prolongement (travail personnel, séance suivante).`,

    exercices: () => {
      const diff = req.difficulte === 'facile' ? 'Niveau de difficulté : facile (consolidation des bases).'
        : req.difficulte === 'moyen' ? 'Niveau de difficulté : moyen.'
          : req.difficulte === 'difficile' ? 'Niveau de difficulté : difficile (transfert, problèmes complexes).'
            : req.difficulte === 'differencie' ? 'Propose trois niveaux clairement identifiés (★ facile, ★★ intermédiaire, ★★★ avancé) travaillant les mêmes compétences.'
              : 'Progression du plus simple au plus complexe.';
      if (sup) {
        return `TÂCHE : rédiger un sujet de ${fmt || 'travaux dirigés'} : 4 à 8 exercices, problèmes ou études de cas.
${diff}
Chaque énoncé est complet (données, hypothèses, questions numérotées). Termine par une partie « Éléments de correction » détaillée (démarche, résultats, erreurs fréquentes).`;
      }
      if (group === 'maternelle') {
        return `TÂCHE : proposer 4 à 6 activités ou ateliers de maternelle sur le sujet.
${diff}
Les élèves ne lisent pas encore : activités de manipulation, jeux, langage oral, tri, graphisme ou motricité, avec consigne orale courte à dire à l'élève, matériel et organisation (atelier, regroupement).
Pour chaque activité : ce que l'on observe (critères de réussite observables), aide possible, prolongement. Aucune note ni barème.`;
      }
      return `TÂCHE : rédiger une série de 6 à 10 exercices.
${diff}
Varie les formats (QCM, vrai/faux justifié, texte à trous, calcul, rédaction, analyse de document, tableau à compléter) selon ce qui convient au niveau.
Ajoute un « Coup de pouce » pour les exercices difficiles.
${primary
    ? 'Termine par une partie « Corrigé » complète (réponses et démarche attendue) et les critères de réussite ; pas de note sur 20.'
    : 'Termine par une partie « Corrigé » complète (réponses et démarche) et un barème indicatif.'}`;
    },

    evaluation: () => (sup
      ? `TÂCHE : rédiger un sujet d'examen${req.duree ? '' : ' (précise la durée)'}.
Structure : en-tête (intitulé, durée, documents autorisés), consignes, exercices/questions/cas avec barème par question (total sur 20), puis « Corrigé et grille d'évaluation » (réponses attendues, critères, niveaux d'exigence).`
      : group === 'maternelle'
        ? `TÂCHE : concevoir une situation d'observation des apprentissages en maternelle (évaluation positive).
Structure : objectif observé, domaine d'apprentissage, matériel, déroulement (activité ou jeu, consigne orale), critères de réussite observables, grille d'observation (non encore acquis / en cours d'acquisition / acquis) à reporter dans le carnet de suivi. Aucune note, aucun écrit demandé à l'élève.`
        : primary
        ? `TÂCHE : concevoir une évaluation adaptée à l'école primaire.
Structure : en-tête (prénom, date), consignes très claires, exercices courts, compétences évaluées pour chaque exercice, puis corrigé et grille de positionnement (non atteint / partiellement atteint / atteint / dépassé). Pas de note sur 20.`
        : `TÂCHE : rédiger une évaluation complète.
Structure :
1. En-tête : établissement, nom, prénom, classe, date, durée, note sur 20.
2. Consignes générales (matériel autorisé, conseils).
3. 3 ou 4 parties progressives (connaissances, compréhension, application, synthèse) avec les points de chaque question ; le total doit faire exactement 20 points.
4. Compétences évaluées pour chaque partie.
5. Corrigé détaillé, barème point par point et grille critériée pour les questions ouvertes.`) + difficultyLine,

    sequence: () => sup
      ? `TÂCHE : organiser un module (unité d'enseignement) en séances.
Structure : acquis d'apprentissage visés, prérequis, tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant), détail de chaque séance, modalités d'évaluation (contrôle continu, examen), lectures recommandées (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, les types de lectures à constituer).`
      : group === 'maternelle'
        ? `TÂCHE : concevoir une séquence de maternelle de 4 à 6 séances.
Structure : titre, section, domaine d'apprentissage, objectifs, tableau synoptique (séance | titre | objectif | activités | durée | organisation), détail de chaque séance (déroulé en phases courtes, consignes orales, matériel, ateliers, rôle de l'enseignant), évaluation positive (réussites observées, carnet de suivi des apprentissages), prolongements.`
        : `TÂCHE : concevoir une séquence pédagogique de 4 à 6 séances.
Structure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation ${primary ? 'finale (positionnement sur les objectifs, sans note sur 20)' : 'sommative'}, prolongements.`,

    fiche_prep: () => sup
      ? `TÂCHE : rédiger une fiche de séance${fmt ? ` (${fmt})` : ''}.
Structure : objectifs, prérequis, déroulé minuté en tableau (phase | durée | activité enseignant | activité étudiants | supports), consignes données aux étudiants, évaluation formative, points de vigilance.`
      : `TÂCHE : rédiger une fiche de préparation de séance.
Structure : en-tête (niveau, matière, titre, durée, place dans la séquence), objectifs, compétences visées, matériel, prérequis, déroulement en tableau (phase | durée | activité enseignant | activité élève | modalité | matériel), différenciation, critères de réussite, trace écrite, bilan.${group === 'maternelle' ? '\nEn maternelle : ateliers, manipulation, regroupements, lien avec les domaines d’apprentissage.' : ''}`,

    progression: () => sup
      ? `TÂCHE : rédiger un syllabus (plan de cours semestriel).
Structure : présentation, prérequis, acquis d'apprentissage, calendrier en tableau (semaine | thème | CM | TD/TP | travail personnel), modalités d'évaluation, charge de travail estimée, ressources (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, indique les types de ressources à constituer).`
      : `TÂCHE : construire une progression annuelle.
Structure : volume horaire estimé, tableau par période (période | semaines | thème ou chapitre | notions | compétences | évaluation), repères de progressivité, liens interdisciplinaires, projets possibles.
Découpe l'année en 5 périodes séparées par les vacances scolaires.`,

    appreciations: () => {
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

    differenciation: () => {
      const selected = req.profilsDifferenciation?.length ? req.profilsDifferenciation : PROFILS_DIFFERENCIATION.map(p => p.value);
      const chosen = PROFILS_DIFFERENCIATION.filter(p => selected.includes(p.value));
      const list = chosen.map((p, i) => `${i + 1}. Version « ${p.label} » (${p.description}) — ${DIFF_GUIDANCE[p.value]}`).join('\n');
      return `TÂCHE : adapter ${req.contenuSource ? "l'exercice ou le contenu fourni ci-dessous" : 'un exercice sur le sujet indiqué'} en ${chosen.length} version${chosen.length > 1 ? 's' : ''}, et UNIQUEMENT ${chosen.length > 1 ? 'celles-ci' : 'celle-ci'} :
${list}
${chosen.length > 1 ? 'Toutes les versions travaillent les MÊMES compétences ; seul le chemin change.' : 'La version travaille les mêmes compétences que le contenu de départ.'}
Ne rédige aucune autre version que ${chosen.length > 1 ? 'celles listées' : 'celle indiquée'}.${sup ? '\nDans le supérieur, pense aussi aux aménagements (tiers-temps, supports accessibles).' : ''}`;
    },

    lettre_parents: () => {
      const type = TYPES_LETTRE.find(t => t.value === req.typeLettre)?.label ?? 'Information';
      const who = req.profile?.displayName ? `Signataire : ${req.profile.displayName}.` : 'Signataire : laisse [Nom de l’enseignant].';
      const where = req.profile?.etablissement ? `Établissement : ${req.profile.etablissement}.` : 'Établissement : laisse [Établissement].';
      return sup
        ? `TÂCHE : rédiger un message (courriel ou courrier) aux étudiants. Objet : ${type}.
${who} ${where}
Ton professionnel, clair et respectueux (les étudiants sont adultes). Structure : objet, formule d'appel, exposé factuel, informations pratiques ou actions attendues, formule de politesse, signature.
N'invente aucun fait : utilise uniquement le contexte fourni et laisse des champs entre crochets pour ce qui manque ([Date], [Salle]…).`
        : `TÂCHE : rédiger un courrier aux parents ou responsables légaux. Objet : ${type}.
${who} ${where}
Structure : en-tête (établissement, lieu, date), objet, formule d'appel, exposé factuel et sans jugement, propositions concrètes (rendez-vous, accompagnement), ouverture au dialogue, formule de politesse, signature.
Ton toujours professionnel et bienveillant, jamais accusateur.
N'invente aucun fait : utilise uniquement le contexte fourni et laisse des champs entre crochets pour ce qui manque ([Nom de l'élève], [Date]…).
C'est un courrier, pas un document pédagogique : ne mentionne ni compétences, ni programme, ni référentiel, ni évaluation chiffrée.`;
    },

    cahier_journal: () => primary
      ? `TÂCHE : rédiger le cahier journal d'une journée de classe.
Tableau horaire complet : horaire | domaine / matière | intitulé | objectif | déroulement résumé | matériel | modalité.
Inclure accueil, récréations, pause méridienne${group === 'maternelle' ? ', temps de repos ou de sieste, passages aux toilettes, habillage' : ''}.
Horaires indicatifs 8h30-11h30 / 13h30-16h30, à adapter ; répartition cohérente avec les volumes horaires hebdomadaires du cycle.`
      : `TÂCHE : rédiger le planning détaillé d'une journée d'enseignement.
Tableau : horaire | ${sup ? 'groupe / formation' : 'classe'} | séance | objectif | déroulement résumé | matériel.
Prévoir les pauses et un temps de préparation / correction.`,

    corrige: () => {
      const grading = group === 'maternelle' || group === 'elementaire'
        ? 'Positionnement sur une échelle de maîtrise (non atteint / partiellement atteint / atteint / dépassé), sans note sur 20.'
        : 'Note indicative sur 20 avec justification du barème.';
      return `TÂCHE : corriger et annoter le travail ${sup ? "d'étudiant" : "d'élève"} fourni.
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

  return byTool[req.type]();
}
