// @vitest-environment jsdom
// Choix du moteur (site web) : Magistra locale par défaut quand ce navigateur est appairé, sinon serveur en ligne ;
// seul un choix explicite change le moteur ; les abonnés (cet onglet, autres onglets) sont prévenus.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_CHOICE_STORAGE_KEY, getEngineChoice, resetEngineChoiceMemory, setEngineChoice, useEngineChoice, type EngineChoice,
} from '@/lib/localConnector/engineChoice';
import { cleanup, render } from '../ui/helpers';

beforeEach(() => {
  localStorage.clear();
  resetEngineChoiceMemory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  resetEngineChoiceMemory();
});

describe('getEngineChoice / setEngineChoice', () => {
  it('sans choix enregistré : appairé → local, sinon serveur', () => {
    expect(getEngineChoice(true)).toBe('local');
    expect(getEngineChoice(false)).toBe('server');
  });

  it('choix explicite enregistré (clé « magistra_engine_choice ») : prioritaire, appairé ou non', () => {
    setEngineChoice('server');
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('server');
    expect(getEngineChoice(true)).toBe('server');
    setEngineChoice('local');
    expect(getEngineChoice(false)).toBe('local');
  });

  it('valeur illisible : ignorée (règle par défaut)', () => {
    localStorage.setItem(ENGINE_CHOICE_STORAGE_KEY, 'ollama');
    expect(getEngineChoice(true)).toBe('local');
    expect(getEngineChoice(false)).toBe('server');
    setEngineChoice('autre' as EngineChoice);
    expect(localStorage.getItem(ENGINE_CHOICE_STORAGE_KEY)).toBe('ollama');
  });

  it('stockage du navigateur refusé : le choix vaut pour la visite (mémoire)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    setEngineChoice('server');
    expect(getEngineChoice(true)).toBe('server');
  });
});

describe('useEngineChoice', () => {
  function Probe({ paired, onRender }: { paired: boolean; onRender: (choice: EngineChoice, set: (c: EngineChoice) => void) => void }) {
    const [choice, set] = useEngineChoice(paired);
    onRender(choice, set);
    return <p data-testid="choice">{choice}</p>;
  }

  it('suit l’appairage, le choix de cet onglet et celui des autres onglets', async () => {
    let setter: ((c: EngineChoice) => void) | null = null;
    const onRender = (_: EngineChoice, set: (c: EngineChoice) => void) => {
      setter = set;
    };
    const view = await render(<Probe paired={false} onRender={onRender} />);
    const text = () => view.container.textContent;
    expect(text()).toBe('server');
    await view.rerender(<Probe paired onRender={onRender} />);
    expect(text()).toBe('local');

    await act(async () => setter!('server'));
    expect(text()).toBe('server');

    // Autre onglet : évènement « storage ».
    await act(async () => {
      localStorage.setItem(ENGINE_CHOICE_STORAGE_KEY, 'local');
      window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_CHOICE_STORAGE_KEY, newValue: 'local' }));
    });
    expect(text()).toBe('local');

    // Autre onglet : stockage vidé.
    await act(async () => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(text()).toBe('local'); // appairé, sans choix : local
    await view.rerender(<Probe paired={false} onRender={onRender} />);
    expect(text()).toBe('server');
  });

  it('écouteur « storage » retiré quand plus aucun composant n’est abonné', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = await render(<Probe paired onRender={() => undefined} />);
    expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
    view.unmount();
    expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
  });
});
