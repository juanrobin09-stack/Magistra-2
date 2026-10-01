// @vitest-environment jsdom
// Brouillon de l'assistant d'accueil : seuls les champs du profil sont écrits, et tout ce qui est relu est revalidé
// comme à la saisie (champs connus, longueurs bornées, valeurs en liste blanche, propriétaire du brouillon).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOnboardingDraft, DRAFT_LIMITS, loadOnboardingDraft, ONBOARDING_DRAFT_KEY, saveOnboardingDraft, type ProfileDraft,
} from '@/lib/onboardingDraft';

const LAST_STEP = 4;

const DRAFT: ProfileDraft = {
  displayName: 'Mme Dupont',
  etablissement: 'Collège Victor Hugo',
  cycle: 'college',
  niveaux: ['6eme', '4eme'],
  matiereChoisie: 'svt',
  matiereSecondaire: 'mathematiques',
  discipline: 'Section européenne',
};

const stored = () => sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
const put = (value: unknown) => sessionStorage.setItem(ONBOARDING_DRAFT_KEY, typeof value === 'string' ? value : JSON.stringify(value));
/** Un brouillon valide dont on remplace certains champs (contenu altéré à la main dans le stockage). */
const tampered = (patch: Record<string, unknown>) => ({ owner: null, step: 2, ...DRAFT, ...patch });

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('Brouillon de l\'assistant d\'accueil — écriture', () => {
  it('écrit les champs du profil, l\'étape et le propriétaire, et rien d\'autre', () => {
    // Un objet portant des champs étrangers (jeton, clé…) n'en laisse aucun dans le stockage.
    saveOnboardingDraft('user_1', { ...DRAFT, token: 'jeton-secret', apiKey: 'sk-secret' } as ProfileDraft, 3);
    const raw = stored()!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      ['cycle', 'discipline', 'displayName', 'etablissement', 'matiereChoisie', 'matiereSecondaire', 'niveaux', 'owner', 'step'],
    );
    expect(raw).not.toContain('secret');
  });

  it('restitue les mêmes valeurs et la même étape', () => {
    saveOnboardingDraft(null, DRAFT, 3);
    expect(loadOnboardingDraft(null, LAST_STEP)).toEqual({ draft: DRAFT, step: 3 });
  });

  it('conserve un champ vidé et une matière non choisie (null)', () => {
    const empty: ProfileDraft = { displayName: '', etablissement: '', cycle: '', niveaux: [], matiereChoisie: null, matiereSecondaire: null, discipline: '' };
    saveOnboardingDraft(null, empty, 0);
    expect(loadOnboardingDraft(null, LAST_STEP)).toEqual({ draft: empty, step: 0 });
  });

  it('effacer supprime le brouillon', () => {
    saveOnboardingDraft(null, DRAFT, 2);
    clearOnboardingDraft();
    expect(stored()).toBeNull();
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
  });
});

