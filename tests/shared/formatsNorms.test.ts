// Formats normés et textes officiels en vigueur (rentrée 2026, session 2027) : épreuves du brevet, du baccalauréat
// général, technologique et professionnel, du supérieur ; programme de maternelle en six domaines ; niveaux du CECRL
// des programmes de langues vivantes ; EPS et enseignements artistiques ; mise en page Markdown des QCM et vrai/faux.

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import {
  ALL_MATIERES, getMatiereLabel, getMatieresForNiveau, getSujetSuggestions, isMatiere, resolveMatiere, type Matiere, type TypeContenu,
} from '../../shared/catalog.js';
import { countUnit, isModaliteAvailable, MODALITES, modalitePrompt, modalitesFor } from '../../shared/formats.js';
import { ALL_NIVEAUX, type NiveauScolaire } from '../../shared/levels.js';
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

  it('STMG, sciences de l’ingénieur, LLCER : un sujet type bac ; aucune épreuve hors de leur voie', () => {
    expect(values('evaluation', 'terminale_techno', 'droit_economie')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'management')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_gen', 'sciences_ingenieur')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_gen', 'anglais')).toContain('sujet_bac');
    expect(values('evaluation', 'terminale_gen', 'droit_economie')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'anglais')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'ses')).not.toContain('sujet_bac');
    expect(values('evaluation', 'terminale_techno', 'physique_chimie')).toContain('sujet_bac');
    expect(prompt('sujet_bac', 'terminale_techno', 'droit_economie')).toMatch(/Partie droit \(10 points\).*Partie économie \(10 points\)/s);
    expect(prompt('sujet_bac', 'terminale_techno', 'management')).toMatch(/fictive présentée comme telle/);
    expect(prompt('sujet_bac', 'terminale_gen', 'sciences_ingenieur')).toMatch(/3 heures 30.*sciences physiques/s);
    const llcer = prompt('sujet_bac', 'terminale_gen', 'espagnol');
    expect(llcer).toMatch(/LLCER.*synthèse d’environ 500 mots à rédiger en espagnol.*traduction en français.*OU transposition/s);
    expect(llcer).toMatch(/16 points.*4 points/s);
    expect(prompt('sujet_bac', 'terminale_techno', 'physique_chimie')).toMatch(/physique-chimie et mathématiques \(STI2D, STL\)/);
  });

  it('session 2027 : au moins 2 points pour la maîtrise de la langue dans chaque épreuve (brevet, bac, bac pro)', () => {
    for (const [value, niveau, matiere] of [
      ['sujet_bac', '1ere_gen', 'mathematiques'], ['sujet_bac', 'terminale_gen', 'svt'], ['sujet_brevet', '3eme', 'francais'],
      ['sujet_brevet', '3eme', 'histoire_geo'], ['sujet_bac_pro', 'terminale_pro', 'francais'],
    ] as const) {
      expect(prompt(value, niveau, matiere), `${value} ${matiere}`).toMatch(/Maîtrise de la langue : au moins 2 points du total/);
    }
    expect(prompt('interro', '4eme', 'mathematiques')).not.toMatch(/maîtrise de la langue/);
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
