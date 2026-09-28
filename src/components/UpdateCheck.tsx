// « Rechercher une mise à jour » (application Windows uniquement, Réglages → À propos).
// Rien ne se passe sans clic : une seule requête vers la page des versions du dépôt officiel, faite par le
// processus principal ; aucun téléchargement ni installation automatique. La page de la nouvelle version
// s'ouvre dans le navigateur du système, sur demande.

import { useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { MagistraBridge, UpdateCheckResult } from '@shared/ipc';
import { ErrorBox, SuccessNote } from '@/components/ai/Notices';
import { fromIpcError } from '@/lib/runtime/local';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: UpdateCheckResult }
  | { kind: 'error'; message: string };

export default function UpdateCheck({ bridge }: { bridge: MagistraBridge }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function check() {
    setState({ kind: 'checking' });
    try {
      setState({ kind: 'done', result: await bridge.app.checkForUpdate() });
    } catch (err) {
      setState({ kind: 'error', message: fromIpcError(err).message });
    }
  }

  const result = state.kind === 'done' ? state.result : null;
  const available = result && !result.upToDate && result.latestVersion && result.url ? result : null;

  return (
    <div className="space-y-2 pt-1">
      <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void check()} disabled={state.kind === 'checking'}>
        {state.kind === 'checking'
          ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          : <RefreshCw size={15} aria-hidden="true" />}
        {state.kind === 'checking' ? 'Recherche en cours…' : 'Rechercher une mise à jour'}
      </button>
      {result && !available && (
        result.latestVersion === null
          ? <p className="text-sm text-mg-100" role="status">Aucune version publiée pour l'instant.</p>
          : <SuccessNote>Magistra est à jour (version {result.currentVersion}).</SuccessNote>
      )}
      {available && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-mg-50">
            Version {available.latestVersion} disponible (version installée : {available.currentVersion}).
          </p>
          <button type="button" className="btn-ghost text-sm" onClick={() => void bridge.app.openExternal(available.url!)}>
            <ExternalLink size={15} aria-hidden="true" /> Ouvrir la page de la nouvelle version
          </button>
        </div>
      )}
      {state.kind === 'error' && <ErrorBox title="Recherche de mise à jour" message={state.message} />}
    </div>
  );
}