describe('Brouillon de l\'assistant d\'accueil — lecture', () => {
  it('aucun brouillon : null', () => {
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
  });

  it('le brouillon d\'un autre compte (ou d\'une autre session sans compte) n\'est jamais restitué, et il est effacé', () => {
    saveOnboardingDraft('user_1', DRAFT, 3);
    expect(loadOnboardingDraft('user_2', LAST_STEP)).toBeNull();
    expect(stored()).toBeNull();
    saveOnboardingDraft('user_1', DRAFT, 3);
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
    saveOnboardingDraft(null, DRAFT, 3);
    expect(loadOnboardingDraft('user_1', LAST_STEP)).toBeNull();
    expect(stored()).toBeNull();
  });

  it.each([
    ['JSON cassé', '{"owner":null,"step":'],
    ['texte quelconque', 'bonjour'],
    ['tableau', '[]'],
    ['null', 'null'],
    ['chaîne', '"brouillon"'],
    ['nombre', '42'],
    ['propriétaire absent', JSON.stringify({ step: 2, ...DRAFT })],
    ['propriétaire d\'un autre type', JSON.stringify(tampered({ owner: { id: 'user_1' } }))],
    ['contenu trop gros', JSON.stringify(tampered({ displayName: 'x'.repeat(40_000) }))],
  ])('contenu illisible ou étranger (%s) : null, et effacé', (_name, raw) => {
    put(raw);
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
    expect(stored()).toBeNull();
  });

  it('textes : longueurs bornées comme les champs de saisie, caractères de contrôle neutralisés', () => {
    put(tampered({
      displayName: 'N'.repeat(5000),
      etablissement: `Collège\u0000\n\r\tTest\u007f${'E'.repeat(5000)}`,
      discipline: 'D'.repeat(121),
    }));
    const { draft } = loadOnboardingDraft(null, LAST_STEP)!;
    expect(draft.displayName).toBe('N'.repeat(DRAFT_LIMITS.displayName));
    expect(draft.etablissement).toHaveLength(DRAFT_LIMITS.etablissement);
    expect(draft.etablissement.startsWith('Collège Test E')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(draft.etablissement).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(draft.discipline).toBe('D'.repeat(DRAFT_LIMITS.discipline));
  });

  it('une coupure ne laisse pas la moitié d\'une paire de substitution', () => {
    put(tampered({ displayName: `${'a'.repeat(DRAFT_LIMITS.displayName - 1)}😀suite` }));
    const { displayName } = loadOnboardingDraft(null, LAST_STEP)!.draft;
    expect(displayName).toBe('a'.repeat(DRAFT_LIMITS.displayName - 1));
  });

  it('textes d\'un autre type que du texte : champ vide', () => {
    put(tampered({ displayName: 42, etablissement: { a: 1 }, discipline: ['x'] }));
    const { draft } = loadOnboardingDraft(null, LAST_STEP)!;
    expect([draft.displayName, draft.etablissement, draft.discipline]).toEqual(['', '', '']);
  });

  it('le texte n\'est pas interprété : le balisage reste du texte', () => {
    put(tampered({ displayName: '<img src=x onerror=alert(1)>' }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.draft.displayName).toBe('<img src=x onerror=alert(1)>');
  });

  it('niveaux : liste blanche, doublons retirés, ordre officiel, seulement ceux du cycle', () => {
    put(tampered({ niveaux: ['4eme', '__proto__', 'constructor', 42, null, { v: '6eme' }, '6eme', '4eme', 'terminale_generale', 'master_1'] }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.draft.niveaux).toEqual(['6eme', '4eme']);
  });

  it('niveaux d\'un autre type qu\'une liste : aucun', () => {
    put(tampered({ niveaux: '6eme' }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.draft.niveaux).toEqual([]);
    put(tampered({ niveaux: { 0: '6eme', length: 1 } }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.draft.niveaux).toEqual([]);
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'inconnu', '', 42, null])(
    'cycle inconnu (%s) : cycle vide et aucun niveau',
    cycle => {
      put(tampered({ cycle }));
      const { draft } = loadOnboardingDraft(null, LAST_STEP)!;
      expect(draft.cycle).toBe('');
      expect(draft.niveaux).toEqual([]);
    },
  );

  it('matières : seules les matières connues sont restituées', () => {
    put(tampered({ matiereChoisie: '<b>svt</b>', matiereSecondaire: 'constructor' }));
    const { draft } = loadOnboardingDraft(null, LAST_STEP)!;
    expect(draft.matiereChoisie).toBeNull();
    expect(draft.matiereSecondaire).toBeNull();
    put(tampered({ matiereChoisie: 12, matiereSecondaire: ['svt'] }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.draft.matiereChoisie).toBeNull();
  });

  it.each([
    [-3, 0], [0, 0], [3, 3], [4, 4], [5, 4], [99, 4], [2.5, 0], [Number.MAX_SAFE_INTEGER, 4], ['3', 0], [null, 0], [undefined, 0], [[3], 0],
  ])('étape %j : ramenée dans les étapes de l\'assistant (%j)', (step, expected) => {
    put(tampered({ step }));
    expect(loadOnboardingDraft(null, LAST_STEP)!.step).toBe(expected);
  });

  it('un contenu hostile ne produit que des champs du profil : rien d\'étranger n\'est relu ni réécrit', () => {
    put('{"owner":null,"step":2,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'
      + '"token":"jeton-secret","apiKey":"sk-secret","displayName":"Mme X","niveaux":["6eme"],"cycle":"college"}');
    const saved = loadOnboardingDraft(null, LAST_STEP)!;
    expect(Object.keys(saved.draft).sort()).toEqual(
      ['cycle', 'discipline', 'displayName', 'etablissement', 'matiereChoisie', 'matiereSecondaire', 'niveaux'],
    );
    expect(Object.keys(saved).sort()).toEqual(['draft', 'step']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('secret');
    saveOnboardingDraft(null, saved.draft, saved.step);
    expect(stored()).not.toContain('secret');
  });
});

describe('Brouillon de l\'assistant d\'accueil — stockage de session indisponible', () => {
  const denied = () => {
    throw new DOMException('Accès refusé', 'SecurityError');
  };

  it('lecture, écriture et effacement qui échouent : aucune exception, rien de restitué', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    expect(() => saveOnboardingDraft(null, DRAFT, 2)).not.toThrow();
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
    expect(() => clearOnboardingDraft()).not.toThrow();
  });

  it('quota dépassé à l\'écriture : aucune exception', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota dépassé', 'QuotaExceededError');
    });
    expect(() => saveOnboardingDraft(null, DRAFT, 2)).not.toThrow();
  });

  it('effacement impossible après une lecture d\'un contenu altéré : aucune exception', () => {
    put('{cassé');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
  });

  it('accès à sessionStorage refusé (navigateur configuré pour bloquer les données de site) : aucune exception', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(denied);
    expect(() => saveOnboardingDraft(null, DRAFT, 2)).not.toThrow();
    expect(loadOnboardingDraft(null, LAST_STEP)).toBeNull();
    expect(() => clearOnboardingDraft()).not.toThrow();
  });
});
