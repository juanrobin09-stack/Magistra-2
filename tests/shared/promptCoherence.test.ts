// Cohérence des consignes transmises au modèle : chaque option choisie par l'enseignant (format, corrigé, objectif,
// notation, difficulté, destination, besoins, matière de langue) ne doit contredire ni la structure de l'outil ni
// une autre option. Un petit modèle local (3B à 8B) suit la consigne la plus détaillée ou la dernière lue : une
// contradiction se paie par un document faux (corrigé dans une version élève, sujet réécrit au lieu d'une copie
// corrigée, texte à trous sans blancs, exercice d'anglais en français…).

import { describe, expect, it } from 'vitest';
import { getMatieresForNiveau, isMatiere, type Matiere } from '../../shared/catalog.js';
import { isModaliteAvailable, MODALITES, modalitePrompt } from '../../shared/formats.js';
import { isLangueAncienne, isLangueVivante, LANGUES_ANCIENNES, LANGUES_VIVANTES, targetLanguage } from '../../shared/languages.js';
import { ALL_NIVEAUX, type NiveauScolaire } from '../../shared/levels.js';
import { buildSystemPrompt, buildUserPrompt } from '../../shared/prompts/index.js';
import type { GenerationRequest } from '../../shared/types.js';

function req(extra: Partial<GenerationRequest>): GenerationRequest {
  return { type: 'exercices', niveau: '4eme', matiere: 'mathematiques', sujet: 'Les fractions', researchMode: 'documents', ...extra };
}

const sys = (r: Partial<GenerationRequest>) => buildSystemPrompt(req(r), false);
const user = (r: Partial<GenerationRequest>) => buildUserPrompt(req(r), []);
const count = (text: string, needle: string) => text.split(needle).length - 1;

/** Un niveau et une matière où ce format est proposé pour cet outil (il y en a toujours un). */
function whereAvailable(value: string, type: GenerationRequest['type']): { niveau: NiveauScolaire; matiere: Matiere } {
  for (const niveau of ALL_NIVEAUX) {
    for (const { value: matiere } of getMatieresForNiveau(niveau)) {
      if (isModaliteAvailable(value, type, niveau, matiere)) return { niveau, matiere };
    }
  }
  throw new Error(`${value} n'est proposé nulle part pour ${type}`);
}

const UNSCOPED_PRIME = 'Ce format prime sur toute autre indication de forme ci-dessus.';

