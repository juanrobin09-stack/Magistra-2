// @vitest-environment jsdom
// « Activer l'IA » (application Windows) : taille annoncée avant le clic, un clic → moteur puis modèle recommandé,
// progression unique, annulation (à tout moment), erreurs précises, reprise au lancement suivant (préférence
// aiSetupRequested) — jamais sans le clic initial, et une demande que l'on peut retirer après une erreur. Recours à
// la page officielle dans la même activation, focus et annonces pour le clavier et les lecteurs d'écran, cas où
// l'activation ne s'applique pas (modèle personnalisé, moteur sur un autre ordinateur), réglages.
// Le magasin de l'IA (useAIStatus) est propre à chaque test (modules rechargés).

import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { RuntimeMode } from '@/lib/runtime/types';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import { PROXY_RESTART_MESSAGE } from '../../electron/ollamaSetup';
import { ENGINE_STARTING_MESSAGE } from '@shared/ipc';
import { ENGINE_WINDOW_DONE_NOTE, ENGINE_WINDOW_MANUAL_NOTE, ENGINE_WINDOW_NOTE } from '@/components/localEngine/texts';
import { hold, installFakeLocalAI, ipcError, removeFakeLocalAI, type FakeLocalAI } from './localAIHelpers';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  removeFakeLocalAI();
  vi.useRealTimers();
});

/** Texte lisible : espaces insécables remplacées par des espaces ordinaires. */
function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

/** Monte un élément dans le contexte d'exécution Windows (modules rechargés : magasin de l'IA neuf). */
async function mountLocal(build: (mods: { ActivateAICard: typeof import('@/components/ai/ActivateAICard').default }) => ReactElement, mode: RuntimeMode = 'local') {
  const { RuntimeContext } = await import('@/lib/runtime/context');
  const { default: ActivateAICard } = await import('@/components/ai/ActivateAICard');
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { mode, profile: PROFILE_COLLEGE })}>
      <MemoryRouter>{build({ ActivateAICard })}</MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush(4);
  return view;
}

async function mountCard(variant: 'dashboard' | 'generate' | 'setup' = 'dashboard') {
  return mountLocal(({ ActivateAICard }) => <ActivateAICard variant={variant} />);
}

async function settle(): Promise<void> {
  await flush(12);
}

function prefsWrites(fake: FakeLocalAI): string[] {
  return fake.log.filter(l => l.startsWith('prefs:'));
}

describe('Carte « Activer l’IA » : annonce avant le clic', () => {
  it('moteur absent : taille totale (moteur + modèle recommandé), durée indicative, rien de téléchargé avant le clic', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountCard();
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(card).not.toBeNull();
    expect(text(card)).toContain('Activez l’IA de Magistra sur cet ordinateur');
    expect(text(container.querySelector('[data-testid="activate-ai-size"]'))).toBe(
      'Environ 10,1 Go à télécharger en tout, une seule fois. (moteur IA : environ 1,1 Go · Magistra Standard : 9 Go)',
    );
    expect(text(card)).toContain('Durée indicative : environ 15 minutes avec la fibre');
    expect(text(card)).toContain('Rien n’est téléchargé avant votre clic.');
    const activate = button(container, /Activer l’IA/);
    expect(activate).not.toBeNull();
    // Le bouton est décrit par la taille (lecteurs d'écran).
    const describedBy = activate!.getAttribute('aria-describedby')!;
    expect(text(document.getElementById(describedBy))).toContain('10,1 Go');
    // Aucun nom technique imposé, aucune adresse ; le seul texte qui nomme le moteur est la note sur sa fenêtre.
    expect(text(card)).toContain(ENGINE_WINDOW_NOTE);
    expect(text(card).replace(ENGINE_WINDOW_NOTE, '')).not.toMatch(/Ollama|localhost|127\.0\.0\.1|ministral/i);
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(fake.spies.prefsSet).not.toHaveBeenCalled();
    // Options avancées : repliées sur la page de l'IA.
    expect(container.querySelector('a[href="/setup"]')).not.toBeNull();
  });

  it('modèle personnalisé absent (options avancées) : la vraie cause, jamais « il suffit de démarrer le moteur », jamais remplacé en un clic', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: ['standard'], customModel: 'llama3.1:8b' });
    const { container } = await mountCard();
    expect(container.querySelector('[data-testid="activate-ai"]')).toBeNull();
    const card = container.querySelector('[data-testid="activate-ai-blocked"]');
    expect(card?.querySelector('h2')?.textContent).toBe('L’intelligence artificielle n’est pas prête');
    expect(text(card)).toContain('Modèle llama3.1:8b non installé.');
    expect(text(card)).toContain('Un modèle personnalisé a été choisi dans les options avancées (llama3.1:8b)');
    expect(text(card)).not.toMatch(/il suffit de démarrer|restent sur cet ordinateur/);
    expect(button(container, /Activer l’IA/)).toBeNull();
    expect(card!.querySelector('a[href="/setup"]')).not.toBeNull();
    expect(fake.spies.setConfig).not.toHaveBeenCalled();
  });

  it('IA prête ou serveur IA distant : aucune carte', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const ready = await mountCard();
    expect(ready.container.querySelector('[data-testid="activate-ai"]')).toBeNull();
    cleanup();
    removeFakeLocalAI();
    vi.resetModules();
    installFakeLocalAI({ mode: 'remote', ready: false });
    const remote = await mountCard();
    expect(remote.container.querySelector('[data-testid="activate-ai"]')).toBeNull();
  });
});

