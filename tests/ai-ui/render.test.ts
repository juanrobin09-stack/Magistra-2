// Rendu serveur (react-dom/server) des composants de choix du modèle, avec un état factice.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EngineSetupPanel from '@/components/ai/EngineSetupPanel';
import ModelSetupPanel from '@/components/ai/ModelSetupPanel';
import SetupChecklist from '@/components/ai/SetupChecklist';
import TierPicker from '@/components/ai/TierPicker';
import { MagistraError } from '@shared/errors';
import { ENGINE_STARTING_MESSAGE } from '@shared/ipc';
import { PROXY_RESTART_MESSAGE } from '../../electron/ollamaSetup';
import type { AIController } from '@/hooks/useAIStatus';
import { EMPTY_PROGRESS, type AIProgressState } from '@/lib/ai-ui/progress';
import { setupChecks } from '@/lib/ai-ui/status';
import { makeStatus } from './fixtures';

/** Rendu HTML, espaces insécables remplacées par des espaces ordinaires (lisibilité des attentes). */
function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element).replace(/\u00a0/g, ' ');
}

/** Balise <input> du niveau demandé. */
function radioFor(html: string, tier: string): string {
  const match = new RegExp(`<input[^>]*value="${tier}"[^>]*>`).exec(html);
  if (!match) throw new Error(`bouton radio ${tier} introuvable`);
  return match[0];
}

/** Badge d'adéquation (et non un mot de la description). */
function badge(label: string): RegExp {
  return new RegExp(`<span class="badge[^"]*">${label}</span>`);
}

/** Carte (label) du niveau demandé. */
function cardFor(html: string, tier: string): string {
  const match = new RegExp(`<label[^>]*data-tier="${tier}"[\\s\\S]*?</label>`).exec(html);
  if (!match) throw new Error(`carte ${tier} introuvable`);
  return match[0];
}

describe('TierPicker (carte de choix du modèle)', () => {
  // Ordinateur de 16 Go sans carte graphique : Standard recommandé, Qualité déconseillé.
  const status = makeStatus({ engine: 'running', installed: [] });
  const html = render(createElement(TierPicker, { tiers: status.tiers, selected: 'standard', onSelect: () => undefined }));

  it('présente les trois niveaux sans nom technique', () => {
    expect(html).toContain('Magistra Léger');
    expect(html).toContain('Magistra Standard');
    expect(html).toContain('Magistra Qualité');
    expect(html).not.toMatch(/ministral|mistral-small|Mistral AI|Apache/i);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
  });

  it('indique la taille de téléchargement de chaque niveau', () => {
    expect(cardFor(html, 'leger')).toContain('Téléchargement : 6 Go');
    expect(cardFor(html, 'standard')).toContain('Téléchargement : 9 Go');
    expect(cardFor(html, 'qualite')).toContain('Téléchargement : 15 Go');
  });

  it('badge Recommandé sur le niveau conseillé, Déconseillé avec explication sur le niveau trop lourd', () => {
    expect(cardFor(html, 'standard')).toMatch(badge('Recommandé'));
    expect(cardFor(html, 'standard')).toContain('badge badge-success');
    expect(cardFor(html, 'leger')).toMatch(badge('Adapté'));
    expect(cardFor(html, 'leger')).not.toMatch(badge('Recommandé'));
    const qualite = cardFor(html, 'qualite');
    expect(qualite).toMatch(badge('Déconseillé'));
    expect(qualite).toContain('32 Go de mémoire nécessaires, cet ordinateur en a 16 Go');
    expect(qualite).toContain('text-danger');
  });

  it('coche le niveau choisi (radio natif, accessible au clavier)', () => {
    expect(radioFor(html, 'standard')).toContain('checked');
    expect(radioFor(html, 'leger')).not.toContain('checked');
    expect(radioFor(html, 'qualite')).not.toContain('checked');
    expect(html).toContain('<legend class="sr-only">');
  });

  it('signale les niveaux installés et le niveau utilisé', () => {
    const s = makeStatus({ engine: 'running', installed: ['leger'], selectedTier: 'leger' });
    const out = render(createElement(TierPicker, {
      tiers: s.tiers, selected: 'leger', currentTier: 'leger', onSelect: () => undefined,
    }));
    const leger = cardFor(out, 'leger');
    expect(leger).toMatch(badge('Installé'));
    expect(leger).toMatch(badge('Utilisé actuellement'));
    expect(leger).toContain('Déjà installé (6 Go)');
    expect(cardFor(out, 'standard')).not.toMatch(badge('Installé'));
  });

  it('ordinateur modeste : Léger recommandé, Standard et Qualité déconseillés', () => {
    const s = makeStatus({ hardware: { totalRamGB: 8 } });
    const out = render(createElement(TierPicker, { tiers: s.tiers, selected: s.recommendation.tier, onSelect: () => undefined }));
    expect(cardFor(out, 'leger')).toMatch(badge('Recommandé'));
    expect(cardFor(out, 'standard')).toMatch(badge('Déconseillé'));
    expect(cardFor(out, 'standard')).not.toMatch(badge('Recommandé'));
    expect(cardFor(out, 'qualite')).toMatch(badge('Déconseillé'));
    expect(radioFor(out, 'leger')).toContain('checked');
  });

  it('désactive le choix pendant un enregistrement', () => {
    const out = render(createElement(TierPicker, { tiers: status.tiers, selected: 'standard', onSelect: () => undefined, disabled: true }));
    expect(out).toMatch(/<fieldset[^>]*disabled/);
  });
});

