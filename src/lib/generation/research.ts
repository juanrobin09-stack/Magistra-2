// Sources de recherche et confidentialité : ce qui est RÉELLEMENT disponible, dit honnêtement.

import { getLevelGroup, isSuperieur, type NiveauScolaire } from '@shared/levels';
import { RESEARCH_MODES, type Capabilities, type ResearchMode } from '@shared/types';
import type { RuntimeMode } from '@/lib/runtime/types';

export interface ResearchOption {
  value: ResearchMode;
  label: string;
  description: string;
  network: boolean;
  /** Le mode peut-il être choisi ici ? */
  available: boolean;
  /** Précision honnête sur ce qui sera réellement consulté (ou pourquoi c'est indisponible). */
  note?: string;
}

export const WEB_LIMITED_ACADEMIC_NOTE = 'Internet : Wikipédia et sources académiques seulement (aucun moteur web configuré)';
export const WEB_LIMITED_NOTE = 'Internet : Wikipédia seulement (aucun moteur web configuré)';
/** Scolaire : Éduscol et le Bulletin officiel passent par le moteur web ; sans lui, on le dit. */
export const WEB_LIMITED_SCOLAIRE_LOCAL_NOTE =
  'Internet : Wikipédia seulement. Éduscol et le Bulletin officiel demandent un moteur de recherche web (SearXNG), à indiquer dans les réglages.';
export const WEB_LIMITED_SCOLAIRE_SERVER_NOTE =
  'Internet : Wikipédia seulement. Éduscol et le Bulletin officiel ne sont pas interrogés : aucun moteur de recherche web configuré sur ce serveur.';
export const ACADEMIC_ONLY_NOTE = 'Internet : sources académiques seulement (aucun moteur web configuré, Wikipédia désactivé)';
export const NO_INTERNET_LOCAL_NOTE = 'Internet indisponible : aucun moteur web configuré et Wikipédia désactivé dans les réglages.';
export const NO_INTERNET_SERVER_NOTE = 'Recherche Internet non activée sur ce serveur.';
export const DEMO_RESEARCH_NOTE = 'Recherche indisponible en mode démonstration.';
export const DOCUMENTS_IGNORED_NOTE = 'Vos documents ne seront pas utilisés dans ce mode.';
export const NETWORK_PRIVACY_NOTE =
  'La recherche en ligne transmet uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.';
export const LOCAL_PRIVACY_NOTE = 'Vos documents et générations restent sur cet ordinateur.';

/**
 * Décrit les 4 modes de recherche selon les capacités du moteur.
 * `caps` null = capacités encore inconnues : tout reste sélectionnable, sans promesse.
 */
export function describeResearchOptions(
  caps: Capabilities | null,
  mode: RuntimeMode,
  niveau: NiveauScolaire,
): ResearchOption[] {
  return RESEARCH_MODES.map(m => {
    const base: ResearchOption = { ...m, available: true };
    if (m.value === 'documents') return base;
    if (mode === 'demo') return { ...base, available: false, note: DEMO_RESEARCH_NOTE };
    if (!caps) return base;

    if (m.value === 'academic') {
      if (caps.research.academic) return base;
      return {
        ...base,
        available: false,
        note: mode === 'local'
          ? 'Recherche académique désactivée dans les réglages.'
          : 'Recherche académique non activée sur ce serveur.',
      };
    }

    // Internet / Documents + Internet : on annonce seulement ce qui sera réellement consulté.
    if (caps.research.web) return base;
    const academicUsed = isSuperieur(niveau) && caps.research.academic;
    const wikipedia = caps.research.wikipedia;
    if (!academicUsed && !wikipedia) {
      return { ...base, available: false, note: mode === 'local' ? NO_INTERNET_LOCAL_NOTE : NO_INTERNET_SERVER_NOTE };
    }
    if (!wikipedia) return { ...base, note: ACADEMIC_ONLY_NOTE };
    if (academicUsed) return { ...base, note: WEB_LIMITED_ACADEMIC_NOTE };
    if (!isSuperieur(niveau)) {
      return { ...base, note: mode === 'local' ? WEB_LIMITED_SCOLAIRE_LOCAL_NOTE : WEB_LIMITED_SCOLAIRE_SERVER_NOTE };
    }
    return { ...base, note: WEB_LIMITED_NOTE };
  });
}

/** Mode réellement utilisé : un mode indisponible retombe sur « Mes documents uniquement ». */
export function effectiveResearchMode(chosen: ResearchMode, options: ResearchOption[]): ResearchMode {
  return options.find(o => o.value === chosen)?.available ? chosen : 'documents';
}

export function modeUsesNetwork(mode: ResearchMode): boolean {
  return RESEARCH_MODES.find(m => m.value === mode)?.network ?? false;
}

export interface ResearchHints {
  /** « Vos documents ne seront pas utilisés dans ce mode » (documents ajoutés + mode Internet). */
  documentsIgnored: boolean;
  /** Master / Doctorat sans document : suggérer « Sources académiques ». */
  suggestAcademic: boolean;
  /** Aucun document et aucune recherche : le modèle ne s'appuie que sur ses connaissances. */
  modelOnly: boolean;
}

export function researchHints(
  mode: ResearchMode,
  documentCount: number,
  niveau: NiveauScolaire,
  options: ResearchOption[],
  runtimeMode?: RuntimeMode,
): ResearchHints {
  const group = getLevelGroup(niveau);
  const academicAvailable = options.find(o => o.value === 'academic')?.available ?? false;
  return {
    documentsIgnored: documentCount > 0 && mode === 'internet',
    suggestAcademic: (group === 'master' || group === 'doctorat') && documentCount === 0 && mode === 'documents' && academicAvailable,
    // En démonstration, aucun modèle n'est utilisé : l'avertissement n'aurait pas de sens.
    modelOnly: documentCount === 0 && mode === 'documents' && runtimeMode !== 'demo',
  };
}

export interface PrivacyNotes {
  /** Message fourni par le moteur (vrai selon le mode d'exécution). */
  message: string | null;
  /** Ajouté si le mode choisi utilise le réseau. */
  network: string | null;
  /** Affiché uniquement si tout reste réellement sur l'ordinateur. */
  local: string | null;
}

export function privacyNotes(caps: Capabilities | null, mode: ResearchMode): PrivacyNotes {
  return {
    message: caps?.privacy.message ?? null,
    network: modeUsesNetwork(mode) ? NETWORK_PRIVACY_NOTE : null,
    local: caps?.privacy.level === 'local' ? LOCAL_PRIVACY_NOTE : null,
  };
}