describe('Un clic : enchaînement automatique', () => {
  it('demande mémorisée AVANT tout téléchargement, puis moteur, puis modèle recommandé ; IA prête → message, demande retirée', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.log).toEqual([
      'prefs:{"aiSetupRequested":true}',
      'installEngine',
      'pullModel:standard',
      'prefs:{"aiSetupRequested":false}',
    ]);
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(fake.status().ready).toBe(true);
    const ready = container.querySelector('[data-testid="activate-ai-ready"]');
    expect(text(ready)).toContain('L’IA de Magistra est prête.');
    expect(ready!.querySelector('a[href="/app/generate"]')).not.toBeNull();
    await click(container.querySelector('button[aria-label="Fermer le message"]'));
    expect(container.querySelector('[data-testid="activate-ai-ready"]')).toBeNull();
  });

  it('moteur arrêté, modèle déjà installé : démarrage seulement, aucun téléchargement', async () => {
    const fake = installFakeLocalAI({ engine: 'installed_stopped', installed: ['standard'], ready: false });
    const { container } = await mountCard();
    expect(text(container)).toContain('Aucun téléchargement : il suffit de démarrer le moteur IA.');
    // L'état « prêt » suit maintenant le moteur démarré.
    fake.options.ready = undefined;
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.spies.startEngine).toHaveBeenCalledOnce();
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('progression unique (étape, %, reste) puis Annuler : téléchargement arrêté, demande retirée, reprise possible', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    const bar = container.querySelector('[role="progressbar"][aria-label="Activation de l’IA"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('aria-valuenow')).toBe('22');
    expect(text(container)).toContain('Activation de l’IA de Magistra');
    expect(text(container)).toContain('reste 7 Go');
    expect(text(container)).toContain('Vous pouvez continuer à utiliser Magistra pendant ce temps.');
    expect(fake.prefs.aiSetupRequested).toBe(true);

    await click(button(container, /^\s*Annuler$/));
    await settle();
    expect(fake.spies.cancelPull).toHaveBeenCalledOnce();
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(text(container)).toContain('Activation interrompue.');
    const resume = button(container, /Reprendre l’activation/);
    expect(resume).not.toBeNull();

    fake.holdPull = null;
    await click(resume);
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledTimes(2);
    expect(fake.status().ready).toBe(true);
    expect(text(container.querySelector('[data-testid="activate-ai-ready"]'))).toContain('L’IA de Magistra est prête.');
  });

  it('« Annuler » : « Activation interrompue » annoncée seulement APRÈS le retrait de la demande (fermer Magistra ensuite ne relance rien)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.prefs.aiSetupRequested).toBe(true);

    // Écriture de la préférence ralentie (disque lent, antivirus) pendant l'annulation.
    fake.holdPrefs = hold();
    await click(button(container, /^\s*Annuler$/));
    await settle();
    expect(fake.spies.cancelPull).toHaveBeenCalledOnce();
    expect(fake.prefs.aiSetupRequested).toBe(true);
    expect(text(container)).not.toContain('Activation interrompue.');

    fake.holdPrefs.resolve();
    fake.holdPrefs = null;
    await settle();
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(text(container)).toContain('Activation interrompue.');
  });

  it('erreur précise (espace disque) : message du moteur, « Reprendre le téléchargement » ; la demande reste mémorisée', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.pullFailure = ipcError('STORAGE_ERROR', 'Espace disque insuffisant pour installer Magistra Standard : environ 10 Go nécessaires, 4 Go disponibles. Libérez de l’espace puis réessayez.');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    const alert = container.querySelector('[role="alert"]');
    expect(text(alert)).toContain('Le téléchargement du modèle d’IA n’a pas abouti.');
    expect(text(alert)).toContain('Espace disque insuffisant pour installer Magistra Standard');
    // Le téléchargement repart là où il s'est arrêté : même nom que dans les réglages.
    expect(button(container, /Reprendre le téléchargement/)).not.toBeNull();
    expect(button(container, /Réessayer/)).toBeNull();
    expect(fake.prefs.aiSetupRequested).toBe(true);
  });

  it('erreur réseau : conseil pour le réseau d’établissement (proxy, filtrage)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.pullFailure = ipcError('NETWORK_ERROR', 'Le téléchargement a été interrompu (connexion perdue).');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(text(container.querySelector('[role="alert"]'))).toContain('un proxy ou un filtrage peut bloquer le téléchargement');
  });

  it('proxy d’établissement ignoré par le moteur : le bouton porte le nom que cite le message, sans conseil contradictoire', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [], proxyRestart: true });
    // Message réel de l'application Windows (electron/ollamaSetup.ts) : il cite « Reprendre le téléchargement ».
    fake.pullFailure = ipcError('NETWORK_ERROR', PROXY_RESTART_MESSAGE);
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    const alert = text(container.querySelector('[role="alert"]'));
    expect(alert).toContain('vous autorisez Magistra à relancer le moteur IA avec le proxy');
    expect(alert).not.toContain('un proxy ou un filtrage peut bloquer le téléchargement');
    fake.options.proxyRestart = false;
    await click(button(container, /Reprendre le téléchargement/));
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledTimes(2);
    expect(fake.status().ready).toBe(true);
  });

  it('installation du moteur en échec → « Ouvrir la page officielle d’installation » (le libellé que cite le message) : même activation, attente sans faux « 100 % », moteur détecté → modèle téléchargé tout seul', async () => {
    // Vérification régulière du moteur (toutes les 3 s) : horloge simulée, qui avance aussi toute seule.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.engineFailure = ipcError('ENGINE_NOT_INSTALLED', 'L’installation automatique n’a pas abouti. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(text(alert)).toContain('L’installation du moteur IA n’a pas abouti.');
    // Le bouton porte exactement le nom que cite le message, et il est décrit par la taille annoncée.
    const official = button(alert!, /^\s*Ouvrir la page officielle d’installation$/);
    expect(official).not.toBeNull();
    expect(text(document.getElementById(official!.getAttribute('aria-describedby')!))).toContain('Magistra Standard : 9 Go');

    await click(official);
    await settle();
    expect(fake.spies.openEngineDownload).toHaveBeenCalledOnce();
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(text(card)).toContain('En attente de l’installation du moteur IA depuis sa page officielle…');
    // Rien n'est téléchargé par Magistra pendant cette attente : ni « 100 % », ni Go du téléchargement raté.
    expect(text(card)).not.toMatch(/\d+ %|Go sur/);
    expect(text(card)).toContain('Étape 1 sur 2');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fake.prefs.aiSetupRequested).toBe(true);

    // L'enseignant installe le moteur ; Magistra le détecte et poursuit toute seule avec le modèle.
    fake.options.engine = 'running';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(fake.spies.installEngine).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text(container.querySelector('[data-testid="activate-ai-ready"]'))).toContain('L’IA de Magistra est prête.');
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('arrêt à l’étape du moteur, puis moteur installé ailleurs : plus d’erreur périmée ; « Reprendre l’activation » télécharge le modèle', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.engineFailure = ipcError('ENGINE_NOT_INSTALLED', 'L’installation automatique n’a pas abouti.');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    // Moteur installé depuis la page de l'IA (hors activation) : détecté.
    fake.options.engine = 'running';
    await act(async () => {
      fake.emit({ kind: 'engine-ready', version: '0.34.4' });
    });
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text(container)).not.toContain('L’installation du moteur IA n’a pas abouti.');
    expect(text(container)).toContain('Le moteur IA fonctionne maintenant : reprenez l’activation pour télécharger Magistra Standard.');
    expect(button(container, /Réessayer/)).toBeNull();
    await click(button(container, /Reprendre l’activation/));
    await settle();
    expect(fake.spies.installEngine).toHaveBeenCalledOnce();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(fake.status().ready).toBe(true);
  });

  it('arrêt sur erreur : la carte dit que la demande reprendra au prochain lancement (jamais « rien avant votre clic ») ; « Ne pas reprendre » la retire', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.pullFailure = ipcError('NETWORK_ERROR', 'Le téléchargement a été interrompu (connexion perdue).');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.prefs.aiSetupRequested).toBe(true);
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(text(card)).not.toContain('Rien n’est téléchargé avant votre clic');
    expect(text(container.querySelector('[data-testid="activate-ai-requested"]')))
      .toContain('sans nouveau clic, Magistra reprendra l’activation à sa prochaine ouverture');

    await click(button(container, /Ne pas reprendre/));
    await settle();
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(text(container)).toContain('Activation interrompue.');
    expect(text(container)).toContain('Rien n’est téléchargé avant votre clic.');
    expect(container.querySelector('[data-testid="activate-ai-requested"]')).toBeNull();
    expect(button(container, /Reprendre l’activation/)).not.toBeNull();
  });

  it('modèle refusé par le registre (moteur trop ancien) : mise à jour du moteur annoncée avec sa taille, puis le modèle', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.pullFailure = ipcError('ENGINE_OUTDATED', 'Magistra Standard nécessite une version plus récente du moteur IA.');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    const alert = container.querySelector('[role="alert"]');
    expect(text(alert)).toContain('Le moteur IA doit d’abord être mis à jour.');
    expect(text(alert)).toContain('nécessite une version plus récente du moteur IA');
    // « Réessayer » seul échouerait de nouveau : la mise à jour du moteur est proposée, taille comprise.
    expect(button(container, /^\s*Réessayer$/)).toBeNull();
    expect(text(container.querySelector('[data-testid="activate-ai-size"]'))).toContain('moteur IA : environ 1,1 Go');
    expect(fake.spies.installEngine).not.toHaveBeenCalled();

    await click(button(container, /Mettre à jour le moteur IA et reprendre/));
    await settle();
    expect(fake.spies.installEngine).toHaveBeenCalledWith({ update: true });
    expect(fake.log.filter(l => !l.startsWith('prefs:'))).toEqual(['pullModel:standard', 'installEngine', 'pullModel:standard']);
    expect(fake.status().ready).toBe(true);
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });
});

