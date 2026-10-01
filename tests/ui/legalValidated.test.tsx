// @vitest-environment jsdom
// Avis « Projet de texte, à faire valider » : affiché tant que l'éditeur n'a pas déclaré les textes validés
// (VITE_LEGAL_VALIDATED) ; une fois validés, seule subsiste la liste des informations encore à compléter.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from '@/pages/LegalPage';
import { LEGAL_ENV_NAMES, readLegalInfo, type LegalField, type LegalPageKind } from '@/lib/legal';
import { setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import { cleanup, render } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setRuntimeConfig(null);
});

const ALL_VARS = {
  VITE_LEGAL_PUBLISHER: 'Association Exemple',
  VITE_LEGAL_DIRECTOR: 'Mme Dupont',
  VITE_LEGAL_ADDRESS: '1 rue de la Paix, 33000 Bordeaux',
  VITE_LEGAL_CONTACT: 'contact@exemple.test',
  VITE_LEGAL_HOST: 'Hébergeur Exemple, 2 avenue du Cloud',
  VITE_LEGAL_DATA_REGION: 'Union européenne (Paris)',
};
/** Tout sauf l'hébergeur et la région de la base : complet pour les modes sans hébergement. */
const WITHOUT_HOSTING = { ...ALL_VARS, VITE_LEGAL_HOST: '', VITE_LEGAL_DATA_REGION: '' };

const CONFIGS: Record<string, RuntimeConfig> = {
  web: { mode: 'web', clerkPublishableKey: 'pk_test_x' },
  personal: { mode: 'personal' },
  demo: { mode: 'demo' },
  local: { mode: 'local' },
};

function stub(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
}

async function mount(page: LegalPageKind, config: RuntimeConfig = CONFIGS.web) {
  setRuntimeConfig(config);
  return render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  );
}

const note = (container: HTMLElement) => container.querySelector('[role="note"]');
const listed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-legal-missing] code')).map(el => el.textContent).sort();
const marked = (container: HTMLElement) =>
  [...new Set(Array.from(container.querySelectorAll('[data-legal-todo]')).map(el => el.getAttribute('data-legal-todo') as LegalField))].sort();

describe('Avis « projet de texte » selon VITE_LEGAL_VALIDATED', () => {
  it('non validé : avis complet (projet à valider + liste), quelles que soient les informations renseignées', async () => {
    const incomplete = await mount('mentions');
    expect(note(incomplete.container)!.textContent).toContain('Projet de texte, à faire valider avant mise en ligne');
    expect(note(incomplete.container)!.textContent).toContain('Informations à compléter');
    cleanup();

    stub(ALL_VARS);
    const complete = await mount('mentions');
    expect(note(complete.container)!.textContent).toContain('Projet de texte, à faire valider avant mise en ligne');
    expect(complete.container.querySelector('[data-legal-missing]')).toBeNull();
  });

  it('validé et complet : aucun avis, ni liste, ni marque « à compléter »', async () => {
    stub({ ...ALL_VARS, VITE_LEGAL_VALIDATED: 'true' });
    for (const page of ['mentions', 'confidentialite', 'cgu'] as const) {
      cleanup();
      const { container } = await mount(page);
      expect(note(container), page).toBeNull();
      expect(container.textContent, page).not.toContain('Projet de texte');
      expect(container.textContent, page).not.toContain('à faire valider');
      expect(container.querySelector('[data-legal-todo]'), page).toBeNull();
    }
  });

  it('validé mais incomplet : la liste « Informations à compléter » seule, sans la phrase « projet de texte »', async () => {
    stub({ ...ALL_VARS, VITE_LEGAL_HOST: '', VITE_LEGAL_DIRECTOR: '', VITE_LEGAL_VALIDATED: 'true' });
    const { container } = await mount('mentions');
    const notice = note(container)!;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("Informations à compléter par l'éditeur du site");
    expect(notice.textContent).not.toContain('Projet de texte');
    expect(notice.textContent).not.toContain('à faire valider');
    expect(notice.textContent).not.toContain('Ce texte a été rédigé');
    expect(listed(container)).toEqual([LEGAL_ENV_NAMES.director, LEGAL_ENV_NAMES.host].sort());
    // Les marques dans le texte restent, validé ou non.
    expect(marked(container)).toEqual(['director', 'host']);
    expect(container.textContent).toContain('[à compléter');
  });

  it('les marques « [à compléter : …] » du texte ne dépendent pas de la validation', async () => {
    const draft = await mount('mentions');
    const before = marked(draft.container);
    expect(before.length).toBeGreaterThan(0);
    cleanup();
    stub({ VITE_LEGAL_VALIDATED: 'true' });
    const validated = await mount('mentions');
    expect(marked(validated.container)).toEqual(before);
  });
});

