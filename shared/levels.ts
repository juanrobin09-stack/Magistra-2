// Niveaux scolaires et universitaires, regroupés par « groupe de niveau ».
// Le groupe pilote les prompts (exigences pédagogiques) et l'interface.

export type NiveauScolaire =
  // Maternelle
  | 'maternelle_tps' | 'maternelle_ps' | 'maternelle_ms' | 'maternelle_gs'
  // Élémentaire
  | 'cp' | 'ce1' | 'ce2' | 'cm1' | 'cm2'
  // Collège
  | '6eme' | '5eme' | '4eme' | '3eme'
  // Lycée général & technologique
  | '2nde_gt' | '1ere_gen' | 'terminale_gen' | '1ere_techno' | 'terminale_techno'
  // Lycée professionnel
  | '2nde_pro' | '1ere_pro' | 'terminale_pro' | 'cap_1' | 'cap_2'
  // Supérieur
  | 'bts' | 'but' | 'cpge' | 'licence_1' | 'licence_2' | 'licence_3' | 'master_1' | 'master_2' | 'doctorat';

export type LevelGroup =
  | 'maternelle'
  | 'elementaire'
  | 'college'
  | 'lycee'
  | 'lycee_pro'
  | 'bts_but'
  | 'cpge'
  | 'licence'
  | 'master'
  | 'doctorat';

/** Cycles officiels utilisés pour filtrer les matières. */
export type Cycle = 'maternelle' | 'cycle2' | 'cycle3' | 'college' | 'lycee' | 'lycee_pro' | 'superieur';

export interface NiveauGroupDef {
  label: string;
  niveaux: { value: NiveauScolaire; label: string }[];
}

export const NIVEAUX: Record<string, NiveauGroupDef> = {
  maternelle: {
    label: 'Maternelle',
    niveaux: [
      { value: 'maternelle_tps', label: 'Toute Petite Section (TPS)' },
      { value: 'maternelle_ps', label: 'Petite Section (PS)' },
      { value: 'maternelle_ms', label: 'Moyenne Section (MS)' },
      { value: 'maternelle_gs', label: 'Grande Section (GS)' },
    ],
  },
  primaire: {
    label: 'Élémentaire',
    niveaux: [
      { value: 'cp', label: 'CP' },
      { value: 'ce1', label: 'CE1' },
      { value: 'ce2', label: 'CE2' },
      { value: 'cm1', label: 'CM1' },
      { value: 'cm2', label: 'CM2' },
    ],
  },
  college: {
    label: 'Collège',
    niveaux: [
      { value: '6eme', label: '6ème' },
      { value: '5eme', label: '5ème' },
      { value: '4eme', label: '4ème' },
      { value: '3eme', label: '3ème' },
    ],
  },
  lycee_general: {
    label: 'Lycée Général & Techno',
    niveaux: [
      { value: '2nde_gt', label: 'Seconde GT' },
      { value: '1ere_gen', label: 'Première Générale' },
      { value: 'terminale_gen', label: 'Terminale Générale' },
      { value: '1ere_techno', label: 'Première Technologique' },
      { value: 'terminale_techno', label: 'Terminale Technologique' },
    ],
  },
  lycee_pro: {
    label: 'Lycée Professionnel',
    niveaux: [
      { value: 'cap_1', label: 'CAP 1ère année' },
      { value: 'cap_2', label: 'CAP 2ème année' },
      { value: '2nde_pro', label: 'Seconde Pro' },
      { value: '1ere_pro', label: 'Première Pro' },
      { value: 'terminale_pro', label: 'Terminale Pro' },
    ],
  },
  superieur: {
    label: 'Supérieur',
    niveaux: [
      { value: 'bts', label: 'BTS' },
      { value: 'but', label: 'BUT' },
      { value: 'cpge', label: 'CPGE (Prépa)' },
      { value: 'licence_1', label: 'Licence 1' },
      { value: 'licence_2', label: 'Licence 2' },
      { value: 'licence_3', label: 'Licence 3' },
      { value: 'master_1', label: 'Master 1' },
      { value: 'master_2', label: 'Master 2' },
      { value: 'doctorat', label: 'Doctorat' },
    ],
  },
};