describe('Annulation à tout moment', () => {
  it('« Annuler » pendant la préparation du téléchargement du modèle : il ne part pas (jamais plusieurs Go sans accord)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    // Le processus principal relit tout l'état pendant le changement de configuration : le téléchargement n'est pas
    // encore parti (l'annulation du processus principal n'aurait rien à arrêter).
    fake.holdConfig = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.spies.setConfig).toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(text(container)).toContain('Préparation du téléchargement du modèle…');

    await click(button(container, /^\s*Annuler$/));
    await settle();
    // Jamais une fausse étape « moteur » pendant l'arrêt.
    expect(text(container)).not.toContain('Installation du moteur IA');
    const config = fake.holdConfig;
    fake.holdConfig = null;
    config.resolve();
    await settle();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(fake.status().ready).toBe(false);
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(text(container)).toContain('Activation interrompue.');
    expect(button(container, /^\s*Annuler$/)).toBeNull();
  });

  it('« Annuler » pendant l’enregistrement de la demande (disque lent, antivirus) : rien ne démarre ensuite', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.holdPrefs = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    const write = fake.holdPrefs;
    fake.holdPrefs = null;
    await click(button(container, /^\s*Annuler$/));
    await settle();
    write.resolve();
    await settle();
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    // Écritures dans l'ordre (demande, puis retrait) : rien ne reprendra au prochain lancement.
    expect(prefsWrites(fake)).toEqual(['prefs:{"aiSetupRequested":true}', 'prefs:{"aiSetupRequested":false}']);
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(text(container)).toContain('Activation interrompue.');
  });
});

