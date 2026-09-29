// Catalogue volontairement court des modèles locaux proposés aux enseignants.
// L'enseignant voit « Magistra Léger / Standard / Qualité » ; le nom technique n'apparaît qu'en mode avancé.
//
// Les modèles retenus sont publiés sous licence Apache 2.0 (Mistral AI) et disponibles dans la
// bibliothèque Ollama. Les tailles sont celles des versions quantifiées Q4 publiées par Ollama
// (arrondies) ; elles servent à informer l'utilisateur avant tout téléchargement.

export type TierId = 'leger' | 'standard' | 'qualite';

/**
 * Version minimale d'Ollama pour les modèles Magistra : ministral-3 exige Ollama 0.13.1
 * (page du modèle dans la bibliothèque Ollama ; support ajouté par v0.13.1-rc1). En dessous, le registre
 * refuse le téléchargement (« 412: … requires a newer version of Ollama ») → ENGINE_OUTDATED.
 */
export const MIN_OLLAMA_VERSION = '0.13.1';

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
  /**
   * Autres noms Ollama du MÊME fichier de modèle (même quantification Q4_K_M), reconnus comme « installé »
   * pour ce niveau (voir installedModelForTier). Les variantes q8_0 / fp16 n'y figurent PAS : elles demandent
   * beaucoup plus de mémoire et ne sont pas équivalentes.
   */
  aliases: string[];
  /** Version minimale d'Ollama pour ce modèle. */
  minOllama: string;
}

/**
 * Contexte demandé à Ollama (num_ctx) pour un modèle hors catalogue Magistra : celui du niveau Léger, supportable
 * sans carte graphique. Commun au serveur (déclaré par AI_MODEL ou détecté) et à l'application Windows.
 */
export const CUSTOM_OLLAMA_MODEL_CONTEXT = 12_288;

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
    // ministral-3:latest désigne le 8B (même empreinte que ministral-3:8b dans la bibliothèque Ollama).
    aliases: ['ministral-3', 'ministral-3:latest', 'ministral-3:8b-instruct-2512-q4_K_M'],
    minOllama: MIN_OLLAMA_VERSION,
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
    aliases: ['ministral-3:14b-instruct-2512-q4_K_M'],
    minOllama: MIN_OLLAMA_VERSION,
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
    // mistral-small3.2:latest désigne le 24B Q4_K_M.
    aliases: ['mistral-small3.2', 'mistral-small3.2:latest', 'mistral-small3.2:24b-instruct-2506-q4_K_M'],
    minOllama: MIN_OLLAMA_VERSION,
  },
];

export const DEFAULT_TIER: TierId = 'standard';

export function getTier(id: string | undefined): ModelTier {
  return MODEL_TIERS.find(t => t.id === id) ?? MODEL_TIERS.find(t => t.id === DEFAULT_TIER)!;
}

/**
 * Forme canonique d'un nom de modèle Ollama : casse ignorée, préfixe « registry.ollama.ai/library/ » retiré,
 * étiquette « :latest » ajoutée quand aucune n'est précisée (« mistral » = « mistral:latest »).
 * « ministral-3:8b » et « ministral-3:14b » restent distincts.
 */
