// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DEFAULT_PREFERENCES, type LocalPreferences, type MagistraBridge } from '@shared/ipc';
import UsageParticipation, { USAGE_PREFERENCE_EVENT } from '@/components/UsageParticipation';
import { RuntimeContext } from '@/lib/runtime/context';
import type { RuntimeMode } from '@/lib/runtime/types';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, render } from './helpers';

const network = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', network); network.mockClear(); });
afterEach(() => {
  cleanup();
  delete (window as unknown as { magistra?: unknown }).magistra;
  vi.unstubAllGlobals();
});

function fixture(initial: Partial<LocalPreferences> = {}) {
  let value: LocalPreferences = { ...DEFAULT_PREFERENCES, ...initial };
  const apply = (update: Partial<LocalPreferences>) => {
    value = { ...value, ...update };
    return { ...value };
  };
  const get = vi.fn(async () => ({ ...value }));
  const set = vi.fn(async (update: Partial<LocalPreferences>) => apply(update));
  const activity = vi.fn();
  const bridge = { isElectron: true, prefs: { get, set }, app: { activity } } as unknown as MagistraBridge;
  (window as unknown as { magistra?: MagistraBridge }).magistra = bridge;
  return { bridge, get, set, activity, apply };
}

function CurrentPath() {
  return <p data-testid="current-path">{useLocation().pathname}</p>;
}

async function mount(variant: 'banner' | 'settings' = 'banner', mode: RuntimeMode = 'local', both = false) {
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), { mode })}>
      <MemoryRouter>
        <CurrentPath />
        <UsageParticipation variant={variant} />
        {both && <UsageParticipation variant="settings" />}
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush();
  return view;
}

it('demande un choix sans activer la mesure, émettre une activité ni appeler le réseau ; les deux choix ont la même visibilité', async () => {
  const fake = fixture({ usageStatsEnabled: undefined, usageStatsChoiceMade: undefined });
  const changed = vi.fn();
  window.addEventListener(USAGE_PREFERENCE_EVENT, changed);
  try {
    const { container } = await mount();
    const accept = button(container, 'Participer')!;
    const refuse = button(container, 'Ne pas participer')!;
    expect(accept.disabled).toBe(false);
    expect(refuse.disabled).toBe(false);
    expect(accept.className).toBe(refuse.className);
    expect(container.textContent).toContain('désactivée par défaut');
    expect(container.textContent).toContain('profils locaux participants');
    expect(container.textContent).toContain('documents, consignes et clés API ne sont pas envoyés');
    await click(container.querySelector('a[href="/confidentialite"]'));
    expect(container.querySelector('[data-testid="current-path"]')?.textContent).toBe('/confidentialite');
    expect(fake.set).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(fake.activity).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(USAGE_PREFERENCE_EVENT, changed);
  }
});