describe('corrigé annoté : le type de travail oriente la correction, sans faire construire un sujet', () => {
  it('dissertation : attendus de la copie, structure de correction intacte, jamais la consigne du format', () => {
    const text = sys({ type: 'corrige', niveau: '1ere_gen', matiere: 'francais', modalite: 'dissertation', bareme: 'sur20', texteEleve: 'Copie' });
    expect(text).toMatch(/TYPE DE TRAVAIL : dissertation\. Évalue la copie avec les attendus méthodologiques de ce type de travail : analyse des termes du sujet, problématique/);
    expect(text).toMatch(/Ne rédige ni nouveau sujet, ni texte support, ni corrigé modèle complet : corrige le travail fourni\./);
    expect(text).toMatch(/1\. Appréciation globale/);
    expect(text).not.toMatch(/FORMAT : dissertation/);
    expect(text).not.toMatch(/prime sur toute autre indication/);
    // La notation choisie remplace le point 5, et c'est la seule consigne de notation.
    expect(count(text, 'Cette notation remplace celle du point 5.')).toBe(1);
    expect(count(text, 'NOTATION :')).toBe(1);
  });

  it('traduction (4e, anglais) et commentaire d’arrêt : aucun emplacement pour un texte que l’enseignant a déjà collé', () => {
    const traduction = sys({ type: 'corrige', niveau: '4eme', matiere: 'anglais', modalite: 'traduction', texteEleve: 'Copie' });
    expect(traduction).not.toMatch(/\[Texte à coller\]/);
    expect(traduction).not.toMatch(/traduction proposée/);
    expect(traduction).toMatch(/1\. Appréciation globale/);
    expect(traduction).toMatch(/fidélité au sens/);
    const arret = sys({ type: 'corrige', niveau: 'licence_2', matiere: 'droit', modalite: 'commentaire_arret', texteEleve: 'Copie' });
    expect(arret).not.toMatch(/\[Décision à coller\]/);
    expect(arret).toMatch(/fiche d’arrêt/);
  });

  it('demande : « Type de travail corrigé », jamais « Format demandé » ni le rappel « Respecte exactement le format »', () => {
    const text = user({ type: 'corrige', niveau: '4eme', matiere: 'anglais', modalite: 'traduction', texteEleve: 'Copie' });
    expect(text).toMatch(/- Type de travail corrigé : Traduction/);
    expect(text).not.toMatch(/Format demandé/);
    expect(text).not.toMatch(/Respecte exactement le format/);
  });

  it('chaque type de travail corrigé : aucune consigne de construction du format, des attendus pour la copie', () => {
    for (const m of MODALITES.filter(m => m.tools.includes('corrige'))) {
      const where = whereAvailable(m.value, 'corrige');
      const text = sys({ type: 'corrige', ...where, modalite: m.value, texteEleve: 'Copie' });
      const formatText = modalitePrompt(m.value, where);
      expect(text, m.value).toMatch(/TYPE DE TRAVAIL : /);
      expect(text, m.value).toMatch(/Évalue la copie avec les attendus méthodologiques de ce type de travail : \S/);
      expect(text, m.value).not.toContain(formatText);
      expect(text, m.value).not.toMatch(/prime sur toute autre indication/);
    }
  });
});

describe('version élève seule : aucun format ne fait réécrire le corrigé', () => {
  it('QCM : le format reste appliqué, mais sa partie « corrigé » est explicitement exclue', () => {
    const text = sys({ type: 'exercices', niveau: '6eme', modalite: 'qcm', nombreExercices: 10, sansCorrige: true });
    const format = text.indexOf('FORMAT : QCM');
    const scoped = text.indexOf('sauf pour le corrigé : c’est une version élève seule');
    expect(format).toBeGreaterThan(-1);
    expect(scoped).toBeGreaterThan(format);
    expect(text).not.toContain(UNSCOPED_PRIME);
    expect(text).toMatch(/VERSION ÉLÈVE SEULE : ne rédige AUCUN corrigé/);
  });

  it('chaque format des outils Exercices et Évaluation : jamais de priorité du format sur l’absence de corrigé', () => {
    for (const type of ['exercices', 'evaluation'] as const) {
      for (const m of MODALITES.filter(m => m.tools.includes(type))) {
        const where = whereAvailable(m.value, type);
        const text = sys({ type, ...where, modalite: m.value, sansCorrige: true });
        const label = `${type} / ${m.value}`;
        expect(text, label).toMatch(/VERSION ÉLÈVE SEULE/);
        if (m.value === 'texte_trous') {
          // Le format lui-même interdit d'écrire le corrigé ; la priorité simple suffit.
          expect(text, label).toMatch(/VERSION ÉLÈVE SEULE : Magistra n’ajoutera pas de corrigé/);
        } else {
          expect(text, label).not.toContain(UNSCOPED_PRIME);
          expect(text, label).toMatch(/sauf pour le corrigé : c’est une version élève seule/);
        }
      }
    }
  });

  it('avec corrigé : le format prime, sans restriction', () => {
    expect(sys({ modalite: 'qcm' })).toContain(UNSCOPED_PRIME);
    expect(sys({ modalite: 'qcm' })).not.toMatch(/sauf pour le corrigé/);
  });

  it('texte à trous sans corrigé : les mots restent marqués entre doubles crochets (sinon aucun blanc ne serait posé)', () => {
    for (const type of ['exercices', 'evaluation'] as const) {
      const text = sys({ type, niveau: 'cm1', matiere: 'francais', modalite: 'texte_trous', nombreExercices: 8, sansCorrige: true });
      expect(text, type).not.toMatch(/ne rédige AUCUN corrigé, aucune réponse/);
      expect(text, type).toMatch(/Marque quand même chaque mot à trouver entre doubles crochets/);
      expect(text, type).toMatch(/doubles crochets/);
    }
  });

  it('évaluation formative : pas de « corrigé commenté » dans une version élève seule', () => {
    const without = sys({ type: 'evaluation', niveau: '5eme', matiere: 'svt', typeEvaluation: 'formative', sansCorrige: true });
    expect(without).not.toMatch(/corrigé commenté/);
    expect(without).toMatch(/OBJECTIF : évaluation formative/);
    expect(without).toMatch(/grille d’auto-évaluation/);
    expect(sys({ type: 'evaluation', niveau: '5eme', matiere: 'svt', typeEvaluation: 'formative' })).toMatch(/corrigé commenté/);
  });
});

