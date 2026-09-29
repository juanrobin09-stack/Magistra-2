// @vitest-environment jsdom
// Carte « Magistra locale » du tableau de bord (site web) : chaque état du contrôleur avec les textes EXACTS de
// l'enseignant, explication AVANT la demande d'autorisation du navigateur, aide quand elle est refusée, et jamais
// d'adresse, de port ni de nom de moteur à l'écran.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { defaultMessage } from '@shared/errors';
import LocalEngineCard from '@/components/localEngine/LocalEngineCard';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import { LocalEngineContext, useLocalEngine } from '@/lib/localConnector/controller';
import { ENGINE_CHOICE_STORAGE_KEY, setEngineChoice } from '@/lib/localConnector/engineChoice';
import { WINDOWS_DOWNLOAD_URL } from '@/lib/links';
import { RuntimeContext } from '@/lib/runtime/context';
import DashboardPage from '@/pages/DashboardPage';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import {
  engineState, FakeEngine, FORBIDDEN_LOCAL_TEXT, mountWeb, READY_STATUS, RELEASE, resetEngineChoice, stubReleaseFetch,
} from './localEngineHelpers';

beforeEach(() => {
  resetEngineChoice();
  resetWindowsReleaseCache();
  stubReleaseFetch(RELEASE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetEngineChoice();
  resetWindowsReleaseCache();
});

function Host() {
  const engine = useLocalEngine();
  return engine ? <LocalEngineCard engine={engine} /> : null;
}

async function mountCard(engine: FakeEngine) {
  const view = await mountWeb(<Host />, engine);
  const card = () => view.container.querySelector<HTMLElement>('[data-testid="local-engine-card"]')!;
  const status = () => card().querySelector<HTMLElement>('[role="status"]')!;
  return { ...view, card, status };
}

describe('Carte Magistra locale — jamais appairée', () => {
  it('accueil : « Activez l’intelligence Magistra… », téléchargement direct de la dernière version, « J\'ai déjà Magistra : la rechercher »', async () => {
    const engine = new FakeEngine(engineState('not-found', { permission: 'granted' }));
    const { card, status } = await mountCard(engine);
    expect(status().textContent).toContain('Activez l’intelligence Magistra sur votre ordinateur.');
    const download = Array.from(card().querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'));
    expect(download?.getAttribute('href')).toBe(RELEASE.downloadUrl);
    expect(download?.getAttribute('rel')).toContain('noreferrer');
    await click(button(card(), "J'ai déjà Magistra : la rechercher"));
    expect(engine.detect).toHaveBeenCalledTimes(1);

    // Recherche demandée par l'enseignant, puis rien trouvé : « n'est pas encore détectée » (plus l'accueil).
    await engine.set(engineState('checking', { permission: 'granted' }));
    expect(status().textContent).toContain('Recherche de Magistra sur cet ordinateur…');
    expect(status().getAttribute('aria-live')).toBe('polite');
    await engine.set(engineState('not-found', { permission: 'granted' }));
    await flush();
    expect(status().textContent).toContain('Magistra n’est pas encore détectée.');
    expect(button(card(), /Réessayer/)).not.toBeNull();
    const short = Array.from(card().querySelectorAll('a')).find(a => a.textContent?.trim() === 'Télécharger Magistra');
    expect(short?.getAttribute('href')).toBe(RELEASE.downloadUrl);
    await click(button(card(), /Réessayer/));
    expect(engine.detect).toHaveBeenCalledTimes(2);
  });

  it('version inconnue (serveur injoignable) : le téléchargement mène à la page officielle des versions, dans un nouvel onglet', async () => {
    stubReleaseFetch(new TypeError('Failed to fetch'));
    const engine = new FakeEngine(engineState('not-found'));
    const { card } = await mountCard(engine);
    const download = Array.from(card().querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    expect(download.getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    expect(download.target).toBe('_blank');
    expect(download.rel).toContain('noopener');
  });

  it('autorisation du navigateur à demander : explication AVANT la demande, rien n’est sondé avant « Continuer »', async () => {
    const engine = new FakeEngine(engineState('not-found', { permission: 'prompt' }));
    const { card } = await mountCard(engine);
    await click(button(card(), "J'ai déjà Magistra : la rechercher"));
    expect(engine.detect).not.toHaveBeenCalled();
    expect(card().textContent).toContain(
      'Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil : acceptez-la. Elle permet uniquement à ce site de dialoguer avec l’application Magistra installée sur cet ordinateur.',
    );
    const next = button(card(), 'Continuer')!;
    expect(document.activeElement).toBe(next);

    // « Annuler » : aucune recherche, l'explication disparaît, le focus revient sur l'état.
    await click(button(card(), 'Annuler'));
    expect(engine.detect).not.toHaveBeenCalled();
    expect(card().textContent).not.toContain('Votre navigateur va vous demander');

    await click(button(card(), "J'ai déjà Magistra : la rechercher"));
    await click(button(card(), 'Continuer'));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });
});

describe('Carte Magistra locale — appairage', () => {
  it('« ✓ Magistra trouvée » [Connecter Magistra locale] → « Confirmez dans l’application Magistra… » [Annuler], focus conservé', async () => {
    const engine = new FakeEngine(engineState('found', { appVersion: '2.1.0' }));
    const { card, status } = await mountCard(engine);
    expect(status().textContent).toContain('✓ Magistra trouvée');
    const connect = button(card(), /Connecter Magistra locale/)!;
    connect.focus();
    await click(connect);
    expect(engine.connect).toHaveBeenCalledTimes(1);

    await engine.set(engineState('pairing'));
    expect(status().textContent).toContain('Confirmez dans l’application Magistra…');
    // Le bouton utilisé a disparu : le focus est placé sur la ligne d'état (jamais perdu).
    expect(document.activeElement).toBe(status());
    await click(button(card(), 'Annuler'));
    expect(engine.cancelPairing).toHaveBeenCalledTimes(1);
  });

  it('juste après l’accord : « ✓ Intelligence locale connectée » ; ensuite : « ✓ Magistra locale connectée »', async () => {
    const engine = new FakeEngine(engineState('pairing'));
    const { status, card } = await mountCard(engine);
    await engine.set(engineState('connected'));
    expect(status().textContent).toContain('✓ Intelligence locale connectée');
    expect(status().textContent).toContain('Modèle : Magistra Standard');
    expect(card().querySelectorAll('button')).toHaveLength(0);
    cleanup();

    const again = await mountCard(new FakeEngine(engineState('connected')));
    expect(again.status().textContent).toContain('✓ Magistra locale connectée');
    expect(again.status().textContent).not.toContain('Intelligence locale connectée');
  });

  it('appairage refusé ou expiré : la cause est dite, « Connecter » reste proposé', async () => {
    for (const code of ['CONNECTOR_PAIRING_REFUSED', 'CONNECTOR_PAIRING_EXPIRED'] as const) {
      const engine = new FakeEngine(engineState('found', { error: { code, message: defaultMessage(code) } }));
      const { status, card } = await mountCard(engine);
      expect(status().textContent).toContain(defaultMessage(code));
      expect(button(card(), /Connecter Magistra locale/)).not.toBeNull();
      cleanup();
    }
  });
});

describe('Carte Magistra locale — appairée', () => {
  it('application fermée : [Ouvrir Magistra] [Réessayer]', async () => {
    const engine = new FakeEngine(engineState('app-closed'));
    const { status, card } = await mountCard(engine);
    expect(status().textContent).toContain('L’application Magistra est fermée.');
    await click(button(card(), /Ouvrir Magistra/));
    expect(engine.openApp).toHaveBeenCalledTimes(1);
    await click(button(card(), /Réessayer/));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });

  it('moteur non prêt : message précis (sans nom de moteur ni adresse) + [Ouvrir Magistra]', async () => {
    const status = structuredClone(READY_STATUS);
    status.engine = {
      ready: false, local: true, label: 'Magistra Standard',
      notReady: { code: 'MODEL_NOT_INSTALLED', message: 'Modèle absent : lancez « ollama pull ministral-3:8b » sur http://127.0.0.1:11434.' },
    };
    const engine = new FakeEngine(engineState('connected', { status }));
    const view = await mountCard(engine);
    expect(view.status().textContent).toContain('Le modèle d’IA choisi n’est pas encore installé : ouvrez l’application Magistra pour le télécharger.');
    expect(view.card().textContent).not.toMatch(FORBIDDEN_LOCAL_TEXT);
    await click(button(view.card(), /Ouvrir Magistra/));
    expect(engine.openApp).toHaveBeenCalledTimes(1);
  });

  it('application réglée sur un serveur distant : dit clairement que l’IA locale n’est pas active', async () => {
    const status = structuredClone(READY_STATUS);
    status.engine = { ready: false, local: false, label: 'Serveur d’IA distant' };
    const engine = new FakeEngine(engineState('connected', { status }));
    const view = await mountCard(engine);
    expect(view.status().textContent).toContain(defaultMessage('LOCAL_ENGINE_REMOTE'));
    expect(button(view.card(), /Ouvrir Magistra/)).not.toBeNull();
  });

  it('application occupée : simple information, aucune action exigée', async () => {
    const engine = new FakeEngine(engineState('connected', { status: { ...structuredClone(READY_STATUS), busy: true } }));
    const view = await mountCard(engine);
    expect(view.status().textContent).toContain('Une génération est en cours dans l’application Magistra');
    expect(view.card().querySelectorAll('button')).toHaveLength(0);
  });

  it('serveur en ligne choisi alors que Magistra locale est prête : [Utiliser l’IA locale] (sans confirmation)', async () => {
    setEngineChoice('server');
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountCard(engine);
    expect(view.card().textContent).toContain('Vos générations utilisent actuellement le serveur en ligne.');
    await click(button(view.card(), 'Utiliser l’IA locale'));
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('local');
    expect(view.card().textContent).not.toContain('utilisent actuellement le serveur en ligne');
  });
});

describe('Carte Magistra locale — autorisation du navigateur', () => {
  it('à demander (appairé) : explication exacte puis [Rechercher Magistra…]', async () => {
    const engine = new FakeEngine(engineState('needs-permission', { paired: true, permission: 'prompt' }));
    const view = await mountCard(engine);
    expect(view.card().textContent).toContain('Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil : acceptez-la.');
    await click(button(view.card(), 'Rechercher Magistra…'));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });

  it('refusée : comment l’accorder (icône à gauche de l’adresse, « Applications sur l\'appareil » / « Réseau local »), puis Réessayer', async () => {
    const engine = new FakeEngine(engineState('permission-denied', {
      permission: 'denied', error: { code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: defaultMessage('LOCAL_NETWORK_PERMISSION_DENIED') },
    }));
    const view = await mountCard(engine);
    const text = view.card().textContent ?? '';
    expect(text).toContain('Votre navigateur bloque l’accès à l’application Magistra.');
    expect(text).toContain('icône à gauche de l’adresse');
    expect(text).toContain("« Applications sur l'appareil » (ou « Réseau local »)");
    expect(text).toContain('« Autoriser »');
    await click(button(view.card(), /Réessayer/));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });
});

describe('Carte Magistra locale — jamais d’adresse, de port ni de nom de moteur', () => {
  it('aucun état n’affiche « localhost », « 127.0.0.1 », un port ou « Ollama »', async () => {
    const leaky = { code: 'CONNECTOR_UNREACHABLE' as const, message: 'Rien sur http://127.0.0.1:47831 (localhost) — Ollama ?' };
    const states = [
      engineState('idle'), engineState('checking'), engineState('not-found'), engineState('not-found', { error: leaky }),
      engineState('found', { error: leaky }), engineState('pairing'), engineState('connected'), engineState('app-closed', { error: leaky }),
      engineState('needs-permission', { paired: true, permission: 'prompt' }), engineState('permission-denied', { permission: 'denied' }),
    ];
    for (const state of states) {
      const view = await mountCard(new FakeEngine(state));
      expect(view.card().textContent, state.kind).not.toMatch(FORBIDDEN_LOCAL_TEXT);
      expect(view.card().innerHTML, state.kind).not.toMatch(/127\.0\.0\.1|localhost/);
      cleanup();
    }
  });
});

describe('Tableau de bord', () => {
  async function mountDashboard(mode: 'web' | 'demo', engine: FakeEngine | null) {
    const store = new MemoryStore([], PROFILE_COLLEGE);
    const runtime = fakeRuntime(store, { mode, profile: PROFILE_COLLEGE });
    const view = await render(
      <RuntimeContext.Provider value={runtime}>
        <LocalEngineContext.Provider value={engine}>
          <MemoryRouter><DashboardPage /></MemoryRouter>
        </LocalEngineContext.Provider>
      </RuntimeContext.Provider>,
    );
    await flush();
    return view;
  }

  it('site web : carte « Magistra locale » ; démonstration ou sans contrôleur : aucune carte', async () => {
    const web = await mountDashboard('web', new FakeEngine(engineState('found')));
    expect(web.container.querySelector('[data-testid="local-engine-card"]')?.textContent).toContain('✓ Magistra trouvée');
    cleanup();
    const demo = await mountDashboard('demo', new FakeEngine(engineState('found')));
    expect(demo.container.querySelector('[data-testid="local-engine-card"]')).toBeNull();
    cleanup();
    const none = await mountDashboard('web', null);
    expect(none.container.querySelector('[data-testid="local-engine-card"]')).toBeNull();
  });
});