it.each([
  ['Participer', true],
  ['Ne pas participer', false],
] as const)('enregistre uniquement le choix explicite « %s » puis ferme la carte', async (label, enabled) => {
  const fake = fixture();
  const { container } = await mount();
  await click(button(container, label));
  await flush();
  expect(fake.set).toHaveBeenCalledExactlyOnceWith({ usageStatsEnabled: enabled, usageStatsChoiceMade: true });
  expect(container.querySelector('section')).toBeNull();
  expect(fake.activity).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it.each([false, true])('ne redemande pas le choix déjà fait (participation %s), mais le réglage reste accessible', async enabled => {
  const fake = fixture({ usageStatsEnabled: enabled, usageStatsChoiceMade: true });
  const { container } = await mount('banner', 'local', true);
  expect(button(container, 'Participer')).toBeNull();
  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(toggle.checked).toBe(enabled);
  expect(toggle.disabled).toBe(false);
  expect(fake.set).not.toHaveBeenCalled();
});

it('les réglages permettent d’accepter puis de retirer ; la carte suit le changement et les notifications locales ne contiennent pas de données', async () => {
  const fake = fixture();
  const events: CustomEvent[] = [];
  const changed = (event: Event) => { events.push(event as CustomEvent); };
  window.addEventListener(USAGE_PREFERENCE_EVENT, changed);
  try {
    const { container } = await mount('banner', 'local', true);
    const toggle = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle().checked).toBe(false);
    await click(toggle());
    await flush();
    expect(toggle().checked).toBe(true);
    expect(button(container, 'Participer')).toBeNull();
    expect(container.textContent).toContain('Participation activée.');
    await click(toggle());
    await flush();
    expect(toggle().checked).toBe(false);
    expect(container.textContent).toContain('Participation désactivée.');
    expect(container.textContent).toContain('efface ses données locales');
    expect(fake.set.mock.calls).toEqual([
      [{ usageStatsEnabled: true, usageStatsChoiceMade: true }],
      [{ usageStatsEnabled: false, usageStatsChoiceMade: true }],
    ]);
    expect(events).toHaveLength(2);
    expect(events.every(event => event.detail === null)).toBe(true);
    expect(network).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(USAGE_PREFERENCE_EVENT, changed);
  }
});

it('une sauvegarde en cours désactive les deux choix et empêche une seconde écriture', async () => {
  const fake = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fake.set.mockImplementationOnce(async update => { await gate; return fake.apply(update); });
  const { container } = await mount();
  await click(button(container, 'Participer'));
  expect(button(container, 'Participer')?.disabled).toBe(true);
  expect(button(container, 'Ne pas participer')?.disabled).toBe(true);
  expect(container.textContent).toContain('Enregistrement du choix…');
  await click(button(container, 'Ne pas participer'));
  expect(fake.set).toHaveBeenCalledOnce();
  await act(async () => { release(); });
  await flush();
  expect(container.querySelector('section')).toBeNull();
});

it('une erreur de sauvegarde laisse le choix disponible et permet de réessayer', async () => {
  const fake = fixture();
  fake.set.mockRejectedValueOnce(new Error('INTERNAL|Enregistrement indisponible.'));
  const { container } = await mount();
  await click(button(container, 'Participer'));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enregistrement indisponible.');
  expect(button(container, 'Participer')?.disabled).toBe(false);
  await click(button(container, 'Ne pas participer'));
  await flush();
  expect(fake.set).toHaveBeenLastCalledWith({ usageStatsEnabled: false, usageStatsChoiceMade: true });
  expect(container.querySelector('section')).toBeNull();
});

it('un retrait non enregistré affiche l’erreur et conserve l’état confirmé jusqu’à une nouvelle tentative', async () => {
  const fake = fixture({ usageStatsEnabled: true, usageStatsChoiceMade: true });
  fake.set.mockRejectedValueOnce(new Error('INTERNAL|Réglage non enregistré.'));
  const { container } = await mount('settings');
  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await click(toggle);
  expect(toggle.checked).toBe(true);
  expect(toggle.disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Réglage non enregistré.');
  expect(container.textContent).not.toContain('Participation désactivée.');
  await click(toggle);
  await flush();
  expect(toggle.checked).toBe(false);
  expect(container.textContent).toContain('Participation désactivée.');
});

it('une lecture impossible reste explicite, empêche une activation à l’aveugle et permet de recharger', async () => {
  const fake = fixture();
  fake.get.mockRejectedValueOnce(new Error('INTERNAL|Lecture indisponible.'));
  const { container } = await mount('settings');
  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(toggle.checked).toBe(false);
  expect(toggle.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Lecture indisponible.');
  await click(button(container, 'Réessayer'));
  await flush();
  expect(toggle.disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(fake.set).not.toHaveBeenCalled();
});

it.each(['web', 'personal', 'demo'] as const)('reste absente en mode %s, même si un pont Electron existe', async mode => {
  const fake = fixture();
  const { container } = await mount('banner', mode, true);
  expect(container.querySelector('section')).toBeNull();
  expect(fake.get).not.toHaveBeenCalled();
  expect(fake.set).not.toHaveBeenCalled();
  expect(fake.activity).not.toHaveBeenCalled();
});
