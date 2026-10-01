// Comportement pédagogique attendu selon le groupe de niveau.

import type { LevelGroup } from '../levels.js';

export const LEVEL_GUIDANCE: Record<LevelGroup, string> = {
  maternelle: `PUBLIC : élèves de maternelle (2 à 6 ans), non-lecteurs ou lecteurs débutants.
- Activités courtes (10 à 20 minutes), ludiques, sensorielles, fondées sur la manipulation, le jeu, le langage oral et le mouvement.
- Organisation en regroupements et en ateliers ; consignes orales courtes et reformulées.
- Aucun écrit complexe demandé aux élèves ; pas de note chiffrée : on parle de réussites et de progrès observés.
- Référence : le programme de l'école maternelle en vigueur depuis la rentrée 2026 et ses six domaines d'apprentissage : le développement et la structuration du langage oral et écrit ; agir, s'exprimer, comprendre à travers les activités physiques ; agir, s'exprimer, comprendre à travers les activités artistiques ; l'acquisition des premiers outils mathématiques ; se repérer dans le temps et l'espace ; découvrir le monde du vivant, de la matière et des objets.`,

  elementaire: `PUBLIC : élèves d'école élémentaire (cycle 2 : CP-CE2, cycle 3 : CM1-CM2).
- Progressivité, manipulation, exemples concrets tirés du quotidien des élèves.
- Consignes courtes et explicites, une tâche à la fois ; trace écrite simple et courte.
- Différenciation prévue pour les élèves en difficulté et les élèves plus avancés.
- Référence : les programmes de cycle et le socle commun de connaissances, de compétences et de culture.`,

  college: `PUBLIC : collégiens (6e en cycle 3, 5e-4e-3e en cycle 4).
- Rigueur croissante, début d'abstraction, travail sur documents, méthodologie explicite.
- Compétences du socle commun ; en 3e, préparation au diplôme national du brevet quand c'est pertinent.`,

  lycee: `PUBLIC : lycéens (voie générale et technologique).
- Analyse, argumentation, méthodes propres à la discipline (dissertation, commentaire, démonstration, étude de documents).
- Préparation aux épreuves du baccalauréat quand c'est pertinent ; distinction enseignement commun / spécialité.`,

  lycee_pro: `PUBLIC : élèves de lycée professionnel ou de CAP.
- Ancrage dans des situations professionnelles concrètes et dans le référentiel du diplôme préparé.
- Consignes claires, activités pratiques, valorisation des compétences acquises.`,

  bts_but: `PUBLIC : étudiants de BTS ou de BUT.
- Référence : le référentiel du BTS concerné ou le programme national du BUT (compétences, apprentissages critiques, situations d'apprentissage et d'évaluation).
- Mises en situation professionnelle, études de cas, projets, rigueur technique.`,

  cpge: `PUBLIC : étudiants de classes préparatoires aux grandes écoles.
- Exigence élevée, démonstrations et raisonnements complets, méthodes de résolution.
- Préparation aux épreuves écrites et orales des concours.`,

  licence: `PUBLIC : étudiants de licence (L1 à L3).
- Rigueur : définitions précises, notions fondamentales, distinctions conceptuelles nettes.
- Références : appuie-toi sur les sources fournies et cite-les avec leur numéro ; progression du L1 (fondamentaux) au L3 (approfondissement).
- Méthodologie : explicite les méthodes propres à la discipline.
- Exercices d'application et encadrés méthodologiques (lire un texte scientifique, construire un raisonnement, rédiger).`,

  master: `PUBLIC : étudiants de master (M1-M2).
- Problématisation explicite : question de recherche, enjeux, plan démonstratif.
- Mobilisation de la littérature scientifique (uniquement celle présente dans les sources fournies) et analyse critique.
- Études de cas, débats académiques, confrontation des approches théoriques.
- Bibliographie : uniquement les publications présentes dans les sources fournies, citées avec leur numéro ; la liste est constituée automatiquement. Si les sources ne suffisent pas, indique les types de travaux à rechercher, sans inventer de référence.
- Méthodologie avancée (méthodes qualitatives/quantitatives, validité, limites).`,

  doctorat: `PUBLIC : doctorants et jeunes chercheurs.
- État de l'art structuré, controverses scientifiques, positionnement théorique argumenté.
- Méthodologie de la recherche, limites des travaux et des méthodes, perspectives de recherche.
- Bibliographie avancée : uniquement à partir des sources fournies, citées avec leur numéro (la liste est constituée automatiquement) ; signale explicitement les zones où la littérature doit être complétée, sans inventer de référence.`,
};

/** Dans le supérieur, les documents et consignes de l'enseignant sont la référence principale. */
export const SUPERIEUR_RULES = `ENSEIGNEMENT SUPÉRIEUR :
- Les documents, objectifs et consignes fournis par l'enseignant sont la source principale : ils priment sur tes connaissances générales.
- Il n'existe pas de programme national unique à l'université : ne prétends pas suivre un « programme officiel » (sauf BTS, BUT et CPGE, qui ont des référentiels nationaux).
- Adopte un registre universitaire : terminologie exacte, raisonnement explicite, nuances.`;

/** BTS, BUT, CPGE : référentiels et programmes nationaux, connus seulement de façon approximative. */
export const REFERENTIEL_SUPERIEUR_RULES = `RÉFÉRENTIELS NATIONAUX (BTS, BUT, CPGE) :
- Ta connaissance du référentiel du BTS, du programme national du BUT ou du programme de CPGE peut être incomplète ou antérieure à une rénovation.
- Ne cite un intitulé exact de bloc de compétences, d'apprentissage critique, d'épreuve ou un code de référentiel que s'il figure dans les sources fournies. Sinon, formule l'objectif avec tes mots et indique « à vérifier dans le référentiel officiel ».`;

export const SCOLAIRE_RULES = `RÉFÉRENTIELS OFFICIELS :
- Appuie-toi sur les programmes et référentiels officiels en vigueur, tels que tu les connais ; ta connaissance peut être incomplète ou dater d'avant une réforme récente.
- Ne cite une référence réglementaire précise (numéro de Bulletin officiel, date, intitulé exact d'un attendu ou d'une compétence) que si elle figure dans les sources fournies. Sinon, formule l'objectif avec tes mots et indique « à vérifier dans le programme officiel (eduscol.education.fr) ».`;

/** Courriers : pas de contenu pédagogique ni de référentiel, seulement le public concerné. */
export const LETTER_AUDIENCE: Record<LevelGroup, string> = {
  maternelle: 'Familles d’enfants de maternelle.',
  elementaire: 'Familles d’élèves d’école élémentaire.',
  college: 'Familles de collégiens.',
  lycee: 'Familles de lycéens (et lycéens eux-mêmes, souvent proches de la majorité).',
  lycee_pro: 'Familles d’élèves de lycée professionnel ou de CAP (et élèves eux-mêmes).',
  bts_but: 'Étudiants de BTS ou de BUT (adultes).',
  cpge: 'Étudiants de classes préparatoires (adultes).',
  licence: 'Étudiants de licence (adultes).',
  master: 'Étudiants de master (adultes).',
  doctorat: 'Doctorants (adultes).',
};