describe('évaluation diagnostique : sans note par défaut, jamais « sur 20 » en même temps', () => {
  it('collège et supérieur, sans notation choisie : ni note sur 20, ni total de 20 points', () => {
    const college = sys({ type: 'evaluation', niveau: '3eme', typeEvaluation: 'diagnostique' });
    expect(college).not.toMatch(/note sur 20|exactement 20 points/);
    expect(college).toMatch(/1\. En-tête : établissement, nom, prénom, classe, date, durée, sans note\./);
    expect(college).toMatch(/sans points ni note/);
    expect(college).toMatch(/OBJECTIF : évaluation diagnostique/);
    const licence = sys({ type: 'evaluation', niveau: 'licence_2', matiere: 'economie', typeEvaluation: 'diagnostique' });
    expect(licence).not.toMatch(/total sur 20/);
    expect(licence).toMatch(/sans barème ni note/);
  });

  it('tableau de remédiation pour l’enseignant, sauf dans une version élève seule', () => {
    expect(sys({ type: 'evaluation', niveau: '3eme', typeEvaluation: 'diagnostique' })).toMatch(/piste de remédiation/);
    const studentOnly = sys({ type: 'evaluation', niveau: '3eme', typeEvaluation: 'diagnostique', sansCorrige: true });
    expect(studentOnly).not.toMatch(/piste de remédiation/);
    expect(studentOnly).toMatch(/questions courtes sur les prérequis/);
  });

  it('notation choisie : elle s’applique (sur 20), sans « aucune note » contradictoire', () => {
    const text = sys({ type: 'evaluation', niveau: '3eme', typeEvaluation: 'diagnostique', bareme: 'sur20' });
    expect(text).toMatch(/NOTATION : note sur 20/);
    expect(text).toMatch(/durée, note sur 20\./);
    expect(text).toMatch(/exactement 20 points/);
    expect(text).not.toMatch(/aucune note|sans note/);
  });

  it('sommative, formative et sans objectif : note sur 20 et total de 20 points, comme avant', () => {
    for (const typeEvaluation of ['sommative', 'formative', undefined] as const) {
      const text = sys({ type: 'evaluation', niveau: '3eme', typeEvaluation });
      expect(text, String(typeEvaluation)).toMatch(/exactement 20 points/);
      expect(text, String(typeEvaluation)).toMatch(/3 ou 4 parties progressives/);
    }
  });

  it('la structure suit la notation choisie : sur 10, par compétences, note chiffrée au primaire', () => {
    const sur10 = sys({ type: 'evaluation', niveau: '3eme', bareme: 'sur10' });
    expect(sur10).toMatch(/durée, note sur 10\./);
    expect(sur10).toMatch(/exactement 10 points/);
    expect(sur10).not.toMatch(/exactement 20 points/);
    const competences = sys({ type: 'evaluation', niveau: '3eme', bareme: 'competences' });
    expect(competences).not.toMatch(/note sur 20|exactement 20 points|barème point par point/);
    expect(competences).toMatch(/positionnement par compétences/);
    expect(sys({ type: 'evaluation', niveau: 'licence_2', matiere: 'economie', bareme: 'sur10' })).toMatch(/total sur 10/);
    // Primaire : « Pas de note sur 20 » par défaut, jamais en même temps qu'une note chiffrée choisie.
    expect(sys({ type: 'evaluation', niveau: 'ce2' })).toMatch(/Pas de note sur 20\./);
    const ce2 = sys({ type: 'evaluation', niveau: 'ce2', bareme: 'sur20' });
    expect(ce2).not.toMatch(/Pas de note sur 20/);
    expect(ce2).toMatch(/NOTATION : note sur 20/);
  });
});

