// Catalogue volontairement court des modèles locaux proposés aux enseignants.
// L'enseignant voit « Magistra Léger / Standard / Qualité » ; le nom technique n'apparaît qu'en mode avancé.
//
// Les modèles retenus sont publiés sous licence Apache 2.0 (Mistral AI) et disponibles dans la
// bibliothèque Ollama. Les tailles sont celles des versions quantifiées Q4 publiées par Ollama
// (arrondies) ; elles servent à informer l'utilisateur avant tout téléchargement.

export type TierId = 'leger' | 'standard' | 'qualite';

export interface ModelTier {
  id: TierId;
  label: string;
  /** Nom du modèle dans la bibliothèque Ollama. */
  model: string;
  /** Nom commercial du modèle open weights (affiché en mode avancé). */
  modelDisplayName: string;
  license: string;
  description: string;
  /** Taille approximative du téléchargement, en Go. */
  downloadGB: number;
  /** Mémoire vive minimale pour fonctionner sans bloquer la machine, en Go. */
  minRamGB: number;
  /** Mémoire vive confortable (utilisation sans carte graphique), en Go. */
  comfortableRamGB: number;
  /** Mémoire vidéo permettant une génération rapide sur carte graphique, en Go. */
  fastVramGB: number;
  /** Taille de contexte demandée à Ollama (tokens). */
  contextTokens: number;
}

export const MODEL_TIERS: ModelTier[] = [
  {
    id: 'leger',
    label: 'Magistra Léger',
    model: 'ministral-3:8b',
    modelDisplayName: 'Ministral 3 8B (Mistral AI)',
    license: 'Apache 2.0',
    description: 'Pour les ordinateurs modestes (8 Go de mémoire au minimum). Plus rapide, un peu moins précis.',
    downloadGB: 6,
    minRamGB: 8,
    comfortableRamGB: 12,
    fastVramGB: 8,
    contextTokens: 12_288,
  },
  {
    id: 'standard',
    label: 'Magistra Standard',
    model: 'ministral-3:14b',
    modelDisplayName: 'Ministral 3 14B (Mistral AI)',
    license: 'Apache 2.0',
    description: 'Le meilleur équilibre qualité / rapidité, pour les ordinateurs récents (16 Go de mémoire au minimum, ou une carte graphique d’au moins 12 Go).',
    downloadGB: 9,
    minRamGB: 16,
    comfortableRamGB: 24,
    fastVramGB: 12,
    contextTokens: 12_288,
  },
  {
    id: 'qualite',
    label: 'Magistra Qualité',
    model: 'mistral-small3.2:24b',
    modelDisplayName: 'Mistral Small 3.2 24B (Mistral AI)',
    license: 'Apache 2.0',
    description: 'Pour les ordinateurs puissants équipés d’une carte graphique récente (16 Go de mémoire vidéo). Contenus plus riches.',
    downloadGB: 15,
    minRamGB: 32,
    comfortableRamGB: 48,
    fastVramGB: 16,
    contextTokens: 16_384,
  },
];

export const DEFAULT_TIER: TierId = 'standard';

export function getTier(id: string | undefined): ModelTier {
  return MODEL_TIERS.find(t => t.id === id) ?? MODEL_TIERS.find(t => t.id === DEFAULT_TIER)!;
}

export function tierForModel(model: string): ModelTier | undefined {
  return MODEL_TIERS.find(t => t.model === model);
}

export interface GpuInfo {
  name: string;
  /** Mémoire vidéo dédiée en Go, si elle a pu être mesurée. */
  vramGB?: number;
}

export interface HardwareInfo {
  totalRamGB: number;
  freeRamGB?: number;
  cpuModel?: string;
  cpuCores: number;
  gpus: GpuInfo[];
  /** Espace disque libre pour les modèles, en Go. */
  freeDiskGB?: number;
  platform: string;
}

export type TierFit = 'recommended' | 'ok' | 'slow' | 'not_recommended';

export interface TierAssessment {
  id: TierId;
  fit: TierFit;
  note: string;
}

export interface Recommendation {
  tier: TierId;
  /** Profil de machine, en langage simple. */
  machine: 'modeste' | 'correct' | 'puissant';
  summary: string;
  warning?: string;
  tiers: TierAssessment[];
  /**
   * Faux si AUCUN modèle local ne peut fonctionner sans rendre l'ordinateur inutilisable
   * (mémoire ou disque insuffisants). `tier` indique alors le niveau le moins exigeant, mais il
   * n'est PAS marqué « recommended » : l'interface doit proposer un serveur d'IA distant.
   */
  localPossible?: boolean;
}

/**
 * Recommande un niveau de modèle selon la machine.
 * Principe : ne jamais recommander un modèle qui risque de rendre l'ordinateur inutilisable.
 * - PC modeste (moins de 16 Go, sans carte graphique d'au moins 10 Go) → Magistra Léger ;
 * - PC correct (16 Go ou plus, ou carte graphique d'au moins 10 Go) → Magistra Standard ;
 * - PC puissant (carte graphique d'au moins 16 Go et 16 Go de mémoire) → Magistra Qualité.
 * Un niveau déconseillé (mémoire ou disque insuffisants) n'est jamais recommandé : on redescend.
 */
/** Capacités de mémoire vendues couramment (Go). */
const RAM_SIZES_GB = [2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 36, 48, 64, 96, 128, 192, 256];

/**
 * Mémoire « nominale » de l'ordinateur. Le système ne voit pas toute la mémoire installée (une part est
 * réservée au matériel ou à la carte graphique intégrée) : un PC vendu avec 16 Go en déclare souvent
 * 15,7, voire 14. On retient la capacité commerciale immédiatement supérieure si l'écart est faible
 * (15 % au plus), pour ne pas refuser à tort un niveau adapté à l'ordinateur.
 */
