// Mode personnel : écran du code d'accès (aucun compte, aucun service de connexion en ligne).
// Le code est affiché dans le terminal où Magistra a démarré, sous la forme d'un lien à ouvrir.

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { GraduationCap, KeyRound, Terminal } from 'lucide-react';
import { useOptionalRuntime } from '@/lib/runtime/context';
import { usePersonalAccess } from '@/lib/runtime/personal';

export const PERSONAL_ACCESS_INTRO =
  "Mode personnel : ouvrez le lien affiché dans le terminal où Magistra a démarré (ou collez le code d'accès).";

export function PersonalAccessScreen({ rejected = false }: { rejected?: boolean }) {
  const access = usePersonalAccess();
  const runtime = useOptionalRuntime();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!access) return;
    const outcome = access.submit(value);
    if (outcome === 'invalid') {
      setError("Ce code n'est pas lisible. Copiez le lien complet affiché dans le terminal (il contient « #acces= »), ou seulement le code qui suit.");
      return;
    }
    setError(null);
    setValue('');
    // Même code qu'avant (serveur redémarré entre-temps…) : on relit simplement le profil.
    if (outcome === 'same') void runtime?.reloadProfile();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mg-900 px-4 py-10">
      <main className="card w-full max-w-md p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
            <GraduationCap size={20} className="text-mg-900" aria-hidden="true" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra<span className="text-gold">.</span>
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Accès à Magistra</h1>
          <p className="text-sm text-mg-100">{PERSONAL_ACCESS_INTRO}</p>
        </div>

        {rejected && (
          <p role="alert" className="text-sm text-warning rounded-xl border border-warning/25 bg-warning/5 p-3">
            Le serveur Magistra n'accepte pas le code d'accès enregistré dans ce navigateur. Ouvrez à nouveau le lien
            affiché dans le terminal, ou collez le code ci-dessous.
          </p>
        )}

        <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-mg-700/40 p-3 text-xs text-mg-200">
          <Terminal size={15} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Au démarrage (<span className="font-mono">npm run dev</span> ou <span className="font-mono">npm start</span>), le
            terminal affiche une adresse du type <span className="font-mono">http://127.0.0.1:…/#acces=…</span>. Ouvrez-la
            dans ce navigateur : le code est retenu, vous n'aurez plus à le saisir.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor={inputId} className="block text-sm font-semibold text-white">Code d'accès</label>
          <input
            id={inputId}
            type="password"
            className="input-field font-mono text-sm"
            value={value}
            onChange={e => {
              setValue(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            placeholder="Code ou lien complet"
          />
          {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={!value.trim()}>
            <KeyRound size={16} aria-hidden="true" /> Valider le code
          </button>
        </form>

        <p className="text-xs text-mg-200">
          Aucun compte n'est nécessaire. Ce code protège votre historique sur cet ordinateur : ne le partagez pas.
        </p>
      </main>
    </div>
  );
}

/** Pages de l'application en mode personnel : sans code d'accès, l'écran de saisie s'affiche. */
export function PersonalAccessGate({ children }: { children: ReactNode }) {
  const access = usePersonalAccess();
  if (access && !access.hasCode) return <PersonalAccessScreen />;
  return <>{children}</>;
}