describe('évaluation en texte à trous : uniquement du texte à trous', () => {
  it('collège : ni parties progressives, ni questions ouvertes, ni corrigé demandé au modèle', () => {
    const text = sys({ type: 'evaluation', niveau: '6eme', matiere: 'svt', modalite: 'texte_trous', bareme: 'sur20' });
    expect(text).toMatch(/UNIQUEMENT de texte à trous/);
    expect(text).not.toMatch(/parties progressives/);
    expect(text).not.toMatch(/synthèse/);
    expect(text).not.toMatch(/questions ouvertes/);
    expect(text).not.toMatch(/Corrigé détaillé/);
    expect(text).toMatch(/points par mot trouvé, total exactement 20 points/);
  });

  it('primaire : même principe, avec la grille de positionnement', () => {
    const text = sys({ type: 'evaluation', niveau: 'ce2', matiere: 'francais', modalite: 'texte_trous' });
    expect(text).toMatch(/UNIQUEMENT de texte à trous/);
    expect(text).not.toMatch(/exercices courts/);
    expect(text).toMatch(/grille de positionnement/);
  });

  it('évaluation diagnostique en texte à trous : sans points ; formative : pas de corrigé commenté à écrire', () => {
    const text = sys({ type: 'evaluation', niveau: '6eme', matiere: 'svt', modalite: 'texte_trous', typeEvaluation: 'diagnostique' });
    expect(text).toMatch(/sans points ni note/);
    expect(text).not.toMatch(/exactement 20 points/);
    // Le corrigé d'un texte à trous est celui de Magistra (aligné sur les blancs).
    const formative = sys({ type: 'evaluation', niveau: '6eme', matiere: 'svt', modalite: 'texte_trous', typeEvaluation: 'formative' });
    expect(formative).toMatch(/OBJECTIF : évaluation formative/);
    expect(formative).not.toMatch(/corrigé commenté/);
  });

  it('autre format (QCM) : la structure complète reste, avec le corrigé détaillé', () => {
    const text = sys({ type: 'evaluation', niveau: '6eme', matiere: 'svt', modalite: 'qcm' });
    expect(text).toMatch(/3 ou 4 parties progressives/);
    expect(text).toMatch(/5\. Corrigé détaillé/);
  });
});