export function normalizeModelName(name: string): string {
  const n = name.trim().toLowerCase().replace(/^registry\.ollama\.ai\/library\//, '').replace(/^library\//, '');
  const lastSegment = n.slice(n.lastIndexOf('/') + 1);
  return lastSegment.includes(':') ? n : `${n}:latest`;
}

/** Vrai si `name` désigne le modèle d'un niveau : nom du catalogue ou l'un de ses alias (même quantification). */
export function modelMatchesTier(name: string, tier: ModelTier): boolean {
  const n = normalizeModelName(name);
  return normalizeModelName(tier.model) === n || tier.aliases.some(a => normalizeModelName(a) === n);
}

/** Niveau Magistra correspondant à un nom de modèle (nom du catalogue ou alias), sinon undefined. */
export function tierForModel(model: string): ModelTier | undefined {
  if (!model) return undefined;
  return MODEL_TIERS.find(t => modelMatchesTier(model, t));
}

type InstalledEntry = string | { name: string };

/**
 * Nom RÉELLEMENT installé pour un niveau, d'après la liste d'Ollama (/api/tags : `models[].name`), ou undefined.
 * Priorité au nom du catalogue, puis aux alias dans l'ordre déclaré. Le nom renvoyé est celui de la liste,
 * tel quel : c'est lui qu'il faut passer à /api/chat (« ministral-3:latest » quand seul cet alias est présent).
 * Sert à l'application Windows (éviter un nouveau téléchargement) et à l'auto-détection du serveur.
 */
export function installedModelForTier(tier: TierId | ModelTier, installed: readonly InstalledEntry[]): string | undefined {
  const t = typeof tier === 'string' ? MODEL_TIERS.find(x => x.id === tier) : tier;
  if (!t) return undefined;
  const names = installed.map(e => (typeof e === 'string' ? e : e?.name)).filter((n): n is string => typeof n === 'string' && n.length > 0);
  for (const candidate of [t.model, ...t.aliases]) {
    const wanted = normalizeModelName(candidate);
    const found = names.find(n => normalizeModelName(n) === wanted);
    if (found) return found;
  }
  return undefined;
}

/** Niveaux Magistra présents dans la liste d'Ollama, dans l'ordre du catalogue (Léger, Standard, Qualité). */
export function installedTiers(installed: readonly InstalledEntry[]): { tier: ModelTier; model: string }[] {
  return MODEL_TIERS.flatMap(tier => {
    const model = installedModelForTier(tier, installed);
    return model ? [{ tier, model }] : [];
  });
}

// ─── Versions (Ollama) ──────────────────────────────────────────────────────

export interface ParsedVersion {
  /** [majeur, mineur, correctif] (les parties absentes valent 0). */
  core: [number, number, number];
  /** Identifiants de pré-version (« rc1 », « mock »…), vide pour une version publiée. */
  pre: string[];
}

/**
 * Lit une version de façon tolérante : préfixe « v », espaces, parties manquantes (« 0.13 » = 0.13.0),
 * pré-version (« 0.13.1-rc1 »), métadonnées de construction (« +abc », ignorées). null si illisible.
 */
export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/i.exec(raw);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ? m[4].split('.').filter(Boolean) : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // Une version publiée est plus récente que ses pré-versions (1.0.0-rc1 < 1.0.0).
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]) ? Number(a[i]) : NaN;
    const nb = /^\d+$/.test(b[i]) ? Number(b[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (!Number.isNaN(na)) {
      return -1; // identifiant numérique < identifiant alphanumérique (règle semver)
    } else if (!Number.isNaN(nb)) {
      return 1;
    } else if (a[i] !== b[i]) {
      // Tolérance : « rc2 » < « rc10 » (étiquettes d'Ollama), là où semver comparerait lettre à lettre.
      const ma = /^([a-z]+)(\d+)$/i.exec(a[i]);
      const mb = /^([a-z]+)(\d+)$/i.exec(b[i]);
      if (ma && mb && ma[1].toLowerCase() === mb[1].toLowerCase() && ma[2] !== mb[2]) return Number(ma[2]) < Number(mb[2]) ? -1 : 1;
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare deux versions (règles semver, lecture tolérante de parseVersion) : -1 si a < b, 0 si égales,
 * 1 si a > b. NaN si l'une des deux est illisible (« inconnue »…) : à traiter comme « version inconnue ».
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return NaN;
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] < vb.core[i] ? -1 : 1;
  }
  return comparePre(va.pre, vb.pre);
}

/**
 * Version d'Ollama suffisante pour les modèles Magistra ?
 *  - 'ok'       : version ≥ minimum. Une PRÉ-VERSION de la version minimale ou d'une version plus récente
 *                 (« 0.13.1-rc1 », « 0.35.0-rc1 ») est acceptée : seule la partie x.y.z est comparée, par prudence
 *                 envers les testeurs (si le registre refuse quand même, le téléchargement renvoie ENGINE_OUTDATED) ;
 *  - 'outdated' : version inférieure au minimum (proposer la mise à jour) ;
 *  - 'unknown'  : version illisible ou « inconnue », ou 0.0.0 (Ollama compilé depuis les sources) : ne rien bloquer.
 */
export function ollamaVersionStatus(version: string | null | undefined, min: string = MIN_OLLAMA_VERSION): 'ok' | 'outdated' | 'unknown' {
  const v = parseVersion(version);
  const m = parseVersion(min);
  if (!v || !m) return 'unknown';
  if (v.core.every(n => n === 0)) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (v.core[i] !== m.core[i]) return v.core[i] > m.core[i] ? 'ok' : 'outdated';
  }
  return 'ok';
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
