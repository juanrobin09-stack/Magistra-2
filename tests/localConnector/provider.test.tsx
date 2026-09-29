// @vitest-environment jsdom
// Intégration React : useLocalEngine (null hors du site web), WebRuntimeProvider (un contrôleur, client hybride,
// vérification automatique sans aucune requête vers cet ordinateur tant que rien n'est autorisé ni appairé).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_PORTS } from '@shared/localConnector';
import { createLocalEngineController, LocalEngineContext, useLocalEngine, type LocalEngineController } from '@/lib/localConnector/controller';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import { useOptionalRuntime } from '@/lib/runtime/context';
import { HybridGenerationClient } from '@/lib/runtime/hybrid';
import { cleanup, flush, render } from '../ui/helpers';
import { fakeClock, FakeConnector } from './fakeConnector';

const auth = {
  isSignedIn: true,
  getToken: async () => 'jeton-session',
};
const signedInUser = { id: 'user_1', firstName: 'Anne', primaryEmailAddress: { emailAddress: 'anne@example.fr' } };

vi.mock('@clerk/react', () => ({
  useAuth: () => auth,
  useUser: () => ({ user: auth.isSignedIn ? signedInUser : null }),
}));

const { WebRuntimeProvider } = await import('@/lib/runtime/RuntimeProvider');

let fetchedUrls: string[] = [];

beforeEach(() => {
  auth.isSignedIn = true;
  fetchedUrls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetchedUrls.push(String(url));
    return new Response(JSON.stringify({ profile: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Seen {
  engine: ReturnType<typeof useLocalEngine>;
  runtime: ReturnType<typeof useOptionalRuntime>;
}

function Probe({ seen }: { seen: Seen[] }) {
  const engine = useLocalEngine();
  const runtime = useOptionalRuntime();
  seen.push({ engine, runtime });
  return <p data-testid="kind">{engine ? engine.state.kind : 'aucun'}</p>;
}

describe('useLocalEngine', () => {
  it('hors du site web (aucun contrôleur fourni) : null', async () => {
    const seen: Seen[] = [];
    const view = await render(<Probe seen={seen} />);
    expect(view.container.textContent).toBe('aucun');
    expect(seen.at(-1)!.engine).toBeNull();
  });

  it('suit les changements d’état du contrôleur', async () => {
    const clock = fakeClock();
    const connector = new FakeConnector(clock.now).setPort(CONNECTOR_PORTS[0], 'magistra');
    const controller: LocalEngineController = createLocalEngineController({
      origin: 'https://magistra-2.vercel.app', fetch: connector.fetch as typeof fetch, store: new MemoryPairingStore(),
      openUrl: connector.openUrl, permission: async () => 'granted', now: clock.now, sleep: clock.sleep,
    });
    const seen: Seen[] = [];
    const view = await render(
      <LocalEngineContext.Provider value={controller}>
        <Probe seen={seen} />
      </LocalEngineContext.Provider>,
    );
    expect(view.container.textContent).toBe('idle');
    await controller.autoCheck();
    await flush();
    expect(view.container.textContent).toBe('found');
    expect(seen.at(-1)!.engine!.controller).toBe(controller);
    expect(seen.at(-1)!.engine!.state).toEqual({ kind: 'found', paired: false, permission: 'granted', appVersion: '2.1.0' });
  });
});

describe('WebRuntimeProvider', () => {
  it('connecté : un contrôleur de Magistra locale, client hybride, vérification automatique sans requête locale', async () => {
    const seen: Seen[] = [];
    const view = await render(
      <WebRuntimeProvider>
        <Probe seen={seen} />
      </WebRuntimeProvider>,
    );
    await flush();
    const last = seen.at(-1)!;
    expect(last.runtime?.mode).toBe('web');
    expect(last.runtime?.client).toBeInstanceOf(HybridGenerationClient);
    expect(last.runtime?.client.kind).toBe('web');
    expect(last.engine).not.toBeNull();
    // Navigateur sans autorisation lisible et jamais appairé : rien n'est sondé automatiquement.
    expect(view.container.textContent).toBe('not-found');
    expect(fetchedUrls.some(u => u.includes('127.0.0.1'))).toBe(false);
    // Un seul contrôleur pendant toute la vie de la page.
    const controllers = new Set(seen.map(s => s.engine?.controller).filter(Boolean));
    expect(controllers.size).toBe(1);
    await view.rerender(
      <WebRuntimeProvider>
        <Probe seen={seen} />
      </WebRuntimeProvider>,
    );
    expect(new Set(seen.map(s => s.engine?.controller).filter(Boolean)).size).toBe(1);
  });

  it('non connecté : pages publiques sans contrôleur ni runtime', async () => {
    auth.isSignedIn = false;
    const seen: Seen[] = [];
    const view = await render(
      <WebRuntimeProvider>
        <Probe seen={seen} />
      </WebRuntimeProvider>,
    );
    await flush();
    expect(view.container.textContent).toBe('aucun');
    expect(seen.at(-1)!.runtime).toBeNull();
    expect(fetchedUrls).toEqual([]);
  });
});
