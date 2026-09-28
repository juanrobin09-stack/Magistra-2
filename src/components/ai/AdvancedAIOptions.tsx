import { useId, useState, type FormEvent } from 'react';
import { ChevronRight, Loader2, Server } from 'lucide-react';
import { getTier } from '@shared/ai/models';
import type { AIStatus } from '@shared/ipc';
import type { AIController } from '@/hooks/useAIStatus';
import { formatGB } from '@/lib/ai-ui/format';
import { SuccessNote, WarningNote } from './Notices';

interface AdvancedAIOptionsProps {
  ai: AIController;
  status: AIStatus;
}

const LABEL = 'block text-xs font-medium text-mg-200 mb-1.5 uppercase tracking-wider';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * « Options avancées » (repliées par défaut) : nom réel du modèle, adresse d'Ollama,
 * modèle personnalisé, serveur IA distant. Aucune clé n'est jamais réaffichée.
 */
export default function AdvancedAIOptions({ ai, status }: AdvancedAIOptionsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section aria-label="Options avancées" className="rounded-xl border border-white/8">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-mg-100 hover:text-accent transition-colors"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        Options avancées
        <span className="text-xs text-mg-200">(pour les utilisateurs avertis)</span>
      </button>
      {open && (
        <div id={panelId} className="px-4 pb-5 space-y-6 border-t border-white/5 pt-4">
          <ModelDetails status={status} />
          <OllamaUrlForm ai={ai} status={status} />
          <CustomModelForm ai={ai} status={status} />
          <RemoteServerForm ai={ai} status={status} />
        </div>
      )}
    </section>
  );
}

