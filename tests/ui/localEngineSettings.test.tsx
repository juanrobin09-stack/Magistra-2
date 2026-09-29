// @vitest-environment jsdom
// Réglages : site web (ordre de priorité des moteurs, choix du moteur avec confirmation avant tout passage au serveur
// en ligne, connexion / déconnexion de Magistra locale, « Magistra pour Windows ») et application Windows (« Site web
// Magistra » : autorisation du site, navigateurs autorisés, retrait) — jamais d'adresse, de port ni de nom de moteur.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MagistraBridge } from '@shared/ipc';
import type { ConnectorAppStatus } from '@shared/localConnector';
import type { Capabilities } from '@shared/types';
import ConnectedBrowsersSettings from '@/components/localEngine/ConnectedBrowsersSettings';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import { ENGINE_CHOICE_STORAGE_KEY, setEngineChoice } from '@/lib/localConnector/engineChoice';
import { RuntimeContext } from '@/lib/runtime/context';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import SettingsPage from '@/pages/SettingsPage';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import {
  engineState, FakeEngine, fakeServer, FORBIDDEN_LOCAL_TEXT, mountWeb, OVH_INFO, RELEASE, resetEngineChoice, SERVER_CAPS,
  stubReleaseFetch,
} from './localEngineHelpers';

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ openUserProfile: vi.fn() }),
}));

const REMOTE_CONFIRM =
  'Cette génération sera traitée par OVHcloud AI Endpoints (serveur distant). Vos demandes et les extraits de vos documents quitteront cet ordinateur.';

beforeEach(() => {
  resetEngineChoice();
  resetWindowsReleaseCache();
  stubReleaseFetch(RELEASE);
  setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: OVH_INFO });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setRuntimeConfig(null);
  resetEngineChoice();
  resetWindowsReleaseCache();
  delete (window as unknown as { magistra?: unknown }).magistra;
});

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
}

async function mountSettings(engine: FakeEngine, serverCaps: Capabilities = SERVER_CAPS) {
  const view = await mountWeb(<SettingsPage />, engine, { server: fakeServer(serverCaps), path: '/app/settings' });
  const ai = () => view.container.querySelector<HTMLElement>('section[aria-labelledby="settings-ai"]')!;
  const radio = (value: 'local' | 'server') => ai().querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
  return { ...view, ai, radio };
}

