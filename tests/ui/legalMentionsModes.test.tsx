// @vitest-environment jsdom
// Mentions légales : l'hébergeur et la base de données Supabase n'existent qu'avec le site web. En mode personnel
// (stockage fichier du serveur local), en démonstration (navigateur) et dans l'application Windows, la page ne les
// affirme pas, et l'avis « à compléter » liste exactement les informations dont la page porte la marque.

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from '@/pages/LegalPage';
import { LEGAL_ENV_NAMES, type LegalField, type LegalPageKind } from '@/lib/legal';
import { setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import { cleanup, render } from './helpers';

afterEach(() => {
  cleanup();
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

const marked = (container: HTMLElement) =>
  [...new Set(Array.from(container.querySelectorAll('[data-legal-todo]')).map(el => el.getAttribute('data-legal-todo') as LegalField))].sort();

const listed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-legal-missing] code'))
    .map(el => el.textContent)
    .sort();

describe('Mentions légales selon le mode', () => {
  it('site web : hébergeur et base Supabase, avec leur région à compléter', async () => {
    const { container } = await mount('mentions', CONFIGS.web);
    const text = container.textContent ?? '';
    expect(text).toContain('Hébergeur du site');
    expect(text).toContain('Supabase');
    expect(marked(container)).toEqual(expect.arrayContaining(['host', 'dataRegion']));
    expect(listed(container)).toEqual(expect.arrayContaining([LEGAL_ENV_NAMES.host, LEGAL_ENV_NAMES.dataRegion]));
  });

  it.each(['personal', 'demo', 'local'])('%s : ni hébergeur ni base Supabase, aucune marque « à compléter » pour eux', async name => {
    const { container } = await mount('mentions', CONFIGS[name]);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Supabase');
    expect(text).not.toContain('Hébergeur du site');
    expect(text).not.toContain('Hébergement');
    expect(marked(container)).not.toContain('host');
    expect(marked(container)).not.toContain('dataRegion');
    expect(listed(container)).not.toContain(LEGAL_ENV_NAMES.host);
    expect(listed(container)).not.toContain(LEGAL_ENV_NAMES.dataRegion);
  });

  it.each(['mentions', 'confidentialite', 'cgu'] as const)(
    '%s : l\'avis liste exactement les variables dont la page affiche la marque, dans chaque mode',
    async page => {
      for (const config of Object.values(CONFIGS)) {
        cleanup();
        const { container } = await mount(page, config);
        const expected = marked(container).map(field => LEGAL_ENV_NAMES[field]).sort();
        expect(listed(container), `${page} en ${config.mode}`).toEqual(expected);
      }
    },
  );
});