describe('Opération lancée hors activation', () => {
  it('page officielle ouverte depuis la page de l’IA, puis « Annuler » : arrêtée, sans « Activation interrompue » pour une activation jamais lancée', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { container, controller } = await mountWithController();
    await act(async () => {
      await controller().openEngineDownload();
    });
    await settle();
    expect(text(container)).toContain('En attente de l’installation du moteur IA depuis sa page officielle…');
    // Aucune activation : ni reprise promise au prochain lancement, ni étape « modèle » qui ne viendrait pas.
    expect(text(container)).not.toContain('reprendra à sa prochaine ouverture');
    expect(container.querySelector('ol[aria-label="Étapes de l’activation"]')).toBeNull();
    await click(button(container, /^\s*Annuler$/));
    await settle();
    expect(fake.spies.cancelEngineInstall).toHaveBeenCalledOnce();
    expect(text(container)).not.toContain('Activation interrompue');
    expect(button(container, /^\s*Activer l’IA$/)).not.toBeNull();
    expect(prefsWrites(fake)).toEqual([]);
  });
});

describe('Clavier et lecteurs d’écran', () => {
  it('la carte change sous le focus : son titre le reçoit (jamais perdu au début de la page) ; lancement, interruption et fin annoncés', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { container } = await mountCard();
    // Région toujours présente (jamais insérée déjà remplie), vide à l'arrivée sur la page.
    const region = container.querySelector('[data-testid="activate-ai-announcement"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(text(region)).toBe('');

    const activate = button(container, /Activer l’IA/)!;
    activate.focus();
    await click(activate);
    await settle();
    expect(container.querySelector('[data-testid="activate-ai-announcement"]')).toBe(region);
    expect(text(region)).toContain('Activation de l’IA lancée');
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('Activation de l’IA de Magistra');

    const cancel = button(container, /^\s*Annuler$/)!;
    cancel.focus();
    await click(cancel);
    await settle();
    expect(text(region)).toContain('Activation interrompue.');
    expect(document.activeElement?.textContent).toBe('Activez l’IA de Magistra sur cet ordinateur');

    // Reprise, puis fin du téléchargement avec le focus dans la carte : le message de fin le reçoit.
    fake.holdPull = null;
    const resume = button(container, /Reprendre l’activation/)!;
    resume.focus();
    await click(resume);
    await settle();
    expect(text(region)).toBe('L’IA de Magistra est prête.');
    expect(document.activeElement).toBe(container.querySelector('[data-testid="activate-ai-ready"]'));
  });

  it('focus ailleurs dans la page : jamais volé quand la carte change', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { container, controller } = await mountWithController();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      void controller().activate();
    });
    await settle();
    expect(text(container)).toContain('Activation de l’IA de Magistra');
    expect(document.activeElement).toBe(input);
    fake.holdPull.resolve();
    await settle();
    expect(document.activeElement).toBe(input);
  });
});

