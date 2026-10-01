// Formats normés et textes officiels en vigueur (rentrée 2026, session 2027) : épreuves du brevet, du baccalauréat
// général, technologique et professionnel, du supérieur ; programme de maternelle en six domaines ; niveaux du CECRL
// des programmes de langues vivantes ; EPS et enseignements artistiques ; mise en page Markdown des QCM et vrai/faux.

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import {
  ALL_MATIERES, getMatiereLabel, getMatieresForNiveau, isMatiere, resolveMatiere, type Matiere, type TypeContenu,
} from '../../shared/catalog.js';
import { countUnit, isModaliteAvailable, MODALITES, modalitePrompt, modalitesFor } from '../../shared/formats.js';
import { ALL_NIVEAUX, type NiveauScolaire } from '../../shared/levels.js';
import { getSujetSuggestions } from '../../shared/suggestions.js';
import { buildSystemPrompt } from '../../shared/prompts/index.js';
import type { GenerationRequest } from '../../shared/types.js';
import { validateGenerationRequest } from '../../shared/validation.js';

const values = (type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere) => modalitesFor(type, niveau, matiere).map(m => m.value);
const prompt = (value: string, niveau: NiveauScolaire, matiere: Matiere) => modalitePrompt(value, { niveau, matiere });

function req(extra: Partial<GenerationRequest>): GenerationRequest {
  return { type: 'evaluation', niveau: '3eme', matiere: 'histoire_geo', sujet: 'La Guerre froide', researchMode: 'documents', ...extra };
}

