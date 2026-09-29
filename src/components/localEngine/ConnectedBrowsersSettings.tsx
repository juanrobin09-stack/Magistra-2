// Application Windows, Réglages → « Site web Magistra » : l'enseignant autorise (ou non) le site Magistra à utiliser
// l'intelligence artificielle de cet ordinateur, voit les navigateurs autorisés (site, navigateur, date) et peut en
// retirer un. Jamais d'adresse ni de port : le connecteur local est un détail interne de l'application.

import { useCallback, useEffect, useId, useState } from 'react';
import { Globe, Loader2, Trash2 } from 'lucide-react';
import type { ConnectorAppStatus, ConnectorClientInfo } from '@shared/localConnector';
import type { MagistraBridge } from '@shared/ipc';
import { ErrorBox, WarningNote } from '@/components/ai/Notices';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { fromIpcError } from '@/lib/runtime/local';
import { NOT_PERSISTENT_NOTE, WEBSITE_TOGGLE_LABEL } from './texts';
import { formatDate } from './windowsRelease';

type Connector = MagistraBridge['connector'];

function ClientRow({ client, onRevoke, busy }: { client: ConnectorClientInfo; onRevoke(): void; busy: boolean }) {
  const paired = formatDate(client.pairedAt);
  const used = client.lastUsedAt ? formatDate(client.lastUsedAt) : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-mg-50 font-medium [overflow-wrap:anywhere]">
          {client.site} <span className="text-mg-200 font-normal">· {client.browser}</span>
        </p>
        <p className="text-xs text-mg-200">
          {paired ? `Autorisé le ${paired}` : 'Autorisé'}
          {used ? ` · dernière utilisation le ${used}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={busy}
        aria-label={`Retirer l’autorisation de ${client.browser} (${client.site})`}
        className={`inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-60 ${FOCUS_RING}`}
      >
        <Trash2 size={13} aria-hidden="true" /> Retirer
      </button>
    </li>
  );
}

export default function ConnectedBrowsersSettings({ connector }: { connector: Connector }) {
  const [status, setStatus] = useState<ConnectorAppStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ConnectorClientInfo | null>(null);
  const [reload, setReload] = useState(0);
  const switchId = useId();

  useEffect(() => {
    let cancelled = false;
    connector.status().then(
      s => {
        if (!cancelled) {
          setStatus(s);
          setLoadError(null);
        }
      },
      err => {
        if (!cancelled) setLoadError(fromIpcError(err).message);
      },
    );
    // Nouvel appairage, retrait, réglage changé ailleurs (boîte de consentement) : état poussé par l'application.
    const off = connector.onChange(next => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [connector, reload]);

  const run = useCallback(async (task: () => Promise<ConnectorAppStatus>) => {
    setBusy(true);
    setActionError(null);
    try {
      setStatus(await task());
    } catch (err) {
      setActionError(fromIpcError(err).message);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!status) {
    return loadError ? (
      <ErrorBox title="État de l’accès du site indisponible." message={loadError}>
        <button type="button" className={`btn-secondary text-sm py-2 px-4 mt-3 ${FOCUS_RING}`} onClick={() => setReload(n => n + 1)}>
          Réessayer
        </button>
      </ErrorBox>
    ) : (
      <p className="flex items-center gap-2 text-sm text-mg-100" role="status">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /> Chargement…
      </p>
    );
  }

  const enabled = status.enabled;
  return (
    <>
      <p className="text-sm text-mg-100">
        Depuis les navigateurs que vous autorisez, le site Magistra peut confier ses générations à l’intelligence
        artificielle de cet ordinateur. Il n’a accès ni à vos fichiers, ni à vos autres applications, ni aux réglages.
      </p>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={switchId} className="text-sm text-mg-50 cursor-pointer">{WEBSITE_TOGGLE_LABEL}</label>
          <p id={`${switchId}-hint`} className="text-xs text-mg-200 mt-0.5">
            Désactivé, le site ne peut plus joindre Magistra ; les navigateurs autorisés sont conservés.
          </p>
        </div>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-describedby={`${switchId}-hint`}
          disabled={busy}
          onClick={() => void run(() => connector.setEnabled(!enabled))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
            enabled ? 'bg-accent border-accent' : 'bg-mg-600 border-white/10'
          } ${FOCUS_RING}`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 rounded-full bg-mg-900 shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>

      {enabled && !status.listening && status.problem && <WarningNote>{status.problem}</WarningNote>}
      {!status.persistent && <WarningNote>{NOT_PERSISTENT_NOTE}</WarningNote>}
      {actionError && <ErrorBox title="La modification n’a pas abouti." message={actionError} />}

      <div className="border-t border-white/5 pt-4 space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe size={15} className="text-accent" aria-hidden="true" /> Navigateurs autorisés
        </h3>
        {status.clients.length === 0 ? (
          <p className="text-sm text-mg-200">
            Aucun navigateur autorisé. Pour en autoriser un, ouvrez le site Magistra dans votre navigateur (de
            préférence Chrome ou Edge), connectez-vous à votre compte, puis cliquez sur « Connecter Magistra locale ».
          </p>
        ) : (
          <ul className="space-y-2">
            {status.clients.map(client => (
              <ClientRow key={client.clientId} client={client} busy={busy} onRevoke={() => setRevoking(client)} />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={revoking !== null}
        title="Retirer cette autorisation ?"
        message={`${revoking?.browser ?? 'Ce navigateur'} ne pourra plus utiliser l’intelligence artificielle de cet ordinateur depuis ${revoking?.site ?? 'le site Magistra'}. Une génération en cours depuis ce navigateur sera arrêtée. Vous pourrez le reconnecter à tout moment depuis le site.`}
        confirmLabel="Retirer"
        danger
        onConfirm={() => {
          const target = revoking;
          setRevoking(null);
          if (target) void run(() => connector.revoke(target.clientId));
        }}
        onCancel={() => setRevoking(null)}
      />
    </>
  );
}
