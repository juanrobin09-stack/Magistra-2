// Texte des consignes de l'outil Séquence tel qu'il était AVANT l'option « plan d'abord » (relevé sur le code d'alors).
// Sans l'option, il doit rester identique caractère pour caractère (tests/shared/planSeulement.test.ts) : ne le modifiez
// que si la consigne de la séquence complète change volontairement.

import type { GenerationRequest } from '../../shared/types.js';

export interface SequencePromptBaseline {
  name: string;
  req: Partial<GenerationRequest>;
  /** toolInstructions() de l'outil Séquence : TÂCHE, structure et démarche. */
  tool: string;
}

export const SEQUENCE_PROMPT_BASELINE: SequencePromptBaseline[] = [
  {
    name: "college",
    req: { niveau: "4eme", matiere: "francais" },
    tool: "TÂCHE : concevoir une séquence pédagogique de 4 à 6 séances.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation sommative, prolongements.",
  },
  {
    name: "college6",
    req: { niveau: "4eme", matiere: "francais", nombreSeances: 6, duree: "55 minutes", objectifs: "Comprendre", consignes: "Varier" },
    tool: "TÂCHE : concevoir une séquence pédagogique de EXACTEMENT 6 séances, numérotées de 1 à 6.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation sommative, prolongements.",
  },
  {
    name: "college_inv",
    req: { niveau: "4eme", matiere: "francais", nombreSeances: 4, modalite: "classe_inversee" },
    tool: "TÂCHE : concevoir une séquence pédagogique de EXACTEMENT 4 séances, numérotées de 1 à 4.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation sommative, prolongements.\nFORME : classe inversée. À la maison : une capsule (script d’une vidéo de 5 minutes au plus ou texte court) et 3 questions de vérification ; en classe : des activités de groupe pour appliquer et approfondir, puis une synthèse.\nApplique cette démarche à toute la séquence et à chacune de ses séances, en conservant la structure demandée ci-dessus (tableau des séances, détail de chaque séance) et le nombre de séances indiqué. En classe inversée, les séances s’appuient chacune sur une capsule préparée à la maison avant la séance, puis sur des activités en classe.",
  },
  {
    name: "primaire",
    req: { niveau: "cm1", matiere: "francais", nombreSeances: 5 },
    tool: "TÂCHE : concevoir une séquence pédagogique de EXACTEMENT 5 séances, numérotées de 1 à 5.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation finale (positionnement sur les objectifs, sans note sur 20), prolongements.",
  },
  {
    name: "primaire_auto",
    req: { niveau: "cm1", matiere: "francais" },
    tool: "TÂCHE : concevoir une séquence pédagogique de 4 à 6 séances.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation finale (positionnement sur les objectifs, sans note sur 20), prolongements.",
  },
  {
    name: "lycee",
    req: { niveau: "terminale_gen", matiere: "francais", nombreSeances: 8 },
    tool: "TÂCHE : concevoir une séquence pédagogique de EXACTEMENT 8 séances, numérotées de 1 à 8.\nStructure : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau synoptique (séance | titre | objectif | activités | durée | évaluation), détail de chaque séance (objectif, déroulé minuté, supports, modalités, différenciation), évaluation sommative, prolongements.",
  },
  {
    name: "maternelle",
    req: { niveau: "maternelle_ms", matiere: "langage_oral", nombreSeances: 3 },
    tool: "TÂCHE : concevoir une séquence de maternelle de EXACTEMENT 3 séances, numérotées de 1 à 3.\nStructure : titre, section, domaine d'apprentissage, objectifs, tableau synoptique (séance | titre | objectif | activités | durée | organisation), détail de chaque séance (déroulé en phases courtes, consignes orales, matériel, ateliers, rôle de l'enseignant), évaluation positive (réussites observées, carnet de suivi des apprentissages), prolongements.",
  },
  {
    name: "maternelle_auto",
    req: { niveau: "maternelle_gs", matiere: "langage_oral" },
    tool: "TÂCHE : concevoir une séquence de maternelle de 4 à 6 séances.\nStructure : titre, section, domaine d'apprentissage, objectifs, tableau synoptique (séance | titre | objectif | activités | durée | organisation), détail de chaque séance (déroulé en phases courtes, consignes orales, matériel, ateliers, rôle de l'enseignant), évaluation positive (réussites observées, carnet de suivi des apprentissages), prolongements.",
  },
  {
    name: "sup",
    req: { niveau: "licence_3", matiere: "autre", nombreSeances: 10, format: "cm", discipline: "Droit" },
    tool: "TÂCHE : organiser un module (unité d'enseignement) en EXACTEMENT 10 séances, numérotées de 1 à 10.\nStructure : acquis d'apprentissage visés, prérequis, tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant), détail de chaque séance, modalités d'évaluation (contrôle continu, examen), lectures recommandées (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, les types de lectures à constituer).",
  },
  {
    name: "sup_auto",
    req: { niveau: "licence_1", matiere: "autre" },
    tool: "TÂCHE : organiser un module (unité d'enseignement) en séances.\nStructure : acquis d'apprentissage visés, prérequis, tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant), détail de chaque séance, modalités d'évaluation (contrôle continu, examen), lectures recommandées (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, les types de lectures à constituer).",
  },
  {
    name: "sup_inv",
    req: { niveau: "master_1", matiere: "autre", nombreSeances: 6, modalite: "classe_inversee" },
    tool: "TÂCHE : organiser un module (unité d'enseignement) en EXACTEMENT 6 séances, numérotées de 1 à 6.\nStructure : acquis d'apprentissage visés, prérequis, tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant), détail de chaque séance, modalités d'évaluation (contrôle continu, examen), lectures recommandées (uniquement parmi les sources fournies, citées avec leur numéro ; sinon, les types de lectures à constituer).\nFORME : classe inversée. À la maison : une capsule (script d’une vidéo de 5 minutes au plus ou texte court) et 3 questions de vérification ; en classe : des activités de groupe pour appliquer et approfondir, puis une synthèse.\nApplique cette démarche à toute la séquence et à chacune de ses séances, en conservant la structure demandée ci-dessus (tableau des séances, détail de chaque séance) et le nombre de séances indiqué. En classe inversée, les séances s’appuient chacune sur une capsule préparée à la maison avant la séance, puis sur des activités en classe.",
  },
];