describe('SetupChecklist', () => {
  it('affiche les vérifications en cours tant que l’état est inconnu', () => {
    const html = render(createElement(SetupChecklist, { checks: null, revealed: 0 }));
    expect(html).toContain('Moteur IA installé');
    expect(html).toContain('vérification en cours');
    expect(html).toContain('role="status"');
  });

  it('affiche le résultat de chaque vérification, lisible par les lecteurs d’écran', () => {
    const checks = setupChecks(makeStatus({ engine: 'installed_stopped' }));
    const html = render(createElement(SetupChecklist, { checks, revealed: checks.length }));
    expect(html).toContain('Vérification terminée.');
    expect(html).toContain('Moteur IA en marche');
    expect(html).toMatch(/Moteur IA installé<\/span><span class="sr-only"> : oui/);
    expect(html).toMatch(/Moteur IA en marche<\/span><span class="sr-only"> : non/);
  });
});

/** Contrôleur factice : état fixe, actions sans effet. */
function fakeController(
  status: ReturnType<typeof makeStatus>,
  progress: AIProgressState = EMPTY_PROGRESS,
  extra: Partial<Pick<AIController, 'errors' | 'engineUpdate' | 'pending'>> = {},
): AIController {
  const noop = async () => undefined;
  return {
    status,
    progress,
    errors: extra.errors ?? {},
    ...(extra.engineUpdate !== undefined ? { engineUpdate: extra.engineUpdate } : {}),
    pending: extra.pending ?? { status: false, engine: false, start: false, model: false, config: false },
    manualInstall: false,
    loadedAt: 1,
    refresh: async () => status,
    installEngine: noop,
    cancelEngineInstall: noop,
    openEngineDownload: noop,
    startEngine: async () => true,
    installTier: noop,
    selectTier: async () => ({ status, error: null }),
    cancelPull: noop,
    setConfig: async () => ({ status, error: null }),
    clearError: () => undefined,
  };
}

describe('ModelSetupPanel (assistant de premier démarrage)', () => {
  const status = makeStatus({ engine: 'running', installed: [] });

  it('présente l’ordinateur, la recommandation et un bouton d’installation explicite', () => {
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status), status, variant: 'setup' }));
    expect(html).toContain('Votre ordinateur');
    expect(html).toContain('Intel Core i7-1165G7 (8 cœurs)');
    expect(html).toContain('Ordinateur correct : Magistra Standard est recommandé.');
    expect(html).toMatch(/<button[^>]*>.*Installer Magistra Standard<\/button>/);
    expect(html).toContain('Téléchargement de 9 Go, une seule fois.');
    expect(html).not.toMatch(/ministral|mistral-small/i);
    expect(html).not.toContain('role="progressbar"');
  });

  it('pendant le téléchargement : barre de progression accessible et bouton Annuler', () => {
    const progress: AIProgressState = {
      engine: null,
      model: { stage: 'pull', model: 'ministral-3:14b', tier: 'standard', status: 'pulling 6a07', completedMB: 3100, totalMB: 9216, percent: 33 },
    };
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress), status, variant: 'setup' }));
    expect(html).toContain('Téléchargement de Magistra Standard');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="33"/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('3 Go sur 9 Go');
    expect(html).toContain('Annuler le téléchargement');
    expect(html).not.toContain('Installer Magistra Standard');
  });

  it('après une interruption : « Reprendre » remplace le bouton d’installation', () => {
    const progress: AIProgressState = {
      engine: null,
      model: { stage: 'cancelled', model: 'ministral-3:14b', tier: 'standard', percent: 33 },
    };
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress), status, variant: 'setup' }));
    expect(html).toContain('interrompu à 33 %');
    expect(html).toContain('Reprendre le téléchargement');
    expect(html).not.toMatch(/<button[^>]*>.*Installer Magistra Standard<\/button>/);
  });

  it('erreur : message clair (role="alert") et reprise', () => {
    const progress: AIProgressState = {
      engine: null,
      model: { stage: 'error', model: 'ministral-3:14b', tier: 'standard', message: 'Connexion perdue pendant le téléchargement.' },
    };
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress), status, variant: 'setup' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Connexion perdue pendant le téléchargement.');
    expect(html).toContain('Reprendre le téléchargement');
  });

  it('réglages : le niveau utilisé est signalé, sans bouton inutile', () => {
    const ready = makeStatus({ engine: 'running', installed: ['standard'] });
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(ready), status: ready, variant: 'settings' }));
    expect(html).not.toContain('Votre ordinateur');
    expect(html).toMatch(badge('Utilisé actuellement'));
    expect(html).not.toContain('Installer Magistra Standard');
  });
});