describe('difficulté « différencié » : trois niveaux au total, un seul texte à trous', () => {
  it('texte à trous : un seul texte, des mots de difficulté graduée', () => {
    const text = sys({ niveau: 'cm2', matiere: 'sciences_primaire', modalite: 'texte_trous', nombreExercices: 8, difficulte: 'differencie' });
    expect(text).not.toMatch(/trois niveaux/);
    expect(text).toMatch(/un seul texte/i);
    const evaluation = sys({ type: 'evaluation', niveau: '6eme', matiere: 'svt', modalite: 'texte_trous', difficulte: 'differencie' });
    expect(evaluation).toMatch(/Un seul texte : les mots à trouver sont de difficulté graduée/);
    expect(evaluation).not.toMatch(/Questions de difficulté graduée/);
  });

  it('nombre demandé : le total, réparti en trois niveaux (jamais trois fois le nombre)', () => {
    const text = sys({ niveau: '6eme', modalite: 'qcm', nombreExercices: 10, difficulte: 'differencie' });
    expect(text).toMatch(/EXACTEMENT 10 questions/);
    expect(text).toMatch(/Les 10 questions se répartissent, au total et non par niveau, en trois niveaux/);
    // Moins de trois : pas de niveaux impossibles à remplir.
    const two = sys({ niveau: '6eme', modalite: 'probleme', nombreExercices: 2, difficulte: 'differencie' });
    expect(two).not.toMatch(/trois niveaux/);
    expect(two).toMatch(/sans rien ajouter au nombre demandé \(2 problèmes au total\)/);
  });

  it('sans nombre : trois niveaux ; travail d’un seul tenant : des aides graduées, jamais plusieurs versions', () => {
    expect(sys({ difficulte: 'differencie' })).toMatch(/trois niveaux/);
    const dissertation = sys({ niveau: '1ere_gen', matiere: 'francais', modalite: 'dissertation', difficulte: 'differencie' });
    expect(dissertation).not.toMatch(/trois niveaux/);
    expect(dissertation).toMatch(/Un seul travail, différencié par des aides graduées/);
  });
});

describe('séquence et fiche de séance : la démarche s’applique dans la structure de l’outil', () => {
  it('séquence en classe inversée : les 5 séances et le tableau restent, une capsule par séance', () => {
    const r = { type: 'sequence' as const, niveau: '4eme' as const, matiere: 'physique_chimie' as const, modalite: 'classe_inversee', nombreSeances: 5 };
    const text = sys(r);
    expect(text).toMatch(/EXACTEMENT 5 séances/);
    expect(text).toMatch(/tableau synoptique/);
    expect(text).toMatch(/en conservant la structure demandée ci-dessus/);
    expect(text).toMatch(/capsule préparée à la maison avant la séance/);
    expect(text).not.toMatch(/prime sur toute autre indication de forme/);
    const demande = user(r);
    expect(demande).toMatch(/- Démarche de la séquence : Classe inversée/);
    expect(demande).not.toMatch(/Format demandé/);
    // Le nombre de séances reste rappelé en dernier.
    expect(demande.trim().endsWith('Respecte exactement le format et les nombres demandés ci-dessus.')).toBe(true);
  });

  it('fiche de séance (remédiation) : toutes les rubriques de la fiche restent', () => {
    const r = { type: 'fiche_prep' as const, niveau: 'cp' as const, modalite: 'remediation' };
    const text = sys(r);
    expect(text).toMatch(/TYPE DE SÉANCE : remédiation/);
    expect(text).toMatch(/en-tête/);
    expect(text).toMatch(/en conservant toutes les rubriques de la fiche/);
    expect(text).not.toMatch(/prime sur toute autre/);
    expect(user(r)).toMatch(/- Type de séance : Remédiation/);
    expect(user(r)).not.toMatch(/Respecte exactement le format/);
  });

  it('progression sur une période : la forme choisie prime toujours', () => {
    expect(sys({ type: 'progression', niveau: 'cm1', modalite: 'periode' })).toContain(UNSCOPED_PRIME);
  });
});

