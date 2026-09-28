// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '@/pages/DashboardPage';
import { RuntimeContext } from '@/lib/runtime/context';
import type { TeacherProfile } from '@shared/types';
import { button, cleanup, click, fakeRuntime, flush, makeRecord, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

afterEach(cleanup);

async function mount(store: MemoryStore, profile: TeacherProfile = PROFILE_COLLEGE) {
  store.profile = profile;
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(store, { profile })}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush();
  return view;
}

describe('Tableau de bord', () => {
  it('statistiques exactes (matière phare avec son vrai nombre), aucun quota', async () => {
    const records = [
      ...Array.from({ length: 7 }, (_, i) => makeRecord(i, { matiere: 'mathematiques', isFavorite: i < 2 })),
      ...Array.from({ length: 3 }, (_, i) => makeRecord(10 + i, { matiere: 'svt' })),
    ];
    const store = new MemoryStore(records);
    const { container } = await mount(store);
    const text = container.textContent ?? '';
    expect(text).toContain('Matière phare');
    expect(text).toContain('Mathématiques');
    expect(text).toContain('7 générations');
    expect(text).toContain('2 favoris');
    expect(text).toContain('10 contenus au total');
    expect(text).not.toMatch(/\/ ?20/);
    expect(text).not.toMatch(/quotidiennes/);
  });

  it('les éléments récents ouvrent l’élément précis de l’historique', async () => {
    const store = new MemoryStore(Array.from({ length: 8 }, (_, i) => makeRecord(i)));
    const { container } = await mount(store);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/app/history?id="]'));
    expect(links).toHaveLength(5);
    expect(links[0].getAttribute('href')).toBe('/app/history?id=gen-0');
    expect(store.calls.find(c => c.method === 'listGenerations')!.args[0]).toMatchObject({ limit: 5 });
  });

  it('outils rapides adaptés au supérieur et idées de sujets du niveau', async () => {
    const profile: TeacherProfile = { displayName: '', etablissement: '', cycle: 'superieur', niveaux: ['licence_2'], matierePrincipale: 'economie' };
    const { container } = await mount(new MemoryStore(), profile);
    const text = container.textContent ?? '';
    expect(text).toContain('TD / Exercices');
    expect(text).toContain('Examen');
    expect(text).toContain('Syllabus');
    expect(text).toContain('Le multiplicateur keynésien');
    expect(text).not.toMatch(/180\+|Barèmes officiels/);
    expect(container.querySelector('a[href="/onboarding?edit=1"]')).not.toBeNull();
  });

  it('erreur de chargement : message visible et « Réessayer » fonctionnel', async () => {
    const store = new MemoryStore([makeRecord(0)]);
    store.failures.getStats = 1;
    store.failures.listGenerations = 1;
    const { container } = await mount(store);
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(2);
    const retries = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.includes('Réessayer'));
    expect(retries).toHaveLength(2);
    await click(retries[0]);
    await click(button(container, /Réessayer/));
    await flush();
    expect(container.querySelectorAll('[role="alert"]').length).toBe(0);
    expect(container.querySelector('a[href="/app/history?id=gen-0"]')).not.toBeNull();
  });

  it('historique vide : invitation à générer', async () => {
    const { container } = await mount(new MemoryStore());
    expect(container.textContent).toContain('Aucune génération pour le moment');
  });
});