describe('Fenêtre d’Ollama pendant l’installation de l’IA (Windows)', () => {
  /** Notes « une fenêtre Ollama peut s'ouvrir » de la page. */
  const notes = (root: ParentNode) => Array.from(root.querySelectorAll('[data-testid="engine-window-note"]'));

  it('AVANT le clic : la note est à côté de la taille annoncée, décrit le bouton, et rien n’est téléchargé', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountCard();
    const [note, ...others] = notes(container);
    expect(others).toEqual([]);
    // Texte unique et région accessible : une note de la page (lue par les lecteurs d'écran), pas un message qui disparaît.
    expect(text(note)).toBe(ENGINE_WINDOW_NOTE);
    expect(note.getAttribute('role')).toBe('note');
    expect(note.hasAttribute('aria-live')).toBe(false);
    expect(note.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(note.hasAttribute('tabindex')).toBe(false);
    // Même bloc que la taille et la durée ; le bouton « Activer l'IA » en est décrit (annoncé avant le clic).
    const size = container.querySelector('[data-testid="activate-ai-size"]')!;
    expect(size.parentElement?.contains(note)).toBe(true);
    const activate = button(container, /Activer l’IA/)!;
    expect(text(document.getElementById(activate.getAttribute('aria-describedby')!))).toContain(ENGINE_WINDOW_NOTE);
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
  });

  it('PENDANT : téléchargement, installation et démarrage du moteur — la même note, une seule fois, sans bouton ni focus pris', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.holdEngine = hold();
    const { container } = await mountCard();
    const activate = button(container, /Activer l’IA/)!;
    activate.focus();
    await click(activate);
    await settle();
    // Téléchargement du moteur.
    expect(text(container)).toContain('Téléchargement du moteur IA…');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    // Le focus est rendu au titre de la carte (comportement existant), pas à la note.
    expect(document.activeElement?.tagName).toBe('H2');
    expect(notes(container)[0].contains(document.activeElement)).toBe(false);
    // Installateur officiel lancé.
    await act(async () => {
      fake.emit({ kind: 'engine-install', message: 'Installation du moteur IA en cours… (cela peut prendre quelques minutes)' });
    });
    expect(text(container)).toContain('Installation du moteur IA en cours…');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    // Démarrage du moteur par l'installateur.
    await act(async () => {
      fake.emit({ kind: 'engine-waiting', message: ENGINE_STARTING_MESSAGE });
    });
    expect(text(container)).toContain(ENGINE_STARTING_MESSAGE);
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    // Une note n'est ni cliquable ni dans la région vivante de progression (jamais annoncée en boucle).
    expect(notes(container)[0].closest('[role="status"], [aria-live]')).toBeNull();
    expect(notes(container)[0].querySelector('button, a, input')).toBeNull();
  });

  it('APRÈS : moteur installé, le modèle se télécharge — la fenêtre a pu rester ouverte (texte « si elle est encore ouverte »), puis sur le message de fin', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.holdEngine = hold();
    fake.holdPull = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);

    // Moteur prêt : l'étape du modèle commence ; l'explication d'avant (« peut s'ouvrir ») n'est plus vraie telle quelle.
    fake.holdEngine.resolve();
    await settle();
    expect(text(container)).toContain('Étape 2 sur 2');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_DONE_NOTE]);
    expect(text(container)).not.toContain(ENGINE_WINDOW_NOTE);

    // IA prête : le message de fin garde la mention (une fenêtre peut être restée ouverte).
    fake.holdPull.resolve();
    await settle();
    const ready = container.querySelector('[data-testid="activate-ai-ready"]')!;
    expect(text(ready)).toContain('L’IA de Magistra est prête.');
    expect(notes(ready).map(n => text(n))).toEqual([ENGINE_WINDOW_DONE_NOTE]);
    expect(notes(container)).toHaveLength(1);
    // Fermé : plus rien.
    await click(container.querySelector('button[aria-label="Fermer le message"]'));
    expect(notes(container)).toHaveLength(0);
  });

  it('mise à jour du moteur (Windows) : avant le clic et pendant l’installation', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [], outdated: true, engineVersion: '0.12.0' });
    fake.holdEngine = hold();
    const { container } = await mountCard();
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(fake.spies.installEngine).toHaveBeenCalledOnce();
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
  });

  it('page officielle (Windows, après l’échec de l’installation automatique) : l’enseignant lance LUI-MÊME l’installateur, la note dit de le terminer d’abord', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.engineFailure = ipcError('ENGINE_NOT_INSTALLED', 'L’installation automatique n’a pas abouti.');
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    await click(button(container.querySelector('[role="alert"]')!, /Ouvrir la page officielle d’installation/));
    await settle();
    expect(text(container)).toContain('En attente de l’installation du moteur IA depuis sa page officielle…');
    // Texte dédié (installateur à terminer, puis fenêtre de l'application à fermer), jamais « Fermez-la simplement » d'emblée.
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_MANUAL_NOTE]);
    expect(notes(container)[0].getAttribute('data-moment')).toBe('manual');
    expect(text(container)).not.toContain(ENGINE_WINDOW_NOTE);
    expect(text(container)).toContain('Terminez d’abord l’installation avec l’installateur d’Ollama (bouton « Terminer »)');
    // Le texte reste une note de page, comme les autres : ni région vivante, ni focus pris.
    expect(notes(container)[0].getAttribute('role')).toBe('note');
    expect(notes(container)[0].closest('[role="status"], [aria-live]')).toBeNull();
  });

  it('jamais : moteur déjà prêt, simple démarrage du moteur, modèle seul, serveur IA distant, moteur sur un autre ordinateur', async () => {
    const scenarios: [string, Parameters<typeof installFakeLocalAI>[0]][] = [
      ['IA prête', { engine: 'running', installed: ['standard'] }],
      ['moteur arrêté (Magistra le lance sans fenêtre)', { engine: 'installed_stopped', installed: ['standard'], ready: false }],
      ['moteur en marche, modèle à télécharger', { engine: 'running', installed: [] }],
      ['serveur IA distant', { mode: 'remote', ready: false }],
      ['moteur sur un autre ordinateur', { engine: 'unknown', installed: [], ollamaUrl: 'http://10.0.0.5:11434' }],
    ];
    for (const [name, options] of scenarios) {
      installFakeLocalAI(options);
      const { container } = await mountCard();
      expect(notes(container), name).toHaveLength(0);
      expect(text(container), name).not.toContain('Ollama');
      cleanup();
      removeFakeLocalAI();
      vi.resetModules();
    }
  });

  it('modèle seul pendant son téléchargement : aucune note (aucun installateur lancé), même à la fin', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { container } = await mountCard();
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(text(container)).toContain('Activation de l’IA de Magistra');
    expect(notes(container)).toHaveLength(0);
    fake.holdPull.resolve();
    await settle();
    expect(text(container.querySelector('[data-testid="activate-ai-ready"]'))).toContain('L’IA de Magistra est prête.');
    expect(notes(container)).toHaveLength(0);
  });

  it('hors Windows : jamais de note (l’installation se fait à la main depuis la page officielle), avant, pendant ni après', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = installFakeLocalAI({ engine: 'not_installed', platformSupported: false, hardware: { platform: 'linux' } });
    const { container } = await mountCard();
    expect(text(container)).toContain('le moteur IA s’installe depuis sa page officielle');
    expect(notes(container)).toHaveLength(0);
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(text(container)).toContain('En attente de l’installation du moteur IA depuis sa page officielle…');
    expect(notes(container)).toHaveLength(0);
    fake.options.engine = 'running';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await settle();
    expect(text(container.querySelector('[data-testid="activate-ai-ready"]'))).toContain('L’IA de Magistra est prête.');
    expect(notes(container)).toHaveLength(0);
    expect(text(container)).not.toContain('Ollama');
  });

  it('focus ailleurs dans la page : l’apparition de la note ne le déplace pas', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.holdEngine = hold();
    const { container, controller } = await mountWithController();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(notes(container)).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    await act(async () => {
      void controller().activate();
    });
    await settle();
    expect(text(container)).toContain('Activation de l’IA de Magistra');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    expect(document.activeElement).toBe(input);
    fake.holdEngine.resolve();
    await settle();
    expect(document.activeElement).toBe(input);
  });

  it('fenêtre rechargée pendant l’installateur : la note est de nouveau là', async () => {
    installFakeLocalAI({ engine: 'installed_stopped', installing: 'install', installed: [] }, { aiSetupRequested: true });
    const { container, controller } = await mountWithController();
    await act(async () => {
      void controller().resumeActivation();
    });
    await settle();
    expect(text(container)).toContain('Reprise de l’activation de l’IA');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
  });
});

