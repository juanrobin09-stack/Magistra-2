// Réglages — mêmes sections dans les trois modes (Windows, site web, démonstration),
// avec un contenu honnête adapté à chacun. Aucun secret n'est affiché ni demandé ici,
// sauf la clé facultative d'un serveur IA distant (options avancées, en écriture seule).
//
// Site web : moteur des générations (Magistra locale ou serveur en ligne, passage au distant confirmé) et
// « Magistra pour Windows ». Application Windows : « Site web Magistra » (navigateurs autorisés à utiliser l'IA de
// cet ordinateur). Jamais d'adresse, de port ni de nom de moteur local pour Magistra locale.

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import {
  BookOpen, Cpu, Download, FileText, Globe, Info, Loader2, Monitor, RefreshCw, Search, Settings, Shield, Trash2, User, UserCog, Wand2,
  type LucideIcon,
} from 'lucide-react';
import { getMatiereLabel } from '@shared/catalog';
import { isMagistraError } from '@shared/errors';
import type { AppInfo, LocalPreferences } from '@shared/ipc';
import { getNiveauLabel } from '@shared/levels';
import { SEARCH_SCOPE_TEXT } from '@shared/research/trusted';
import { RESEARCH_MODES, type Capabilities, type ResearchMode } from '@shared/types';
import ActivateAICard from '@/components/ai/ActivateAICard';
import AdminContactLine from '@/components/ai/AdminContactLine';
import AdvancedAIOptions from '@/components/ai/AdvancedAIOptions';
import ConnectRealAICard from '@/components/ai/ConnectRealAICard';
import EngineSetupPanel from '@/components/ai/EngineSetupPanel';
import ModelSetupPanel from '@/components/ai/ModelSetupPanel';
import { ErrorBox, SuccessNote, WarningNote } from '@/components/ai/Notices';
import ConnectedBrowsersSettings from '@/components/localEngine/ConnectedBrowsersSettings';
import { engineStateKey, useEngineRoute, useRouteCapsHeal } from '@/components/localEngine/engineRoute';
import EngineSettings from '@/components/localEngine/EngineSettings';
import { WEBSITE_SECTION_TITLE } from '@/components/localEngine/texts';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import AuthorCredit from '@/components/AuthorCredit';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import UpdateCheck from '@/components/UpdateCheck';
import { useAIStatus, useCapabilities, type AIController, type CapabilitiesState } from '@/hooks/useAIStatus';
import LegalLinks from '@/components/LegalLinks';
import { exportAccountData, ExportCancelled, EXPORT_ERROR_MESSAGE, type ExportProgress } from '@/lib/exportAccountData';
import { activationPlan } from '@/lib/ai-ui/activation';
import { providerPolicyUrl, serverAIView, type ServerMode } from '@/lib/ai-ui/server';
import { aiPhase, engineHostIfRemote, engineOutdatedText, phaseInfo, phaseLine } from '@/lib/ai-ui/status';
import { useLocalEngine } from '@/lib/localConnector/controller';
import { adminContact, useRuntime } from '@/lib/runtime/context';
import { fromIpcError, getBridge } from '@/lib/runtime/local';
import { usePersonalAccess } from '@/lib/runtime/personal';
import { usesServerApi, type RuntimeMode } from '@/lib/runtime/types';

const ROW_LABEL = 'text-mg-200';
const ROW_VALUE = 'min-w-0 text-mg-50 [overflow-wrap:anywhere]';

function errorText(err: unknown): string {
  if (isMagistraError(err)) return err.message;
  return 'Erreur inattendue. Réessayez.';
}

