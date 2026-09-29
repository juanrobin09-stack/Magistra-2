// @vitest-environment jsdom
// Page Générer du site web avec le client hybride RÉEL : le bandeau dit qui traitera la génération, Magistra locale non
// prête → panneau dédié, passage au serveur en ligne seulement après une confirmation qui nomme le prestataire, et
// JAMAIS de bascule silencieuse du local vers le serveur. Capacités relues quand le choix ou l'état local change.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMessage } from '@shared/errors';
import type { GenerationEvent } from '@shared/types';
import AIStatusBadge from '@/components/ai/AIStatusBadge';
import { APP_CLOSED_DETAIL, SEARCHING_TEXT, SITE_ACCESS_HINT } from '@/components/localEngine/texts';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import { CONNECTOR_PORTS } from '@shared/localConnector';
import { UNRECOGNIZED_BY_APP_MESSAGE } from '@/lib/localConnector/client';
import { createLocalEngineController } from '@/lib/localConnector/controller';
import { MemoryPairingStore } from '@/lib/localConnector/pairingStore';
import { fakeClock, FakeConnector } from '../localConnector/fakeConnector';
import { ENGINE_CHOICE_STORAGE_KEY, setEngineChoice } from '@/lib/localConnector/engineChoice';
import { LOCAL_CONNECTOR_NETWORK_NOTE, NETWORK_PRIVACY_NOTE } from '@/lib/generation/research';
import { LOCAL_PRIVACY_MESSAGE } from '@/lib/runtime/hybrid';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import GeneratePage, { ENGINE_CHANGED_NOTICE, LOCAL_PERMISSION_FIRST_NOTICE, LOCAL_PERMISSION_NOTICE } from '@/pages/GeneratePage';
import { button, cleanup, click, flush } from './helpers';
import {
  engineState, FakeEngine, FORBIDDEN_LOCAL_TEXT, mountWeb, OVH_INFO, READY_STATUS, RELEASE, resetEngineChoice, stubReleaseFetch,
} from './localEngineHelpers';

const PATH = '/app/generate?type=cours&sujet=La%20photosynth%C3%A8se';
const LOCAL_BANNER = 'IA locale — Vos contenus sont générés sur cet ordinateur.';
const REMOTE_BANNER = 'Cette génération sera traitée par OVHcloud AI Endpoints (serveur distant).';
const REMOTE_CONFIRM =
  'Cette génération sera traitée par OVHcloud AI Endpoints (serveur distant). Vos demandes et les extraits de vos documents quitteront cet ordinateur.';

const LOCAL_EVENTS: GenerationEvent[] = [
  { type: 'delta', text: '# La photosynthèse\n\nTexte.' },
  {
    type: 'done', content: '# La photosynthèse\n\nTexte.', sources: [], truncated: false, internetUsed: false, saved: false, model: 'magistra-standard',
    record: {
      type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'La photosynthèse', contenu: '# La photosynthèse\n\nTexte.', sources: [],
      params: { researchMode: 'documents' }, truncated: false, internetUsed: false, model: 'magistra-standard',
    },
  },
];

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
});

async function mountGenerate(engine: FakeEngine) {
  const view = await mountWeb(<GeneratePage />, engine, { path: PATH });
  const banner = () => view.container.querySelector<HTMLElement>('[data-testid="engine-banner"]')!;
  const panel = () => view.container.querySelector<HTMLElement>('[data-testid="local-not-ready"]');
  const submit = () => view.container.querySelector<HTMLButtonElement>('form[aria-label="Demande de génération"] button[type="submit"]')!;
  return { ...view, banner, panel, submit };
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
}

