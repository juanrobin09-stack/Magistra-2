// @vitest-environment jsdom
// Mode personnel (npm run dev / npm start sur le poste de l'enseignant, sans compte) : application complète,
// jeton lu dans « #acces=… » puis effacé, envoyé en « Authorization: Bearer », écran de saisie sans jeton ou sur 401.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerStatus } from '@shared/apiContract';
import App from '@/App';
import { PERSONAL_ACCESS_INTRO } from '@/components/PersonalAccess';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import { accessStorageKey, captureAccessFromUrl, resetCapturedAccessCode } from '@/lib/runtime/personal';
import { button, cleanup, flush, PROFILE_COLLEGE, render, typeInto } from './helpers';

const CODE = 'Zx7-kP2_qR9vT4mN8bL1cH6dJ3fG5sA0eW';
const OTHER = 'Nouveau-code-0123456789abcdefABCDEF';

const STATUS: ServerStatus = {
  ai: {
    ok: true,
    label: 'IA locale du serveur Magistra',
    providerInfo: { label: 'IA locale du serveur Magistra', thirdParty: false, country: 'Même machine que le serveur Magistra' },
  },
  research: { academic: false, web: false, institutional: false, wikipedia: true },
  maxDocumentChars: 30_000,
};

interface Call {
  url: string;
  auth: string | null;
}

/** Faux serveur Magistra en mode personnel : seul `accepted` est accepté. */
function fakeServer(accepted: string) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const auth = new Headers(init.headers).get('Authorization');
    calls.push({ url: input, auth });
    if (auth !== `Bearer ${accepted}`) {
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Code refusé.', retryable: false } }, 401);
    }
    const path = input.split('?')[0];
    if (path === '/api/profile') return json({ profile: PROFILE_COLLEGE });
    if (path === '/api/stats') return json({ total: 0, favorites: 0, today: 0, week: 0 });
    if (path === '/api/history') return json({ items: [] });
    if (path === '/api/status') return json(STATUS);
    return json({ error: { code: 'NOT_FOUND', message: 'Introuvable.', retryable: false } }, 404);
  }));
  return calls;
}

async function mountAt(path: string) {
  history.replaceState(null, '', path);
  const view = await render(<App config={{ mode: 'personal' }} />);
  await flush(4);
  return view;
}

/** Attend que les pages chargées à la demande (React.lazy) soient affichées. */
async function waitForText(container: HTMLElement, text: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(container.textContent ?? '').includes(text)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Texte introuvable : ${text}\n${container.textContent}`);
    await flush(1);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  localStorage.clear();
  resetCapturedAccessCode();
  setRuntimeConfig({ mode: 'personal' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetCapturedAccessCode();
  setRuntimeConfig(null);
  history.replaceState(null, '', '/');
});

describe('mode personnel', () => {
  it('sans code : écran de saisie, aucune requête envoyée, aucun service de connexion', async () => {
    const calls = fakeServer(CODE);
    const { container } = await mountAt('/app');
    await waitForText(container, PERSONAL_ACCESS_INTRO);
    const text = container.textContent ?? '';
    expect(text).toContain(PERSONAL_ACCESS_INTRO);
    expect(PERSONAL_ACCESS_INTRO).toBe(
      "Mode personnel : ouvrez le lien affiché dans le terminal où Magistra a démarré (ou collez le code d'accès).",
    );
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(calls.filter(c => c.url.startsWith('/api/'))).toHaveLength(0);
    expect(text).not.toMatch(/Se déconnecter|Se connecter/);
  });

  it('lien du terminal : code lu dans le fragment puis effacé ; chaque appel porte Authorization: Bearer', async () => {
    const calls = fakeServer(CODE);
    history.replaceState(null, '', `/#acces=${CODE}`);
    captureAccessFromUrl();
    expect(location.hash).toBe('');
    expect(localStorage.getItem(accessStorageKey(location.origin))).toBe(CODE);

    const { container } = await mountAt('/app');
    await waitForText(container, 'M. Martin');
    const api = calls.filter(c => c.url.startsWith('/api/'));
    expect(api.length).toBeGreaterThan(0);
    for (const c of api) expect(c.auth).toBe(`Bearer ${CODE}`);
    expect(api.some(c => c.url.startsWith('/api/profile'))).toBe(true);
    // Profil chargé : tableau de bord de l'enseignant (pas d'écran de code, pas de bouton Clerk).
    expect(container.textContent).toContain('M. Martin');
    expect(container.textContent).not.toContain(PERSONAL_ACCESS_INTRO);
  });

  it('code refusé (401) : écran de saisie ; un nouveau code collé (lien complet) est utilisé aussitôt', async () => {
    const calls = fakeServer(OTHER);
    localStorage.setItem(accessStorageKey(location.origin), CODE);
    const { container } = await mountAt('/app');
    await waitForText(container, PERSONAL_ACCESS_INTRO);
    expect(container.textContent).toContain("n'accepte pas le code d'accès enregistré");

    await typeInto(container.querySelector<HTMLInputElement>('input[type="password"]'), `http://127.0.0.1:5173/#acces=${OTHER}`);
    const submit = button(container, /Valider le code/);
    expect(submit).not.toBeNull();
    const form = submit!.closest('form')!;
    const { act } = await import('react');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitForText(container, 'M. Martin');

    expect(localStorage.getItem(accessStorageKey(location.origin))).toBe(OTHER);
    expect(calls.some(c => c.auth === `Bearer ${OTHER}` && c.url.startsWith('/api/profile'))).toBe(true);
    expect(container.textContent).toContain('M. Martin');
  });

  it('saisie illisible : message clair, rien n’est enregistré', async () => {
    fakeServer(CODE);
    const { container } = await mountAt('/app');
    await waitForText(container, PERSONAL_ACCESS_INTRO);
    await typeInto(container.querySelector<HTMLInputElement>('input[type="password"]'), 'abc');
    const { act } = await import('react');
    await act(async () => {
      button(container, /Valider le code/)!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ce code n'est pas lisible");
    expect(localStorage.getItem(accessStorageKey(location.origin))).toBeNull();
  });

  it('page d’accueil : « Commencer » mène à l’application', async () => {
    fakeServer(CODE);
    const { container } = await mountAt('/');
    await waitForText(container, 'Mode personnel');
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.btn-primary'));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('href')).toBe('/app');
    expect(container.textContent).toContain('Mode personnel');
  });
});