function Section({ id, icon: Icon, title, children }: { id: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card animate-fade-in">
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold text-white mb-4">
        <Icon size={17} className="text-accent" aria-hidden="true" /> {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  function open(e: MouseEvent<HTMLAnchorElement>) {
    const bridge = getBridge();
    if (bridge) {
      e.preventDefault();
      void bridge.app.openExternal(href);
    }
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={open} className="text-accent hover:underline underline-offset-2">
      {children}
    </a>
  );
}

// ─── Préférences locales (Windows) ─────────────────────────────────────────

interface PrefsState {
  prefs: LocalPreferences | null;
  error: string | null;
  save(patch: Partial<LocalPreferences>): Promise<boolean>;
}

function useLocalPrefs(enabled: boolean): PrefsState {
  const [prefs, setPrefs] = useState<LocalPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = enabled ? getBridge() : null;
    if (!bridge) return;
    let cancelled = false;
    bridge.prefs.get().then(
      p => {
        if (!cancelled) setPrefs(p);
      },
      err => {
        if (!cancelled) setError(fromIpcError(err).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const save = useCallback(async (patch: Partial<LocalPreferences>) => {
    const bridge = getBridge();
    if (!bridge) return false;
    setError(null);
    try {
      setPrefs(await bridge.prefs.set(patch));
      return true;
    } catch (err) {
      setError(fromIpcError(err).message);
      return false;
    }
  }, []);

  return { prefs, error, save };
}

/** « ✓ Enregistré » affiché quelques secondes après une modification. */
function useSavedFlash(): [string | null, (key: string) => void] {
  const [saved, setSaved] = useState<string | null>(null);
  const flash = useCallback((key: string) => {
    setSaved(key);
    window.setTimeout(() => setSaved(current => (current === key ? null : current)), 2500);
  }, []);
  return [saved, flash];
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const runtime = useRuntime();
  const mode = runtime.mode;
  const ai = useAIStatus();
  const aiKey = ai?.status ? `${ai.status.config.mode}|${ai.status.ready}|${ai.status.activeModel}` : '';
  // Site web : Magistra locale ou serveur en ligne ; les capacités (recherche, confidentialité) sont celles du moteur
  // choisi et sont relues quand il change.
  const localEngine = useLocalEngine();
  const engine = mode === 'web' ? localEngine : null;
  const { route } = useEngineRoute(engine?.state ?? null);
  const engineKey = engine ? `${route ?? ''}|${route === 'local-connector' ? engineStateKey(engine.state) : ''}` : '';
  const allCaps = useCapabilities({ refreshKey: `${aiKey}|${engineKey}` });
  useRouteCapsHeal(engine?.controller ?? null, route, allCaps.capabilities, allCaps.loading, allCaps.reload);
  const routeCaps = allCaps.capabilities && (!engine || allCaps.capabilities.route === route) ? allCaps.capabilities : null;
  const caps: CapabilitiesState = engine ? { ...allCaps, capabilities: routeCaps } : allCaps;
  const serverCaps = engine && route === 'server' ? routeCaps : null;
  const bridge = mode === 'local' ? getBridge() : null;
  const prefsState = useLocalPrefs(mode === 'local');

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      <header className="animate-fade-in mb-2">
        <div className="flex items-center gap-2 mb-1">
          <Settings size={18} className="text-accent" aria-hidden="true" />
          <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Réglages</h1>
        </div>
        <p className="text-sm text-mg-200">Intelligence artificielle, recherche, profil et données.</p>
      </header>

      <Section id="settings-ai" icon={Cpu} title="Intelligence artificielle">
        {mode === 'local' && ai
          ? <LocalAISettings ai={ai} />
          : engine
            ? (
              <EngineSettings
                engine={engine}
                serverCaps={serverCaps}
                serverDetails={<ServerAISettings caps={{ ...caps, capabilities: serverCaps }} mode="web" />}
              />
            )
            : mode === 'web' || mode === 'personal' ? <ServerAISettings caps={caps} mode={mode} /> : <DemoAISettings />}
      </Section>

      {mode === 'local' && bridge?.connector && (
        <Section id="settings-website" icon={Globe} title={WEBSITE_SECTION_TITLE}>
          <ConnectedBrowsersSettings connector={bridge.connector} />
        </Section>
      )}

      {engine && (
        <Section id="settings-windows" icon={Monitor} title="Magistra pour Windows">
          <WindowsDownloadSection variant="settings" mode={mode} />
        </Section>
      )}

      <Section id="settings-research" icon={Search} title="Recherche">
        {mode === 'local' ? <LocalResearchSettings state={prefsState} /> : usesServerApi(mode) ? <WebResearchSettings caps={caps} /> : (
          <p className="text-sm text-mg-100">La recherche en ligne n'est pas disponible en mode démonstration.</p>
        )}
      </Section>

      {mode === 'local' && (
        <Section id="settings-documents" icon={FileText} title="Documents">
          <DocumentsSettings state={prefsState} />
        </Section>
      )}

      <Section id="settings-profile" icon={User} title="Profil enseignant">
        <ProfileSummary />
      </Section>

      <Section id="settings-account" icon={UserCog} title="Compte et données">
        {mode === 'web' ? <WebAccountSettings /> : mode === 'personal' ? <PersonalAccountSettings /> : mode === 'local' ? (
          <>
          <ExportDataBlock />
          <DeleteDataBlock
            description="Efface l'historique, les favoris, votre profil enseignant et les documents conservés sur cet ordinateur. Le moteur IA et les modèles installés sont conservés."
            buttonLabel="Effacer toutes les données locales"
            confirmTitle="Effacer toutes les données locales ?"
            confirmMessage="L'historique, les favoris, votre profil enseignant et les documents conservés seront définitivement effacés de cet ordinateur. Cette action est irréversible."
            confirmLabel="Tout effacer"
          />
          </>
        ) : (
          <>
          <ExportDataBlock />
          <DeleteDataBlock
            description="Efface l'historique, les favoris et le profil enregistrés dans ce navigateur pour la démonstration."
            buttonLabel="Effacer les données de démonstration"
            confirmTitle="Effacer les données de démonstration ?"
            confirmMessage="L'historique, les favoris et le profil de démonstration seront effacés de ce navigateur."
            confirmLabel="Effacer"
          />
          </>
        )}
      </Section>

      <Section id="settings-privacy" icon={Shield} title="Confidentialité">
        <PrivacySettings mode={mode} caps={caps} />
      </Section>

      <Section id="settings-about" icon={Info} title="À propos">
        <About mode={mode} />
      </Section>
    </div>
  );
}

// ─── Intelligence artificielle ─────────────────────────────────────────────

function LocalAISettings({ ai }: { ai: AIController }) {
  const navigate = useNavigate();
  const status = ai.status;

  if (!status) {
    if (ai.errors.status) {
      return (
        <ErrorBox title="Impossible de vérifier l'intelligence artificielle." message={ai.errors.status.message}>
          <button type="button" className="btn-primary text-sm py-2 px-4 mt-3" onClick={() => void ai.refresh()}>
            <RefreshCw size={15} aria-hidden="true" /> Réessayer
          </button>
        </ErrorBox>
      );
    }
    return (
      <p className="flex items-center gap-2 text-sm text-mg-100" role="status">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /> Vérification de l'intelligence artificielle…
      </p>
    );
  }

  const phase = aiPhase(status);
  const info = phaseInfo(phase);
  const remote = status.config.mode === 'remote';
  const activating = ai.activation.state === 'running';
  const engineStep = phase === 'engine_missing' || phase === 'engine_stopped' || phase === 'engine_outdated';
  // Une seule action principale, la même que sur le tableau de bord : « Activer l'IA » (un clic, taille annoncée,
  // enchaînement moteur → modèle, reprise au prochain lancement). Le panneau du moteur seul ne reste que là où cette
  // activation ne s'applique pas : moteur trop ancien alors que l'IA fonctionne (mise à jour pour d'autres versions),
  // modèle personnalisé ou moteur sur un autre ordinateur (options avancées).
  const oneClick = !remote && (activating || (engineStep && activationPlan(status) !== null));
  const engineHost = remote ? null : engineHostIfRemote(status.engine.url);
  const detail = info.ok
    ? remote
      ? `Serveur IA distant${status.config.remote?.label ? ` « ${status.config.remote.label} »` : ''}.`
      : engineHost
        ? `${status.activeLabel}, sur le serveur Ollama « ${engineHost} » (les données de génération y sont transmises).`
        : `${status.activeLabel}, directement sur cet ordinateur.`
    // Moteur trop ancien : la cause précise (versions), que la carte d'activation ne redit pas.
    : phase === 'engine_outdated' ? engineOutdatedText(status) : info.description;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div role="status" aria-live="polite">
          <p className={`text-base font-semibold ${info.ok ? 'text-success' : 'text-warning'}`}>{phaseLine(phase)}</p>
          <p className="text-sm text-mg-100 mt-0.5">{detail}</p>
        </div>
        <button type="button" className="btn-ghost text-sm" onClick={() => void ai.refresh()} disabled={ai.pending.status}>
          <RefreshCw size={15} className={ai.pending.status ? 'animate-spin' : ''} aria-hidden="true" /> Vérifier à nouveau
        </button>
      </div>

      {oneClick ? (
        <ActivateAICard variant="setup" />
      ) : (engineStep || (!remote && status.engine.state === 'running' && status.engine.outdated)) && <EngineSetupPanel ai={ai} status={status} />}

      {phase === 'remote_unavailable' && (
        <WarningNote>
          Le serveur IA distant ne répond pas. Vérifiez votre connexion, ou revenez à l'IA de cet ordinateur dans les options avancées ci-dessous.
        </WarningNote>
      )}

      {!remote && status.config.customModel && (
        <p className="text-sm text-mg-100">
          Un modèle personnalisé est utilisé (<span className="font-mono text-xs">{status.config.customModel}</span>). Pour revenir à une
          version Magistra, choisissez « Aucun » dans les options avancées ou sélectionnez une version ci-dessous.
        </p>
      )}

      {/* Changer de version ; pas pendant une activation, dont la carte montre déjà le téléchargement. */}
      {!remote && status.engine.state === 'running' && !activating && (
        <div className="border-t border-white/5 pt-4">
          <ModelSetupPanel ai={ai} status={status} variant="settings" />
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-white/5 pt-4">
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => navigate('/setup?from=settings')}>
          <Wand2 size={15} aria-hidden="true" /> Assistant de configuration
        </button>
      </div>

      <AdvancedAIOptions ai={ai} status={status} />
    </>
  );
}

/** Site web et mode personnel : IA du serveur Magistra, avec la vraie cause quand elle n'est pas prête. */
function ServerAISettings({ caps, mode }: { caps: CapabilitiesState; mode: ServerMode }) {
  const c = caps.capabilities;
  const view = serverAIView(c, { mode, loading: caps.loading, checkError: caps.error?.message ?? null });
  if (view.state === 'checking') {
    return (
      <p className="flex items-center gap-2 text-sm text-mg-100" role="status">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /> Vérification du serveur IA…
      </p>
    );
  }
  const ok = view.state === 'ready';
  const line = ok ? `● ${view.badge}` : view.state === 'unverified' ? `◆ ${view.badge}` : `○ ${view.title}`;
  const tone = ok ? 'text-success' : view.state === 'unverified' ? 'text-mg-50' : 'text-warning';
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div role="status" aria-live="polite" className="min-w-0 flex-1">
        <p className={`text-base font-semibold ${tone}`}>{line}</p>
        {c?.engineLabel && <p className="text-sm text-mg-100 mt-0.5 [overflow-wrap:anywhere]">{c.engineLabel}</p>}
        {view.detail && <p className="text-sm text-mg-100 mt-1 [overflow-wrap:anywhere]">{view.detail}</p>}
        {view.warning && <p className="text-sm text-mg-200 mt-1">{view.warning}</p>}
        {view.advice && <p className="text-sm text-mg-200 mt-1">{view.advice}</p>}
        {view.code && (
          <p className="text-sm text-mg-200 mt-1">
            {mode === 'personal' ? 'Code d’erreur' : 'Code à transmettre à l’administrateur'} :{' '}
            <span className="font-mono text-mg-50">{view.code}</span>
          </p>
        )}
        {mode === 'web' && !ok && <AdminContactLine contact={adminContact()} className="text-sm text-mg-200 mt-1" />}
        {caps.error && c && <p className="text-sm text-mg-200 mt-1">{caps.error.message}</p>}
      </div>
      <button type="button" className="btn-ghost text-sm" onClick={caps.reload} disabled={caps.loading}>
        <RefreshCw size={15} className={caps.loading ? 'animate-spin' : ''} aria-hidden="true" /> Vérifier à nouveau
      </button>
    </div>
  );
}

function DemoAISettings() {
  return (
    <div className="space-y-3">
      <p className="text-base font-semibold text-mg-50">Mode démonstration</p>
      <p className="text-sm text-mg-100">
        Les contenus proposés sont des exemples pré-rédigés : aucune intelligence artificielle n'est utilisée. Ils
        montrent le fonctionnement de Magistra, sans s'adapter réellement à votre demande.
      </p>
      <ConnectRealAICard />
    </div>
  );
}

// ─── Recherche ─────────────────────────────────────────────────────────────

const RESEARCH_PRIVACY = 'Quand une recherche en ligne est utilisée, Magistra envoie seulement le sujet et les mots-clés de votre demande : jamais vos documents ni votre profil.';
/** Serveur en ligne : l'adresse de contact de son administrateur (CROSSREF_MAILTO) accompagne les requêtes de publications. */
const RESEARCH_CONTACT_NOTE =
  'Si l’administrateur du serveur a indiqué une adresse de contact, elle est transmise à Crossref et à OpenAlex avec la requête (jamais la vôtre).';

function Checkbox({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange(value: boolean): void; label: string; hint?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-sm text-mg-50 cursor-pointer">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-mg-200 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function LocalResearchSettings({ state }: { state: PrefsState }) {
  const { prefs, error, save } = state;
  const [searx, setSearx] = useState<string | null>(null);
  const [searxError, setSearxError] = useState<string | null>(null);
  const [saved, flash] = useSavedFlash();
  const searxId = useId();

  if (!prefs) {
    return error ? <ErrorBox title="Préférences indisponibles." message={error} /> : (
      <p className="text-sm text-mg-100" role="status">Chargement…</p>
    );
  }

  const searxValue = searx ?? prefs.searxngUrl ?? '';

  async function update(patch: Partial<LocalPreferences>, key: string) {
    if (await save(patch)) flash(key);
  }

  async function submitSearx(e: FormEvent) {
    e.preventDefault();
    const value = searxValue.trim();
    if (value) {
      let valid: boolean;
      try {
        const u = new URL(value);
        valid = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        valid = false;
      }
      if (!valid) {
        setSearxError('Adresse invalide : elle doit commencer par http:// ou https://.');
        return;
      }
    }
    setSearxError(null);
    if (await save({ searxngUrl: value })) {
      setSearx(null);
      flash('searx');
    }
  }

  return (
    <>
      <p className="text-sm text-mg-100">{RESEARCH_PRIVACY}</p>

      <div className="space-y-3">
        <Checkbox
          checked={prefs.academicEnabled}
          onChange={v => void update({ academicEnabled: v }, 'academic')}
          label="Recherche académique (HAL, Crossref, OpenAlex)"
          hint="Publications scientifiques en accès ouvert, citées avec leurs références."
        />
        <Checkbox
          checked={prefs.wikipediaEnabled}
          onChange={v => void update({ wikipediaEnabled: v }, 'wikipedia')}
          label="Wikipédia"
          hint="Articles de l'encyclopédie en français, signalés « à recouper ». Sans moteur de recherche web (plus bas), les sites officiels vérifiés que leurs références citent pour votre sujet sont aussi consultés."
        />
        {(saved === 'academic' || saved === 'wikipedia') && <SuccessNote>Enregistré.</SuccessNote>}
      </div>

      <div className="border-t border-white/5 pt-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-white mb-2">Mode de recherche par défaut</legend>
        {RESEARCH_MODES.map(m => (
          <label key={m.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="default-research-mode"
              value={m.value}
              checked={prefs.defaultResearchMode === m.value}
              onChange={() => void update({ defaultResearchMode: m.value as ResearchMode }, 'mode')}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-sm text-mg-50">{m.label}</span>
              <span className="block text-xs text-mg-200">{m.description}</span>
            </span>
          </label>
        ))}
        {saved === 'mode' && <SuccessNote>Enregistré.</SuccessNote>}
      </fieldset>
      </div>

      <form onSubmit={e => void submitSearx(e)} className="space-y-2 border-t border-white/5 pt-4">
        <label htmlFor={searxId} className="block text-sm font-semibold text-white">Moteur de recherche web (facultatif)</label>
        <p className="text-xs text-mg-200">
          Adresse d'un moteur de recherche SearXNG. Il permet d'interroger directement {SEARCH_SCOPE_TEXT} Sans lui,
          et si Wikipédia est coché, Magistra consulte seulement les sites officiels vérifiés que ses articles citent pour le
          sujet. Aucun autre site n'est interrogé. Laissez vide si vous n'en avez pas.
        </p>
        <input
          id={searxId}
          type="url"
          className="input-field font-mono text-sm"
          value={searxValue}
          onChange={e => setSearx(e.target.value)}
          placeholder="https://searx.mon-etablissement.fr"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn-secondary text-sm py-2 px-4" disabled={searx === null}>Enregistrer l'adresse</button>
        {searxError && <p role="alert" className="text-sm text-danger">{searxError}</p>}
        {saved === 'searx' && <SuccessNote>Adresse enregistrée.</SuccessNote>}
      </form>

      {error && <ErrorBox title="Enregistrement impossible." message={error} />}
    </>
  );
}

/**
 * Ce que « Sites officiels vérifiés » consulte réellement, d'après les capacités : jamais « tous » les sites, jamais un site
 * nommé comme garanti sans moteur de recherche web (seuls les sites que Wikipédia cite pour le sujet sont alors consultés).
 */
function officialSitesNote(r: Capabilities['research']): string {
  if (!r.institutional) return '';
  // Sans moteur de recherche web, « institutional » ne vient que du chemin par Wikipédia, propre aux versions actuelles.
  if (!r.web) return 'Seulement ceux que Wikipédia cite pour votre sujet : aucun moteur de recherche web n’est configuré.';
  return r.trustedCatalogue === true
    ? 'Les principaux sites officiels vérifiés (UNESCO, Éduscol, ministères, ONU…), par le moteur de recherche web.'
    : 'Version plus ancienne : seulement quelques sites officiels (Éduscol, education.gouv.fr…), par le moteur de recherche web.';
}

function WebResearchSettings({ caps }: { caps: CapabilitiesState }) {
  const c = caps.capabilities;
  // Magistra locale pas encore prête : ses sources ne sont pas connues (jamais « non disponible » à tort).
  const r = c && !(c.route === 'local-connector' && !c.ready) ? c.research : undefined;
  const rows: { label: string; ok: boolean | undefined; note?: string }[] = [
    { label: 'Sources académiques (HAL, Crossref, OpenAlex)', ok: r?.academic },
    { label: 'Sites officiels vérifiés', ok: r?.institutional, note: r ? officialSitesNote(r) : undefined },
    { label: 'Moteur de recherche web', ok: r?.web },
    { label: 'Wikipédia', ok: r?.wikipedia },
  ];
  return (
    <>
      <p className="text-sm text-mg-100">{RESEARCH_PRIVACY}</p>
      {/* Magistra locale : les recherches sont faites par l'application Windows, qui n'a pas d'adresse de contact à transmettre. */}
      {c?.route !== 'local-connector' && <p className="text-xs text-mg-200">{RESEARCH_CONTACT_NOTE}</p>}
      <dl className="space-y-1.5 text-sm">
        {rows.map(row => (
          <div key={row.label} className="flex flex-wrap justify-between gap-2">
            <dt className={ROW_LABEL}>{row.label}</dt>
            <dd className={row.ok ? 'text-success' : 'text-mg-100'}>
              {r === undefined ? (caps.loading ? 'Vérification…' : 'Inconnu') : row.ok ? 'Disponible' : 'Non disponible'}
            </dd>
            {row.note && <dd className="basis-full text-xs text-mg-200">{row.note}</dd>}
          </div>
        ))}
      </dl>
    </>
  );
}

// ─── Documents ─────────────────────────────────────────────────────────────

function DocumentsSettings({ state }: { state: PrefsState }) {
  const { prefs, error, save } = state;
  const [saved, flash] = useSavedFlash();
  /** Nombre de documents conservés qui seront supprimés si l'option est désactivée (confirmation). */
  const [pendingDisable, setPendingDisable] = useState<number | null>(null);
  if (!prefs) {
    return error ? <ErrorBox title="Préférences indisponibles." message={error} /> : <p className="text-sm text-mg-100" role="status">Chargement…</p>;
  }
  const apply = (keepDocuments: boolean) => void save({ keepDocuments }).then(ok => ok && flash('keep'));
  const onChange = async (keepDocuments: boolean) => {
    if (keepDocuments) return apply(true);
    // Désactiver l'option efface les documents déjà conservés : on le dit avant de le faire.
    const count = await getBridge()?.documents.list().then(list => list.length, () => 0) ?? 0;
    if (count > 0) setPendingDisable(count);
    else apply(false);
  };
  return (
    <>
      <Checkbox
        checked={prefs.keepDocuments}
        onChange={v => void onChange(v)}
        label="Conserver le texte des documents ajoutés sur cet ordinateur"
        hint="Pratique pour réutiliser vos documents sans les ajouter à nouveau. Seul le texte extrait est conservé : le fichier original n'est jamais copié. Désactivé, le texte sert uniquement à la génération en cours et les documents déjà conservés sont supprimés."
      />
      {saved === 'keep' && <SuccessNote>Enregistré.</SuccessNote>}
      <ConfirmDialog
        open={pendingDisable !== null}
        title="Ne plus conserver les documents ?"
        message={`${pendingDisable === 1 ? 'Le document conservé' : `Les ${pendingDisable ?? 0} documents conservés`} sur cet ordinateur ${pendingDisable === 1 ? 'sera supprimé' : 'seront supprimés'}. Vos fichiers originaux ne sont pas concernés.`}
        confirmLabel="Supprimer et désactiver"
        cancelLabel="Annuler"
        danger
        onConfirm={() => {
          setPendingDisable(null);
          apply(false);
        }}
        onCancel={() => setPendingDisable(null)}
      />
    </>
  );
}

// ─── Profil ────────────────────────────────────────────────────────────────

function ProfileSummary() {
  const { profile } = useRuntime();
  const navigate = useNavigate();
  const rows: { label: string; value: string }[] = profile
    ? [
      ...(profile.displayName ? [{ label: 'Nom', value: profile.displayName }] : []),
      { label: 'Établissement', value: profile.etablissement || '—' },
      { label: (profile.niveaux ?? []).length > 1 ? 'Niveaux' : 'Niveau', value: (profile.niveaux ?? []).map(n => getNiveauLabel(n)).join(', ') || '—' },
      { label: 'Matière principale', value: getMatiereLabel(profile.matierePrincipale) },
      ...(profile.matiereSecondaire ? [{ label: 'Matière secondaire', value: getMatiereLabel(profile.matiereSecondaire) }] : []),
      ...(profile.discipline ? [{ label: 'Discipline', value: profile.discipline }] : []),
    ]
    : [];
  return (
    <>
      {profile ? (
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {rows.map(row => (
            <div key={row.label} className="contents">
              <dt className={ROW_LABEL}>{row.label}</dt>
              <dd className={`${ROW_VALUE} mb-1 sm:mb-0`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-mg-100">Aucun profil enregistré.</p>
      )}
      <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => navigate('/onboarding?edit=1')}>
        <BookOpen size={15} aria-hidden="true" /> Modifier mon profil
      </button>
    </>
  );
}

// ─── Compte et données ─────────────────────────────────────────────────────

function DeleteDataBlock({ description, buttonLabel, confirmTitle, confirmMessage, confirmLabel }: {
  description: string; buttonLabel: string; confirmTitle: string; confirmMessage: string; confirmLabel: string;
}) {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      await runtime.store.clearAllData();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    try {
      await runtime.saveProfile(null);
    } catch {
      // Le profil a déjà été supprimé avec les données : on relit simplement l'état.
      await runtime.reloadProfile().catch(() => undefined);
    }
    navigate('/onboarding', { replace: true });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mg-100">{description}</p>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-60"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
        {busy ? 'Suppression…' : buttonLabel}
      </button>
      {error && <ErrorBox title="La suppression n'a pas abouti." message={error} />}
      <ConfirmDialog
        open={open}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        cancelLabel="Annuler"
        danger
        onConfirm={() => void run()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

/**
 * Droit d'accès et portabilité : télécharge en un fichier JSON le profil, tout l'historique et les favoris. Aucune
 * confirmation (action sans risque) ; progression et bouton « Annuler » pendant la lecture des fiches.
 */
function ExportDataBlock() {
  const runtime = useRuntime();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; unreadable: number } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const data = await exportAccountData(runtime.store, { signal: abort.signal, onProgress: setProgress });
      setResult({ count: data.generations.length, unreadable: data.unreadable.length });
    } catch (err) {
      // Annulation volontaire : aucun message d'erreur. Sinon, message générique (jamais de détail technique).
      if (!(err instanceof ExportCancelled)) setError(EXPORT_ERROR_MESSAGE);
    } finally {
      setRunning(false);
      controller.current = null;
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-mg-100">
        Téléchargez une copie de vos données Magistra : profil enseignant, historique complet et favoris, dans un seul
        fichier JSON.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void run()} disabled={running}>
          {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          {running ? 'Préparation…' : 'Télécharger toutes mes données (JSON)'}
        </button>
        {running && (
          <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => controller.current?.abort()}>
            Annuler
          </button>
        )}
      </div>
      {running && (
        <p className="text-xs text-mg-200" role="status">
          {progress && progress.total > 0 ? `Lecture des fiches : ${progress.done} sur ${progress.total}…` : "Lecture de l'historique…"}
        </p>
      )}
      {error && <ErrorBox title="L'export n'a pas abouti." message={error} />}
      {result && (
        <SuccessNote>
          {result.count === 0 ? 'Fichier téléchargé (profil, aucune fiche).' : `Fichier téléchargé : ${result.count} fiche${result.count > 1 ? 's' : ''}.`}
        </SuccessNote>
      )}
      {result && result.unreadable > 0 && (
        <WarningNote>
          {result.unreadable} fiche{result.unreadable > 1 ? 's' : ''} n'ont pas pu être lues (elles sont listées à la fin du fichier) : relancez l'export pour les retenter.
        </WarningNote>
      )}
    </div>
  );
}

/** Rendu uniquement en mode web (à l'intérieur de ClerkProvider). */
function WebAccountSettings() {
  const clerk = useClerk();
  const { user } = useRuntime();
  return (
    <>
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className={ROW_LABEL}>Adresse e-mail</dt>
        <dd className={`${ROW_VALUE} break-all`}>{user?.email ?? '—'}</dd>
      </dl>
      <div>
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => clerk.openUserProfile()}>
          <UserCog size={15} aria-hidden="true" /> Gérer mon compte
        </button>
        <p className="text-xs text-mg-200 mt-1.5">Adresse e-mail, mot de passe et méthodes de connexion.</p>
      </div>
      <div className="border-t border-white/5 pt-4">
        <ExportDataBlock />
      </div>
      <div className="border-t border-white/5 pt-4">
        <DeleteDataBlock
          description="Supprime définitivement votre historique, vos favoris et votre profil enseignant du serveur Magistra. Votre compte de connexion se gère depuis « Gérer mon compte »."
          buttonLabel="Supprimer toutes mes données Magistra"
          confirmTitle="Supprimer toutes vos données Magistra ?"
          confirmMessage="Votre historique, vos favoris et votre profil enseignant seront définitivement supprimés du serveur Magistra. Cette action est irréversible."
          confirmLabel="Tout supprimer"
        />
      </div>
    </>
  );
}

/** Mode personnel : aucun compte ; données sur le serveur Magistra démarré sur ce poste. */
function PersonalAccountSettings() {
  const access = usePersonalAccess();
  return (
    <>
      <p className="text-sm text-mg-100">
        Mode personnel : aucun compte. Magistra utilise le serveur démarré sur cet ordinateur ; l'accès est protégé par le
        code affiché dans le terminal au démarrage.
      </p>
      <ExportDataBlock />
      <DeleteDataBlock
        description="Supprime définitivement votre historique, vos favoris et votre profil enseignant du serveur Magistra de cet ordinateur."
        buttonLabel="Supprimer toutes mes données Magistra"
        confirmTitle="Supprimer toutes vos données Magistra ?"
        confirmMessage="Votre historique, vos favoris et votre profil enseignant seront définitivement supprimés du serveur Magistra. Cette action est irréversible."
        confirmLabel="Tout supprimer"
      />
      {access && (
        <div className="border-t border-white/5 pt-4">
          <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={access.forget}>
            Oublier le code d'accès sur ce navigateur
          </button>
          <p className="text-xs text-mg-200 mt-1.5">
            Pour revenir, ouvrez à nouveau le lien affiché dans le terminal où Magistra a démarré.
          </p>
        </div>
      )}
    </>
  );
}

// ─── Confidentialité ───────────────────────────────────────────────────────

/** Liens vers les pages légales (mentions légales, confidentialité, conditions d'utilisation). */
function LegalNav() {
  return (
    <p className="text-sm text-mg-100">
      Détail du traitement de vos données et exercice de vos droits : <LegalLinks />
    </p>
  );
}

function PrivacySettings({ mode, caps }: { mode: RuntimeMode; caps: CapabilitiesState }) {
  const privacy = caps.capabilities?.privacy;
  if (!privacy) {
    return caps.loading
      ? <p className="text-sm text-mg-100" role="status">Chargement…</p>
      : (
        <>
          <p className="text-sm text-mg-100">Informations de confidentialité indisponibles pour le moment.</p>
          <LegalNav />
        </>
      );
  }
  if (mode === 'local' && privacy.level === 'local') {
    return (
      <>
        <p className="text-sm text-mg-50 font-semibold">IA locale — Vos documents et générations restent sur cet ordinateur.</p>
        <p className="text-sm text-mg-100">
          Aucun compte n'est nécessaire. Seule la recherche en ligne, si vous la choisissez, envoie le sujet et les
          mots-clés de votre demande.
        </p>
        <LegalNav />
      </>
    );
  }
  const provider = caps.capabilities?.providerInfo;
  const policy = providerPolicyUrl(provider);
  // Prestataire tiers (service d'IA en ligne) : annonce mise en avant, jamais « restent chez vous ».
  const prominent = privacy.level === 'remote' || provider?.thirdParty === true;
  return (
    <>
      {prominent ? <WarningNote>{privacy.message}</WarningNote> : <p className="text-sm text-mg-100">{privacy.message}</p>}
      {policy && (
        <p className="text-sm">
          <ExternalAnchor href={policy}>Engagements annoncés par le prestataire ({provider?.label})</ExternalAnchor>
        </p>
      )}
      {mode !== 'demo' && <p className="text-sm text-mg-100">{RESEARCH_PRIVACY}</p>}
      <LegalNav />
    </>
  );
}

// ─── À propos ──────────────────────────────────────────────────────────────

function About({ mode }: { mode: RuntimeMode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  /** Application Windows uniquement : le site web et la démonstration n'ont pas de mise à jour à rechercher. */
  const updateBridge = mode === 'local' ? getBridge() : null;
  useEffect(() => {
    const bridge = mode === 'local' ? getBridge() : null;
    if (!bridge) return;
    let cancelled = false;
    bridge.app.info().then(
      i => {
        if (!cancelled) setInfo(i);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  return (
    <div className="space-y-1.5 text-sm text-mg-100">
      <p>
        <span className="text-mg-50 font-semibold">Magistra</span>
        {info && <span className="text-mg-200"> — version {info.version}</span>}
      </p>
      {updateBridge && <UpdateCheck bridge={updateBridge} />}
      <p>Assistant pédagogique pour les enseignants, de la maternelle au doctorat.</p>
      <p>Code source publié sous licence MIT.</p>
      <p><LegalLinks /></p>
      <p><AuthorCredit variant="footer" showProfile /></p>
    </div>
  );
}
