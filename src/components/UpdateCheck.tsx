import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { MagistraBridge, UpdateCheckResult, UpdateProgress } from '@shared/ipc';
import { ErrorBox, SuccessNote } from '@/components/ai/Notices';
import { fromIpcError, getBridge } from '@/lib/runtime/local';

const AUTO_KEY = 'magistra_update_check_enabled';
const PREFERENCE_EVENT = 'magistra:update-preference';
const checks = new WeakMap<MagistraBridge, { time: number; promise: Promise<UpdateCheckResult> }>();
const autoEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
function automaticCheck(bridge: MagistraBridge) {
  const cached = checks.get(bridge);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached.promise;
  const promise = bridge.app.checkForUpdate();
  checks.set(bridge, { time: Date.now(), promise });
  return promise;
}

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheckResult }
  | { kind: 'error'; message: string };

/** Mounted only inside the native app: never in the public site or web demo. */
export function AppUpdateNotice() {
  const bridge = getBridge();
  return bridge ? <UpdateCheck bridge={bridge} notice /> : null;
}

export default function UpdateCheck({ bridge, notice = false }: { bridge: MagistraBridge; notice?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [enabled, setEnabled] = useState(autoEnabled);
  const [progress, setProgress] = useState<UpdateProgress>({ phase: 'idle', percent: 0 });
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const [launched, setLaunched] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => bridge.app.onUpdateProgress?.(setProgress), [bridge]);
  useEffect(() => {
    const changed = () => setEnabled(autoEnabled());
    window.addEventListener(PREFERENCE_EVENT, changed);
    return () => window.removeEventListener(PREFERENCE_EVENT, changed);
  }, []);
  useEffect(() => {
    if (!notice || !enabled) return;
    let active = true;
    const run = () => void automaticCheck(bridge).then(
      result => { if (active) setState({ kind: 'done', result }); },
      () => { /* A silent offline check must not interrupt teaching. Manual checks show errors. */ },
    );
    run();
    const interval = window.setInterval(run, 6 * 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [bridge, notice, enabled]);

  async function check() {
    setState({ kind: 'checking' });
    try { setState({ kind: 'done', result: await bridge.app.checkForUpdate() }); }
    catch (err) { setState({ kind: 'error', message: fromIpcError(err).message }); }
  }
  async function install() {
    if (!bridge.app.installUpdate || installing) return;
    setInstalling(true);
    setInstallError('');
    try { setLaunched(await bridge.app.installUpdate()); }
    catch (err) { setInstallError(fromIpcError(err).message); }
    finally { setInstalling(false); setProgress({ phase: 'idle', percent: 0 }); }
  }
  function toggle(value: boolean) {
    setEnabled(value);
    try { localStorage.setItem(AUTO_KEY, value ? '1' : '0'); } catch { /* session only */ }
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }

  const result = state.kind === 'done' ? state.result : null;
  const available = result && !result.upToDate && result.latestVersion && result.url ? result : null;
  const busy = installing || progress.phase !== 'idle';
  if (notice && (!available || dismissed || !enabled)) return null;
  const progressLabel = progress.phase === 'downloading' ? `Téléchargement : ${progress.percent} %`
    : progress.phase === 'verifying' ? 'Vérification du fichier…'
    : progress.phase === 'installing' ? 'Lancement de l’installation…' : 'Préparation de la mise à jour…';

  return (
    <section aria-label="Mises à jour de Magistra" className={notice ? 'm-4 rounded-xl border border-accent/30 bg-accent/10 p-4 space-y-2' : 'space-y-3 pt-1'}>
      {!notice && <>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)} className="mt-1" />
          Me prévenir lorsqu’une mise à jour est disponible
        </label>
        <p className="text-xs text-mg-200">Vérification sur GitHub au démarrage, puis toutes les six heures. Aucun document envoyé ; téléchargement uniquement à votre demande.</p>
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void check()} disabled={state.kind === 'checking' || busy}>
          {state.kind === 'checking' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          {state.kind === 'checking' ? 'Recherche en cours…' : 'Rechercher une mise à jour'}
        </button>
      </>}
      {result && !available && !notice && (result.latestVersion === null
        ? <p className="text-sm text-mg-100" role="status">Aucune version publiée pour l'instant.</p>
        : <SuccessNote>Magistra est à jour (version {result.currentVersion}).</SuccessNote>)}
      {available && <div className="space-y-2">
        <p className="text-sm text-mg-50" role="status">Magistra {available.latestVersion} est disponible. Version installée : {available.currentVersion}.</p>
        {available.installer && bridge.app.installUpdate ? <>
          <p className="text-xs text-mg-100">{Math.ceil(available.installer.size / 1024 / 1024)} Mo · Enregistrez votre travail avant l’installation. Magistra se fermera ; vos données enregistrées et modèles IA seront conservés.</p>
          <button type="button" className="btn-primary text-sm" disabled={busy || launched} onClick={() => void install()}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {launched ? 'Installateur lancé…' : busy ? progressLabel : 'Télécharger et installer'}
          </button>
          {busy && <p role="status" className="text-sm text-mg-100">{progressLabel}</p>}
        </> : <button type="button" className="btn-ghost text-sm" onClick={() => void bridge.app.openExternal(available.url!).catch(() => setInstallError('Ouverture du navigateur impossible.'))}>
          <ExternalLink size={15} aria-hidden="true" /> Ouvrir la page de la nouvelle version
        </button>}
        {notice && <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => setDismissed(true)}>Plus tard</button>}
      </div>}
      {installError && <ErrorBox title="Mise à jour" message={installError} />}
      {state.kind === 'error' && <ErrorBox title="Recherche de mise à jour" message={state.message} />}
    </section>
  );
}