describe('Page Générer — Magistra locale', () => {
  it('connectée (appairé, sans choix enregistré) : bandeau « IA locale », génération locale, résultat enregistré, serveur jamais sollicité', async () => {
    const engine = new FakeEngine(engineState('connected'));
    engine.localGenerate.mockImplementation(async (_request, onEvent) => {
      for (const event of LOCAL_EVENTS) onEvent(structuredClone(event));
    });
    const view = await mountGenerate(engine);
    expect(view.banner().textContent).toContain(LOCAL_BANNER);
    expect(view.banner().getAttribute('aria-live')).toBe('polite');
    const privacy = view.container.querySelector('[aria-label="Confidentialité"]')!;
    expect(privacy.textContent).toContain(LOCAL_PRIVACY_MESSAGE);
    // Le résultat est enregistré dans l'historique en ligne : jamais « restent sur cet ordinateur ».
    expect(privacy.textContent).not.toContain('restent sur cet ordinateur');
    expect(view.panel()).toBeNull();

    await click(view.submit());
    await flush(8);
    expect(engine.localGenerate).toHaveBeenCalledTimes(1);
    expect(view.saveDraft).toHaveBeenCalledTimes(1);
    expect(view.server.generate).not.toHaveBeenCalled();
    expect(view.server.capabilities).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Enregistré dans l'historique");
  });

  it('recherche en ligne avec Magistra locale : faite depuis cet ordinateur par l’application (note exacte), jamais « restent sur cet ordinateur »', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountGenerate(engine);
    const privacy = () => view.container.querySelector<HTMLElement>('[aria-label="Confidentialité"]')!;
    expect(privacy().textContent).not.toContain(LOCAL_CONNECTOR_NETWORK_NOTE);
    await click(button(view.container.querySelector<HTMLElement>('[aria-labelledby="gen-research-title"]')!, /Sources académiques/));
    expect(privacy().textContent).toContain(LOCAL_PRIVACY_MESSAGE);
    expect(privacy().textContent).toContain(LOCAL_CONNECTOR_NETWORK_NOTE);
    expect(privacy().textContent).not.toContain(NETWORK_PRIVACY_NOTE);
    expect(privacy().textContent).not.toContain('restent sur cet ordinateur');
    expect(view.server.capabilities).not.toHaveBeenCalled();
  });

  it('sources de recherche sur le site : jamais « Fonctionne hors ligne » ni « SearXNG » ; réglages de l’application nommés', async () => {
    for (const state of [engineState('connected'), engineState('not-found')]) {
      const view = await mountGenerate(new FakeEngine(state));
      const research = view.container.querySelector<HTMLElement>('[aria-labelledby="gen-research-title"]')!;
      expect(research.textContent, state.kind).toContain('Aucune recherche externe.');
      expect(research.textContent, state.kind).not.toMatch(/hors ligne|searxng/i);
      if (state.kind === 'connected') expect(research.textContent).toContain('réglages de l’application Magistra (Windows)');
      cleanup();
    }
  });

  it('jamais appairé : bandeau du serveur en ligne qui nomme le prestataire, génération par le serveur', async () => {
    const engine = new FakeEngine(engineState('not-found'));
    const view = await mountGenerate(engine);
    expect(view.banner().textContent).toContain(REMOTE_BANNER);
    expect(view.panel()).toBeNull();
    await click(view.submit());
    await flush(8);
    expect(view.server.generate).toHaveBeenCalledTimes(1);
    expect(engine.localGenerate).not.toHaveBeenCalled();
  });

  it('choisie mais application fermée : panneau (cause, [Ouvrir Magistra] [Réessayer]) et JAMAIS de repli vers le serveur', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('app-closed'));
    const view = await mountGenerate(engine);
    const panel = view.panel()!;
    expect(panel.querySelector('h2')?.textContent).toBe('Magistra locale n’est pas prête');
    expect(panel.textContent).toContain(defaultMessage('CONNECTOR_UNREACHABLE'));
    // Le site ne distingue pas une application fermée d'un accès du site désactivé dans l'application : il le dit
    // (sans répéter « ouvrez Magistra », déjà dans la cause).
    expect(panel.textContent).toContain(SITE_ACCESS_HINT);
    expect(panel.textContent).not.toContain(APP_CLOSED_DETAIL);
    await click(button(panel, /Ouvrir Magistra/));
    expect(engine.openApp).toHaveBeenCalledTimes(1);
    await click(button(panel, /Réessayer/));
    expect(engine.detect).toHaveBeenCalledTimes(1);

    await click(view.submit());
    await flush(8);
    expect(engine.localGenerate).toHaveBeenCalledTimes(1);
    expect(view.server.generate).not.toHaveBeenCalled();
    expect(view.server.capabilities).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(defaultMessage('CONNECTOR_UNREACHABLE'));
    expect(view.banner().textContent).toContain(LOCAL_BANNER);
  });

  it('recherche lancée depuis le panneau (« Ouvrir Magistra », jusqu’à une minute) : le panneau reste, avec « Recherche… », « Utiliser le serveur en ligne… » et le focus', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('app-closed'));
    engine.openApp.mockImplementation(async () => {
      await engine.set(engineState('checking', { paired: true }));
    });
    const view = await mountGenerate(engine);
    const open = button(view.panel()!, /Ouvrir Magistra/)!;
    open.focus();
    await click(open);
    await flush(6);
    expect(engine.openApp).toHaveBeenCalledTimes(1);
    const panel = view.panel();
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain(SEARCHING_TEXT);
    // Une seule fois : la cause d'avant la recherche ne s'affiche pas en même temps.
    expect(panel!.textContent!.split(SEARCHING_TEXT)).toHaveLength(2);
    expect(panel!.textContent).not.toContain(defaultMessage('CONNECTOR_UNREACHABLE'));
    expect(button(panel!, 'Utiliser le serveur en ligne…')).not.toBeNull();
    // Le bouton utilisé a disparu : le focus va à la ligne d'état du panneau, jamais au début de la page.
    expect(document.activeElement).not.toBe(document.body);
    expect(panel!.contains(document.activeElement)).toBe(true);
    await engine.set(engineState('app-closed'));
    await flush(6);
    expect(view.panel()?.textContent).toContain(defaultMessage('CONNECTOR_UNREACHABLE'));
  });

  it('vérification au chargement de la page : aucun panneau « pas prête » fugitif avant le résultat', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('checking', { paired: true }));
    const view = await mountGenerate(engine);
    expect(view.panel()).toBeNull();
    await engine.set(engineState('connected'));
    await flush(6);
    expect(view.panel()).toBeNull();
  });

  it('navigateur sans autorisation « réseau local » (Firefox), jamais appairé, Magistra locale choisie : « Magistra trouvée » reste affichée et « Connecter » est proposé (vrai contrôleur)', async () => {
    setEngineChoice('local');
    const clock = fakeClock();
    const connector = new FakeConnector(clock.now).setPort(CONNECTOR_PORTS[0], 'magistra');
    const controller = createLocalEngineController({
      origin: 'https://magistra-2.vercel.app', fetch: connector.fetch as typeof fetch, store: new MemoryPairingStore(),
      openUrl: connector.openUrl, permission: async () => 'unsupported', now: clock.now, sleep: clock.sleep,
    });
    const kinds: string[] = [];
    controller.subscribe(() => kinds.push(controller.getSnapshot().kind));
    const view = await mountWeb(<GeneratePage />, controller, { path: PATH });
    await flush(6);
    const panel = () => view.container.querySelector<HTMLElement>('[data-testid="local-not-ready"]')!;
    // Aucune requête vers cet ordinateur sans action de l'enseignant.
    expect(connector.requests).toHaveLength(0);
    await click(button(panel(), "J'ai déjà Magistra : la rechercher"));
    await flush(12);
    expect(controller.getSnapshot().kind).toBe('found');
    expect(kinds.at(-1)).toBe('found');
    expect(panel().textContent).toContain('Connectez-la à ce navigateur : l’application vous demandera votre accord.');
    expect(button(panel(), 'Connecter Magistra locale')).not.toBeNull();
    expect(panel().textContent).not.toContain('Si Magistra est installée, ouvrez-la puis réessayez');
  });

  it('« Utiliser le serveur en ligne… » : confirmation explicite qui nomme le prestataire ; « Rester » ne change rien', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('app-closed'));
    const view = await mountGenerate(engine);
    await click(button(view.panel()!, 'Utiliser le serveur en ligne…'));
    expect(dialog()?.textContent).toContain(REMOTE_CONFIRM);
    // Focus initial sur « Rester sur Magistra locale » : une frappe réflexe ne vaut jamais accord pour le prestataire.
    expect(document.activeElement).toBe(button(dialog()!, 'Rester sur Magistra locale'));
    await click(button(dialog()!, 'Rester sur Magistra locale'));
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('local');
    expect(view.server.capabilities).not.toHaveBeenCalled();
    expect(view.panel()).not.toBeNull();

    await click(button(view.panel()!, 'Utiliser le serveur en ligne…'));
    await click(button(dialog()!, 'Utiliser le serveur en ligne'));
    await flush(6);
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('server');
    expect(view.server.capabilities).toHaveBeenCalled();
    expect(view.banner().textContent).toContain(REMOTE_BANNER);
    expect(view.panel()).toBeNull();
    // Le bouton utilisé a disparu avec le panneau : le focus va au bandeau (jamais perdu au début de la page).
    expect(document.activeElement).toBe(view.banner());
  });

  it('serveur choisi alors que Magistra locale est prête : rappel discret, [Utiliser l’IA locale] repasse au local sans confirmation', async () => {
    setEngineChoice('server');
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountGenerate(engine);
    expect(view.banner().textContent).toContain(REMOTE_BANNER);
    expect(view.container.textContent).toContain('Magistra locale est disponible');
    const refreshesBefore = engine.refresh.mock.calls.length;
    const useLocal = button(view.container, 'Utiliser l’IA locale')!;
    useLocal.focus();
    await click(useLocal);
    await flush(6);
    // Le rappel (et le bouton utilisé) a disparu : le focus va au bandeau, qui annonce le nouveau moteur.
    expect(document.activeElement).toBe(view.banner());
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('local');
    expect(dialog()).toBeNull();
    expect(view.banner().textContent).toContain(LOCAL_BANNER);
    // Capacités relues pour Magistra locale (le client hybride relit son état).
    expect(engine.refresh.mock.calls.length).toBeGreaterThan(refreshesBefore);
    expect(view.container.textContent).not.toContain('Magistra locale est disponible');
  });

  it('capacités relues quand l’état de Magistra locale change : panneau → prête', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('app-closed'));
    const view = await mountGenerate(engine);
    expect(view.panel()).not.toBeNull();
    await engine.set(engineState('connected'));
    await flush(6);
    expect(view.panel()).toBeNull();
    expect(view.submit().disabled).toBe(false);
    expect(view.submit().textContent).toContain('Générer : ');

    // Moteur de l'application devenu non prêt : la cause précise remonte, sans nom de moteur ni adresse.
    const status = structuredClone(READY_STATUS);
    status.engine = { ready: false, local: true, label: 'Magistra Standard', notReady: { code: 'ENGINE_OUTDATED', message: defaultMessage('ENGINE_OUTDATED') } };
    await engine.set(engineState('connected', { status }));
    await flush(6);
    expect(view.panel()?.textContent).toContain('Le moteur d’intelligence artificielle de Magistra doit être mis à jour');
    expect(view.container.textContent).not.toMatch(FORBIDDEN_LOCAL_TEXT);
  });

  it('autorisation du navigateur à demander : génération bloquée (aucune demande sans explication), [Rechercher Magistra…]', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('needs-permission', { paired: true, permission: 'prompt' }));
    const view = await mountGenerate(engine);
    expect(view.panel()?.textContent).toContain('Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil');
    expect(view.submit().disabled).toBe(true);
    expect(view.container.querySelector('#gen-submit-status')?.textContent).toBe(LOCAL_PERMISSION_NOTICE);
    const form = view.container.querySelector('form[aria-label="Demande de génération"]')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(engine.localGenerate).not.toHaveBeenCalled();
    expect(view.server.generate).not.toHaveBeenCalled();
    await click(button(view.panel()!, 'Rechercher Magistra…'));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });

  it('appairé, autorisation du navigateur toujours à demander dans un autre état (« fermée » après une demande sans réponse) : génération bloquée', async () => {
    setEngineChoice('local');
    const engine = new FakeEngine(engineState('app-closed', { paired: true, permission: 'prompt' }));
    const view = await mountGenerate(engine);
    expect(view.submit().disabled).toBe(true);
    expect(view.container.querySelector('#gen-submit-status')?.textContent).toBe(LOCAL_PERMISSION_FIRST_NOTICE);
    const form = view.container.querySelector('form[aria-label="Demande de génération"]')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(engine.localGenerate).not.toHaveBeenCalled();
    // Les boutons de Magistra locale passent, eux, par l'explication avant la demande du navigateur.
    await click(button(view.panel()!, /Réessayer/));
    expect(engine.detect).not.toHaveBeenCalled();
    expect(view.panel()!.textContent).toContain('Votre navigateur va vous demander l’autorisation');
  });

  it('moteur changé juste avant l’envoi (appairage retiré dans un autre onglet) : rien n’est envoyé, l’enseignant est prévenu', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountGenerate(engine);
    expect(view.banner().textContent).toContain(LOCAL_BANNER);
    engine.paired = false; // magasin modifié ailleurs, état de cet onglet pas encore relu
    await click(view.submit());
    await flush(6);
    expect(engine.localGenerate).not.toHaveBeenCalled();
    expect(view.server.generate).not.toHaveBeenCalled();
    expect(view.container.querySelector('#gen-submit-status')?.textContent).toBe(ENGINE_CHANGED_NOTICE);
    expect(engine.refresh).toHaveBeenCalled();
  });

  it('« Réessayer » et « Recommencer » : mêmes garde-fous que l’envoi (autorisation du navigateur expliquée d’abord, moteur revérifié)', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountGenerate(engine);
    const status = () => view.container.querySelector('#gen-submit-status')?.textContent;
    await click(view.submit());
    await flush(8);
    expect(engine.localGenerate).toHaveBeenCalledTimes(1);
    const alert = () => view.container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert().textContent).toContain(defaultMessage('CONNECTOR_UNREACHABLE'));
    // Tout est en ordre : la relance part, vers le moteur annoncé.
    await click(button(alert(), /Réessayer/));
    await flush(8);
    expect(engine.localGenerate).toHaveBeenCalledTimes(2);

    // Autorisation du navigateur à redemander : la relance n'envoie rien (aucune demande sans explication).
    await engine.set(engineState('needs-permission', { paired: true, permission: 'prompt' }));
    await flush(6);
    await click(button(alert(), /Réessayer/));
    await flush(6);
    expect(engine.localGenerate).toHaveBeenCalledTimes(2);
    expect(status()).toBe(LOCAL_PERMISSION_NOTICE);

    // Appairage oublié dans un autre onglet (état de cet onglet pas encore relu) : moteur revérifié, rien n'est envoyé.
    await engine.set(engineState('connected'));
    await flush(6);
    engine.paired = false;
    await click(button(view.container, /Recommencer/));
    await flush(6);
    expect(engine.localGenerate).toHaveBeenCalledTimes(2);
    expect(view.server.generate).not.toHaveBeenCalled();
    expect(status()).toBe(ENGINE_CHANGED_NOTICE);
  });

  it('appairage pas encore vérifié : « Vérification du moteur de génération… », bouton désactivé', async () => {
    const engine = new FakeEngine(engineState('idle', { permission: 'unsupported' }));
    const view = await mountGenerate(engine);
    expect(view.banner().textContent).toContain('Vérification du moteur de génération…');
    expect(view.submit().disabled).toBe(true);
    await engine.set(engineState('not-found'));
    await flush(4);
    expect(view.banner().textContent).toContain(REMOTE_BANNER);
    expect(view.submit().disabled).toBe(false);
  });

  it('jamais « localhost », « 127.0.0.1 » ni « Ollama », même si un message en contient', async () => {
    setEngineChoice('local');
    const leaky = { code: 'CONNECTOR_UNREACHABLE' as const, message: 'Connexion refusée sur http://127.0.0.1:47831 (Ollama, localhost)' };
    for (const state of [engineState('app-closed', { error: leaky }), engineState('found', { error: leaky }), engineState('not-found', { error: leaky })]) {
      const view = await mountGenerate(new FakeEngine(state));
      expect(view.container.textContent, state.kind).not.toMatch(FORBIDDEN_LOCAL_TEXT);
      cleanup();
    }
  });
});