/** Carte montée avec l'accès direct au magasin de l'IA (actions sans clic : lancement au démarrage, test du focus). */
async function mountWithController() {
  const { useAIStatus } = await import('@/hooks/useAIStatus');
  let controller: ReturnType<typeof useAIStatus> = null;
  function Probe() {
    controller = useAIStatus();
    return null;
  }
  const view = await mountLocal(({ ActivateAICard }) => (
    <>
      <Probe />
      <ActivateAICard variant="dashboard" />
    </>
  ));
  return { ...view, controller: () => controller! };
}

describe('Reprise au lancement suivant', () => {
  const mountWithResume = mountWithController;

  it('activation demandée lors d’une session précédente : reprise sans nouveau clic, une seule fois par lancement', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] }, { aiSetupRequested: true });
    fake.holdPull = hold();
    const { container, controller } = await mountWithResume();
    await act(async () => {
      void controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(text(container)).toContain('Reprise de l’activation de l’IA');
    // Rechargement de la fenêtre (même lancement) : rien n'est relancé.
    await act(async () => {
      await controller().resumeActivation();
    });
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    fake.holdPull.resolve();
    await settle();
    expect(fake.status().ready).toBe(true);
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('fenêtre rechargée pendant le téléchargement : l’enchaînement reprend, le téléchargement en cours est attendu (jamais relancé)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const before = await mountCard();
    await click(button(before.container, /Activer l’IA/));
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(fake.prefs.aiSetupRequested).toBe(true);

    // Rechargement : nouvelle page (modules rechargés), même processus principal (téléchargement toujours en cours).
    cleanup();
    vi.resetModules();
    const { container, controller } = await mountWithResume();
    await act(async () => {
      void controller().resumeActivation();
    });
    await settle();
    // Le processus principal refuse le doublon (AI_BUSY) : aucune erreur affichée, l'attente est visible.
    expect(fake.spies.pullModel).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text(container)).toContain('Reprise de l’activation de l’IA');
    await act(async () => {
      fake.emit({ kind: 'model-pull', tier: 'standard', model: 'ministral-3:14b', status: 'pulling', completedMB: 6144, totalMB: 9216 });
    });
    expect(container.querySelector('[role="progressbar"][aria-label="Activation de l’IA"]')?.getAttribute('aria-valuenow')).toBe('66');

    // Fin du téléchargement lancé avant le rechargement : l'IA est prête, sans second téléchargement.
    fake.holdPull.resolve();
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledTimes(2);
    expect(fake.status().ready).toBe(true);
    expect(text(container.querySelector('[data-testid="activate-ai-ready"]'))).toContain('L’IA de Magistra est prête.');
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('fenêtre rechargée pendant le téléchargement, « Annuler » avant tout évènement de progression : le téléchargement du processus principal est arrêté', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const before = await mountCard();
    await click(button(before.container, /Activer l’IA/));
    await settle();
    cleanup();
    vi.resetModules();
    const { container, controller } = await mountWithResume();
    await act(async () => {
      void controller().resumeActivation();
    });
    await settle();
    // Doublon refusé (AI_BUSY) : le téléchargement d'avant le rechargement est attendu ; aucun évènement reçu encore.
    expect(fake.spies.pullModel).toHaveBeenCalledTimes(2);
    expect(fake.spies.cancelPull).not.toHaveBeenCalled();
    await click(button(container, /^\s*Annuler$/));
    await settle();
    expect(fake.spies.cancelPull).toHaveBeenCalledOnce();
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(fake.status().ready).toBe(false);
    expect(text(container)).toContain('Activation interrompue.');
  });

  it('fenêtre rechargée pendant l’installateur du moteur (ancien moteur arrêté) : l’installation est attendue, l’ancien moteur n’est jamais démarré en parallèle', async () => {
    const fake = installFakeLocalAI({ engine: 'installed_stopped', installing: 'update', installed: [] }, { aiSetupRequested: true });
    const { container, controller } = await mountWithResume();
    await act(async () => {
      void controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.startEngine).not.toHaveBeenCalled();
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(text(container)).toContain('Mise à jour du moteur IA en cours…');
    expect(text(container)).not.toContain('Le moteur IA démarre');
    // L'installateur ne s'interrompt pas en cours de route (comme dans l'installation classique).
    expect(button(container, /^\s*Annuler$/)).toBeNull();

    // L'installateur a terminé et relancé le moteur : l'activation continue avec le modèle.
    fake.options = { ...fake.options, installing: undefined, engine: 'running' };
    await act(async () => {
      fake.emit({ kind: 'engine-ready', version: '0.34.4' });
    });
    await settle();
    expect(fake.spies.startEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(fake.status().ready).toBe(true);
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('moteur réglé sur un autre ordinateur (options avancées) : jamais « sur cet ordinateur » ; la demande mémorisée n’est pas relancée à chaque lancement', async () => {
    const fake = installFakeLocalAI({ engine: 'unknown', installed: [], ollamaUrl: 'http://10.0.0.5:11434' }, { aiSetupRequested: true });
    const { container, controller } = await mountWithResume();
    expect(container.querySelector('[data-testid="activate-ai"]')).toBeNull();
    const card = container.querySelector('[data-testid="activate-ai-blocked"]');
    expect(text(card)).toContain('le moteur IA d’un autre ordinateur (« 10.0.0.5:11434 »)');
    expect(text(card)).toContain('les données de génération sont transmises à cette machine');
    expect(text(container)).not.toMatch(/restent sur cet ordinateur|il suffit de démarrer|Activer l’IA/);
    await act(async () => {
      await controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.startEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('reprise automatique en échec (modèle) : la demande est retirée, aucun nouveau téléchargement au lancement suivant ; « Reprendre » reste proposé', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] }, { aiSetupRequested: true });
    fake.pullFailure = ipcError('NETWORK_ERROR', 'Le téléchargement a été interrompu (connexion perdue).');
    const { container, controller } = await mountWithResume();
    await act(async () => {
      await controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.pullModel).toHaveBeenCalledOnce();
    expect(text(container.querySelector('[role="alert"]'))).toContain('Le téléchargement du modèle d’IA n’a pas abouti.');
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(button(container, /Reprendre le téléchargement/)).not.toBeNull();
  });

  it('reprise automatique en échec (installation du moteur) : la demande est retirée', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' }, { aiSetupRequested: true });
    fake.engineFailure = ipcError('ENGINE_NOT_INSTALLED', 'L’installateur téléchargé ne correspond pas à l’empreinte officielle.');
    const { controller } = await mountWithResume();
    await act(async () => {
      await controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.installEngine).toHaveBeenCalledOnce();
    expect(fake.prefs.aiSetupRequested).toBe(false);
  });

  it('sans demande mémorisée : rien ne démarre au lancement (jamais sans le clic initial)', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { controller } = await mountWithResume();
    await act(async () => {
      await controller().resumeActivation();
    });
    await settle();
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(prefsWrites(fake)).toEqual([]);
  });

  it('reprise d’une activation déjà aboutie : aucun message, demande retirée', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: ['standard'] }, { aiSetupRequested: true });
    const { container, controller } = await mountWithResume();
    await act(async () => {
      await controller().resumeActivation();
    });
    await settle();
    expect(fake.prefs.aiSetupRequested).toBe(false);
    expect(container.querySelector('[data-testid="activate-ai-ready"]')).toBeNull();
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
  });
});