describe('EngineSetupPanel (moteur IA absent ou arrêté)', () => {
  const missing = makeStatus({ engine: 'not_installed', installed: [] });

  it('Windows : consentement avec la taille AVANT tout téléchargement, puis bouton explicite', () => {
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(missing), status: missing }));
    expect(html).toContain('Avant de commencer');
    expect(html).toMatch(/Téléchargement<\/dt><dd[^>]*>environ 1,1 Go<\/dd>/);
    expect(html).toMatch(/Espace disque nécessaire<\/dt><dd[^>]*>5 Go/);
    expect(html).toContain('Magistra Standard : 9 Go');
    expect(html).toMatch(/<button[^>]*>.*Installer le moteur IA<\/button>/);
    expect(html).toContain('Ouvrir la page officielle d&#x27;installation');
    expect(html).toContain('Rien n&#x27;est téléchargé tant que vous n&#x27;avez pas cliqué.');
    expect(html).not.toContain('role="progressbar"');
  });

  it('taille réelle de l’installateur quand elle est connue', () => {
    const known = { ...missing, engineDownload: { ...missing.engineDownload, sizeMB: 1229 } };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(known), status: known }));
    expect(html).toMatch(/Téléchargement<\/dt><dd[^>]*>1,2 Go<\/dd>/);
  });

  it('hors Windows : pas d’installation automatique, seulement la page officielle', () => {
    const other = { ...missing, engineDownload: { ...missing.engineDownload, platformSupported: false } };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(other), status: other }));
    expect(html).not.toMatch(/<button[^>]*>.*Installer le moteur IA<\/button>/);
    expect(html).toContain('L&#x27;installation automatique n&#x27;est pas disponible sur ce système.');
    expect(html).toContain('Ouvrir la page officielle d&#x27;installation');
  });

  it('pendant le téléchargement : progression accessible et annulation possible', () => {
    const progress: AIProgressState = { engine: { stage: 'download', receivedMB: 300, totalMB: 1200 }, model: null };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(missing, progress), status: missing }));
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="25"/);
    expect(html).toContain('300 Mo sur 1,2 Go');
    expect(html).toContain('Annuler l&#x27;installation');
  });

  it('moteur installé mais arrêté : bouton « Démarrer le moteur IA », aucun téléchargement proposé', () => {
    const stopped = makeStatus({ engine: 'installed_stopped', installed: [] });
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(stopped), status: stopped }));
    expect(html).toContain('Démarrer le moteur IA');
    expect(html).not.toContain('Avant de commencer');
    expect(html).not.toMatch(/<button[^>]*>.*Installer le moteur IA<\/button>/);
    expect(html).not.toContain(ENGINE_STARTING_MESSAGE);
  });

  it('pendant le démarrage : « Démarrage… » et message d’attente (jusqu’à 2 minutes au premier lancement)', () => {
    const stopped = makeStatus({ engine: 'installed_stopped', installed: [] });
    const pending = { status: false, engine: false, start: true, model: false, config: false };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(stopped, EMPTY_PROGRESS, { pending }), status: stopped }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Démarrage…<\/button>/);
    expect(html).toContain('Le moteur IA démarre, cela peut prendre une minute au premier lancement…');
    expect(html).toMatch(/role="status"[^>]*>Le moteur IA démarre/);
  });
});

