// @vitest-environment jsdom
// Réglages → « À propos » : liens vers les trois pages légales et contact de l'éditeur (lien « mailto: »).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RuntimeContext } from '@/lib/runtime/context';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import SettingsPage from '@/pages/SettingsPage';
import type { RuntimeMode } from '@/lib/runtime/types';
import { cleanup, fakeRuntime, flush, MemoryStore, render } from './helpers';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ openUserProfile: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setRuntimeConfig(null);
});

async function mountSettings(mode: RuntimeMode = 'demo') {
  const { container } = await render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), { mode })}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush(5);
  return container;
}

const aboutOf = (container: HTMLElement) => container.querySelector('#settings-about')!.closest('section')!;

describe('Réglages — pages légales', () => {
  it('renvoient vers les mentions légales, la confidentialité et les conditions (À propos)', async () => {
    const container = await mountSettings();
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/mentions-legales', '/confidentialite', '/cgu']));
  });
});

describe('Réglages — À propos : contact', () => {
  it.each(['local', 'demo', 'personal'] as const)('%s : le contact par défaut est un lien « mailto: » exact', async mode => {
    const about = aboutOf(await mountSettings(mode));
    expect(about.textContent).toContain('Contact : juanrobin89@gmail.com');
    const link = about.querySelector('a[href="mailto:juanrobin89@gmail.com"]');
    expect(link?.textContent).toBe('juanrobin89@gmail.com');
    expect(about.textContent).not.toMatch(/à compléter|VITE_/i);
  });

  it('VITE_LEGAL_CONTACT remplace le contact par défaut, comme dans les pages légales', async () => {
    vi.stubEnv('VITE_LEGAL_CONTACT', 'Service Exemple, contact@exemple.test');
    const about = aboutOf(await mountSettings('local'));
    expect(about.textContent).toContain('Contact : Service Exemple, contact@exemple.test');
    expect(about.querySelector('a[href="mailto:contact@exemple.test"]')).not.toBeNull();
    expect(about.querySelector('a[href="mailto:juanrobin89@gmail.com"]')).toBeNull();
  });

  it('le contact de l\'administrateur du serveur passe avant le contact par défaut', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', adminContact: 'admin@exemple.test' });
    const about = aboutOf(await mountSettings('web'));
    expect(about.querySelector('a[href="mailto:admin@exemple.test"]')).not.toBeNull();
    expect(about.querySelector('a[href="mailto:juanrobin89@gmail.com"]')).toBeNull();
  });
});