describe('baccalauréat général et technologique : chaque épreuve à sa classe et dans sa voie', () => {
  it('français en première (épreuve anticipée), philosophie en terminale, jamais l’inverse', () => {
    expect(values('evaluation', 'terminale_gen', 'francais')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'francais')).not.toContain('sujet_bac');
    expect(values('evaluation', '1ere_gen', 'philosophie')).not.toContain('sujet_bac');
    expect(values('evaluation', '1ere_techno', 'francais')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'philosophie')).toContain('sujet_bac');
    expect(isModaliteAvailable('sujet_bac', 'evaluation', 'terminale_gen', 'francais')).toBe(false);
    // Validation partagée (serveur et application Windows) : un format sans épreuve à ce niveau est ignoré.
    expect(validateGenerationRequest(req({ niveau: 'terminale_gen', matiere: 'francais', modalite: 'sujet_bac' }))).not.toHaveProperty('modalite');
    expect(validateGenerationRequest(req({ niveau: '1ere_gen', matiere: 'francais', modalite: 'sujet_bac' })).modalite).toBe('sujet_bac');
    expect(prompt('sujet_bac', '1ere_gen', 'francais')).toMatch(/épreuve anticipée de français.*4 heures/s);
  });

  it('épreuve anticipée de mathématiques : 2 h, sans calculatrice du début à la fin, 6 + 14 points', () => {
    const general = prompt('sujet_bac', '1ere_gen', 'mathematiques');
    expect(general).toMatch(/calculatrice interdite pendant toute l’épreuve/);
    expect(general).toMatch(/2 heures/);
    expect(general).toMatch(/Partie 1 \(6 points\).*QCM sans justification.*Partie 2 \(14 points\).*deux ou trois exercices/s);
    expect(general).toMatch(/avec spécialité mathématiques.*sans spécialité/s);
    expect(prompt('sujet_bac', '1ere_techno', 'mathematiques')).toMatch(/voie technologique/);
    expect(prompt('sujet_bac', 'terminale_gen', 'mathematiques')).not.toMatch(/calculatrice interdite/);
    // Terminale technologique : pas d'épreuve terminale de mathématiques (hors STI2D et STL).
    const techno = prompt('sujet_bac', 'terminale_techno', 'mathematiques');
    expect(techno).not.toMatch(/baccalauréat de mathématiques/);
    expect(techno).toMatch(/contrôle continu.*STI2D et STL/s);
  });

  it('histoire-géographie : question problématisée (voie générale), questions et analyse de document (voie technologique), plus de composition', () => {
    const techno = prompt('sujet_bac', 'terminale_techno', 'histoire_geo');
    expect(techno).toMatch(/voie technologique.*questions à réponse courte.*analyse de document/s);
    expect(techno).not.toMatch(/composition|étude critique/);
    const general = prompt('sujet_bac', 'terminale_gen', 'histoire_geo');
    expect(general).toMatch(/question problématisée.*analyse de document.*production graphique/s);
    expect(general).not.toMatch(/composition|étude critique/);
    // Exercice officiel de la voie générale, proposé avant la composition ; ni en voie technologique, ni au collège.
    const exercices = values('exercices', 'terminale_gen', 'histoire_geo');
    expect(exercices).toContain('question_problematisee');
    expect(exercices.indexOf('question_problematisee')).toBeLessThan(exercices.indexOf('composition'));
    expect(values('exercices', '1ere_techno', 'histoire_geo')).not.toContain('question_problematisee');
    expect(values('exercices', '3eme', 'histoire_geo')).not.toContain('question_problematisee');
    expect(countUnit('question_problematisee')).toBeNull();
    // HGGSP : dissertation et étude critique, pas de composition.
    expect(values('exercices', 'terminale_gen', 'hggsp')).toEqual(expect.arrayContaining(['dissertation', 'etude_critique']));
    expect(values('exercices', 'terminale_gen', 'hggsp')).not.toContain('composition');
  });

  it('philosophie en voie technologique : explication guidée (éléments d’analyse, de synthèse, commentaire)', () => {
    expect(prompt('sujet_bac', 'terminale_techno', 'philosophie')).toMatch(/A\. éléments d’analyse.*B\. éléments de synthèse.*C\. commentaire/s);
    expect(prompt('sujet_bac', 'terminale_gen', 'philosophie')).not.toMatch(/éléments d’analyse/);
    expect(prompt('sujet_bac', 'terminale_gen', 'philosophie')).toMatch(/N’invente jamais un extrait/);
  });

  it('STMG, sciences de l’ingénieur : un sujet type bac ; aucune épreuve hors de leur voie', () => {
    expect(values('evaluation', 'terminale_techno', 'droit_economie')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'management')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_gen', 'sciences_ingenieur')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_gen', 'droit_economie')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'ses')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'physique_chimie')).toContain('sujet_bac');
    expect(prompt('sujet_bac', 'terminale_techno', 'droit_economie')).toMatch(/Partie droit \(10 points\).*Partie économie \(10 points\)/s);
    expect(prompt('sujet_bac', 'terminale_techno', 'management')).toMatch(/fictive présentée comme telle/);
    expect(prompt('sujet_bac', 'terminale_gen', 'sciences_ingenieur')).toMatch(/3 heures 30.*sciences physiques/s);
  });

  it('langues vivantes : l’épreuve de la spécialité LLCER est un format à part, nommé, jamais le « sujet type bac » d’une LVA ou LVB', () => {
    // Une seule matière par langue : « Sujet type bac » d'anglais donnait l'épreuve de LLCER à un professeur de LVA.
    for (const niveau of ['1ere_gen', 'terminale_gen'] as const) {
      expect(values('evaluation', niveau, 'anglais'), niveau).not.toContain('sujet_bac');
      expect(values('evaluation', niveau, 'anglais'), niveau).toContain('sujet_bac_llcer');
      expect(isModaliteAvailable('sujet_bac', 'evaluation', niveau, 'espagnol'), niveau).toBe(false);
    }
    for (const niveau of ['1ere_techno', 'terminale_techno', '2nde_gt', '3eme', 'terminale_pro', 'licence_1'] as const) {
      expect(values('evaluation', niveau, 'anglais'), niveau).not.toContain('sujet_bac_llcer');
    }
    expect(values('evaluation', 'terminale_gen', 'philosophie')).not.toContain('sujet_bac_llcer');
    expect(validateGenerationRequest(req({ niveau: 'terminale_gen', matiere: 'anglais', modalite: 'sujet_bac' }))).not.toHaveProperty('modalite');
    expect(validateGenerationRequest(req({ niveau: 'terminale_gen', matiere: 'anglais', modalite: 'sujet_bac_llcer' })).modalite).toBe('sujet_bac_llcer');
    const llcer = MODALITES.find(m => m.value === 'sujet_bac_llcer')!;
    expect(llcer.label).toMatch(/LLCER/);
    expect(llcer.description).toMatch(/pas LVA\/LVB/);
    const text = prompt('sujet_bac_llcer', 'terminale_gen', 'espagnol');
    expect(text).toMatch(/LLCER.*synthèse d’environ 500 mots à rédiger en espagnol.*traduction en français.*OU transposition/s);
    expect(text).toMatch(/16 points.*4 points/s);
    expect(text).toMatch(/et non d’une évaluation de LVA ou de LVB du tronc commun/);
    expect(text).not.toMatch(/En première/);
    // En première : l'épreuve se passe en terminale, le sujet est un entraînement.
    expect(prompt('sujet_bac_llcer', '1ere_gen', 'espagnol')).toMatch(/En première, cette épreuve n’a pas lieu.*sujet d’entraînement/s);
  });

  it('première : une épreuve de spécialité de terminale n’y est qu’un entraînement ; épreuves anticipées et histoire-géographie inchangées', () => {
    for (const [niveau, matiere] of [
      ['1ere_gen', 'ses'], ['1ere_gen', 'svt'], ['1ere_gen', 'nsi'], ['1ere_gen', 'physique_chimie'], ['1ere_techno', 'physique_chimie'],
      ['1ere_techno', 'droit_economie'], ['1ere_techno', 'management'],
    ] as const) {
      expect(prompt('sujet_bac', niveau, matiere), `${niveau} ${matiere}`).toMatch(/En première, cette épreuve n’a pas lieu \(elle se passe en terminale\) : sujet d’entraînement/);
      expect(prompt('sujet_bac', niveau.replace('1ere', 'terminale') as NiveauScolaire, matiere), matiere).not.toMatch(/En première/);
    }
    for (const [niveau, matiere] of [['1ere_gen', 'francais'], ['1ere_gen', 'mathematiques'], ['1ere_techno', 'mathematiques'], ['1ere_gen', 'histoire_geo']] as const) {
      expect(prompt('sujet_bac', niveau, matiere), `${niveau} ${matiere}`).not.toMatch(/En première, cette épreuve n’a pas lieu/);
    }
  });

  it('physique-chimie en voie technologique : l’épreuve dépend de la série (STI2D, STL, ST2S), aucune n’est imposée', () => {
    for (const niveau of ['1ere_techno', 'terminale_techno'] as const) {
      const text = prompt('sujet_bac', niveau, 'physique_chimie');
      expect(text, niveau).toMatch(/sur le modèle de l’épreuve de la série des élèves \(à indiquer en tête\)/);
      expect(text, niveau).toMatch(/physique-chimie et mathématiques \(STI2D, STL\)/);
      expect(text, niveau).toMatch(/sciences physiques et chimiques en laboratoire \(STL\)/);
      expect(text, niveau).toMatch(/chimie, biologie et physiopathologie humaines \(ST2S\)/);
      expect(text, niveau).not.toMatch(/^FORMAT : sujet de type épreuve de physique-chimie et mathématiques/);
    }
    expect(prompt('sujet_bac', 'terminale_gen', 'physique_chimie')).toMatch(/baccalauréat de physique-chimie \(3 heures 30\)/);
    expect(prompt('sujet_bac', 'terminale_gen', 'physique_chimie')).not.toMatch(/STI2D/);
  });

  it('session 2027 : au moins 2 points de maîtrise de la langue, compris dans le barème officiel, jamais ajoutés (brevet, bac, bac pro)', () => {
    for (const [value, niveau, matiere] of [
      ['sujet_bac', '1ere_gen', 'mathematiques'], ['sujet_bac', 'terminale_gen', 'svt'], ['sujet_brevet', '3eme', 'francais'],
      ['sujet_brevet', '3eme', 'histoire_geo'], ['sujet_bac_pro', 'terminale_pro', 'francais'], ['sujet_bac', '1ere_gen', 'francais'],
      ['sujet_bac', 'terminale_gen', 'philosophie'], ['sujet_bac', 'terminale_techno', 'droit_economie'],
      ['sujet_bac_llcer', 'terminale_gen', 'anglais'],
    ] as const) {
      const text = prompt(value, niveau, matiere);
      expect(text, `${value} ${matiere}`).toMatch(/Maîtrise de la langue \(épreuves écrites, à compter de la session 2027\) : elle compte pour au moins 2 points, compris dans le total et dans les parties ci-dessus, jamais ajoutés en plus/);
      expect(text, `${value} ${matiere}`).toMatch(/s’apprécie sur l’ensemble de la copie/);
      expect(text, `${value} ${matiere}`).toMatch(/ne crée ni partie ni ligne de barème séparée, ne change ni la répartition des parties ni le total/);
      // Plus de points « réservés » qu'un modèle ajoute en ligne séparée à un barème déjà complet.
      expect(text, `${value} ${matiere}`).not.toMatch(/lui sont réservés/);
    }
    // Les répartitions officielles restent celles du sujet (6 + 14, 16 + 4, 10 + 10) : la langue est comprise dedans.
    expect(prompt('sujet_bac', '1ere_gen', 'mathematiques')).toMatch(/Partie 1 \(6 points\).*Partie 2 \(14 points\).*compris dans le total et dans les parties ci-dessus/s);
    expect(prompt('sujet_bac_llcer', 'terminale_gen', 'anglais')).toMatch(/Partie 1 \(16 points\).*Partie 2 \(4 points\).*compris dans le total/s);
    expect(prompt('sujet_bac_pro', 'terminale_pro', 'francais')).toMatch(/\(10 points\).*\(10 points\).*compris dans le total/s);
    expect(prompt('interro', '4eme', 'mathematiques')).not.toMatch(/maîtrise de la langue/i);
    // Dans la consigne complète : la règle « total exactement 20 » et la maîtrise de la langue ne se contredisent plus.
    const sys = buildSystemPrompt(req({ niveau: '1ere_gen', matiere: 'mathematiques', sujet: 'Suites', modalite: 'sujet_bac', bareme: 'sur20' }), false);
    expect(sys).toMatch(/total fait exactement 20/);
    expect(sys).toMatch(/au moins 2 points, compris dans le total.*jamais ajoutés en plus/s);
  });
});