describe('Valeurs de VITE_LEGAL_VALIDATED', () => {
  it.each(['true', 'TRUE', 'True', '1', 'oui', 'Oui', 'OUI', 'yes', 'YES', '  yes  ', '\toui\n', 'true\r\n'])(
    '« %s » valide les textes',
    value => {
      expect(readLegalInfo({ VITE_LEGAL_VALIDATED: value }).validated).toBe(true);
    },
  );

  it.each(['', '  ', 'false', '0', 'non', 'no', 'vrai', 'on', 'y', 'truee', 'oui !', 'true, false', '2', 'null', 'undefined'])(
    '« %s » ne valide rien',
    value => {
      expect(readLegalInfo({ VITE_LEGAL_VALIDATED: value }).validated).toBe(false);
    },
  );

  it('absente ou d\'un autre type que du texte : non validé', () => {
    expect(readLegalInfo({}).validated).toBe(false);
    for (const value of [true, 1, null, undefined, ['true'], { toString: () => 'true' }]) {
      expect(readLegalInfo({ VITE_LEGAL_VALIDATED: value }).validated).toBe(false);
    }
  });

  it('la validation ne comble aucune information manquante', () => {
    const info = readLegalInfo({ VITE_LEGAL_VALIDATED: 'oui' });
    expect(info.validated).toBe(true);
    expect(info.missing).toHaveLength(6);
  });

  it('lue dans les variables du build quand aucune n\'est passée', async () => {
    stub({ ...ALL_VARS, VITE_LEGAL_VALIDATED: 'Oui' });
    expect(readLegalInfo().validated).toBe(true);
    const { container } = await mount('confidentialite');
    expect(note(container)).toBeNull();
  });
});

describe('Avis validé selon le mode', () => {
  it.each(Object.keys(CONFIGS))('%s : validé et complet, aucune page n\'affiche d\'avis', async name => {
    stub({ ...ALL_VARS, VITE_LEGAL_VALIDATED: 'yes' });
    for (const page of ['mentions', 'confidentialite', 'cgu'] as const) {
      cleanup();
      const { container } = await mount(page, CONFIGS[name]);
      expect(note(container), `${page} en ${name}`).toBeNull();
    }
  });

  it('site web : l\'hébergeur et la région manquent → liste seule, limitée à ces deux informations', async () => {
    stub({ ...WITHOUT_HOSTING, VITE_LEGAL_VALIDATED: 'true' });
    const { container } = await mount('mentions', CONFIGS.web);
    expect(note(container)!.textContent).not.toContain('Projet de texte');
    expect(listed(container)).toEqual([LEGAL_ENV_NAMES.dataRegion, LEGAL_ENV_NAMES.host].sort());
  });

  it.each(['personal', 'demo', 'local'])(
    '%s : sans hébergement à renseigner, validé = aucun avis (mentions et confidentialité)',
    async name => {
      stub({ ...WITHOUT_HOSTING, VITE_LEGAL_VALIDATED: 'true' });
      for (const page of ['mentions', 'confidentialite'] as const) {
        cleanup();
        const { container } = await mount(page, CONFIGS[name]);
        expect(note(container), `${page} en ${name}`).toBeNull();
      }
    },
  );

  it.each(Object.keys(CONFIGS))('%s : non validé, l\'avis « projet de texte » reste affiché même avec des informations complètes', async name => {
    stub(ALL_VARS);
    for (const page of ['mentions', 'confidentialite', 'cgu'] as const) {
      cleanup();
      const { container } = await mount(page, CONFIGS[name]);
      expect(note(container)!.textContent, `${page} en ${name}`).toContain('à faire valider');
    }
  });

  it.each(Object.keys(CONFIGS))('%s : CGU validées, seul le contact manquant est listé', async name => {
    stub({ VITE_LEGAL_VALIDATED: 'true' });
    const { container } = await mount('cgu', CONFIGS[name]);
    expect(note(container)!.textContent).not.toContain('Projet de texte');
    expect(listed(container)).toEqual([LEGAL_ENV_NAMES.contact]);
  });
});
