import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalPreferences } from '@shared/ipc';
import { ErrorBox } from '@/components/ai/Notices';
import { useOptionalRuntime } from '@/lib/runtime/context';
import { fromIpcError, getBridge } from '@/lib/runtime/local';

/** Local notification only: readers reload preferences through IPC, without an event payload. */
export const USAGE_PREFERENCE_EVENT = 'magistra:usage-preference-changed';

export default function UsageParticipation({ variant = 'banner' }: { variant?: 'banner' | 'settings' }) {
  const runtime = useOptionalRuntime();
  const bridge = runtime?.mode === 'local' ? getBridge() : null;
  const id = useId();
  const [prefs, setPrefs] = useState<LocalPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ kind: 'read' | 'write'; message: string } | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const saving = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!bridge) return;
    mounted.current = true;
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const value = await bridge.prefs.get();
        if (active && current === request) {
          setPrefs(value);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (active && current === request) {
          setError({ kind: 'read', message: fromIpcError(err).message });
          setLoading(false);
        }
      }
    };
    const changed = () => { void load(); };
    window.addEventListener(USAGE_PREFERENCE_EVENT, changed);
    void load();
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener(USAGE_PREFERENCE_EVENT, changed);
    };
  }, [bridge]);

  async function save(enabled: boolean) {
    if (!bridge || !prefs || saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const value = await bridge.prefs.set({ usageStatsEnabled: enabled, usageStatsChoiceMade: true });
      if (mounted.current) {
        setPrefs(value);
        setSaved(enabled);
      }
      window.dispatchEvent(new CustomEvent(USAGE_PREFERENCE_EVENT));
    } catch (err) {
      if (mounted.current) setError({ kind: 'write', message: fromIpcError(err).message });
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function retry() {
    setLoading(true);
    setError(null);
    window.dispatchEvent(new CustomEvent(USAGE_PREFERENCE_EVENT));
  }

  if (!bridge || (variant === 'banner' && (loading || prefs?.usageStatsChoiceMade === true))) return null;
  const enabled = prefs?.usageStatsEnabled === true && prefs.usageStatsChoiceMade === true;
  const disabled = loading || pending || !prefs;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={variant === 'banner'
        ? 'fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-xl rounded-xl border border-accent/30 bg-mg-900 p-4 shadow-xl space-y-3'
        : 'rounded-xl border border-mg-700 p-4 space-y-3'}
    >
      <h3 id={`${id}-title`} className="font-semibold text-mg-50">Statistiques d’utilisation facultatives</h3>
      <p id={`${id}-description`} className="text-sm text-mg-100">
        Aidez à améliorer Magistra avec des chiffres sur les jours et mois d’utilisation, les ouvertures et les retours
        dans les 7 et 30 jours après le premier usage mesuré. Vos documents, consignes et clés API ne sont pas envoyés.
      </p>
      <p className="text-sm text-mg-100">
        Seuls les profils locaux participants sont comptés, pas des personnes uniques. Cette option est désactivée par
        défaut et l’application fonctionne de la même manière si vous refusez.
      </p>
      {variant === 'settings' ? (
        <>
          <label className="flex items-start gap-2 text-sm text-mg-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled}
              disabled={disabled}
              onChange={event => { void save(event.currentTarget.checked); }}
              aria-describedby={`${id}-description ${id}-withdraw`}
            />
            Participer aux statistiques d’utilisation
          </label>
          <p id={`${id}-withdraw`} className="text-sm text-mg-100">
            Vous pouvez retirer votre accord ici à tout moment. Le retrait arrête la mesure et efface ses données locales
            ainsi que les contributions en attente d’envoi.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={disabled} onClick={() => { void save(true); }}>
            Participer
          </button>
          <button type="button" className="btn-secondary text-sm" disabled={disabled} onClick={() => { void save(false); }}>
            Ne pas participer
          </button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-mg-100">Chargement du choix…</p>}
      {pending && <p role="status" className="text-sm text-mg-100">Enregistrement du choix…</p>}
      {saved !== null && !pending && variant === 'settings' && (
        <p role="status" className="text-sm text-success">{saved ? 'Participation activée.' : 'Participation désactivée.'}</p>
      )}
      {error && (
        <ErrorBox title={error.kind === 'read' ? 'Impossible de charger votre choix' : 'Impossible d’enregistrer votre choix'} message={error.message}>
          {error.kind === 'read' && <button type="button" className="btn-secondary mt-3 text-sm" disabled={loading || pending} onClick={retry}>Réessayer</button>}
        </ErrorBox>
      )}
      <p className="text-sm">
        <Link to="/confidentialite" className="text-accent underline underline-offset-2">Lire la politique de confidentialité</Link>
        {variant === 'banner' && <span className="text-mg-100"> · Votre choix reste modifiable dans Réglages → Confidentialité.</span>}
      </p>
    </section>
  );
}