describe('Réglages du site — Intelligence artificielle', () => {
  it('ordre de priorité : 1. Magistra locale (état), 2. serveur de l’établissement, 3. fournisseur web (tiers nommé)', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const { ai } = await mountSettings(engine);
    const rows = Array.from(ai().querySelectorAll('ol li')).map(li => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Magistra locale — connectée — Magistra Standard');
    expect(rows[0]).toContain('utilisé pour vos générations');
    expect(rows[1]).toContain('Serveur IA de l’établissement — non configuré');
    expect(rows[2]).toContain('Fournisseur web configuré — OVHcloud AI Endpoints');
    expect(rows[2]).not.toContain('utilisé');
    expect(ai().textContent).toContain('Magistra locale (recommandé)');
    expect(ai().textContent).toContain('Serveur en ligne : OVHcloud AI Endpoints');
    expect(ai().textContent).toContain('IA locale — Vos contenus sont générés sur cet ordinateur.');
    expect(ai().textContent).not.toMatch(FORBIDDEN_LOCAL_TEXT);
  });

  it('serveur de l’établissement (IA non tierce) : ligne 2 renseignée, ligne 3 « non configuré »', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: { label: 'IA du lycée Victor Hugo', thirdParty: false } });
    setEngineChoice('server');
    const caps: Capabilities = { ...SERVER_CAPS, engineLabel: 'IA du lycée Victor Hugo', providerInfo: { label: 'IA du lycée Victor Hugo', thirdParty: false } };
    const { ai } = await mountSettings(new FakeEngine(engineState('not-found')), caps);
    const rows = Array.from(ai().querySelectorAll('ol li')).map(li => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[1]).toContain('Serveur IA de l’établissement — IA du lycée Victor Hugo');
    expect(rows[1]).toContain('utilisé pour vos générations');
    expect(rows[2]).toContain('Fournisseur web configuré — non configuré');
    expect(ai().textContent).toContain('Cette génération sera traitée par IA du lycée Victor Hugo (serveur distant).');
  });

  it('passage au serveur en ligne : confirmation qui nomme le prestataire ; Annuler garde Magistra locale', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountSettings(engine);
    expect(view.radio('local').checked).toBe(true);
    await click(view.radio('server'));
    expect(dialog()?.textContent).toContain(REMOTE_CONFIRM);
    expect(view.radio('local').checked).toBe(true);
    await click(button(dialog()!, 'Garder Magistra locale'));
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBeNull();
    expect(view.radio('local').checked).toBe(true);

    await click(view.radio('server'));
    await click(button(dialog()!, 'Utiliser le serveur en ligne'));
    await flush(6);
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('server');
    expect(view.radio('server').checked).toBe(true);
    expect(view.ai().textContent).toContain('Cette génération sera traitée par OVHcloud AI Endpoints (serveur distant).');
    // L'état du serveur en ligne est alors affiché (capacités du serveur relues).
    expect(view.server.capabilities).toHaveBeenCalled();
    expect(view.ai().textContent).toContain('● Serveur IA disponible');

    // Retour à Magistra locale : immédiat, sans confirmation (rien ne quitte l'ordinateur).
    await click(view.radio('local'));
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('local');
  });

  it('déconnexion : confirmation, puis retrait de l’autorisation', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountSettings(engine);
    await click(button(view.ai(), /Déconnecter Magistra locale/));
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    await click(button(dialog()!, 'Annuler'));
    expect(engine.disconnect).not.toHaveBeenCalled();
    await click(button(view.ai(), /Déconnecter Magistra locale/));
    await click(button(dialog()!, 'Déconnecter'));
    await flush();
    expect(engine.disconnect).toHaveBeenCalledTimes(1);
  });

  it('déconnexion avec l’autorisation du navigateur à redemander : explication d’abord', async () => {
    const engine = new FakeEngine(engineState('needs-permission', { paired: true, permission: 'prompt' }));
    const view = await mountSettings(engine);
    await click(button(view.ai(), /Déconnecter Magistra locale/));
    await click(button(dialog()!, 'Déconnecter'));
    expect(engine.disconnect).not.toHaveBeenCalled();
    const explainers = view.ai().querySelectorAll('[aria-label="Autorisation du navigateur"]');
    const last = explainers[explainers.length - 1] as HTMLElement;
    expect(last.textContent).toContain('Votre navigateur va vous demander l’autorisation');
    await click(button(last, 'Continuer'));
    await flush();
    expect(engine.disconnect).toHaveBeenCalledTimes(1);
  });

  it('jamais appairé, Magistra trouvée : [Connecter Magistra locale] ; section « Magistra pour Windows » présente', async () => {
    const engine = new FakeEngine(engineState('found'));
    const view = await mountSettings(engine);
    expect(button(view.ai(), /Déconnecter/)).toBeNull();
    await click(button(view.ai(), /Connecter Magistra locale/));
    expect(engine.connect).toHaveBeenCalledTimes(1);
    const windows = view.container.querySelector('section[aria-labelledby="settings-windows"]')!;
    expect(windows.querySelector('h2')?.textContent).toContain('Magistra pour Windows');
    expect(windows.textContent).toContain('2.3.1');
  });

  it('mode personnel et démonstration : ni choix du moteur, ni section Windows', async () => {
    for (const mode of ['personal', 'demo'] as const) {
      const store = new MemoryStore([], PROFILE_COLLEGE);
      const view = await render(
        <RuntimeContext.Provider value={fakeRuntime(store, { mode, profile: PROFILE_COLLEGE })}>
          <MemoryRouter><SettingsPage /></MemoryRouter>
        </RuntimeContext.Provider>,
      );
      await flush(4);
      expect(view.container.querySelector('section[aria-labelledby="settings-windows"]'), mode).toBeNull();
      expect(view.container.textContent, mode).not.toContain('Magistra locale (recommandé)');
      cleanup();
    }
  });
});

// ─── Application Windows : « Site web Magistra » ────────────────────────────

function connectorStatus(patch: Partial<ConnectorAppStatus> = {}): ConnectorAppStatus {
  return {
    enabled: true,
    listening: true,
    persistent: true,
    clients: [
      { clientId: 'AAAAAAAAAAAAAAAAAAAAAA', site: 'magistra-2.vercel.app', browser: 'Google Chrome', pairedAt: '2026-09-20T10:00:00Z', lastUsedAt: '2026-09-28T09:30:00Z' },
      { clientId: 'BBBBBBBBBBBBBBBBBBBBBB', site: 'magistra-2.vercel.app', browser: 'Mozilla Firefox', pairedAt: '2026-09-22T10:00:00Z' },
    ],
    ...patch,
  };
}

