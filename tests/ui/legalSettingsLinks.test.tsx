// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RuntimeContext } from '@/lib/runtime/context';
import SettingsPage from '@/pages/SettingsPage';
import { cleanup, fakeRuntime, flush, MemoryStore, render } from './helpers';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ openUserProfile: vi.fn() }) }));

afterEach(cleanup);

describe('Réglages — pages légales', () => {
  it('renvoient vers les mentions légales, la confidentialité et les conditions (À propos)', async () => {
    const { container } = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore())}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(5);
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/mentions-legales', '/confidentialite', '/cgu']));
  });
});