describe('Barre latérale : indicateur de progression', () => {
  it('pendant l’activation : « Installation de l’IA : N % » (progression globale)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    fake.holdPull = hold();
    const { default: AIStatusBadge } = await import('@/components/ai/AIStatusBadge');
    const { container } = await mountLocal(({ ActivateAICard }) => (
      <>
        <AIStatusBadge />
        <ActivateAICard variant="dashboard" />
      </>
    ));
    await click(button(container, /Activer l’IA/));
    await settle();
    const badge = container.querySelector('a[aria-label^="État de l\'intelligence artificielle"]');
    expect(text(badge)).toBe('○Installation de l’IA : 22 %');
    fake.holdPull.resolve();
    await settle();
    expect(text(badge)).toBe('●IA prête');
  });
});

describe('Tableau de bord', () => {
  async function mountDashboard(mode: RuntimeMode) {
    const { RuntimeContext } = await import('@/lib/runtime/context');
    const { default: DashboardPage } = await import('@/pages/DashboardPage');
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { mode, profile: PROFILE_COLLEGE })}>
        <MemoryRouter><DashboardPage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(6);
    return view;
  }

  it('application Windows, IA pas prête : carte « Activer l’IA » bien visible', async () => {
    installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountDashboard('local');
    expect(container.querySelector('[data-testid="activate-ai"] h2')?.textContent).toBe('Activez l’IA de Magistra sur cet ordinateur');
  });

  it('démonstration du site : jamais de carte d’activation', async () => {
    const { container } = await mountDashboard('demo');
    expect(container.querySelector('[data-testid="activate-ai"]')).toBeNull();
  });
});

