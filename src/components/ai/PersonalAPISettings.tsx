import { useId, useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { PERSONAL_PROVIDERS, personalProviderFor, type PersonalProviderId } from '@shared/ai/personalProviders';
import type { AIStatus } from '@shared/ipc';
import type { AIController } from '@/hooks/useAIStatus';
import { SuccessNote, WarningNote } from './Notices';

/** Une clé en écriture seule ; revenir au local conserve la configuration en ligne. */
export default function PersonalAPISettings({ ai, status }: { ai: AIController; status: AIStatus }) {
  const saved = personalProviderFor(status.config.remote);
  const [providerId, setProviderId] = useState<PersonalProviderId>(saved?.id ?? 'openai');
  const provider = PERSONAL_PROVIDERS.find(p => p.id === providerId)!;
  const [model, setModel] = useState(saved ? status.config.remote!.model : provider.model as string);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const id = useId();
  const keepsKey = saved?.id === providerId && status.config.remote?.hasApiKey;
  const active = status.config.mode === 'remote' && saved !== undefined;
  const busy = ai.pending.config || ai.activation.state === 'running';

  function selectProvider(value: PersonalProviderId) {
    const next = PERSONAL_PROVIDERS.find(p => p.id === value)!;
    setProviderId(value);
    setModel(saved?.id === value ? status.config.remote!.model : next.model);
    setApiKey('');
    setMessage(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!apiKey.trim() && !keepsKey) {
      setMessage({ ok: false, text: `Ajoutez votre clé API ${provider.label}.` });
      return;
    }
    if (!model.trim()) {
      setMessage({ ok: false, text: 'Indiquez le modèle à utiliser.' });
      return;
    }
    const result = await ai.setConfig({ mode: 'remote', remote: {
      kind: provider.kind, baseUrl: provider.baseUrl, label: provider.label, model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    } });
    setApiKey('');
    setMessage(result.status
      ? { ok: result.status.ready, text: result.status.ready ? `${provider.label} est activé. Vous pouvez lancer une génération.` : `Configuration enregistrée. ${result.status.headline}` }
      : { ok: false, text: result.error?.message ?? 'Enregistrement impossible.' });
  }

  async function selectLocal(forget = false) {
    const result = await ai.setConfig({ mode: 'local', ...(forget ? { remote: null } : {}) });
    setApiKey('');
    setMessage(result.status ? { ok: true, text: forget ? 'La clé API et sa configuration ont été supprimées. L’IA locale est sélectionnée.' : 'L’IA locale est sélectionnée. Votre clé reste enregistrée pour une prochaine utilisation.' } : { ok: false, text: result.error?.message ?? 'Enregistrement impossible.' });
  }

  return (
    <section aria-label="IA avec une clé API personnelle" className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-white"><KeyRound size={18} aria-hidden="true" /> IA avec une clé API personnelle</h3>
        <p className="text-sm text-mg-100 mt-1">Utilisez OpenAI, Mistral, Gemini ou Anthropic sans installer de moteur IA. L’IA locale reste disponible.</p>
        {active && <p className="text-sm text-accent mt-2" role="status">Fournisseur actif : {saved.label} · {status.config.remote!.model}</p>}
      </div>
      <form onSubmit={e => void submit(e)}>
        <fieldset disabled={busy} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-provider`} className="block text-sm text-mg-100 mb-1">Fournisseur</label>
              <select id={`${id}-provider`} className="input-field w-full" value={providerId} onChange={e => selectProvider(e.target.value as PersonalProviderId)}>
                {PERSONAL_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-model`} className="block text-sm text-mg-100 mb-1">Modèle de l’API</label>
              <input id={`${id}-model`} className="input-field w-full" value={model} onChange={e => setModel(e.target.value)} maxLength={200} autoComplete="off" spellCheck={false} required />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-key`} className="block text-sm text-mg-100 mb-1">Clé API personnelle</label>
            <input id={`${id}-key`} type="password" className="input-field w-full" value={apiKey} onChange={e => setApiKey(e.target.value)} maxLength={1000} autoComplete="new-password" spellCheck={false} placeholder={keepsKey ? 'Clé enregistrée — laisser vide pour la conserver' : 'Collez votre clé API'} aria-describedby={`${id}-privacy`} />
            <p className="text-xs text-mg-200 mt-1">{keepsKey ? 'Une clé chiffrée est enregistrée pour ce fournisseur.' : <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Créer une clé chez {provider.label}</a>} Une seule configuration en ligne est conservée ; changer de fournisseur remplace la précédente.</p>
          </div>
          <p id={`${id}-privacy`} className="text-sm text-mg-100">La clé est chiffrée sur cet ordinateur. Avec cette option, vos consignes et les extraits de documents utilisés pour générer sont envoyés à {provider.label}. Une connexion Internet est nécessaire ; les frais et quotas dépendent de votre compte API.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary text-sm">{ai.pending.config && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Enregistrer et utiliser l’API</button>
            {status.config.mode === 'remote' && <button type="button" className="btn-secondary text-sm" onClick={() => void selectLocal()}>Utiliser l’IA locale</button>}
            {saved && <button type="button" className="btn-ghost text-sm" onClick={() => void selectLocal(true)}>Supprimer la clé API</button>}
          </div>
        </fieldset>
      </form>
      {message && (message.ok ? <SuccessNote>{message.text}</SuccessNote> : <WarningNote>{message.text}</WarningNote>)}
    </section>
  );
}