function ModelDetails({ status }: { status: AIStatus }) {
  const activeTier = status.tiers.find(t => t.model === status.activeModel);
  const engine = status.engine;
  const engineText = engine.state === 'running'
    ? `Ollama${engine.version ? ` ${engine.version}` : ''} (en marche)`
    : engine.state === 'installed_stopped'
      ? 'Ollama (installé, arrêté)'
      : engine.state === 'not_installed' ? 'Non installé' : 'État inconnu';
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">Modèle utilisé</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-mg-200">Version</dt>
        <dd className="text-mg-50">{status.activeLabel}</dd>
        <dt className="text-mg-200">Nom technique</dt>
        <dd className="text-mg-50 font-mono text-xs break-all self-center">{status.activeModel || '—'}</dd>
        {activeTier && (
          <>
            <dt className="text-mg-200">Modèle</dt>
            <dd className="text-mg-50">{activeTier.modelDisplayName}</dd>
            <dt className="text-mg-200">Licence</dt>
            <dd className="text-mg-50">{activeTier.license}</dd>
          </>
        )}
        {status.config.mode === 'local' && (
          <>
            <dt className="text-mg-200">Moteur</dt>
            <dd className="text-mg-50">{engineText}</dd>
            {engine.executable && (
              <>
                <dt className="text-mg-200">Emplacement</dt>
                <dd className="text-mg-50 font-mono text-xs break-all self-center">{engine.executable}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <table className="mt-4 w-full text-left text-xs">
        <caption className="sr-only">Correspondance entre les versions de Magistra et les modèles open weights</caption>
        <thead>
          <tr className="text-mg-200">
            <th scope="col" className="py-1 pr-3 font-medium">Version</th>
            <th scope="col" className="py-1 pr-3 font-medium">Modèle</th>
            <th scope="col" className="py-1 pr-3 font-medium">Licence</th>
            <th scope="col" className="py-1 font-medium">Taille</th>
          </tr>
        </thead>
        <tbody>
          {status.tiers.map(t => (
            <tr key={t.id} className="border-t border-white/5 text-mg-100">
              <th scope="row" className="py-1.5 pr-3 font-medium">{t.label}</th>
              <td className="py-1.5 pr-3">
                {t.modelDisplayName} <span className="font-mono text-mg-200">({t.model})</span>
              </td>
              <td className="py-1.5 pr-3">{t.license}</td>
              <td className="py-1.5">{formatGB(t.downloadGB)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OllamaUrlForm({ ai, status }: AdvancedAIOptionsProps) {
  const id = useId();
  const [url, setUrl] = useState(status.config.ollamaUrl);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isHttpUrl(url)) {
      setMessage({ ok: false, text: 'Adresse invalide : elle doit commencer par http:// ou https://.' });
      return;
    }
    setMessage(null);
    const { status: s, error } = await ai.setConfig({ ollamaUrl: url.trim() });
    if (s) {
      setMessage({
        ok: true,
        text: s.engine.state === 'running' ? 'Adresse enregistrée. Le moteur IA répond.' : 'Adresse enregistrée, mais le moteur IA ne répond pas à cette adresse.',
      });
    } else {
      setMessage({ ok: false, text: error?.message ?? 'Enregistrement impossible.' });
    }
  }

  return (
    <form onSubmit={e => void submit(e)} className="space-y-2">
      <label htmlFor={id} className={LABEL}>Adresse du serveur Ollama</label>
      <input
        id={id}
        type="url"
        className="input-field font-mono text-sm"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="http://127.0.0.1:11434"
        spellCheck={false}
        autoComplete="off"
      />
      <p className="text-xs text-mg-200">À modifier seulement si le moteur IA utilise un autre port ou fonctionne sur un autre ordinateur.</p>
      <button type="submit" className="btn-secondary text-sm py-2 px-4" disabled={ai.pending.config || url.trim() === status.config.ollamaUrl}>
        {ai.pending.config && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Enregistrer l'adresse
      </button>
      {message && (message.ok ? <SuccessNote>{message.text}</SuccessNote> : <p role="alert" className="text-sm text-danger">{message.text}</p>)}
    </form>
  );
}

function CustomModelForm({ ai, status }: AdvancedAIOptionsProps) {
  const id = useId();
  const current = status.config.customModel ?? '';
  const [choice, setChoice] = useState(current);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = status.installedModels.map(m => m.name);
  const tierLabel = getTier(status.selectedTier).label;

  async function apply(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    setError(null);
    const result = await ai.setConfig({ customModel: choice || null });
    if (result.status) setDone(true);
    else setError(result.error?.message ?? 'Enregistrement impossible.');
  }

  return (
    <form onSubmit={e => void apply(e)} className="space-y-2">
      <label htmlFor={id} className={LABEL}>Modèle personnalisé</label>
      {names.length === 0 && !current ? (
        <p className="text-sm text-mg-200">Aucun modèle n'est installé dans le moteur IA pour le moment.</p>
      ) : (
        <>
          <select id={id} className="select-field text-sm" value={choice} onChange={e => { setChoice(e.target.value); setDone(false); }}>
            <option value="">Aucun : utiliser {tierLabel}</option>
            {current && !names.includes(current) && <option value={current}>{current} (non installé)</option>}
            {status.installedModels.map(m => (
              <option key={m.name} value={m.name}>{m.name} ({formatGB(m.sizeGB)})</option>
            ))}
          </select>
          <p className="text-xs text-mg-200">
            Choisissez un autre modèle déjà installé dans le moteur IA. Il remplace la version choisie ({tierLabel}).
            La qualité des contenus n'est pas garantie avec un modèle personnalisé.
          </p>
          <button type="submit" className="btn-secondary text-sm py-2 px-4" disabled={ai.pending.config || choice === current}>
            Utiliser ce choix
          </button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {done && <SuccessNote>{choice ? `Magistra utilise maintenant le modèle ${choice}.` : `Magistra utilise maintenant ${tierLabel}.`}</SuccessNote>}
        </>
      )}
    </form>
  );
}

function RemoteServerForm({ ai, status }: AdvancedAIOptionsProps) {
  const remote = status.config.remote;
  const isRemote = status.config.mode === 'remote';
  const [show, setShow] = useState(isRemote);
  const [kind, setKind] = useState<'openai-compatible' | 'ollama'>(remote?.kind ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(remote?.baseUrl ?? '');
  const [model, setModel] = useState(remote?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [label, setLabel] = useState(remote?.label ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { url: useId(), model: useId(), key: useId(), label: useId(), form: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isHttpUrl(baseUrl)) {
      setMessage({ ok: false, text: "Adresse du serveur invalide : elle doit commencer par http:// ou https://." });
      return;
    }
    if (!model.trim()) {
      setMessage({ ok: false, text: 'Indiquez le nom du modèle à utiliser sur ce serveur.' });
      return;
    }
    setMessage(null);
    const { status: s, error } = await ai.setConfig({
      mode: 'remote',
      remote: {
        kind,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : removeKey ? { apiKey: '' } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      },
    });
    // La clé n'est jamais conservée dans l'interface.
    setApiKey('');
    setRemoveKey(false);
    if (s) {
      setMessage(s.ready
        ? { ok: true, text: 'Serveur enregistré : il répond et Magistra l’utilise maintenant.' }
        : { ok: false, text: "Serveur enregistré, mais il ne répond pas pour le moment. Vérifiez l'adresse, le modèle et la clé." });
    } else {
      setMessage({ ok: false, text: error?.message ?? 'Enregistrement impossible.' });
    }
  }

  async function backToLocal() {
    setMessage(null);
    const { status: s, error } = await ai.setConfig({ mode: 'local' });
    if (s) {
      setShow(false);
      setMessage({ ok: true, text: "Magistra utilise de nouveau l'IA locale de cet ordinateur." });
    } else {
      setMessage({ ok: false, text: error?.message ?? 'Enregistrement impossible.' });
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Server size={15} className="text-accent" aria-hidden="true" /> Serveur IA distant
      </h3>
      <p className="text-sm text-mg-200">
        Utiliser un serveur d'IA installé ailleurs (par exemple celui de votre établissement) au lieu de l'IA de cet
        ordinateur. Serveurs compatibles OpenAI ou Ollama distant.
      </p>
      <WarningNote>Les données utilisées pour la génération seront transmises au serveur IA configuré.</WarningNote>
      {isRemote && (
        <p className="text-sm text-mg-50">
          Magistra utilise actuellement le serveur distant{remote?.label ? ` « ${remote.label} »` : ''}.
        </p>
      )}
      {!isRemote && !show && (
        <button type="button" className="btn-secondary text-sm py-2 px-4" aria-expanded={false} aria-controls={ids.form} onClick={() => setShow(true)}>
          Utiliser un serveur IA distant…
        </button>
      )}
      {(show || isRemote) && (
        <form id={ids.form} onSubmit={e => void submit(e)} className="space-y-3">
          <fieldset>
            <legend className={LABEL}>Type de serveur</legend>
            <div className="flex flex-wrap gap-4 text-sm text-mg-100">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="remote-kind" checked={kind === 'openai-compatible'} onChange={() => setKind('openai-compatible')} className="accent-[var(--color-accent)]" />
                Compatible OpenAI
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="remote-kind" checked={kind === 'ollama'} onChange={() => setKind('ollama')} className="accent-[var(--color-accent)]" />
                Ollama distant
              </label>
            </div>
          </fieldset>
          <div>
            <label htmlFor={ids.url} className={LABEL}>Adresse du serveur</label>
            <input
              id={ids.url} type="url" className="input-field font-mono text-sm" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
              placeholder={kind === 'ollama' ? 'http://serveur.local:11434' : 'https://ia.mon-etablissement.fr/v1'}
              spellCheck={false} autoComplete="off" required
            />
          </div>
          <div>
            <label htmlFor={ids.model} className={LABEL}>Modèle</label>
            <input
              id={ids.model} type="text" className="input-field font-mono text-sm" value={model} onChange={e => setModel(e.target.value)}
              placeholder="mistral-small3.2:24b" spellCheck={false} autoComplete="off" required
            />
          </div>
          <div>
            <label htmlFor={ids.key} className={LABEL}>Clé API (facultative)</label>
            <input
              id={ids.key} type="password" className="input-field font-mono text-sm" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder={remote?.hasApiKey ? 'Clé enregistrée (non affichée)' : 'Aucune clé'} autoComplete="new-password" spellCheck={false}
              disabled={removeKey}
            />
            <p className="text-xs text-mg-200 mt-1">
              La clé est conservée sur cet ordinateur et n'est jamais réaffichée.
              {remote?.hasApiKey && ' Laissez vide pour garder la clé actuelle.'}
            </p>
            {remote?.hasApiKey && (
              <label className="mt-2 flex items-center gap-2 text-sm text-mg-100 cursor-pointer">
                <input type="checkbox" checked={removeKey} onChange={e => setRemoveKey(e.target.checked)} className="accent-[var(--color-accent)]" />
                Supprimer la clé enregistrée
              </label>
            )}
          </div>
          <div>
            <label htmlFor={ids.label} className={LABEL}>Nom affiché (facultatif)</label>
            <input
              id={ids.label} type="text" className="input-field text-sm" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Serveur de mon établissement" autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={ai.pending.config}>
              {ai.pending.config && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {isRemote ? 'Enregistrer' : 'Enregistrer et utiliser ce serveur'}
            </button>
            {isRemote ? (
              <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void backToLocal()} disabled={ai.pending.config}>
                Revenir à l'IA locale
              </button>
            ) : (
              <button type="button" className="btn-ghost text-sm" onClick={() => { setShow(false); setMessage(null); }}>
                Annuler
              </button>
            )}
          </div>
        </form>
      )}
      {message && (message.ok ? <SuccessNote>{message.text}</SuccessNote> : <p role="alert" className="text-sm text-warning">{message.text}</p>)}
    </div>
  );
}
