// @vitest-environment jsdom
// Mentions légales : l'hébergeur et la base de données Supabase n'existent qu'avec le site web. En mode personnel
// (stockage fichier du serveur local), en démonstration (navigateur) et dans l'application Windows, la page ne les
// affirme pas ; une information sans valeur (la région de la base) n'est pas affichée.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from '@/pages/LegalPage';
import { type LegalPageKind } from '@/lib/legal';
import { setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import { cleanup, render } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setRuntimeConfig(null);
});

const CONFIGS: Record<string, RuntimeConfig> = {
  web: { mode: 'web', clerkPublishableKey: 'pk_test_x' },
  personal: { mode: 'personal' },
  demo: { mode: 'demo' },
  local: { mode: 'local' },
};

async function mount(page: LegalPageKind, config: RuntimeConfig) {
  setRuntimeConfig(config);
  return render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  );
}

describe('Mentions légales selon le mode', () => {
  it('site web : hébergeur (Vercel par défaut) et base Supabase, sans région tant que le build ne la donne pas', async () => {
    const { container } = await mount('mentions', CONFIGS.web);
    const text = container.textContent ?? '';
    expect(text).toContain('Hébergeur du site : Vercel Inc., États-Unis (https://vercel.com).');
    expect(text).toContain('Supabase');
    expect(text).not.toMatch(/région/i);
  });

  it('site web : la région de la base est affichée quand VITE_LEGAL_DATA_REGION la donne', async () => {
    vi.stubEnv('VITE_LEGAL_DATA_REGION', 'Union européenne (Paris)');
    const { container } = await mount('mentions', CONFIGS.web);
    expect(container.textContent).toContain('base de données Supabase, région : Union européenne (Paris).');
  });

  it.each(['personal', 'demo', 'local'])('%s : ni hébergeur ni base Supabase, même avec les variables d\'hébergement renseignées', async name => {
    vi.stubEnv('VITE_LEGAL_HOST', 'Hébergeur Exemple, 2 avenue du Cloud');
    vi.stubEnv('VITE_LEGAL_DATA_REGION', 'Union européenne (Paris)');
    const { container } = await mount('mentions', CONFIGS[name]);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Supabase');
    expect(text).not.toContain('Hébergeur du site');
    expect(text).not.toContain('Hébergement');
    expect(text).not.toContain('Hébergeur Exemple');
    expect(text).not.toContain('Union européenne (Paris)');
  });
});
