// Harnais E2E du connecteur local (JAMAIS dans le build du site : voir vite.config.ts de ce dossier).
//
// Monte les VRAIS composants du site web, pour un enseignant connecté : carte « Magistra locale » du tableau de bord,
// réglages du moteur (priorités, choix, déconnexion), section « Magistra pour Windows » et page « Générer » (bandeau du
// moteur, panneau « non prête », résultat en flux). Tout ce qui touche au connecteur est RÉEL : contrôleur, client
// (WebCrypto, IndexedDB, preuve, flux NDJSON) et client hybride du site. Seuls sont simulés :
//  - la session Clerk et le serveur Magistra en ligne (capacités d'un prestataire tiers, génération factice comptée :
//    elle ne doit JAMAIS servir quand Magistra locale est choisie) ;
//  - l'enregistrement du résultat dans l'historique du compte (POST /api/generation) : brouillon capturé ;
//  - l'ouverture des URL magistra:// : remise à window.__magistraE2EOpenUrl si le test l'expose (le test la transmet
//    à l'application réelle comme le ferait Windows), sinon ouverture normale.
//
// Paramètres de l'adresse : ?ports=47961,47962 (ports du connecteur, comme MAGISTRA_CONNECTOR_PORTS de l'application)
// et ?view=dashboard|settings|generate (page affichée au chargement). Sondes lues par le test : window.__magistraE2E.

import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, NavLink, Route, Routes } from 'react-router-dom';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import './harness.css';
import { MagistraError } from '@shared/errors';
import type { ConnectorStatus } from '@shared/localConnector';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRecordDraft, GenerationRequest, HistoryPage, ProviderInfo, TeacherProfile,
  UsageStats,
} from '@shared/types';
import EngineSettings from '@/components/localEngine/EngineSettings';
import { useEngineRoute } from '@/components/localEngine/engineRoute';
import LocalEngineCard from '@/components/localEngine/LocalEngineCard';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import { openMagistraUrl } from '@/lib/localConnector/client';
import { createLocalEngineController, LocalEngineContext, useLocalEngine, type LocalEngineController } from '@/lib/localConnector/controller';
import { RuntimeContext } from '@/lib/runtime/context';
import { HybridGenerationClient } from '@/lib/runtime/hybrid';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import type { DataStore, GenerationClient, RuntimeValue } from '@/lib/runtime/types';
import GeneratePage from '@/pages/GeneratePage';

/** Sondes lues par le test (aucun secret : ni clé, ni vérificateur, ni signature). */
interface HarnessProbe {
  /** Résultats de Magistra locale envoyés pour l'historique du compte (POST /api/generation simulé). */
  drafts: GenerationRecordDraft[];
  /** Générations demandées au serveur en ligne (factice). */
  serverGenerations: number;
  /** URL magistra:// ouvertes par le site. */
  openedUrls: string[];
  /** État du moteur lu par le VRAI client du site (GET /v1/status signé, preuve vérifiée), sans rien afficher. */
  connectorStatus?: () => Promise<ConnectorStatus>;
}

declare global {
  interface Window {
    /** Exposée par le test (page.exposeFunction) : reçoit les URL magistra:// à la place du système. */
    __magistraE2EOpenUrl?: (url: string) => unknown;
    __magistraE2E?: HarnessProbe;
  }
}

const probe: HarnessProbe = { drafts: [], serverGenerations: 0, openedUrls: [] };
window.__magistraE2E = probe;

// ─── Paramètres ─────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const ports = (params.get('ports') ?? '')
  .split(',')
  .map(p => Number(p.trim()))
  .filter(p => Number.isInteger(p) && p >= 1_024 && p <= 65_535);
const VIEWS = { dashboard: '/app', settings: '/app/settings', generate: '/app/generate' } as const;
const initialView = VIEWS[(params.get('view') ?? 'dashboard') as keyof typeof VIEWS] ?? VIEWS.dashboard;

// ─── Serveur Magistra en ligne (simulé) ─────────────────────────────────────

const SERVER_PROVIDER: ProviderInfo = { label: 'OVHcloud AI Endpoints', thirdParty: true, country: 'France' };
// Prestataire annoncé au démarrage, comme le ferait GET /api/mode sur le site.
setRuntimeConfig({ mode: 'web', providerInfo: SERVER_PROVIDER });

const SERVER_CAPS: Capabilities = {
  maxDocumentChars: 60_000,
  research: { academic: true, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'server', message: 'Vos demandes sont traitées par OVHcloud AI Endpoints (serveur distant).' },
  engineLabel: SERVER_PROVIDER.label,
  ready: true,
  providerInfo: SERVER_PROVIDER,
};