describe('Page Générer — erreur d’une génération locale', () => {
  it('moteur qui ne démarre pas : cause affichée sans « Ollama », port ni chemin (texte neutre), jamais de repli', async () => {
    const engine = new FakeEngine(engineState('connected'));
    engine.localGenerate.mockImplementation(async (_request, onEvent) => {
      onEvent({
        type: 'error', code: 'ENGINE_NOT_RUNNING', retryable: true,
        message: 'Le moteur IA ne peut pas démarrer : le port 11434 est déjà utilisé (peut-être un autre Ollama). Un antivirus bloque peut-être Ollama (ollama.exe).',
      });
    });
    const view = await mountGenerate(engine);
    await click(view.submit());
    await flush(8);
    const alert = view.container.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('Le moteur d’intelligence artificielle de Magistra n’est pas démarré');
    expect(view.container.textContent).not.toMatch(FORBIDDEN_LOCAL_TEXT);
    expect(view.container.textContent).not.toMatch(/port 11434/);
    expect(view.server.generate).not.toHaveBeenCalled();
  });
});

describe('Pastille de la barre latérale (site web)', () => {
  it('Magistra locale choisie : son état (jamais « serveur ») ; serveur choisi : état du serveur', async () => {
    const engine = new FakeEngine(engineState('connected'));
    const view = await mountWeb(<AIStatusBadge />, engine);
    expect(view.container.querySelector('a')?.textContent).toContain('Magistra locale');
    expect(view.container.textContent).not.toMatch(/serveur/i);
    await engine.set(engineState('app-closed'));
    expect(view.container.querySelector('a')?.textContent).toContain('Magistra locale fermée');
    // L'application vient de répondre : jamais « fermée ».
    await engine.set(engineState('app-closed', { error: { code: 'CONNECTOR_UNPAIRED', message: UNRECOGNIZED_BY_APP_MESSAGE } }));
    expect(view.container.querySelector('a')?.textContent).toContain('Magistra locale non reconnue');
    await engine.set(engineState('app-closed', { error: { code: 'CONNECTOR_PAIRING_REFUSED', message: defaultMessage('CONNECTOR_PAIRING_REFUSED') } }));
    expect(view.container.querySelector('a')?.textContent).toContain('Magistra locale indisponible');

    await act(async () => setEngineChoice('server'));
    await flush(6);
    expect(view.container.querySelector('a')?.textContent).toContain('Serveur IA disponible');
    expect(view.server.capabilities).toHaveBeenCalled();
  });
});