describe('EngineSetupPanel (moteur trop ancien)', () => {
  const outdated = makeStatus({ engine: 'running', installed: [], engineVersion: '0.12.3', outdated: true });

  it('message avec les versions et bouton « Mettre à jour le moteur IA » (taille annoncée, consentement)', () => {
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(outdated), status: outdated }));
    expect(html).toContain('Le moteur IA installé (version 0.12.3) est trop ancien pour ce modèle (version 0.13.1 minimum).');
    expect(html).toMatch(/<button[^>]*>.*Mettre à jour le moteur IA<\/button>/);
    expect(html).toMatch(/Téléchargement<\/dt><dd[^>]*>environ 1,1 Go<\/dd>/);
    expect(html).toContain('Rien n&#x27;est téléchargé tant que vous n&#x27;avez pas cliqué.');
    expect(html).not.toContain('Démarrer le moteur IA');
    expect(html).not.toContain('Reprendre le téléchargement');
  });

  it('installé par le service informatique : « demandez-lui », sans bouton', () => {
    const managed = makeStatus({ engine: 'running', installed: [], engineVersion: '0.12.3', outdated: true, managedByAdmin: true });
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(managed), status: managed }));
    expect(html).toContain('Ollama a été installé par le service informatique : demandez-lui de le mettre à jour');
    expect(html).not.toContain('Mettre à jour le moteur IA</button>');
    expect(html).not.toMatch(/<button/);
  });

  it('pendant l’installation : aucune « demande d’autorisation », fenêtre Ollama annoncée', () => {
    const missing = makeStatus({ engine: 'not_installed', installed: [] });
    const progress: AIProgressState = { engine: { stage: 'install', message: 'Installation du moteur IA…' }, model: null };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(missing, progress), status: missing }));
    expect(html).toContain('Une fenêtre Ollama peut s&#x27;ouvrir : vous pouvez la fermer, aucun compte n&#x27;est nécessaire.');
    expect(html).not.toMatch(/autorisation/);
  });

  it('pendant la mise à jour : titre « Mise à jour du moteur IA »', () => {
    const progress: AIProgressState = { engine: { stage: 'download', receivedMB: 100, totalMB: 1200 }, model: null };
    const html = render(createElement(EngineSetupPanel, { ai: fakeController(outdated, progress, { engineUpdate: true }), status: outdated }));
    expect(html).toContain('Mise à jour du moteur IA');
    expect(html).toContain('Annuler la mise à jour');
  });

  it('échec réseau de l’installation : conseil pour un proxy d’établissement', () => {
    const missing = makeStatus({ engine: 'not_installed', installed: [] });
    const ai = fakeController(missing, EMPTY_PROGRESS, { errors: { engine: new MagistraError('NETWORK_ERROR', 'Téléchargement impossible.') } });
    const html = render(createElement(EngineSetupPanel, { ai, status: missing }));
    expect(html).toContain('un proxy ou un filtrage peut bloquer le téléchargement');
  });
});

describe('ModelSetupPanel (erreur ENGINE_OUTDATED)', () => {
  const progress: AIProgressState = {
    engine: null,
    model: { stage: 'error', model: 'ministral-3:14b', tier: 'standard', message: 'Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour.' },
  };
  const errors = { model: new MagistraError('ENGINE_OUTDATED') };

  it('jamais « Reprendre le téléchargement » : mise à jour du moteur proposée', () => {
    const status = makeStatus({ engine: 'running', installed: [] });
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress, { errors }), status, variant: 'setup' }));
    expect(html).toContain('Le moteur IA doit d&#x27;abord être mis à jour.');
    expect(html).toContain('trop ancien pour ce modèle');
    expect(html).not.toContain('Reprendre le téléchargement');
    expect(html).toMatch(/<button[^>]*>.*Mettre à jour le moteur IA<\/button>/);
  });

  it('moteur géré par le service informatique : message, sans bouton de mise à jour', () => {
    const status = makeStatus({ engine: 'running', installed: [], managedByAdmin: true });
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress, { errors }), status, variant: 'setup' }));
    expect(html).toContain('demandez-lui de le mettre à jour');
    expect(html).not.toContain('Mettre à jour le moteur IA</button>');
    expect(html).not.toContain('Reprendre le téléchargement');
  });

  it('erreur réseau du téléchargement : reprise possible et conseil proxy', () => {
    const status = makeStatus({ engine: 'running', installed: [] });
    const net = { model: new MagistraError('NETWORK_ERROR', 'Connexion perdue pendant le téléchargement.') };
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress, { errors: net }), status, variant: 'setup' }));
    expect(html).toContain('Reprendre le téléchargement');
    expect(html).toContain('registry.ollama.ai');
  });

  it('proxy d’établissement ignoré par le moteur : le message annonce la relance, sans conseil contradictoire', () => {
    const base = makeStatus({ engine: 'running', installed: [] });
    const status = { ...base, engine: { ...base.engine, proxyRestart: true } };
    // Message réel de l'application Windows (electron/ollamaSetup.ts) : il cite le bouton « Reprendre le téléchargement ».
    const net = { model: new MagistraError('NETWORK_ERROR', PROXY_RESTART_MESSAGE) };
    const html = render(createElement(ModelSetupPanel, { ai: fakeController(status, progress, { errors: net }), status, variant: 'setup' }));
    expect(html).toContain('vous autorisez Magistra à relancer le moteur IA avec le proxy');
    expect(html).toMatch(/<button[^>]*>.*Reprendre le téléchargement<\/button>/);
    expect(html).not.toContain('demandez au service informatique');
    expect(html).not.toContain('Vérifiez votre connexion Internet');
  });
});