const serverClient: GenerationClient = {
  kind: 'web',
  capabilities: async () => ({ ...SERVER_CAPS }),
  async generate(_request: GenerationRequest, onEvent: (event: GenerationEvent) => void): Promise<void> {
    probe.serverGenerations += 1;
    const content = 'Réponse du serveur en ligne (simulée par le harnais).';
    onEvent({ type: 'delta', text: content });
    onEvent({ type: 'done', content, sources: [], truncated: false, internetUsed: false, saved: true, id: `serveur-${probe.serverGenerations}`, model: 'serveur' });
  },
};

const PROFILE: TeacherProfile = {
  displayName: 'Mme Durand',
  etablissement: 'Collège Jean Moulin',
  cycle: 'college',
  niveaux: ['6eme'],
  matierePrincipale: 'francais',
};

/** Historique du compte (simulé) : vide ; seuls les brouillons de Magistra locale sont capturés. */
class HarnessStore implements DataStore {
  readonly kind = 'web' as const;
  async listGenerations(): Promise<HistoryPage> {
    return { items: [] };
  }
  async getGeneration(): Promise<GenerationRecord> {
    throw new MagistraError('NOT_FOUND');
  }
  async setFavorite(): Promise<void> {}
  async deleteGeneration(): Promise<void> {}
  async getStats(): Promise<UsageStats> {
    return { total: probe.drafts.length, favorites: 0, today: probe.drafts.length, week: probe.drafts.length };
  }
  async getProfile(): Promise<TeacherProfile | null> {
    return PROFILE;
  }
  async saveProfile(): Promise<void> {}
  async clearAllData(): Promise<void> {}
}

// ─── Magistra locale : contrôleur et client RÉELS ───────────────────────────

const controller: LocalEngineController = createLocalEngineController({
  ...(ports.length ? { ports } : {}),
  openUrl: url => {
    probe.openedUrls.push(url);
    const hook = window.__magistraE2EOpenUrl;
    if (hook) void Promise.resolve(hook(url)).catch(() => undefined);
    else openMagistraUrl(url);
  },
});

probe.connectorStatus = () => controller.client.status();

const store = new HarnessStore();
const client = new HybridGenerationClient(serverClient, controller, async draft => {
  probe.drafts.push(structuredClone(draft));
  return { id: `brouillon-${probe.drafts.length}` };
});

const runtime: RuntimeValue = {
  mode: 'web',
  store,
  client,
  user: { id: 'enseignant-e2e', firstName: 'Camille', email: null },
  profile: PROFILE,
  profileStatus: 'ready',
  profileError: null,
  saveProfile: async () => undefined,
  reloadProfile: async () => undefined,
};

// ─── Vues ───────────────────────────────────────────────────────────────────

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-6">
      <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
      {children}
    </main>
  );
}

function DashboardView() {
  const engine = useLocalEngine();
  return <Page title="Tableau de bord">{engine && <LocalEngineCard engine={engine} />}</Page>;
}

function SettingsView() {
  const engine = useLocalEngine();
  const { route } = useEngineRoute(engine?.state ?? null);
  return (
    <Page title="Réglages">
      {engine && (
        <section aria-labelledby="harness-ai" className="card p-5 sm:p-6 space-y-4">
          <h2 id="harness-ai" className="text-sm font-semibold text-white">Intelligence artificielle</h2>
          <EngineSettings engine={engine} serverCaps={route === 'server' ? SERVER_CAPS : null} />
        </section>
      )}
      <section aria-labelledby="harness-windows" className="card p-5 sm:p-6 space-y-4">
        <h2 id="harness-windows" className="text-sm font-semibold text-white">Magistra pour Windows</h2>
        <WindowsDownloadSection variant="settings" mode="web" />
      </section>
    </Page>
  );
}

const NAV: { to: string; label: string }[] = [
  { to: VIEWS.dashboard, label: 'Tableau de bord' },
  { to: VIEWS.generate, label: 'Générer' },
  { to: VIEWS.settings, label: 'Réglages' },
];

function Harness() {
  // Comme WebRuntimeProvider : vérification automatique au montage (jamais de demande d'autorisation du navigateur),
  // appairage en attente interrompu quand la page est quittée.
  useEffect(() => {
    void controller.autoCheck();
    return () => controller.cancelPairing();
  }, []);
  return (
    <RuntimeContext.Provider value={runtime}>
      <LocalEngineContext.Provider value={controller}>
        <MemoryRouter initialEntries={[initialView]}>
          <nav aria-label="Navigation principale" className="border-b border-white/5 px-4 sm:px-6 py-3 flex flex-wrap gap-2">
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => `btn-ghost text-sm py-1.5 px-3 ${isActive ? 'text-accent' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Routes>
            <Route path="/app" element={<DashboardView />} />
            <Route path="/app/generate" element={<GeneratePage />} />
            <Route path="/app/settings" element={<SettingsView />} />
            <Route path="*" element={<Page title="Page du site"><p className="text-sm text-mg-200">Page hors du harnais.</p></Page>} />
          </Routes>
        </MemoryRouter>
      </LocalEngineContext.Provider>
    </RuntimeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
