// Règles propres à chaque discipline : un tableau complet et sobre, injecté en une ligne « DISCIPLINE : » dans les
// outils qui en profitent, avant les consignes de l'outil (le format choisi garde le dernier mot), jamais dans les
// courriers, appréciations ni cahier-journal, et sans rien changer quand une matière n'a pas de règle.

import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { ALL_MATIERES, ALL_TYPES, isMatiereAvailableFor, type Matiere, type TypeContenu } from '../../shared/catalog';
import { DISCIPLINE_RULE_MAX_CHARS, DISCIPLINES, disciplineRule } from '../../shared/disciplines';
import { ALL_NIVEAUX, getLevelGroup, LEVEL_GROUP_LABELS, type LevelGroup, type NiveauScolaire } from '../../shared/levels';
import { computeBudgets, SOURCES_PROMPT_MARGIN_TOKENS } from '../../shared/pipeline';
import { buildMessages, buildSystemPrompt, estimateTokens } from '../../shared/prompts/index';
import { toolInstructions } from '../../shared/prompts/tools';
import type { GenerationRequest } from '../../shared/types';

const GROUPS = Object.keys(LEVEL_GROUP_LABELS) as LevelGroup[];
const WITH_RULE: TypeContenu[] = ['cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression', 'differenciation', 'corrige'];
const WITHOUT_RULE: TypeContenu[] = ['lettre_parents', 'appreciations', 'cahier_journal'];
/** Un niveau par groupe de niveau. */
const NIVEAU_OF: Record<LevelGroup, NiveauScolaire> = {
  maternelle: 'maternelle_gs', elementaire: 'cm1', college: '4eme', lycee: 'terminale_gen', lycee_pro: 'terminale_pro',
  bts_but: 'bts', cpge: 'cpge', licence: 'licence_2', master: 'master_1', doctorat: 'doctorat',
};

function req(extra: Partial<GenerationRequest> = {}): GenerationRequest {
  return { type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'Les fractions', researchMode: 'documents', texteEleve: 'Copie.', ...extra };
}
const sys = (extra: Partial<GenerationRequest> = {}) => buildSystemPrompt(req(extra), false);
const disciplineLines = (text: string) => text.split('\n').filter(l => l.startsWith('DISCIPLINE : '));