describe('matières de langue : le contenu des élèves dans la langue étudiée', () => {
  it('langues vivantes et anciennes reconnues ; les autres matières ne le sont pas', () => {
    for (const m of ['anglais', 'espagnol', 'allemand', 'italien', 'portugais', 'chinois', 'arabe'] as Matiere[]) {
      expect(isLangueVivante(m), m).toBe(true);
      expect(targetLanguage(m)?.name, m).toBe(m);
    }
    expect(isLangueAncienne('latin')).toBe(true);
    expect(targetLanguage('grec')).toEqual({ kind: 'ancienne', name: 'grec ancien' });
    for (const m of ['francais', 'lettres', 'linguistique', 'mathematiques', 'autre'] as Matiere[]) expect(targetLanguage(m), m).toBeNull();
    for (const m of [...LANGUES_VIVANTES, ...LANGUES_ANCIENNES]) expect(isMatiere(m), m).toBe(true);
    // Mêmes langues que les formats propres aux langues (compréhension écrite : vivantes ; traduction : toutes).
    for (const { value: m } of getMatieresForNiveau('4eme')) {
      expect(isModaliteAvailable('comprehension_ecrite', 'exercices', '4eme', m), m).toBe(isLangueVivante(m));
      expect(isModaliteAvailable('traduction', 'exercices', '4eme', m), m).toBe(targetLanguage(m) !== null);
    }
  });

  it('anglais, texte à trous et QCM : en anglais (langue cible), plus de « français soigné » ; rappel en fin de demande', () => {
    for (const modalite of ['texte_trous', 'qcm']) {
      const r = { niveau: '5eme' as const, matiere: 'anglais' as const, modalite, nombreExercices: 10, sujet: 'Les animaux' };
      const text = sys(r);
      expect(text, modalite).toMatch(/est en anglais, la langue cible, jamais en français/);
      expect(text, modalite).toMatch(/Les exemples de présentation donnés en français ne montrent que la forme/);
      expect(text, modalite).not.toMatch(/Écris un français soigné/);
      const demande = user(r).trim().split('\n');
      expect(demande.at(-2), modalite).toBe('Langue : tout ce qui est destiné aux élèves est en anglais.');
      expect(demande.at(-1), modalite).toBe('Respecte exactement le format et les nombres demandés ci-dessus.');
    }
    // Les deux adaptations des exigences de qualité s'appliquent ensemble.
    expect(sys({ niveau: '5eme', matiere: 'anglais', modalite: 'texte_trous' })).toMatch(/- Crochets : des doubles crochets/);
  });

  it('latin : textes et formes en latin, consignes en français', () => {
    const r = { type: 'cours' as const, niveau: '4eme' as const, matiere: 'latin' as const, sujet: 'La première déclinaison' };
    expect(sys(r)).toMatch(/sont en latin, la langue étudiée/);
    expect(user(r).trim().split('\n').at(-1)).toBe('Langue : textes et mots étudiés en latin ; consignes et explications en français.');
  });

  it('documents de préparation, copies corrigées : en français, exemples et corrections dans la langue', () => {
    expect(sys({ type: 'sequence', niveau: '4eme', matiere: 'espagnol' })).toMatch(/document de préparation rédigé en français soigné ; exemples, lexique, consignes et supports destinés aux élèves en espagnol/);
    expect(sys({ type: 'corrige', niveau: '4eme', matiere: 'anglais', texteEleve: 'Copie' })).toMatch(/corrections proposées en anglais correct et naturel/);
    expect(user({ type: 'sequence', niveau: '4eme', matiere: 'espagnol' })).not.toMatch(/^Langue :/m);
  });

  it('appréciations et courriers : toujours en français ; autres matières : règle inchangée', () => {
    expect(sys({ type: 'appreciations', niveau: '4eme', matiere: 'anglais' })).toMatch(/Écris un français soigné et fluide/);
    expect(sys({ type: 'lettre_parents', niveau: '4eme', matiere: 'anglais' })).not.toMatch(/langue cible/);
    expect(sys({})).toMatch(/Écris un français soigné et fluide/);
    expect(user({})).not.toMatch(/^Langue :/m);
  });
});