describe('baccalauréat professionnel', () => {
  it('sujet type bac pro en français et en histoire-géographie-EMC, en première et terminale professionnelles seulement', () => {
    expect(values('evaluation', 'terminale_pro', 'francais')).toContain('sujet_bac_pro');
    expect(values('evaluation', 'terminale_pro', 'histoire_geo')).toContain('sujet_bac_pro');
    expect(values('evaluation', '1ere_pro', 'emc')).toContain('sujet_bac_pro');
    expect(values('evaluation', 'terminale_pro', 'francais')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_pro', 'mathematiques')).not.toContain('sujet_bac_pro');
    expect(values('evaluation', 'terminale_gen', 'francais')).not.toContain('sujet_bac_pro');
    expect(values('evaluation', 'cap_2', 'francais')).not.toContain('sujet_bac_pro');
    expect(values('exercices', 'terminale_pro', 'francais')).not.toContain('sujet_bac_pro');
    const francais = prompt('sujet_bac_pro', 'terminale_pro', 'francais');
    expect(francais).toMatch(/3 heures.*compétences de lecture \(10 points\).*compétences d’écriture \(10 points\)/s);
    expect(francais).toMatch(/N’invente jamais un extrait/);
    expect(prompt('sujet_bac_pro', 'terminale_pro', 'histoire_geo')).toMatch(/2 heures 30.*histoire, géographie, puis EMC/s);
    expect(countUnit('sujet_bac_pro')).toBeNull();
  });
});

describe('brevet 2026 : histoire-géographie sur 40, EMC sur 20', () => {
  it('sujet type brevet : 15 + 18 + 7 points, développement construit d’au moins trente lignes, EMC à part', () => {
    const hg = prompt('sujet_brevet', '3eme', 'histoire_geo');
    expect(hg).toMatch(/notée sur 40 points/);
    expect(hg).toMatch(/15 points/);
    expect(hg).toMatch(/au moins trente lignes.*18 points/s);
    expect(hg).toMatch(/7 points/);
    expect(hg).toMatch(/Enseignement moral et civique, noté sur 20 points/);
    // Le barème officiel dépasse 20 : il prime, ou il est ramené à la notation demandée.
    expect(hg).toMatch(/ramène les points proportionnellement/);
    expect(prompt('sujet_brevet', '3eme', 'emc')).toMatch(/notée sur 20 points.*un ou deux documents.*réponse développée/s);
  });

  it('développement construit : au moins trente lignes en 3e, deux ou trois paragraphes avant', () => {
    expect(prompt('developpement_construit', '3eme', 'histoire_geo')).toMatch(/au moins trente lignes/);
    expect(prompt('developpement_construit', '5eme', 'histoire_geo')).not.toMatch(/trente lignes/);
    expect(prompt('developpement_construit', '5eme', 'histoire_geo')).toMatch(/deux ou trois paragraphes/);
    expect(prompt('developpement_construit', 'terminale_pro', 'histoire_geo')).not.toMatch(/trente lignes/);
  });
});

describe('supérieur : un format d’examen propre à chaque filière', () => {
  it('partiel (UE) à l’université et en BUT ; devoir surveillé en CPGE ; sujet type BTS en BTS', () => {
    expect(values('evaluation', 'cpge', 'mathematiques')).not.toContain('partiel');
    expect(values('evaluation', 'bts', 'gestion')).not.toContain('partiel');
    expect(values('evaluation', 'but', 'informatique')).toContain('partiel');
    expect(values('evaluation', 'licence_2', 'droit')).toContain('partiel');
    expect(values('evaluation', 'master_1', 'economie')).toContain('partiel');
    expect(isModaliteAvailable('partiel', 'evaluation', 'cpge', 'mathematiques')).toBe(false);
    expect(values('evaluation', 'cpge', 'mathematiques')[0]).toBe('devoir_surveille');
    expect(values('evaluation', 'bts', 'gestion')[0]).toBe('sujet_bts');
    expect(values('evaluation', 'but', 'informatique')).not.toContain('sujet_bts');
    expect(values('evaluation', 'licence_1', 'mathematiques')).not.toContain('devoir_surveille');
    expect(prompt('devoir_surveille', 'cpge', 'physique_chimie')).toMatch(/concours/);
    expect(prompt('devoir_surveille', 'cpge', 'physique_chimie')).not.toMatch(/UE/);
    // Référentiel du BTS : intitulé d'épreuve à vérifier, jamais inventé.
    expect(prompt('sujet_bts', 'bts', 'gestion')).toMatch(/à vérifier dans le référentiel officiel/);
    expect(prompt('sujet_bts', 'bts', 'gestion')).not.toMatch(/\bUE\b/);
  });
});

describe('français au lycée : pas de dissertation en voie technologique', () => {
  it('commentaire ou contraction + essai en voie technologique ; dissertation en voie générale, en seconde et en philosophie', () => {
    expect(values('exercices', '1ere_techno', 'francais')).not.toContain('dissertation');
    expect(values('exercices', '1ere_techno', 'francais')).toEqual(expect.arrayContaining(['commentaire', 'contraction_essai']));
    expect(isModaliteAvailable('dissertation', 'corrige', '1ere_techno', 'francais')).toBe(false);
    expect(values('exercices', 'terminale_techno', 'philosophie')).toContain('dissertation');
    expect(values('exercices', '2nde_gt', 'francais')).toContain('dissertation');
    expect(values('exercices', '1ere_gen', 'francais')).toContain('dissertation');
  });
});

describe('maternelle : programme de la rentrée 2026, six domaines', () => {
  it('consignes : six domaines, dont « Se repérer dans le temps et l’espace » ; plus de « cinq domaines »', () => {
    const sys = buildSystemPrompt(req({ type: 'fiche_prep', niveau: 'maternelle_gs', matiere: 'explorer_monde', sujet: 'Les graines' }), false);
    expect(sys).toMatch(/six domaines d'apprentissage/);
    expect(sys).toMatch(/se repérer dans le temps et l'espace/);
    expect(sys).toMatch(/découvrir le monde du vivant, de la matière et des objets/);
    expect(sys).toMatch(/l'acquisition des premiers outils mathématiques/);
    expect(sys).not.toMatch(/cinq domaines/);
  });

  it('matières : nouveau domaine « temps et espace », clés inchangées, anciens libellés reconnus', () => {
    const maternelle = getMatieresForNiveau('maternelle_gs').map(m => m.value);
    expect(maternelle).toEqual(expect.arrayContaining(['temps_espace', 'explorer_monde', 'nombres_formes']));
    expect(maternelle[0]).toBe('langage_oral');
    expect(getMatieresForNiveau('cp').map(m => m.value)).not.toContain('temps_espace');
    expect(isMatiere('explorer_monde')).toBe(true);
    expect(isMatiere('temps_espace')).toBe(true);
    expect(getMatiereLabel('explorer_monde')).toBe('Découvrir le monde du vivant, de la matière et des objets');
    expect(getMatiereLabel('temps_espace')).toBe("Se repérer dans le temps et l'espace");
    expect(getMatiereLabel('nombres_formes')).toBe('Acquérir les premiers outils mathématiques');
    // Historique : les anciens libellés stockés retrouvent leur clé.
    expect(resolveMatiere('Explorer le monde')).toBe('explorer_monde');
    expect(resolveMatiere('Nombres, formes et grandeurs')).toBe('nombres_formes');
    expect(resolveMatiere('Se repérer dans le temps et l’espace')).toBe('temps_espace');
    expect(new Set(ALL_MATIERES.map(m => m.value)).size).toBe(ALL_MATIERES.length);
    // Suggestions réparties entre les deux domaines issus d'« Explorer le monde ».
    expect(getSujetSuggestions('temps_espace', 'maternelle_ms')).toContain('Les saisons');
    expect(getSujetSuggestions('explorer_monde', 'maternelle_ms')).not.toContain('Les saisons');
    expect(getSujetSuggestions('explorer_monde', 'maternelle_ms')).toContain('Les 5 sens');
    // Même traitement que les autres domaines : ateliers et jeux, validation acceptée.
    expect(values('exercices', 'maternelle_ms', 'temps_espace')).toEqual(['ateliers', 'jeux']);
    expect(validateGenerationRequest(req({ type: 'cours', niveau: 'maternelle_ps', matiere: 'temps_espace', sujet: 'Les saisons' })).matiere).toBe('temps_espace');
  });

  it('libellés : les intitulés des domaines de 2026, plus « Mobiliser le langage » (2015) ; anciens libellés reconnus', () => {
    for (const { label } of getMatieresForNiveau('maternelle_ms')) {
      expect(label).not.toMatch(/Mobiliser le langage|avec son corps|Explorer le monde/);
    }
    expect(getMatiereLabel('langage_oral')).toBe('Développement et structuration du langage — Oral');
    expect(getMatiereLabel('graphisme_ecriture')).toBe('Développement et structuration du langage — Écrit / Graphisme');
    expect(getMatiereLabel('activites_physiques')).toBe("Agir, s'exprimer, comprendre à travers les activités physiques");
    expect(getMatiereLabel('activites_artistiques')).toBe("Agir, s'exprimer, comprendre à travers les activités artistiques");
    // Mêmes intitulés que ceux des six domaines donnés au modèle (shared/prompts/levels.ts).
    const sys = buildSystemPrompt(req({ type: 'fiche_prep', niveau: 'maternelle_ps', matiere: 'langage_oral', sujet: 'Raconter une histoire' }), false);
    expect(sys).toMatch(/le développement et la structuration du langage oral et écrit/);
    expect(sys).toMatch(/agir, s'exprimer, comprendre à travers les activités physiques/);
    expect(sys).toMatch(/agir, s'exprimer, comprendre à travers les activités artistiques/);
    // Historique : les libellés enregistrés avant la rentrée 2026 (y compris avec une apostrophe typographique).
    expect(resolveMatiere('Mobiliser le langage — Oral')).toBe('langage_oral');
    expect(resolveMatiere('Mobiliser le langage — Écrit / Graphisme')).toBe('graphisme_ecriture');
    expect(resolveMatiere("Agir, s'exprimer avec son corps")).toBe('activites_physiques');
    expect(resolveMatiere('Agir, s’exprimer avec son corps')).toBe('activites_physiques');
    expect(resolveMatiere('Activités artistiques')).toBe('activites_artistiques');
    expect(getMatiereLabel('Mobiliser le langage — Oral')).toBe('Développement et structuration du langage — Oral');
    expect(resolveMatiere('Développement et structuration du langage — Oral')).toBe('langage_oral');
  });
});

describe('langues vivantes : niveau du CECRL de la classe (programmes de 2025)', () => {
  it('cible de la classe au lieu d’un niveau laissé au choix du modèle', () => {
    const sixieme = prompt('comprehension_ecrite', '6eme', 'anglais');
    expect(sixieme).toMatch(/A1\+ en LVA/);
    expect(sixieme).not.toMatch(/de A1 à C1/);
    expect(sixieme).toMatch(/calibre le lexique, la syntaxe et la longueur/);
    const terminale = prompt('comprehension_ecrite', 'terminale_gen', 'espagnol');
    expect(terminale).toMatch(/B2 en LVA/);
    expect(terminale).toMatch(/B1 à B1\+ en LVB/);
    const troisieme = prompt('expression_ecrite', '3eme', 'allemand');
    expect(troisieme).toMatch(/B1 en LVA/);
    expect(troisieme).toMatch(/A2 en LVB/);
    expect(prompt('comprehension_orale', '2nde_gt', 'anglais')).toMatch(/B1\+ en LVA, A2\+ en LVB/);
    expect(prompt('expression_orale', 'cap_1', 'anglais')).toMatch(/A2, niveau attendu à l’examen du CAP/);
    expect(prompt('comprehension_ecrite', 'terminale_pro', 'anglais')).toMatch(/B1\+ en LVA et A2\+ en LVB/);
    expect(prompt('comprehension_ecrite', 'cm2', 'anglais')).toMatch(/visé pour cette classe : A1 /);
    // Supérieur : aucun programme national, le niveau reste à choisir et à indiquer.
    expect(prompt('comprehension_ecrite', 'licence_1', 'anglais')).toMatch(/de A1 à C1/);
    expect(prompt('expression_orale', 'licence_1', 'anglais')).toMatch(/de A1 à C1/);
  });

  it('formats généraux dans une langue vivante : tout en langue cible ; exemple du texte à trous signalé comme français', () => {
    const qcm = prompt('qcm', '5eme', 'anglais');
    expect(qcm).toMatch(/questions et choix de réponse entièrement en anglais \(langue cible\)/);
    expect(prompt('vrai_faux', '4eme', 'espagnol')).toMatch(/affirmations et justifications attendues entièrement en espagnol/);
    const trous = prompt('texte_trous', '5eme', 'anglais');
    expect(trous).toMatch(/exemple en français ; ton texte et les mots à trouver sont en anglais/);
    // L'exemple reste le même (Magistra reconnaît les doubles crochets quelle que soit la langue).
    expect(trous).toMatch(/« Le chat \[\[dort\]\] sur le canapé pendant que le \[\[chien\]\] joue\. »/);
    expect(prompt('texte_trous', '4eme', 'latin')).toMatch(/texte en latin si le sujet porte sur la langue/);
    expect(prompt('texte_trous', '3eme', 'grec')).toMatch(/grec ancien/);
    // Autres matières : aucune consigne de langue étrangère.
    for (const value of ['qcm', 'vrai_faux', 'texte_trous']) {
      expect(prompt(value, '5eme', 'svt'), value).not.toMatch(/langue cible|langue étudiée/);
    }
    // Cible CECRL de la classe citée, plus un vague « niveau de la classe ».
    expect(qcm).toMatch(/A2 en LVA, A1\+ en LVB/);
    expect(prompt('qcm', 'licence_1', 'anglais')).toMatch(/de A1 à C1/);
  });

  it('cycle 2 (CP-CE2) : QCM et vrai/faux en français, lus par l’enseignant ; seuls des mots déjà travaillés à l’oral en langue cible', () => {
    for (const [value, niveau, matiere] of [['qcm', 'cp', 'anglais'], ['qcm', 'ce2', 'allemand'], ['vrai_faux', 'ce1', 'allemand'], ['vrai_faux', 'cp', 'anglais']] as const) {
      const text = prompt(value, niveau, matiere);
      expect(text, `${value} ${niveau}`).not.toMatch(/entièrement en/);
      expect(text, `${value} ${niveau}`).toMatch(/cycle 2, niveau visé A1 \(premiers acquis, surtout à l’oral\)/);
      expect(text, `${value} ${niveau}`).toMatch(/en français, lues à voix haute par l’enseignant/);
      expect(text, `${value} ${niveau}`).toMatch(/des mots ou de très courtes expressions déjà travaillés à l’oral ; corrigé en français/);
    }
    expect(prompt('qcm', 'cp', 'anglais')).toMatch(/consignes et questions en français.*seuls les choix de réponse sont en anglais/s);
    expect(prompt('vrai_faux', 'ce1', 'allemand')).toMatch(/justification à l’oral ; seuls les mots cités dans les affirmations \(entre guillemets\) sont en allemand/);
    // Dès le CM1 (cycle 3) : tout en langue cible, comme au collège.
    expect(prompt('qcm', 'cm1', 'anglais')).toMatch(/questions et choix de réponse entièrement en anglais/);
    expect(prompt('qcm', 'cm1', 'anglais')).not.toMatch(/cycle 2/);
    expect(prompt('qcm', 'cp', 'mathematiques')).not.toMatch(/langue vivante/);
  });
});

describe('EPS et enseignements artistiques : évalués en pratiquant', () => {
  it('situation motrice en EPS : AFL au lycée, attendus de fin de cycle au collège et à l’école', () => {
    for (const tool of ['exercices', 'evaluation', 'fiche_prep'] as const) expect(values(tool, '2nde_gt', 'eps'), tool).toContain('situation_eps');
    // Avant les formats généraux (écrits) : c'est le format propre à la discipline.
    expect(values('exercices', '2nde_gt', 'eps')[0]).toBe('situation_eps');
    expect(values('fiche_prep', '4eme', 'eps')[0]).toBe('situation_eps');
    expect(values('evaluation', 'ce2', 'eps')).toContain('situation_eps');
    expect(values('evaluation', 'terminale_pro', 'eps')).toContain('situation_eps');
    expect(values('evaluation', '4eme', 'mathematiques')).not.toContain('situation_eps');
    expect(values('evaluation', 'licence_1', 'eps')).not.toContain('situation_eps');
    const lycee = prompt('situation_eps', 'terminale_gen', 'eps');
    expect(lycee).toMatch(/AFL1 sur 12 points/);
    expect(lycee).toMatch(/4\/4, 6\/2 ou 2\/6/);
    expect(lycee).toMatch(/aucun devoir écrit/);
    const college = prompt('situation_eps', '4eme', 'eps');
    expect(college).toMatch(/attendus de fin de cycle 4/);
    expect(college).not.toMatch(/AFL1/);
    expect(prompt('situation_eps', '6eme', 'eps')).toMatch(/fin de cycle 3/);
    expect(prompt('situation_eps', 'cp', 'eps')).toMatch(/fin de cycle 2.*sans note/s);
    expect(prompt('situation_eps', 'cm1', 'eps')).toMatch(/fin de cycle 3/);
    expect(prompt('situation_eps', 'terminale_pro', 'eps')).toMatch(/à vérifier dans le référentiel/);
    expect(countUnit('situation_eps')).toBeNull();
  });

  it('pratique artistique : arts plastiques et éducation musicale, par compétences, sans œuvre inventée', () => {
    expect(values('evaluation', '5eme', 'musique')).toContain('pratique_artistique');
    expect(values('exercices', 'cm1', 'arts_plastiques')).toContain('pratique_artistique');
    expect(values('evaluation', '5eme', 'histoire_arts')).not.toContain('pratique_artistique');
    const arts = prompt('pratique_artistique', '4eme', 'arts_plastiques');
    expect(arts).toMatch(/incitation.*contraintes.*verbalisation/s);
    expect(arts).toMatch(/seulement si tu es certain de son auteur et de son titre/);
    const musique = prompt('pratique_artistique', '4eme', 'musique');
    expect(musique).toMatch(/projet musical.*écoute/s);
    expect(musique).toMatch(/réaliser des projets musicaux/);
    expect(prompt('pratique_artistique', 'ce1', 'musique')).toMatch(/chanter et interpréter/);
    expect(countUnit('pratique_artistique')).toBeNull();
  });

  it('pratique artistique au lycée : les compétences du programme de lycée, pas celles du collège', () => {
    expect(values('evaluation', '2nde_gt', 'arts_plastiques')).toContain('pratique_artistique');
    for (const niveau of ['2nde_gt', '1ere_gen', 'terminale_techno'] as const) {
      const arts = prompt('pratique_artistique', niveau, 'arts_plastiques');
      expect(arts, niveau).toMatch(/compétences du programme de lycée : pratiquer les arts plastiques de manière réflexive ; questionner le fait artistique ; exposer l’œuvre, la démarche, la pratique/);
      expect(arts, niveau).not.toMatch(/se repérer dans les domaines/);
      const musique = prompt('pratique_artistique', niveau, 'musique');
      expect(musique, niveau).toMatch(/champs de compétences du programme de lycée/);
      expect(musique, niveau).toMatch(/explorer, imaginer, élaborer une stratégie : faire et créer/);
      expect(musique, niveau).not.toMatch(/culture musicale commune/);
    }
    // Collège et école : inchangés (cycles 2 à 4).
    expect(prompt('pratique_artistique', '4eme', 'arts_plastiques')).toMatch(/grille d’évaluation par compétences : expérimenter, produire, créer.*se repérer dans les domaines liés aux arts plastiques/s);
    expect(prompt('pratique_artistique', 'cm1', 'arts_plastiques')).not.toMatch(/programme de lycée/);
    expect(prompt('pratique_artistique', '4eme', 'musique')).toMatch(/grille d’évaluation par compétences : réaliser des projets musicaux/);
    expect(prompt('pratique_artistique', 'ce1', 'musique')).toMatch(/grille d’évaluation par compétences : chanter et interpréter/);
  });

  it('la consigne d’évaluation de l’EPS parvient au modèle et prime sur le contrôle écrit par défaut', () => {
    const sys = buildSystemPrompt(req({ niveau: 'terminale_gen', matiere: 'eps', sujet: 'Badminton', modalite: 'situation_eps' }), false);
    expect(sys).toMatch(/FORMAT : situation motrice en EPS.*Ce format prime sur toute autre indication de forme ci-dessus\./s);
  });
});

describe('QCM et vrai/faux : une mise en page qui reste lisible une fois affichée', () => {
  const parse = (md: string) => unified().use(remarkParse).use(remarkGfm).parse(md);

  it('QCM : les choix en liste à puces (un par ligne), une ligne vide entre deux questions, corrigé en liste', () => {
    const text = prompt('qcm', '4eme', 'mathematiques');
    expect(text).toMatch(/« \*\*Question 1\.\*\* Combien font 3 × 4 \? »/);
    expect(text).toMatch(/les 4 choix en liste à puces, un par ligne : « - A\) 7 », « - B\) 12 », « - C\) 34 », « - D\) 1 »/);
    expect(text).toMatch(/une ligne vide entre deux questions/);
    expect(text).toMatch(/« - Question 1 : B — 3 × 4 = 12 »/);
    expect(text).not.toMatch(/un choix par ligne : « A\)/);
    // La présentation prescrite donne bien un paragraphe puis une liste de 4 choix (et non une seule ligne).
    const tree = parse('**Question 1.** Combien font 3 × 4 ?\n- A) 7\n- B) 12\n- C) 34\n- D) 1\n\n**Question 2.** …\n- A) …');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'list', 'paragraph', 'list']);
    expect((tree.children[1] as { children: unknown[] }).children).toHaveLength(4);
    // Corrigé : une ligne par question (liste), pas une liste imbriquée.
    const key = parse('- Question 1 : B — 3 × 4 = 12\n- Question 2 : D — …');
    expect(key.children.map(n => n.type)).toEqual(['list']);
    expect((key.children[0] as { children: unknown[] }).children).toHaveLength(2);
  });

  it('vrai/faux : une affirmation par paragraphe ; corrigé en liste sans liste imbriquée', () => {
    const text = prompt('vrai_faux', '4eme', 'svt');
    expect(text).toMatch(/une affirmation par paragraphe, séparée de la suivante par une ligne vide/);
    expect(text).toMatch(/« \*\*1\.\*\* \[affirmation\] ☐ Vrai ☐ Faux — Justification : … »/);
    expect(text).toMatch(/Le corrigé est une liste à puces, une ligne par affirmation/);
    expect(text).toMatch(/« - Affirmation 1 : Faux — … »/);
    const tree = parse('**1.** Le cœur est un muscle. ☐ Vrai ☐ Faux — Justification : …\n\n**2.** Le sang circule dans un seul sens. ☐ Vrai ☐ Faux — Justification : …');
    expect(tree.children.map(n => n.type)).toEqual(['paragraph', 'paragraph']);
    const key = parse('- Affirmation 1 : Vrai — …\n- Affirmation 2 : Faux — …');
    expect(key.children.map(n => n.type)).toEqual(['list']);
  });
});

describe('cohérence des nouveaux formats', () => {
  it('chaque format propre à une épreuve ou à une pratique est un travail d’un seul tenant', () => {
    for (const value of ['sujet_bac_pro', 'devoir_surveille', 'sujet_bts', 'question_problematisee', 'situation_eps', 'pratique_artistique']) {
      expect(MODALITES.some(m => m.value === value), value).toBe(true);
      expect(countUnit(value), value).toBeNull();
    }
  });

  it('exclusions : jamais une matière ou une classe hors du format lui-même (règles cohérentes)', () => {
    for (const m of MODALITES) {
      for (const x of m.exclusions ?? []) {
        for (const matiere of x.matieres) {
          if (m.matieres) expect(m.matieres, `${m.value} / ${matiere}`).toContain(matiere);
        }
        // Une exclusion laisse toujours au moins une classe où le format est proposé pour ces matières.
        const reste = ALL_NIVEAUX.filter(n => !x.niveaux.includes(n) && x.matieres.some(ma => m.tools.some(t => isModaliteAvailable(m.value, t, n, ma))));
        expect(reste.length, m.value).toBeGreaterThan(0);
      }
    }
  });
});
