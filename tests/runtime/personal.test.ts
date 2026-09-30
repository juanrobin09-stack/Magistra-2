// @vitest-environment jsdom
// Mode personnel : code d'accès lu dans le fragment « #acces=… », mémorisé (clé propre à l'origine),
// puis effacé de l'adresse.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  accessStorageKey, captureAccessFromUrl, clearAccessCode, initialAccessCode, loadAccessCode, normalizeAccessCode,
  resetCapturedAccessCode, splitAccessFragment,
} from '@/lib/runtime/personal';

const CODE = 'Zx7-kP2_qR9vT4mN8bL1cH6dJ3fG5sA0eW';

beforeEach(() => {
  localStorage.clear();
  resetCapturedAccessCode();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  localStorage.clear();
  resetCapturedAccessCode();
});

describe('splitAccessFragment', () => {
  it('extrait le code et garde le reste du fragment', () => {
    expect(splitAccessFragment(`#acces=${CODE}`)).toEqual({ code: CODE, rest: '' });
    expect(splitAccessFragment(`#section=2&acces=${CODE}`)).toEqual({ code: CODE, rest: 'section=2' });
    expect(splitAccessFragment('#token=abc')).toEqual({ code: 'abc', rest: '' });
    expect(splitAccessFragment('#section=2')).toEqual({ code: undefined, rest: 'section=2' });
  });

  it('garde les « + » d’un jeton base64 (pas de conversion en espace)', () => {
    expect(splitAccessFragment('#acces=ab+cd/ef==').code).toBe('ab+cd/ef==');
  });
});

describe('normalizeAccessCode', () => {
  it('accepte le code seul, « acces=… » ou le lien complet du terminal', () => {
    expect(normalizeAccessCode(`  ${CODE} `)).toBe(CODE);
    expect(normalizeAccessCode(`acces=${CODE}`)).toBe(CODE);
    expect(normalizeAccessCode(`http://127.0.0.1:5173/#acces=${CODE}`)).toBe(CODE);
  });

  it('refuse ce qui n’est pas un code plausible', () => {
    for (const bad of ['', 'court', 'http://127.0.0.1:5173/', 'avec des espaces dedans et encore', '<script>alert(1)</script>xxxxxx']) {
      expect(normalizeAccessCode(bad)).toBeNull();
    }
  });
});

describe('captureAccessFromUrl', () => {
  it('lit le code dans le fragment, le mémorise, puis l’efface de l’adresse', () => {
    history.replaceState({ marque: 1 }, '', `/app/generate?type=cours#acces=${CODE}`);
    expect(captureAccessFromUrl()).toBe(CODE);
    // Effacé de l'adresse (chemin et paramètres conservés, état de l'historique aussi).
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/app/generate');
    expect(location.search).toBe('?type=cours');
    expect(history.state).toEqual({ marque: 1 });
    // Mémorisé sous une clé propre à l'origine.
    expect(localStorage.getItem(accessStorageKey(location.origin))).toBe(CODE);
    expect(loadAccessCode()).toBe(CODE);
    expect(initialAccessCode()).toBe(CODE);
  });

  it('garde les autres éléments du fragment', () => {
    history.replaceState(null, '', `/#acces=${CODE}&vue=1`);
    captureAccessFromUrl();
    expect(location.hash).toBe('#vue=1');
  });

  it('code illisible : effacé de l’adresse, rien n’est mémorisé', () => {
    history.replaceState(null, '', '/#acces=%3Cscript%3E');
    expect(captureAccessFromUrl()).toBeNull();
    expect(location.hash).toBe('');
    expect(loadAccessCode()).toBeNull();
  });

  it('sans code dans l’adresse : rien ne change', () => {
    history.replaceState(null, '', '/app#section');
    expect(captureAccessFromUrl()).toBeNull();
    expect(location.hash).toBe('#section');
  });

  it('stockage indisponible : le code lu reste utilisable pour cette visite', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      history.replaceState(null, '', `/#acces=${CODE}`);
      expect(captureAccessFromUrl()).toBe(CODE);
      expect(initialAccessCode()).toBe(CODE);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('« Oublier le code » l’efface de ce navigateur', () => {
    history.replaceState(null, '', `/#acces=${CODE}`);
    captureAccessFromUrl();
    clearAccessCode();
    expect(loadAccessCode()).toBeNull();
  });
});