export function nominalRamGB(detectedGB: number): number {
  if (!Number.isFinite(detectedGB) || detectedGB <= 0) return 0;
  const size = RAM_SIZES_GB.find(s => s >= detectedGB);
  return size !== undefined && detectedGB >= size * 0.85 ? size : detectedGB;
}

export function recommendTier(hw: HardwareInfo): Recommendation {
  const ram = nominalRamGB(hw.totalRamGB);
  const vram = Math.max(0, ...(hw.gpus ?? []).map(g => (Number.isFinite(g.vramGB) ? g.vramGB ?? 0 : 0)));
  const freeDisk = hw.freeDiskGB !== undefined && Number.isFinite(hw.freeDiskGB) ? hw.freeDiskGB : undefined;

  /** Mémoire insuffisante : le modèle ne tient ni en mémoire vive, ni (en grande partie) sur la carte graphique. */
  const lacksMemory = (tier: ModelTier) => ram < tier.minRamGB && !(vram >= tier.fastVramGB && ram >= tier.minRamGB / 2);

  const assess = (tier: ModelTier): TierAssessment => {
    const fitsGpu = vram >= tier.fastVramGB;
    if (lacksMemory(tier)) {
      return { id: tier.id, fit: 'not_recommended', note: `Déconseillé : ${tier.minRamGB} Go de mémoire nécessaires, cet ordinateur en a ${formatGB(ram)}.` };
    }
    if (freeDisk !== undefined && freeDisk < tier.downloadGB + 2) {
      return { id: tier.id, fit: 'not_recommended', note: `Espace disque insuffisant : environ ${tier.downloadGB + 2} Go nécessaires, ${formatGB(Math.max(0, freeDisk))} disponibles.` };
    }
    if (fitsGpu) return { id: tier.id, fit: 'ok', note: 'Rapide grâce à la carte graphique.' };
    if (tier.id === 'qualite') return { id: tier.id, fit: 'slow', note: 'Très lent sans carte graphique dédiée (plusieurs minutes par contenu).' };
    if (ram >= tier.comfortableRamGB) return { id: tier.id, fit: 'ok', note: 'Fonctionne sans carte graphique, génération progressive.' };
    return { id: tier.id, fit: 'slow', note: 'Fonctionne, mais lentement sur cet ordinateur.' };
  };

  let tier: TierId;
  let machine: Recommendation['machine'];
  if (vram >= 16 && ram >= 16) {
    tier = 'qualite';
    machine = 'puissant';
  } else if (vram >= 10 || ram >= 16) {
    tier = 'standard';
    machine = 'correct';
  } else {
    tier = 'leger';
    machine = 'modeste';
  }

  const tiers = MODEL_TIERS.map(assess);
  const fitOf = (id: TierId) => tiers.find(t => t.id === id)!;
  // Si le niveau visé est déconseillé (mémoire, disque plein…), redescendre vers un niveau utilisable.
  const order: TierId[] = ['qualite', 'standard', 'leger'];
  const usable = order.slice(order.indexOf(tier)).find(id => fitOf(id).fit !== 'not_recommended');
  const localPossible = usable !== undefined;
  tier = usable ?? 'leger';
  if (localPossible) {
    // La note du niveau retenu est réécrite : elle doit rester cohérente avec le badge « recommandé ».
    const chosenTier = getTier(tier);
    const chosen = fitOf(tier);
    chosen.fit = 'recommended';
    chosen.note = vram >= chosenTier.fastVramGB
      ? 'Recommandé pour cet ordinateur : rapide grâce à la carte graphique.'
      : ram >= chosenTier.comfortableRamGB
        ? 'Recommandé pour cet ordinateur : génération progressive sans carte graphique.'
        : 'Recommandé pour cet ordinateur : génération progressive sans carte graphique, assez lente (fermez les autres applications pendant la rédaction).';
  }

  const lightest = getTier('leger');
  let warning: string | undefined;
  let summary: string;
  const machineText = machine === 'puissant'
    ? 'Ordinateur puissant avec carte graphique'
    : machine === 'correct' ? 'Ordinateur correct' : 'Ordinateur modeste';

  if (!localPossible) {
    const diskTooSmall = freeDisk !== undefined && freeDisk < lightest.downloadGB + 2;
    const ramTooSmall = lacksMemory(lightest);
    summary = `${machineText} : aucun modèle local ne peut fonctionner correctement sur cet ordinateur.`;
    warning = ramTooSmall
      ? `Cet ordinateur dispose de ${formatGB(ram)} de mémoire alors que ${lightest.label} en demande au moins ${lightest.minRamGB} Go : l'installer rendrait l'ordinateur très lent, voire inutilisable. Utilisez plutôt un serveur d'IA distant (par exemple celui de votre établissement).`
      : diskTooSmall
        ? `Espace disque insuffisant pour installer un modèle (environ ${lightest.downloadGB + 2} Go nécessaires). Libérez de l’espace avant de continuer, ou utilisez un serveur d'IA distant.`
        : "Aucun modèle local n'est adapté à cet ordinateur. Utilisez un serveur d'IA distant.";
  } else {
    summary = `${machineText} : ${getTier(tier).label} est recommandé.`;
    const chosen = getTier(tier);
    if (fitOf(tier).fit === 'recommended' && vram < chosen.fastVramGB && ram < chosen.comfortableRamGB) {
      warning = `Avec ${formatGB(ram)} de mémoire, la génération sera lente : fermez les autres applications pendant la rédaction.`;
    }
  }

  return { tier, machine, summary, warning, tiers, localPossible };
}

export function formatGB(gb: number): string {
  return `${Math.round(gb * 10) / 10} Go`.replace('.', ',');
}