describe('appréciations : destination livret scolaire ou conseil de classe', () => {
  it('livret scolaire (bac) : appréciations annuelles, sans trimestre ni bulletin', () => {
    const r = { type: 'appreciations' as const, niveau: 'terminale_gen' as const, modalite: 'livret_bac', trimestre: '2' as const, nombreAppreciations: 5 };
    const text = sys(r);
    expect(text).toMatch(/TÂCHE : rédiger EXACTEMENT 5 appréciations annuelles du livret scolaire différentes, numérotées de 1 à 5\. Ni plus, ni moins\./);
    const tache = text.split('\n').find(l => l.startsWith('TÂCHE'))!;
    expect(tache).not.toMatch(/trimestre/i);
    expect(text).not.toMatch(/pour le trimestre|bulletin/);
    expect(text).toMatch(/bilan de l'année entière/);
    const demande = user(r);
    expect(demande).not.toMatch(/Trimestre/);
    expect(demande).toMatch(/- Format demandé : Livret scolaire \(bac\)/);
  });

  it('conseil de classe : appréciation générale sur toutes les disciplines (pas la matière de l’enseignant), trimestre gardé', () => {
    const r = { type: 'appreciations' as const, niveau: '4eme' as const, modalite: 'conseil_classe', trimestre: '1' as const, nombreAppreciations: 3 };
    const text = sys(r);
    expect(text).toMatch(/EXACTEMENT 3 appréciations générales du conseil de classe différentes, numérotées de 1 à 3, pour le trimestre 1\./);
    expect(text).toMatch(/sur l'ensemble des disciplines/);
    expect(text).not.toMatch(/les compétences travaillées/);
    const demande = user(r);
    expect(demande).not.toMatch(/- Matière : Mathématiques/);
    expect(demande).toMatch(/- Matières : toutes les disciplines/);
    expect(demande).toMatch(/- Trimestre : 1/);
  });

  it('bulletin (par défaut) : inchangé', () => {
    const r = { type: 'appreciations' as const, niveau: '4eme' as const, trimestre: '2' as const, nombreAppreciations: 4 };
    expect(sys(r)).toMatch(/EXACTEMENT 4 appréciations de bulletin différentes, numérotées de 1 à 4, pour le trimestre 2\./);
    expect(user(r)).toMatch(/- Matière : Mathématiques/);
  });
});

describe('différenciation : le haut potentiel relève de l’approfondissement, pas de chaque version', () => {
  const block = (text: string) => {
    const lines = text.split('\n');
    const start = lines.findIndex(l => l.startsWith('BESOINS PARTICULIERS à prendre en compte dans chaque version'));
    if (start === -1) return '';
    const end = lines.findIndex((l, i) => i > start && !l.startsWith('- '));
    return lines.slice(start, end === -1 ? undefined : end).join('\n');
  };

  it('haut potentiel seul : dans la version « Approfondissement » uniquement, l’étayage des autres versions gardé', () => {
    const text = sys({ type: 'differenciation', niveau: '5eme', besoins: ['hpi'] });
    expect(text).not.toMatch(/BESOINS PARTICULIERS à prendre en compte dans chaque version[\s\S]*haut potentiel/i);
    expect(text).toMatch(/HAUT POTENTIEL .* dans la version « Approfondissement » seulement\. Élèves à haut potentiel/);
    expect(text).toMatch(/Ne retire ni l’étayage ni les aides des autres versions/);
  });

  it('DYS et haut potentiel : DYS dans chaque version, haut potentiel à part', () => {
    const text = sys({ type: 'differenciation', niveau: '5eme', besoins: ['dys', 'hpi'] });
    const each = block(text);
    expect(each).toMatch(/Élèves DYS : consignes courtes/);
    expect(each).not.toMatch(/haut potentiel/i);
    expect(text).toMatch(/HAUT POTENTIEL/);
  });

  it('sans version « Approfondissement » : un défi facultatif, sans transformer les versions choisies', () => {
    const text = sys({ type: 'differenciation', niveau: '5eme', besoins: ['hpi'], profilsDifferenciation: ['renforce'] });
    expect(text).toMatch(/un « Défi » facultatif/);
    expect(text).not.toMatch(/tâches ouvertes à plusieurs solutions, défis de transfert, autonomie/);
    expect(text).not.toMatch(/Version « Approfondissement »/);
  });
});