export const ALL_NIVEAUX: NiveauScolaire[] = Object.values(NIVEAUX).flatMap(g => g.niveaux.map(n => n.value));

export function isNiveau(value: unknown): value is NiveauScolaire {
  return typeof value === 'string' && (ALL_NIVEAUX as string[]).includes(value);
}

export function getLevelGroup(niveau: NiveauScolaire): LevelGroup {
  if (niveau.startsWith('maternelle')) return 'maternelle';
  if (['cp', 'ce1', 'ce2', 'cm1', 'cm2'].includes(niveau)) return 'elementaire';
  if (['6eme', '5eme', '4eme', '3eme'].includes(niveau)) return 'college';
  if (['2nde_gt', '1ere_gen', 'terminale_gen', '1ere_techno', 'terminale_techno'].includes(niveau)) return 'lycee';
  if (['cap_1', 'cap_2', '2nde_pro', '1ere_pro', 'terminale_pro'].includes(niveau)) return 'lycee_pro';
  if (niveau === 'bts' || niveau === 'but') return 'bts_but';
  if (niveau === 'cpge') return 'cpge';
  if (niveau.startsWith('licence')) return 'licence';
  if (niveau.startsWith('master')) return 'master';
  return 'doctorat';
}

export function getCycle(niveau: NiveauScolaire): Cycle {
  if (niveau.startsWith('maternelle')) return 'maternelle';
  if (['cp', 'ce1', 'ce2'].includes(niveau)) return 'cycle2';
  if (['cm1', 'cm2'].includes(niveau)) return 'cycle3';
  if (['6eme', '5eme', '4eme', '3eme'].includes(niveau)) return 'college';
  if (['2nde_gt', '1ere_gen', 'terminale_gen', '1ere_techno', 'terminale_techno'].includes(niveau)) return 'lycee';
  if (['cap_1', 'cap_2', '2nde_pro', '1ere_pro', 'terminale_pro'].includes(niveau)) return 'lycee_pro';
  return 'superieur';
}

export const SUPERIEUR_GROUPS: LevelGroup[] = ['bts_but', 'cpge', 'licence', 'master', 'doctorat'];

export function isSuperieur(niveau: NiveauScolaire): boolean {
  return SUPERIEUR_GROUPS.includes(getLevelGroup(niveau));
}

/** Enseignement universitaire au sens strict (où les documents de l'enseignant priment). */
export function isUniversitaire(niveau: NiveauScolaire): boolean {
  const g = getLevelGroup(niveau);
  return g === 'licence' || g === 'master' || g === 'doctorat';
}

/** Anciens libellés de niveau stockés par la première version de Magistra, différents des libellés actuels. */
const LEGACY_NIVEAU_LABELS: Record<string, NiveauScolaire> = { 'but (ex-dut)': 'but' };

/** Clé de niveau à partir d'une clé, d'un libellé actuel ou d'un ancien libellé stocké. */
export function resolveNiveau(value: NiveauScolaire | string): NiveauScolaire | undefined {
  const label = String(value).trim().toLowerCase();
  for (const group of Object.values(NIVEAUX)) {
    const found = group.niveaux.find(n => n.value === value || n.label.toLowerCase() === label);
    if (found) return found.value;
  }
  return LEGACY_NIVEAU_LABELS[label];
}

export function getNiveauLabel(niveau: NiveauScolaire | string): string {
  const key = resolveNiveau(niveau);
  for (const group of Object.values(NIVEAUX)) {
    const found = group.niveaux.find(n => n.value === key);
    if (found) return found.label;
  }
  return String(niveau);
}

export const LEVEL_GROUP_LABELS: Record<LevelGroup, string> = {
  maternelle: 'Maternelle',
  elementaire: 'École élémentaire',
  college: 'Collège',
  lycee: 'Lycée général et technologique',
  lycee_pro: 'Lycée professionnel / CAP',
  bts_but: 'BTS / BUT',
  cpge: 'Classes préparatoires (CPGE)',
  licence: 'Licence',
  master: 'Master',
  doctorat: 'Doctorat',
};