describe('disciplines : le tableau des règles', () => {
  it('chaque matière du catalogue a une entrée, et il n’y en a pas d’autre', () => {
    const values = ALL_MATIERES.map(m => m.value).sort();
    expect(Object.keys(DISCIPLINES).sort()).toEqual(values);
    for (const m of values) expect(typeof DISCIPLINES[m].default, m).toBe('string');
  });

  it('seule « autre » n’a pas de règle ; toutes les autres ont une règle par défaut', () => {
    for (const { value } of ALL_MATIERES) {
      if (value === 'autre') expect(DISCIPLINES[value].default).toBe('');
      else expect(DISCIPLINES[value].default.length, value).toBeGreaterThan(40);
    }
    for (const group of GROUPS) expect(disciplineRule('autre', group)).toBe('');
  });

  it('chaque clé de variante est un groupe de niveau valide', () => {
    for (const { value } of ALL_MATIERES) {
      for (const group of Object.keys(DISCIPLINES[value].groups ?? {})) expect(GROUPS, `${value} / ${group}`).toContain(group);
    }
  });

  it('chaque texte : 300 caractères au plus, une seule ligne, sans émoji, ni espace de bord, ni titre Markdown', () => {
    for (const { value } of ALL_MATIERES) {
      const { default: base, groups } = DISCIPLINES[value];
      for (const [key, text] of [['default', base], ...Object.entries(groups ?? {})] as [string, string][]) {
        const label = `${value} / ${key}`;
        expect(text.length, label).toBeLessThanOrEqual(DISCIPLINE_RULE_MAX_CHARS);
        expect(text, label).not.toMatch(/\n/);
        expect(text, label).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(text, label).toBe(text.trim());
        expect(text, label).not.toMatch(/^#/);
        expect(text, label).not.toMatch(/^[-*>] /);
        if (key !== 'default') expect(text.length, label).toBeGreaterThan(0);
        expect(text, label).not.toMatch(/ {2}|[;,] [;,]| [,.]/);
      }
    }
  });

  it('disciplineRule : la variante du groupe, sinon la règle par défaut', () => {
    expect(disciplineRule('mathematiques', 'college')).toBe(DISCIPLINES.mathematiques.groups!.college);
    expect(disciplineRule('mathematiques', 'college')).not.toBe(DISCIPLINES.mathematiques.default);
    // Aucune variante « college » pour les statistiques : la règle par défaut.
    expect(DISCIPLINES.statistiques.groups?.college).toBeUndefined();
    expect(disciplineRule('statistiques', 'college')).toBe(DISCIPLINES.statistiques.default);
  });
});

describe('disciplines : cohérence entre le niveau et la règle', () => {
  /** Cycle officiel des niveaux du premier degré et du collège (la 6e est au cycle 3, avec le CM1-CM2). */
  const SCHOOL_CYCLE: Partial<Record<NiveauScolaire, number>> = {
    maternelle_tps: 1, maternelle_ps: 1, maternelle_ms: 1, maternelle_gs: 1, cp: 2, ce1: 2, ce2: 2, cm1: 3, cm2: 3,
    '6eme': 3, '5eme': 4, '4eme': 4, '3eme': 4,
  };

  /** Chaque couple (matière, niveau) proposé par le catalogue, avec la règle que reçoit le modèle. */
  const applications = ALL_MATIERES.flatMap(({ value: matiere }) => ALL_NIVEAUX
    .filter(niveau => isMatiereAvailableFor(matiere, niveau))
    .map(niveau => ({ matiere, niveau, group: getLevelGroup(niveau), rule: disciplineRule(matiere, getLevelGroup(niveau)) }))
    .filter(a => a.rule !== ''));

  /** Cycles cités par la règle (« cycles 2-3 », « cycle 4 »), ou aucun. */
  const citedCycles = (rule: string): Set<number> => {
    const cycles = new Set<number>();
    for (const m of rule.matchAll(/cycles? (\d)(?:\s*(?:-|à|et)\s*(\d))?/gi)) {
      for (let c = Number(m[1]); c <= Number(m[2] ?? m[1]); c++) cycles.add(c);
    }
    return cycles;
  };
  /** Cycles des classes nommées dans la règle (« CM1-CM2 », « 6e », « 5e-3e »). */
  const namedClassCycles = (rule: string): Set<number> => {
    const cycles = new Set<number>();
    if (/\b(?:CP|CE[12])\b/.test(rule)) cycles.add(2);
    if (/\b(?:CM[12]|6e)\b/.test(rule)) cycles.add(3);
    if (/\b[345]e\b/.test(rule)) cycles.add(4);
    return cycles;
  };

  it('une règle qui cite un cycle couvre le cycle de chaque classe à laquelle elle s’applique (6e : cycle 3)', () => {
    for (const { matiere, niveau, rule } of applications) {
      const cycle = SCHOOL_CYCLE[niveau];
      const cited = citedCycles(rule);
      if (cycle === undefined || cited.size === 0) continue;
      const covered = new Set([...cited, ...namedClassCycles(rule)]);
      expect(covered.has(cycle), `${matiere} / ${niveau} (cycle ${cycle}) : « ${rule} »`).toBe(true);
    }
  });

  it('aucune règle du collège ne cite le lycée, « terminale » ou « bac » ; aucune règle du premier degré ne cite le collège ni le lycée', () => {
    for (const { matiere, niveau, group, rule } of applications) {
      if (group === 'college') expect(rule, `${matiere} / ${niveau}`).not.toMatch(/terminale|\bbac\b|lycée|seconde|licence|master|cpge|\bbts\b/i);
      if (group === 'maternelle' || group === 'elementaire') expect(rule, `${matiere} / ${niveau}`).not.toMatch(/collège|lycée|terminale|\bbac\b|licence|master/i);
      if (group === 'lycee' || group === 'lycee_pro') expect(rule, `${matiere} / ${niveau}`).not.toMatch(/cycles? [234]|collège|\b6e\b|fin de lycée/i);
    }
  });

  it('philosophie au lycée : notions du programme de la classe, pas de terminale seulement', () => {
    for (const niveau of ['2nde_gt', '1ere_gen', 'terminale_gen', '1ere_techno'] as NiveauScolaire[]) {
      expect(disciplineRule('philosophie', getLevelGroup(niveau)), niveau).toMatch(/programme de la classe/);
      expect(disciplineRule('philosophie', getLevelGroup(niveau)), niveau).not.toMatch(/terminale/i);
    }
  });

  it('SVT et physique-chimie au collège : la 6e (cycle 3) n’est pas présentée comme du cycle 4', () => {
    for (const matiere of ['svt', 'physique_chimie'] as Matiere[]) {
      const rule = disciplineRule(matiere, 'college');
      expect(rule, matiere).toMatch(/cycle 3/i);
      expect(rule, matiere).toMatch(/6e/);
      expect(rule, matiere).not.toMatch(/^Cycle 4/);
    }
  });

  it('EVARS au collège : variante bornée par niveau, contraception et IST réservées à la 4e-3e', () => {
    const college = DISCIPLINES.evars.groups?.college ?? '';
    expect(college).not.toBe('');
    expect(college).not.toBe(DISCIPLINES.evars.default);
    for (const word of ['puberté', 'respect', 'consentement', 'égalité', 'neutres', 'sans jugement moral']) expect(college.toLowerCase(), word).toContain(word);
    // Les contenus les plus sensibles ne sont cités qu'avec leur borne de niveau et leur renvoi au programme.
    expect(college).toMatch(/[Cc]ontraception et IST seulement en 4e-3e, selon le programme/);
    expect(college).toMatch(/en 6e, rien d'explicite/);
    for (const niveau of ['6eme', '5eme', '4eme', '3eme'] as NiveauScolaire[]) {
      expect(sys({ type: 'cours', niveau, matiere: 'evars' }), niveau).toContain(`DISCIPLINE : ${college}`);
    }
    // Le lycée garde la règle générale.
    expect(disciplineRule('evars', 'lycee')).toBe(DISCIPLINES.evars.default);
    expect(DISCIPLINES.evars.default).toMatch(/contraception, IST/);
  });
});

describe('disciplines : la ligne « DISCIPLINE : » du prompt système', () => {
  it('présente, une seule fois, pour chaque matière à règle, outil concerné et groupe de niveau', () => {
    for (const { value: matiere } of ALL_MATIERES) {
      if (matiere === 'autre') continue;
      for (const group of GROUPS) {
        const niveau = NIVEAU_OF[group];
        const rule = disciplineRule(matiere, group);
        for (const type of WITH_RULE) {
          const lines = disciplineLines(sys({ type, niveau, matiere }));
          expect(lines, `${matiere} / ${type} / ${niveau}`).toEqual([`DISCIPLINE : ${rule}`]);
        }
      }
    }
  });

  it('absente de la lettre aux parents, des appréciations et du cahier-journal', () => {
    for (const type of WITHOUT_RULE) {
      for (const matiere of ['mathematiques', 'anglais', 'eps'] as Matiere[]) {
        expect(sys({ type, matiere }), `${type} / ${matiere}`).not.toMatch(/DISCIPLINE :/);
      }
    }
    // Les outils concernés et les autres couvrent tous les types.
    expect([...WITH_RULE, ...WITHOUT_RULE].sort()).toEqual([...ALL_TYPES].sort());
  });

  it('absente pour la matière « autre » : le prompt est identique à celui d’avant', () => {
    for (const type of WITH_RULE) {
      const text = sys({ type, matiere: 'autre' });
      expect(text, type).not.toMatch(/DISCIPLINE :/);
      expect(text, type).not.toMatch(/\n\n\n/);
    }
  });

  it('c’est la règle de la matière choisie, pas celle d’une autre matière', () => {
    for (const { value: matiere } of ALL_MATIERES) {
      if (matiere === 'autre') continue;
      const text = sys({ matiere });
      const own = disciplineRule(matiere, 'college');
      expect(text, matiere).toContain(`DISCIPLINE : ${own}`);
      for (const { value: other } of ALL_MATIERES) {
        const rule = disciplineRule(other, 'college');
        if (other !== matiere && rule && rule !== own) expect(text, `${matiere} contient la règle de ${other}`).not.toContain(rule);
      }
    }
  });

  it('la variante du groupe de niveau est choisie par le niveau', () => {
    const cases: [NiveauScolaire, LevelGroup][] = [['maternelle_ms', 'maternelle'], ['ce2', 'elementaire'], ['3eme', 'college'], ['1ere_gen', 'lycee'], ['cap_1', 'lycee_pro'], ['licence_3', 'licence'], ['master_2', 'master'], ['doctorat', 'doctorat']];
    for (const [niveau, group] of cases) {
      expect(getLevelGroup(niveau)).toBe(group);
      const text = sys({ niveau, matiere: 'mathematiques' });
      expect(text, niveau).toContain(`DISCIPLINE : ${DISCIPLINES.mathematiques.groups![group]}`);
      expect(text, niveau).not.toContain(DISCIPLINES.mathematiques.default);
    }
    // Pas de variante pour ce groupe : la règle par défaut.
    expect(sys({ niveau: '4eme', matiere: 'statistiques' })).toContain(`DISCIPLINE : ${DISCIPLINES.statistiques.default}`);
  });

  it('placée après le niveau et les référentiels, avant les consignes de l’outil et les exigences de qualité', () => {
    for (const type of WITH_RULE) {
      for (const niveau of ['4eme', 'bts', 'licence_2'] as NiveauScolaire[]) {
        const r = req({ type, niveau });
        const text = buildSystemPrompt(r, false);
        const at = text.indexOf('DISCIPLINE : ');
        const tool = text.indexOf(toolInstructions(r, getLevelGroup(niveau)));
        expect(at, `${type} / ${niveau}`).toBeGreaterThan(text.indexOf('NIVEAU : '));
        expect(at, `${type} / ${niveau}`).toBeGreaterThan(Math.max(text.indexOf('RÉFÉRENTIELS'), text.indexOf('ENSEIGNEMENT SUPÉRIEUR')));
        expect(tool, `${type} / ${niveau}`).toBeGreaterThan(at);
        expect(text.indexOf('QUALITÉ ATTENDUE'), `${type} / ${niveau}`).toBeGreaterThan(tool);
        // Un paragraphe à part : une seule ligne.
        expect(text.split('\n\n').filter(p => p.startsWith('DISCIPLINE : ')).every(p => !p.includes('\n'))).toBe(true);
      }
    }
  });

  it('matière de langue : la règle de discipline et la règle de langue coexistent, sans doublon', () => {
    for (const matiere of ['anglais', 'espagnol', 'latin', 'grec'] as Matiere[]) {
      const text = sys({ type: 'exercices', matiere, niveau: '4eme' });
      expect(text, matiere).toContain(`DISCIPLINE : ${disciplineRule(matiere, 'college')}`);
      expect(text.match(/^- Langue :/gm), matiere).toHaveLength(1);
      expect(text, matiere).not.toMatch(/Écris un français soigné/);
      // La règle de discipline ne dit jamais dans quelle langue écrire : c'est le rôle de la règle de langue.
      expect(disciplineRule(matiere, 'college'), matiere).not.toMatch(/jamais en français|langue cible/i);
    }
    // Copie corrigée : la règle de langue du corrigé reste seule maîtresse de la langue des corrections.
    const corrige = sys({ type: 'corrige', matiere: 'anglais', niveau: '4eme' });
    expect(corrige).toContain('DISCIPLINE : ');
    expect(corrige).toMatch(/anglais correct et naturel pour un passage écrit en anglais/);
  });

  it('niveau maternelle et primaire : la règle accompagne les consignes du niveau sans les remplacer', () => {
    const maternelle = sys({ niveau: 'maternelle_gs', matiere: 'nombres_formes', type: 'fiche_prep' });
    expect(maternelle).toContain(`DISCIPLINE : ${DISCIPLINES.nombres_formes.default}`);
    expect(maternelle).toMatch(/PUBLIC : élèves de maternelle/);
    const cm1 = sys({ niveau: 'cm1', matiere: 'mathematiques', type: 'exercices' });
    expect(cm1).toMatch(/PUBLIC : élèves d'école élémentaire/);
    expect(cm1).toContain(`DISCIPLINE : ${DISCIPLINES.mathematiques.groups!.elementaire}`);
  });

  it('format choisi et texte à trous : la règle précède le format, qui garde le dernier mot', () => {
    const qcm = sys({ type: 'exercices', matiere: 'svt', niveau: '4eme', modalite: 'qcm', nombreExercices: 8 });
    expect(qcm.indexOf('DISCIPLINE : ')).toBeLessThan(qcm.indexOf('FORMAT : QCM'));
    expect(qcm).toMatch(/EXACTEMENT 8 questions/);
    for (const type of ['exercices', 'evaluation'] as const) {
      const cloze = sys({ type, matiere: 'svt', niveau: '4eme', modalite: 'texte_trous', nombreExercices: 8 });
      expect(cloze.indexOf('DISCIPLINE : '), type).toBeGreaterThan(-1);
      expect(cloze.indexOf('DISCIPLINE : '), type).toBeLessThan(cloze.indexOf('FORMAT : texte à trous'));
      expect(cloze, type).toMatch(/doubles crochets/);
    }
    // Version élève seule : la règle ne rouvre pas le corrigé.
    expect(sys({ type: 'exercices', matiere: 'mathematiques', sansCorrige: true })).toMatch(/VERSION ÉLÈVE SEULE/);
  });
});

describe('disciplines : budget de tokens', () => {
  const provider = new MockProvider({ contextTokens: 12_288 });

  it('la ligne n’ajoute que ses propres tokens, sans toucher à la place de la réponse', () => {
    for (const matiere of ['mathematiques', 'anglais', 'eps', 'droit'] as Matiere[]) {
      const r = req({ type: 'exercices', niveau: '4eme', matiere, sansCorrige: undefined, texteEleve: undefined });
      const line = `DISCIPLINE : ${disciplineRule(matiere, 'college')}`;
      const messages = buildMessages({ ...r, documents: undefined }, []);
      const without = messages.map(m => ({ content: m.content.replace(`${line}\n\n`, '') }));
      expect(without[0].content, matiere).not.toContain('DISCIPLINE :');
      const sum = (ms: { content: string }[]) => ms.reduce((n, m) => n + estimateTokens(m.content) + 8, 0) + SOURCES_PROMPT_MARGIN_TOKENS;
      const b = computeBudgets(provider, r);
      expect(b.promptTokens, matiere).toBe(sum(messages));
      const added = b.promptTokens - sum(without);
      expect(added, matiere).toBeGreaterThanOrEqual(estimateTokens(line) - 1);
      expect(added, matiere).toBeLessThanOrEqual(estimateTokens(line) + 2);
      expect(b.outputTokens, matiere).toBe(Math.floor(12_288 * 0.4));
      expect(b.fits, matiere).toBe(true);
    }
  });

  it('une règle de 300 caractères ajoute au plus 100 tokens, et la demande tient encore dans un modèle de 8 k', () => {
    const small = new MockProvider({ contextTokens: 8_192 });
    let max = 0;
    for (const { value: matiere } of ALL_MATIERES) {
      for (const group of GROUPS) {
        max = Math.max(max, estimateTokens(`DISCIPLINE : ${disciplineRule(matiere, group)}\n\n`));
      }
      expect(computeBudgets(small, req({ type: 'sequence', niveau: 'licence_2', matiere })).fits, matiere).toBe(true);
    }
    expect(max).toBeLessThanOrEqual(100);
  });
});
