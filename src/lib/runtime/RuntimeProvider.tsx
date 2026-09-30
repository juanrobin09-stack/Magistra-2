import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/react';
import { toMagistraError, type MagistraError } from '@shared/errors';
import type { TeacherProfile } from '@shared/types';
import { createLocalEngineController, LocalEngineContext } from '@/lib/localConnector/controller';
import { RuntimeContext } from './context';
import { DemoDataStore, DemoGenerationClient } from './demo';
import { HybridGenerationClient } from './hybrid';
import { getBridge, LocalDataStore, LocalGenerationClient } from './local';
import {
  clearAccessCode, initialAccessCode, normalizeAccessCode, PERSONAL_USER_ID, PersonalAccessContext, storeAccessCode,
  type PersonalAccess,
} from './personal';
import type { DataStore, GenerationClient, ProfileStatus, RuntimeMode, RuntimeUser, RuntimeValue } from './types';
import { ApiDataStore, ApiGenerationClient } from './web';

interface ProfileResult {
  /** Magasin (donc compte / ordinateur) auquel ce profil appartient. */
  store: DataStore;
  profile: TeacherProfile | null;
  status: Exclude<ProfileStatus, 'loading'>;
  error?: MagistraError;
}

/**
 * Charge le profil du magasin courant. Le résultat est rattaché au magasin qui l'a produit :
 * après un changement de compte, le profil précédent n'est jamais affiché, même brièvement.
 */
function useProfile(store: DataStore | null) {
  const [result, setResult] = useState<ProfileResult | null>(null);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.getProfile().then(
      profile => {
        if (!cancelled) setResult({ store, profile, status: 'ready' });
      },
      err => {
        if (!cancelled) setResult({ store, profile: null, status: 'error', error: toMagistraError(err, 'INTERNAL') });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  const reload = useCallback(async () => {
    if (!store) return;
    setResult(null);
    try {
      const profile = await store.getProfile();
      setResult({ store, profile, status: 'ready' });
    } catch (err) {
      setResult({ store, profile: null, status: 'error', error: toMagistraError(err, 'INTERNAL') });
    }
  }, [store]);

  const save = useCallback(async (profile: TeacherProfile | null) => {
    if (!store) return;
    await store.saveProfile(profile);
    setResult({ store, profile, status: 'ready' });
  }, [store]);

  const current = result && result.store === store ? result : null;
  return {
    profile: current?.profile ?? null,
    status: (current?.status ?? 'loading') as ProfileStatus,
    error: current?.error ?? null,
    reload,
    save,
  };
}

function useRuntimeValue(mode: RuntimeMode, store: DataStore | null, client: GenerationClient | null, user: RuntimeUser | null): RuntimeValue | null {
  const { profile, status, error, reload, save } = useProfile(store);
  return useMemo(() => {
    if (!store || !client) return null;
    return { mode, store, client, user, profile, profileStatus: status, profileError: error, saveProfile: save, reloadProfile: reload };
  }, [mode, store, client, user, profile, status, error, save, reload]);
}

/** Application Windows : pont IPC local. */
export function LocalRuntimeProvider({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const store = useMemo(() => (bridge ? new LocalDataStore(bridge) : null), [bridge]);
  const client = useMemo(() => (bridge ? new LocalGenerationClient(bridge) : null), [bridge]);
  const value = useRuntimeValue('local', store, client, null);
  if (!value) return null;
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

/** Démonstration : exemples pré-rédigés + stockage du navigateur. */
export function DemoRuntimeProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new DemoDataStore(), []);
  const client = useMemo(() => new DemoGenerationClient(store), [store]);
  const value = useRuntimeValue('demo', store, client, null);
  if (!value) return null;
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

/**
 * Web : doit être rendu à l'intérieur de <ClerkProvider>.
 * Utilisateur connecté : générations par le serveur en ligne OU par Magistra locale (IA de cet ordinateur, via
 * l'application Windows), selon le choix de l'enseignant ; UN seul contrôleur de Magistra locale par page, fourni
 * par LocalEngineContext (carte du tableau de bord, réglages, page Générer).
 */
export function WebRuntimeProvider({ children }: { children: ReactNode }) {
  // getToken est mémoïsé par Clerk (stable tant que l'instance Clerk ne change pas).
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const tokenGetter = useCallback(async () => (await getToken()) ?? null, [getToken]);
  const userId = isSignedIn && user ? user.id : null;
  // L'appairage appartient à ce navigateur (et non au compte) : le contrôleur vit aussi longtemps que la page.
  const localEngine = useMemo(() => createLocalEngineController(), []);

  const store = useMemo(() => (userId ? new ApiDataStore(tokenGetter, userId) : null), [userId, tokenGetter]);
  const client = useMemo(
    () => (store ? new HybridGenerationClient(new ApiGenerationClient(tokenGetter), localEngine, draft => store.saveGenerationDraft(draft)) : null),
    [store, tokenGetter, localEngine],
  );
  const runtimeUser = useMemo<RuntimeUser | null>(
    () => (user ? { id: user.id, firstName: user.firstName, email: user.primaryEmailAddress?.emailAddress ?? null } : null),
    [user],
  );
  const value = useRuntimeValue('web', store, client, runtimeUser);

  // Vérification automatique (jamais de demande d'autorisation du navigateur) dès que l'enseignant est connecté.
  useEffect(() => {
    if (userId) void localEngine.autoCheck();
  }, [userId, localEngine]);
  // Page quittée pendant un appairage : l'attente est interrompue.
  useEffect(() => () => localEngine.cancelPairing(), [localEngine]);

  // Non connecté : les pages publiques s'affichent, les pages de l'application sont protégées par le routeur.
  if (!value) return <>{children}</>;
  return (
    <RuntimeContext.Provider value={value}>
      <LocalEngineContext.Provider value={localEngine}>{children}</LocalEngineContext.Provider>
    </RuntimeContext.Provider>
  );
}

/**
 * Mode personnel (serveur Magistra sur le poste de l'enseignant, sans compte) : mêmes données et même IA
 * que le site web, mais le jeton envoyé est le code d'accès affiché dans le terminal. Sans code, les pages
 * publiques s'affichent et les pages de l'application demandent le code (voir PersonalAccessGate).
 */
export function PersonalRuntimeProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState<string | null>(() => initialAccessCode());
  const tokenGetter = useCallback(async () => code, [code]);

  const store = useMemo(() => (code ? new ApiDataStore(tokenGetter, PERSONAL_USER_ID, 'personal') : null), [code, tokenGetter]);
  const client = useMemo(() => (code ? new ApiGenerationClient(tokenGetter, 'personal') : null), [code, tokenGetter]);
  const value = useRuntimeValue('personal', store, client, null);

  const access = useMemo<PersonalAccess>(() => ({
    hasCode: code !== null,
    submit(input: string) {
      const next = normalizeAccessCode(input);
      if (!next) return 'invalid';
      storeAccessCode(next);
      if (next === code) return 'same';
      setCode(next);
      return 'changed';
    },
    forget() {
      clearAccessCode();
      setCode(null);
    },
  }), [code]);

  return (
    <PersonalAccessContext.Provider value={access}>
      {value ? <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider> : children}
    </PersonalAccessContext.Provider>
  );
}