describe('Réglages → Intelligence artificielle', () => {
  async function mountSettings() {
    const { RuntimeContext } = await import('@/lib/runtime/context');
    const { default: SettingsPage } = await import('@/pages/SettingsPage');
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { mode: 'local', profile: PROFILE_COLLEGE })}>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(8);
    return view;
  }

  it('moteur absent : la même activation en un clic que le tableau de bord (enchaînement jusqu’au modèle, demande mémorisée) — plus l’ancienne installation en plusieurs étapes', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountSettings();
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(card?.querySelector('h2')?.textContent).toBe('Activez l’IA de Magistra sur cet ordinateur');
    expect(text(container)).not.toContain('Étape suivante : téléchargement du modèle');
    expect(button(container, /^\s*Installer le moteur IA$/)).toBeNull();
    await click(button(card!, /Activer l’IA/));
    await settle();
    expect(fake.log).toEqual([
      'prefs:{"aiSetupRequested":true}',
      'installEngine',
      'pullModel:standard',
      'prefs:{"aiSetupRequested":false}',
    ]);
    expect(fake.status().ready).toBe(true);
  });

  it('moteur trop ancien, IA pas prête : l’activation (mise à jour comprise dans la taille) et la cause précise, versions comprises', async () => {
    installFakeLocalAI({ engine: 'running', installed: [], outdated: true, engineVersion: '0.12.0' });
    const { container } = await mountSettings();
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(text(card?.querySelector('[data-testid="activate-ai-size"]') ?? null)).toContain('moteur IA : environ 1,1 Go');
    expect(text(container)).toMatch(/Le moteur IA installé \(version 0\.12\.0\) est trop ancien pour ce modèle \(version \d+\.\d+\.\d+ minimum\)/);
  });

  it('moteur trop ancien alors que l’IA fonctionne : la mise à jour du moteur reste proposée à part (aucune activation à faire)', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'], outdated: true });
    const { container } = await mountSettings();
    expect(container.querySelector('[data-testid="activate-ai"]')).toBeNull();
    expect(button(container, /Mettre à jour le moteur IA/)).not.toBeNull();
  });
});

describe('Fenêtre d’Ollama : réglages et page de l’IA', () => {
  const notes = (root: ParentNode) => Array.from(root.querySelectorAll('[data-testid="engine-window-note"]'));

  async function mountPage(name: 'SettingsPage' | 'SetupPage') {
    const { RuntimeContext } = await import('@/lib/runtime/context');
    const mod = name === 'SettingsPage' ? await import('@/pages/SettingsPage') : await import('@/pages/SetupPage');
    const Page = mod.default;
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { mode: 'local', profile: PROFILE_COLLEGE })}>
        <MemoryRouter><Page /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(8);
    return view;
  }

  it('Réglages, moteur absent : la note est dans la carte « Activer l’IA » (une seule fois)', async () => {
    installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountPage('SettingsPage');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    expect(container.querySelector('[data-testid="activate-ai"]')?.contains(notes(container)[0])).toBe(true);
  });

  it('Réglages, moteur trop ancien alors que l’IA fonctionne : la note accompagne « Mettre à jour le moteur IA »', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'], outdated: true });
    const { container } = await mountPage('SettingsPage');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    expect(button(container, /Mettre à jour le moteur IA/)).not.toBeNull();
  });

  it('Réglages, IA prête : aucune note', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const { container } = await mountPage('SettingsPage');
    expect(notes(container)).toHaveLength(0);
  });

  it('page de l’IA : avant, pendant, puis sur « Intelligence artificielle prête » (la fenêtre a pu rester ouverte)', async () => {
    const fake = installFakeLocalAI({ engine: 'not_installed' });
    fake.holdEngine = hold();
    const { container } = await mountPage('SetupPage');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_NOTE]);
    fake.holdEngine.resolve();
    await settle();
    expect(text(container)).toContain('✓ Intelligence artificielle prête');
    expect(notes(container).map(n => text(n))).toEqual([ENGINE_WINDOW_DONE_NOTE]);
  });

  it('page de l’IA, modèle seul : « prête » sans note', async () => {
    installFakeLocalAI({ engine: 'running', installed: [] });
    const { container } = await mountPage('SetupPage');
    expect(notes(container)).toHaveLength(0);
    await click(button(container, /Activer l’IA/));
    await settle();
    expect(text(container)).toContain('✓ Intelligence artificielle prête');
    expect(notes(container)).toHaveLength(0);
  });
});