function fakeConnector(initial: ConnectorAppStatus) {
  let current = initial;
  const listeners = new Set<(status: ConnectorAppStatus) => void>();
  const connector = {
    status: vi.fn(async () => current),
    revoke: vi.fn(async (clientId: string) => {
      current = { ...current, clients: current.clients.filter(c => c.clientId !== clientId) };
      return current;
    }),
    setEnabled: vi.fn(async (enabled: boolean) => {
      current = { ...current, enabled, listening: enabled };
      return current;
    }),
    onChange: vi.fn((listener: (status: ConnectorAppStatus) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  } satisfies MagistraBridge['connector'];
  const push = async (next: ConnectorAppStatus) => {
    current = next;
    await act(async () => {
      for (const listener of [...listeners]) listener(next);
    });
  };
  return { connector, push, listeners };
}

describe('Application Windows — « Site web Magistra »', () => {
  async function mountConnector(initial: ConnectorAppStatus) {
    const fake = fakeConnector(initial);
    const view = await render(<ConnectedBrowsersSettings connector={fake.connector} />);
    await flush();
    return { ...view, ...fake };
  }

  it('interrupteur, navigateurs autorisés (site, navigateur, date) et [Retirer] avec confirmation', async () => {
    const view = await mountConnector(connectorStatus());
    const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    const label = view.container.querySelector(`label[for="${toggle.id}"]`);
    expect(label?.textContent).toBe('Permettre au site Magistra d’utiliser l’IA de cet ordinateur');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const items = Array.from(view.container.querySelectorAll('li')).map(li => li.textContent ?? '');
    expect(items[0]).toContain('magistra-2.vercel.app');
    expect(items[0]).toContain('Google Chrome');
    expect(items[0]).toContain('Autorisé le 20 septembre 2026');
    expect(items[0]).toContain('dernière utilisation le 28 septembre 2026');
    expect(items[1]).toContain('Mozilla Firefox');

    await click(button(view.container.querySelectorAll('li')[1], /Retirer/));
    expect(dialog()?.textContent).toContain('Mozilla Firefox ne pourra plus utiliser l’intelligence artificielle de cet ordinateur');
    await click(button(dialog()!, 'Retirer'));
    await flush();
    expect(view.connector.revoke).toHaveBeenCalledWith('BBBBBBBBBBBBBBBBBBBBBB');
    expect(view.container.querySelectorAll('li')).toHaveLength(1);

    await click(toggle);
    await flush();
    expect(view.connector.setEnabled).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('suit les changements poussés par l’application (nouvel appairage) ; se désabonne au démontage', async () => {
    const view = await mountConnector(connectorStatus({ clients: [] }));
    expect(view.container.textContent).toContain('Aucun navigateur autorisé');
    await view.push(connectorStatus());
    expect(view.container.querySelectorAll('li')).toHaveLength(2);
    view.unmount();
    expect(view.listeners.size).toBe(0);
  });

  it('autorisations non conservées (chiffrement indisponible) et cause quand le site ne peut pas joindre l’application', async () => {
    const problem = 'Le site Magistra ne peut pas joindre cette application pour l’instant : un autre programme de cet ordinateur occupe les accès réservés à Magistra.';
    const view = await mountConnector(connectorStatus({ persistent: false, listening: false, problem }));
    const text = view.container.textContent ?? '';
    expect(text).toContain('elles durent jusqu’à la fermeture de Magistra');
    expect(text).toContain(problem);
    expect(text).not.toMatch(FORBIDDEN_LOCAL_TEXT);
    expect(text).not.toMatch(/\b\d{5}\b/); // aucun port
  });

  it('erreur de l’application : message clair, [Réessayer]', async () => {
    const fake = fakeConnector(connectorStatus());
    fake.connector.status.mockRejectedValueOnce(new Error("Error invoking remote method 'connector:status': INTERNAL|Erreur inattendue. Réessayez."));
    const view = await render(<ConnectedBrowsersSettings connector={fake.connector} />);
    await flush();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Erreur inattendue. Réessayez.');
    await click(button(view.container, 'Réessayer'));
    await flush();
    expect(view.container.querySelectorAll('li')).toHaveLength(2);
  });

  it('page Réglages de l’application Windows : section « Site web Magistra »', async () => {
    const fake = fakeConnector(connectorStatus());
    const never = () => new Promise<never>(() => undefined);
    (window as unknown as { magistra: unknown }).magistra = {
      isElectron: true,
      ai: { status: never, refresh: never, onProgress: () => () => undefined },
      prefs: { get: never },
      app: { info: never },
      connector: fake.connector,
    };
    const store = new MemoryStore([], PROFILE_COLLEGE);
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(store, { mode: 'local', profile: PROFILE_COLLEGE })}>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(4);
    const section = view.container.querySelector('section[aria-labelledby="settings-website"]')!;
    expect(section.querySelector('h2')?.textContent).toContain('Site web Magistra');
    expect(section.textContent).toContain('Google Chrome');
    expect(view.container.querySelector('section[aria-labelledby="settings-windows"]')).toBeNull();
  });
});
