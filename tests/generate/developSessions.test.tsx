// @vitest-environment jsdom
// « Développer une séance » : sous le plan d'une séquence demandée avec « Commencer par le plan » (résultat de la génération
// ou contenu ouvert depuis l'Historique), la liste des séances ; chaque bouton ouvre « Fiche de préparation » PRÉREMPLIE,
// sans rien lancer ; le texte préparé voyage dans l'état du routeur, jamais dans l'adresse.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom';
import type { GenerationEvent, GenerationRequest } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';
import DevelopSessions from '@/components/generate/DevelopSessions';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import ResultPanel from '@/components/generate/ResultPanel';
import { createInitialForm, type GenerateForm } from '@/lib/generation/request';
import { initialGenerationState, type GenerationState } from '@/lib/generation/state';
import { planOriginFromRequest } from '@/lib/generation/plan';
import type { ReuseState } from '@/lib/generation/reuse';
import { RuntimeContext } from '@/lib/runtime/context';
import type { GenerationClient, RuntimeMode } from '@/lib/runtime/types';
import { button, cleanup, click, fakeRuntime, flush, makeRecord, MemoryStore, PROFILE_COLLEGE, render, typeInto } from '../ui/helpers';

vi.mock('@/lib/export', () => ({
  exportPdf: vi.fn(async () => undefined),
  exportMarkdown: vi.fn(async () => undefined),
  printDocument: vi.fn(async () => undefined),
  copyText: vi.fn(async () => true),
}));
vi.mock('@/components/MarkdownView', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

// Import après les simulations de modules.
const { default: GeneratePage } = await import('@/pages/GeneratePage');
const { default: HistoryPage } = await import('@/pages/HistoryPage');

beforeEach(() => {
  // Démonstration : la carte « Passez à la vraie IA » interroge la dernière version Windows (sans réponse ici).
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PLAN = `# Séquence — La Révolution française

## Problématique

Comment la Révolution transforme-t-elle la société française ?

## Objectifs de la séquence

- Situer les étapes de la Révolution
- Analyser des documents

## Tableau synoptique

| N° | Titre | Objectif | Activités | Durée |
|---|---|---|---|---|
| 1 | L'Ancien Régime | Décrire la société d'Ancien Régime | Étude de documents | 55 min |
| 2 | 1789 : la prise de la Bastille | Expliquer les causes | Frise chronologique | 55 min |
| 3 | La fin de la monarchie | Comprendre la chute du roi | Débat | 55 min |
| 4 | La Terreur | Analyser la radicalisation | Étude de cas | 55 min |

## Évaluation sommative prévue

Un devoir en classe.
`;

const REQ: GenerationRequest = {
  type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française', nombreSeances: 4, planSeulement: true,
  researchMode: 'documents',
};

function doneState(request: GenerationRequest, text: string, patch: Partial<GenerationState> = {}): GenerationState {
  return {
    ...initialGenerationState(), phase: 'done', runId: 1, request, text,
    result: { type: 'done', content: text, sources: [], truncated: false, internetUsed: false, saved: true, id: 'g1', model: 'm' },
    ...patch,
  };
}

let where: Location | null = null;
let go: NavigateFunction | null = null;
function LocationProbe() {
  where = useLocation();
  go = useNavigate();
  return null;
}

/** État du routeur à l'arrivée (ce que la page « Générer » reçoit). */
const arrival = () => where!.state as ReuseState;

/** Saisie dans une zone de texte (typeInto ne gère que les champs « input »). */
async function typeIntoArea(area: HTMLTextAreaElement | null, text: string): Promise<void> {
  if (!area) throw new Error('Zone de texte introuvable');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function panel(state: GenerationState, props: { example?: boolean; mode?: RuntimeMode } = {}) {
  where = null;
  const { mode = 'web', ...rest } = props;
  return render(
    <MemoryRouter initialEntries={['/app/generate?type=sequence']}>
      <Routes>
        <Route
          path="/app/generate"
          element={<ResultPanel state={state} mode={mode} store={new MemoryStore()} onStop={vi.fn()} onRestart={vi.fn()} {...rest} />}
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const section = (root: ParentNode) => root.querySelector('section[aria-labelledby="plan-develop-title"]');
/** Bouton « Développer » de la séance n (nom accessible : « Développer la séance 3 : Titre »). */
const develop = (root: ParentNode, n: number) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Développer la séance"]'))
    .find(b => new RegExp(`^Développer la séance ${n}(?: :|$)`).test(b.getAttribute('aria-label') ?? '')) ?? null;

describe('Formulaire — case « Commencer par le plan » (interaction)', () => {
  async function form(patch: Partial<GenerateForm> = {}) {
    const onChange = vi.fn();
    const value: GenerateForm = { ...createInitialForm(PROFILE_COLLEGE, { type: 'sequence' }), ...patch };
    const view = await render(
      <GenerateFormFields form={value} onChange={onChange} onNiveauChange={vi.fn()} problems={[]} showErrors={false} />,
    );
    return { ...view, onChange };
  }
  const box = (root: ParentNode) => root.querySelector<HTMLInputElement>('#gen-plan-seulement')!;

  it('cocher la case change seulement « planSeulement » ; la décocher aussi ; le libellé est cliquable', async () => {
    const { container, onChange } = await form();
    expect(box(container).checked).toBe(false);
    await click(box(container));
    expect(onChange).toHaveBeenLastCalledWith({ planSeulement: true });
    await click(container.querySelector('label[for="gen-plan-seulement"]'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.every(([patch]) => Object.keys(patch).join() === 'planSeulement')).toBe(true);
    cleanup();
    const checked = await form({ planSeulement: true });
    expect(box(checked.container).checked).toBe(true);
    await click(box(checked.container));
    expect(checked.onChange).toHaveBeenLastCalledWith({ planSeulement: false });
  });

  it('nom accessible = « Commencer par le plan » ; aide reliée par aria-describedby (aide, puis conseil quand il y en a un)', async () => {
    const { container } = await form({ nombreSeances: 8 });
    const input = box(container);
    expect(container.querySelector('label[for="gen-plan-seulement"]')?.textContent).toBe('Commencer par le plan');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map(id => container.querySelector(`#${id}`)?.textContent ?? '');
    expect(described[0]).toBe('Plus rapide : vous obtenez d’abord le plan de la séquence, puis vous choisissez les séances à développer.');
    expect(described[1]).toContain('Conseil : pour une grosse séquence');
  });

  it('le conseil n’active jamais la case : aucun changement sans geste de l’enseignant', async () => {
    const { container, onChange } = await form({ nombreSeances: 10, duree: '2 mois' });
    expect(container.textContent).toContain('Conseil : pour une grosse séquence');
    expect(box(container).checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Résultat — « Développer une séance » sous le plan', () => {
  it('plan demandé : liste des séances lues dans le tableau, un bouton par séance', async () => {
    const { container } = await panel(doneState(REQ, PLAN));
    expect(section(container)?.querySelector('h3')?.textContent).toBe('Développer une séance');
    const items = Array.from(section(container)!.querySelectorAll('li')).map(li => li.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim());
    expect(items).toEqual([
      'Séance 1 : L\'Ancien Régime',
      'Séance 2 : 1789 : la prise de la Bastille',
      'Séance 3 : La fin de la monarchie',
      'Séance 4 : La Terreur',
    ]);
    expect(section(container)?.querySelectorAll('li button')).toHaveLength(4);
    expect(develop(container, 3)?.getAttribute('aria-label')).toBe('Développer la séance 3 : La fin de la monarchie');
    // L'explication dit que rien n'est généré automatiquement.
    expect(section(container)?.textContent).toContain('rien n’est généré automatiquement');
  });

  it('un bouton ouvre « Fiche de préparation » prérempli (état du routeur), sans rien lancer ni mettre le texte dans l’adresse', async () => {
    const { container } = await panel(doneState(REQ, PLAN));
    await click(develop(container, 3));
    expect(where?.pathname).toBe('/app/generate');
    // Adresse : l'outil seulement ; ni sujet, ni consignes, ni objectifs.
    expect(where?.search).toBe('?type=fiche_prep');
    expect(decodeURIComponent(where?.search ?? '')).not.toContain('Révolution');
    const { reuse, reuseNotice } = arrival();
    expect(reuse).toMatchObject({
      type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française — séance 3 : La fin de la monarchie',
    });
    expect(reuse?.params).toMatchObject({ objectifs: 'Comprendre la chute du roi', researchMode: 'documents' });
    expect(reuse?.params?.consignes).toMatch(/^Séance 3 sur 4 d'une séquence « La Révolution française »\. Objectifs et problématique de la séquence : objectifs : Situer les étapes de la Révolution ; Analyser des documents ; problématique : Comment la Révolution transforme-t-elle la société française \? Ligne du plan : Titre : La fin de la monarchie/);
    expect(reuse?.params?.consignes).toContain('Séance précédente : séance 2 — 1789 : la prise de la Bastille. Séance suivante : séance 4 — La Terreur. Respecte ce plan.');
    expect(reuseNotice).toContain('séance 3 sur 4');
    // Jamais de génération : le panneau n'a aucun moyen d'en lancer une (le formulaire est rempli, pas envoyé).
    expect(JSON.stringify(arrival()).length).toBeLessThan(5_000);
  });

  it('nombre de séances demandé plus grand que celui du tableau : « séance N sur n » avec n demandé', async () => {
    const { container } = await panel(doneState({ ...REQ, nombreSeances: 6 }, PLAN));
    await click(develop(container, 1));
    expect(arrival().reuse?.params?.consignes).toMatch(/^Séance 1 sur 6 /);
  });

  it('plan d’un module du supérieur (« Numéro | Format | Thème »)', async () => {
    const sup = '| Numéro | Format | Thème | Contenus |\n|---|---|---|---|\n| 1 | CM | Les coûts complets | Charges |\n| 2 | TD | Les coûts partiels | Marge |\n';
    const { container } = await panel(doneState({ ...REQ, niveau: 'licence_3', matiere: 'autre', discipline: 'Gestion' }, sup));
    expect(section(container)?.querySelectorAll('li')).toHaveLength(2);
    await click(develop(container, 2));
    expect(arrival().reuse).toMatchObject({ niveau: 'licence_3', discipline: 'Gestion', sujet: 'La Révolution française — séance 2 : Les coûts partiels' });
  });

  it('rien quand la demande n’était pas « plan d’abord » (même texte, même tableau)', async () => {
    const { planSeulement: _plan, ...complete } = REQ;
    const { container } = await panel(doneState(complete, PLAN));
    expect(container.textContent).toContain('1789 : la prise de la Bastille');
    expect(section(container)).toBeNull();
    expect(container.textContent).not.toContain('Développer une séance');
    await panel(doneState({ ...REQ, planSeulement: false }, PLAN));
    expect(document.body.textContent).not.toContain('Développer');
  });

  it('rien pour un autre outil, un exemple pré-rédigé, ni avant la fin de la génération', async () => {
    const { container: cours } = await panel(doneState({ ...REQ, type: 'cours' }, PLAN));
    expect(section(cours)).toBeNull();
    cleanup();
    const { container: example } = await panel(doneState(REQ, PLAN), { example: true });
    expect(section(example)).toBeNull();
    cleanup();
    for (const phase of ['running', 'aborted', 'error'] as const) {
      const { container } = await panel(doneState(REQ, PLAN, { phase }));
      expect(section(container), phase).toBeNull();
      cleanup();
    }
  });

  it('ligne qui regroupe plusieurs séances : « Développer les séances 2 et 3 », une seule séance : « Développer la séance 1 »', async () => {
    const text = '| N° | Titre |\n|---|---|\n| 1 | A |\n| Séances 2 et 3 | B |\n| 4 à 6 | C |\n| 7 | D |';
    const { container } = await panel(doneState({ ...REQ, nombreSeances: 7 }, text));
    const labels = Array.from(section(container)!.querySelectorAll('li button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Développer la séance 1 : A', 'Développer les séances 2 et 3 : B', 'Développer les séances 4 à 6 : C', 'Développer la séance 7 : D',
    ]);
    // Le nom visible de la ligne suit la même règle (« Séances 2 et 3 : B »).
    expect(Array.from(section(container)!.querySelectorAll('li p')).map(p => p.textContent?.trim())).toEqual([
      'Séance 1 : A', 'Séances 2 et 3 : B', 'Séances 4 à 6 : C', 'Séance 7 : D',
    ]);
    // Titre absent : « Développer les séances 2 et 3 » tout court.
    cleanup();
    const bare = await render(
      <MemoryRouter>
        <DevelopSessions content={'| N° | Durée |\n|---|---|\n| 1 | 45 min |\n| 2 et 3 | 45 min |'} origin={planOriginFromRequest(REQ)} />
      </MemoryRouter>,
    );
    expect(Array.from(section(bare.container)!.querySelectorAll('li button')).map(b => b.getAttribute('aria-label'))).toEqual([
      'Développer la séance 1', 'Développer les séances 2 et 3',
    ]);
  });

  it('plan enregistré : l’identifiant du plan voyage avec la demande préparée (« Revenir au plan ») ; non enregistré : aucun', async () => {
    const { container } = await panel(doneState(REQ, PLAN));
    await click(develop(container, 2));
    expect(arrival().planId).toBe('g1');
    // Génération non enregistrée : pas d'identifiant, donc rien à rouvrir.
    cleanup();
    const unsaved = doneState(REQ, PLAN, { result: { type: 'done', content: PLAN, sources: [], truncated: false, internetUsed: false, saved: false, model: 'm' } });
    const { container: other } = await panel(unsaved);
    await click(develop(other, 2));
    expect(arrival()).not.toHaveProperty('planId');
    expect(arrival().reuse?.type).toBe('fiche_prep');
  });

  it('démonstration : jamais de liste de séances (le « plan » y est un exemple fixe, sans rapport avec le sujet saisi)', async () => {
    const { container } = await panel(doneState(REQ, PLAN), { mode: 'demo' });
    expect(container.textContent).toContain('1789 : la prise de la Bastille');
    expect(section(container)).toBeNull();
    expect(container.textContent).not.toContain('Développer');
    // Les autres modes (serveur, application Windows, personnel) la proposent.
    for (const mode of ['web', 'local', 'personal'] as const) {
      cleanup();
      const { container: other } = await panel(doneState(REQ, PLAN), { mode });
      expect(section(other), mode).not.toBeNull();
    }
  });

  it('tableau illisible : rien n’est affiché, pas d’erreur', async () => {
    for (const text of ['# Plan\n\nPas de tableau.', '| Compétence | Niveau |\n|---|---|\n| Lire | 1 |', '| N° | Titre |\n|---|---|\n| a | b |\n| c | d |']) {
      const { container } = await panel(doneState(REQ, text));
      expect(section(container)).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).not.toMatch(/illisible|impossible|erreur/i);
      cleanup();
    }
  });

  it('séance sans titre lisible : bouton « Développer la séance N »', async () => {
    const { container } = await render(
      <MemoryRouter>
        <DevelopSessions content={'| N° | Durée |\n|---|---|\n| 1 | 45 min |\n| 2 | 45 min |'} origin={planOriginFromRequest(REQ)} />
      </MemoryRouter>,
    );
    expect(develop(container, 2)?.getAttribute('aria-label')).toBe('Développer la séance 2');
    expect(section(container)?.querySelectorAll('li')[1].textContent).toContain('Séance 2');
  });

  it('textes démesurés : la demande préparée reste dans les limites d’une demande', async () => {
    const huge = 'mot '.repeat(3_000);
    const table = `| N° | Titre | Objectif | Activités |\n|---|---|---|---|\n| 1 | ${huge} | ${huge} | ${huge} |\n| 2 | b | b | b |`;
    const { container } = await panel(doneState({ ...REQ, sujet: 'S'.repeat(REQUEST_LIMITS.sujet), objectifs: huge.slice(0, 2_000) }, `## Objectifs\n\n${huge}\n\n${table}`));
    await click(develop(container, 1));
    const { reuse } = arrival();
    expect(reuse!.sujet.length).toBeLessThanOrEqual(REQUEST_LIMITS.sujet);
    expect((reuse!.params!.consignes as string).length).toBeLessThanOrEqual(REQUEST_LIMITS.consignes);
    expect((reuse!.params!.objectifs as string).length).toBeLessThanOrEqual(REQUEST_LIMITS.objectifs);
  });
});

describe('Historique — « Développer une séance » sur un plan enregistré', () => {
  async function history(records: ReturnType<typeof makeRecord>[], id: string) {
    where = null;
    const store = new MemoryStore(records, PROFILE_COLLEGE);
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(store)}>
        <MemoryRouter initialEntries={[`/app/history?id=${id}`]}>
          <Routes>
            <Route path="/app/history" element={<HistoryPage />} />
            <Route path="/app/generate" element={<p>Page Générer</p>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(6);
    return view;
  }

  const planRecord = (patch: Partial<ReturnType<typeof makeRecord>> = {}) => makeRecord(0, {
    id: 'plan-1', type: 'sequence', sujet: 'La Révolution française', matiere: 'histoire_geo', contenu: PLAN,
    params: { nombreSeances: 4, planSeulement: true, researchMode: 'documents' }, ...patch,
  });
  const detail = (root: ParentNode) => root.querySelector<HTMLElement>('section[aria-label="Contenu sélectionné"]')!;

  it('plan seul : « Plan d’abord : oui » dans les paramètres, liste des séances, bouton qui ouvre la fiche préremplie', async () => {
    const { container } = await history([planRecord()], 'plan-1');
    expect(detail(container).textContent).toContain("Plan d'abord");
    expect(detail(container).textContent).toMatch(/Plan d'abord\s*oui/);
    expect(section(detail(container))?.querySelectorAll('li')).toHaveLength(4);
    await click(develop(detail(container), 2));
    expect(where?.pathname).toBe('/app/generate');
    expect(where?.search).toBe('?type=fiche_prep');
    expect(arrival().reuse).toMatchObject({ type: 'fiche_prep', sujet: 'La Révolution française — séance 2 : 1789 : la prise de la Bastille' });
    expect(arrival().reuse?.params?.consignes).toMatch(/^Séance 2 sur 4 d'une séquence « La Révolution française »/);
  });

  it('l’identifiant du plan enregistré voyage avec la demande préparée (« Revenir au plan »)', async () => {
    const { container } = await history([planRecord()], 'plan-1');
    await click(develop(detail(container), 3));
    expect(arrival().planId).toBe('plan-1');
  });

  it('exemple pré-rédigé de la démonstration : jamais de liste de séances', async () => {
    const demo = planRecord({ params: { nombreSeances: 4, planSeulement: true, demo: true } });
    const { container } = await history([demo], 'plan-1');
    expect(detail(container).textContent).toContain('1789 : la prise de la Bastille');
    expect(section(detail(container))).toBeNull();
  });

  it('séquence complète (pas de plan seul) ou autre outil : rien', async () => {
    const full = planRecord({ id: 'full-1', params: { nombreSeances: 4 } });
    const { container } = await history([full], 'full-1');
    expect(detail(container).textContent).not.toContain("Plan d'abord");
    expect(section(detail(container))).toBeNull();
    cleanup();
    const wrongTool = planRecord({ id: 'cours-1', type: 'cours' });
    const other = await history([wrongTool], 'cours-1');
    expect(section(detail(other.container))).toBeNull();
  });

  it('plan seul au tableau illisible : le contenu s’affiche, rien d’autre (pas d’erreur)', async () => {
    const { container } = await history([planRecord({ contenu: '# Plan\n\nTexte libre sans tableau.' })], 'plan-1');
    expect(detail(container).textContent).toContain('Texte libre sans tableau.');
    expect(section(detail(container))).toBeNull();
    expect(detail(container).querySelector('[role="alert"]')).toBeNull();
  });

  it('« Reprendre cette demande » d’un plan seul : la case « Commencer par le plan » est reprise', async () => {
    const { container } = await history([planRecord()], 'plan-1');
    await click(button(detail(container), /Reprendre cette demande/));
    expect((arrival().reuse?.params as Record<string, unknown>).planSeulement).toBe(true);
    expect(arrival().reuse?.type).toBe('sequence');
  });
});

describe('Page « Générer » — plan d’abord puis séances, de bout en bout', () => {
  /** Client de démonstration : renvoie le plan pour une séquence, une fiche pour le reste ; garde les demandes reçues. */
  function planClient() {
    const requests: GenerationRequest[] = [];
    const client: GenerationClient = {
      kind: 'demo',
      capabilities: async () => ({
        maxDocumentChars: 1000, research: { academic: false, web: false, institutional: false, wikipedia: false },
        privacy: { level: 'demo', message: '' }, engineLabel: 'Test', ready: true,
      }),
      generate: vi.fn(async (request: GenerationRequest, onEvent: (e: GenerationEvent) => void) => {
        requests.push(request);
        const content = request.type === 'sequence' ? PLAN : '# Fiche de préparation\n\nContenu de la fiche.';
        onEvent({ type: 'done', content, sources: [], truncated: false, internetUsed: false, saved: true, id: `g${requests.length}`, model: 'm' });
      }),
    };
    return { client, requests };
  }

  async function mount(url: string, client: GenerationClient, mode: RuntimeMode = 'web') {
    where = null;
    const store = new MemoryStore([], PROFILE_COLLEGE);
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(store, { mode, client, profile: PROFILE_COLLEGE })}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/app/generate" element={<GeneratePage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(6);
    return view;
  }

  const value = (root: ParentNode, selector: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value;
  const submit = (root: ParentNode) => root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  const note = (root: ParentNode) => root.querySelector('main [role="note"], [role="note"]');

  it('plan demandé avec la case ; « Développer » prérempli la fiche (rien n’est généré) ; l’enseignant relit puis génère', async () => {
    const { client, requests } = planClient();
    const { container } = await mount('/app/generate?type=sequence', client);
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'La Révolution française');
    await click(container.querySelector('#gen-plan-seulement'));
    await click(button(container.querySelector('[aria-labelledby="gen-nombre-seances-label"]')!, '4'));
    await click(submit(container));
    await flush(6);
    // La demande de séquence porte l'option, avec le nombre de séances.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: 'sequence', matiere: 'mathematiques', planSeulement: true, nombreSeances: 4, sujet: 'La Révolution française' });
    expect(section(container)?.querySelectorAll('li')).toHaveLength(4);

    // « Développer » la séance 3 : le formulaire passe à « Fiche de préparation », rempli, et RIEN n'est généré.
    await click(develop(container, 3));
    await flush(4);
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Fiche de prep');
    expect(where?.search).toBe('?type=fiche_prep');
    expect(value(container, '#gen-sujet')).toBe('La Révolution française — séance 3 : La fin de la monarchie');
    expect(value(container, '#gen-objectifs')).toBe('Comprendre la chute du roi');
    expect(value(container, '#gen-consignes')).toMatch(/^Séance 3 sur 4 d'une séquence « La Révolution française »\. /);
    expect(value(container, '#gen-consignes')).toMatch(/Séance précédente : séance 2 — 1789 : la prise de la Bastille\. Séance suivante : séance 4 — La Terreur\. Respecte ce plan\.$/);
    expect(note(container)?.textContent).toContain('Demande préparée à partir du plan (séance 3 sur 4');
    expect(note(container)?.textContent).not.toContain('reprise depuis l’historique');
    expect(requests).toHaveLength(1);
    // Le plan reste affiché : on peut en choisir une autre (le formulaire est rempli à nouveau).
    await click(develop(container, 1));
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('La Révolution française — séance 1 : L\'Ancien Régime');
    expect(requests).toHaveLength(1);

    // L'enseignant modifie puis génère : la demande est celle du formulaire (fiche de préparation), sans l'option du plan.
    await typeIntoArea(container.querySelector<HTMLTextAreaElement>('#gen-objectifs'), 'Mes objectifs');
    await click(submit(container));
    await flush(6);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      // Même niveau et même matière (celles du formulaire de la séquence).
      type: 'fiche_prep', niveau: '4eme', matiere: 'mathematiques', sujet: 'La Révolution française — séance 1 : L\'Ancien Régime', objectifs: 'Mes objectifs',
    });
    expect(requests[1]).not.toHaveProperty('planSeulement');
    expect(requests[1].consignes).toMatch(/^Séance 1 sur 4 d'une séquence « La Révolution française »/);
    // Résultat d'une fiche : plus de liste de séances.
    expect(section(container)).toBeNull();
  });

  it('sans la case : séquence complète, aucune liste de séances', async () => {
    const { client, requests } = planClient();
    const { container } = await mount('/app/generate?type=sequence', client);
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'La Révolution française');
    await click(submit(container));
    await flush(6);
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('planSeulement');
    expect(container.textContent).toContain('1789 : la prise de la Bastille');
    expect(section(container)).toBeNull();
  });

  /** Demande préparée comme la prépare « Développer » (état du routeur). */
  const PREPARED: ReuseState = {
    reuse: {
      type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution — séance 2 : Les causes',
      params: { objectifs: 'Expliquer', consignes: 'Séance 2 sur 4 d\'une séquence « La Révolution ». Respecte ce plan.' },
    },
    reuseNotice: 'Rappel du plan.',
  };

  it('page déjà sur « Fiche de préparation » : la demande préparée remplit le formulaire quand même, et la page revient en haut', async () => {
    const scrolls: Element[] = [];
    const proto = Element.prototype as { scrollIntoView?: (options?: unknown) => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolls.push(this);
    };
    try {
      const { client, requests } = planClient();
      const { container } = await mount('/app/generate?type=fiche_prep', client);
      await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'Autre sujet');
      expect(scrolls).toHaveLength(0);
      await act(async () => {
        go!('/app/generate?type=fiche_prep', { state: PREPARED });
      });
      await flush(4);
      expect(value(container, '#gen-sujet')).toBe('La Révolution — séance 2 : Les causes');
      expect(value(container, '#gen-objectifs')).toBe('Expliquer');
      expect(note(container)?.textContent).toContain('Rappel du plan.');
      expect(scrolls.length).toBeGreaterThan(0);
      expect(requests).toHaveLength(0);
    } finally {
      proto.scrollIntoView = original;
    }
  });

  it('retour arrière du navigateur : la saisie en cours est conservée (la demande préparée n’est pas ré-appliquée)', async () => {
    const { client } = planClient();
    const { container } = await mount('/app/generate?type=sequence', client);
    await act(async () => {
      go!('/app/generate?type=fiche_prep', { state: PREPARED });
    });
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('La Révolution — séance 2 : Les causes');
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'Ma version corrigée');
    await act(async () => {
      go!('/app/generate?type=cours');
    });
    await flush(4);
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Cours');
    await act(async () => {
      go!(-1);
    });
    await flush(4);
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Fiche de prep');
    expect(value(container, '#gen-sujet')).toBe('Ma version corrigée');
  });

  /** Séquence « plan d'abord » de 4 séances, avec consignes, générée : le plan reste affiché sous le formulaire. */
  async function generatedPlan(client: GenerationClient, mode: RuntimeMode = 'web') {
    const view = await mount('/app/generate?type=sequence', client, mode);
    const { container } = view;
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'La Révolution française');
    await typeIntoArea(container.querySelector<HTMLTextAreaElement>('#gen-consignes'), 'Documents audio uniquement');
    await click(container.querySelector('#gen-plan-seulement'));
    await click(button(container.querySelector('[aria-labelledby="gen-nombre-seances-label"]')!, '4'));
    await click(submit(container));
    await flush(6);
    return view;
  }
  const chip = (root: ParentNode, label: string) =>
    button(root.querySelector('[aria-labelledby="gen-nombre-seances-label"]')!, label)?.getAttribute('aria-pressed');

  it('retour arrière du navigateur après « Développer » : le formulaire de la séquence est rétabli (pas celui de la fiche)', async () => {
    const { client } = planClient();
    const { container } = await generatedPlan(client);
    await click(develop(container, 3));
    await flush(4);
    expect(where?.search).toBe('?type=fiche_prep');
    expect(value(container, '#gen-sujet')).toBe('La Révolution française — séance 3 : La fin de la monarchie');
    expect(note(container)?.textContent).toContain('Demande préparée à partir du plan');

    await act(async () => {
      go!(-1);
    });
    await flush(4);
    // Retour sur « Séquence » avec les valeurs de la séquence : sujet, consignes, « plan d'abord », nombre de séances.
    expect(where?.search).toBe('?type=sequence');
    expect(container.querySelector('h1')?.textContent?.trim()).not.toBe('Fiche de prep');
    expect(value(container, '#gen-sujet')).toBe('La Révolution française');
    expect(value(container, '#gen-consignes')).toBe('Documents audio uniquement');
    expect(container.querySelector<HTMLInputElement>('#gen-plan-seulement')?.checked).toBe(true);
    expect(chip(container, '4')).toBe('true');
    // Plus de rappel « Demande préparée… » sur la séquence ; le plan reste affiché, on peut en développer une autre.
    expect(note(container)).toBeNull();
    expect(section(container)?.querySelectorAll('li')).toHaveLength(4);
    await click(develop(container, 1));
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('La Révolution française — séance 1 : L\'Ancien Régime');
  });

  it('plusieurs séances développées à la suite, puis retour : toujours le formulaire de la séquence ; rien dans l’adresse', async () => {
    const { client } = planClient();
    const { container } = await generatedPlan(client);
    await click(develop(container, 2));
    await flush(4);
    await click(develop(container, 3));
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('La Révolution française — séance 3 : La fin de la monarchie');
    expect(decodeURIComponent(where?.search ?? '')).toBe('?type=fiche_prep');
    await act(async () => {
      go!(-1);
    });
    await flush(4);
    await act(async () => {
      go!(-1);
    });
    await flush(4);
    expect(where?.search).toBe('?type=sequence');
    expect(value(container, '#gen-sujet')).toBe('La Révolution française');
    expect(value(container, '#gen-consignes')).toBe('Documents audio uniquement');
    expect(container.querySelector<HTMLInputElement>('#gen-plan-seulement')?.checked).toBe(true);
    expect(chip(container, '4')).toBe('true');
  });

  it('retour à « Séquence » par un lien (barre latérale) après « Développer » : même formulaire rétabli, une seule fois', async () => {
    const { client } = planClient();
    const { container } = await generatedPlan(client);
    await click(develop(container, 2));
    await flush(4);
    await act(async () => {
      go!('/app/generate?type=sequence');
    });
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('La Révolution française');
    expect(chip(container, '4')).toBe('true');
    // Rétabli une seule fois : la saisie suivante n'est pas écrasée au prochain changement d'outil.
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'Autre sujet');
    await act(async () => {
      go!('/app/generate?type=cours');
    });
    await flush(4);
    await act(async () => {
      go!('/app/generate?type=sequence');
    });
    await flush(4);
    expect(value(container, '#gen-sujet')).toBe('Autre sujet');
  });

  it('plan enregistré : le rappel de la fiche propose « Revenir au plan » (Historique) ; sans plan enregistré, aucun lien', async () => {
    const { client } = planClient();
    const { container } = await generatedPlan(client);
    await click(develop(container, 2));
    await flush(4);
    const back = Array.from(note(container)?.querySelectorAll('a') ?? []).find(a => a.textContent?.trim() === 'Revenir au plan');
    expect(back?.getAttribute('href')).toBe('/app/history?id=g1');
    // Le lien reste après la génération de la fiche.
    await click(submit(container));
    await flush(6);
    expect(Array.from(note(container)?.querySelectorAll('a') ?? []).map(a => a.textContent?.trim())).toContain('Revenir au plan');
    cleanup();

    // Demande préparée sans plan enregistré (plan non enregistré) : le rappel seul.
    const unsaved = await mount('/app/generate?type=fiche_prep', client);
    await act(async () => {
      go!('/app/generate?type=fiche_prep', { state: PREPARED });
    });
    await flush(4);
    expect(note(unsaved.container)?.textContent).toContain('Rappel du plan.');
    expect(note(unsaved.container)?.querySelector('a')).toBeNull();
    // Identifiant illisible (pas un texte) : jamais de lien.
    await act(async () => {
      go!('/app/generate?type=fiche_prep', { state: { ...PREPARED, reuse: { ...PREPARED.reuse!, sujet: 'Autre' }, planId: 42 } });
    });
    await flush(4);
    expect(note(unsaved.container)?.querySelector('a')).toBeNull();
    // Identifiant à protéger dans l'adresse.
    await act(async () => {
      go!('/app/generate?type=fiche_prep', { state: { ...PREPARED, reuse: { ...PREPARED.reuse!, sujet: 'Encore' }, planId: 'a b&c' } });
    });
    await flush(4);
    expect(note(unsaved.container)?.querySelector('a')?.getAttribute('href')).toBe('/app/history?id=a%20b%26c');
  });

  it('démonstration : la page ne propose jamais « Développer une séance » après une séquence « plan d’abord »', async () => {
    const { client, requests } = planClient();
    const { container } = await generatedPlan(client, 'demo');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: 'sequence', planSeulement: true });
    expect(container.textContent).toContain('1789 : la prise de la Bastille');
    expect(section(container)).toBeNull();
    expect(container.textContent).not.toContain('Développer');
  });

  it('arrivée depuis l’Historique avec une demande préparée : formulaire rempli, rien de généré', async () => {
    const { client, requests } = planClient();
    const reuse = {
      type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution — séance 2 : Les causes',
      params: { objectifs: 'Expliquer', consignes: 'Séance 2 sur 4 d\'une séquence « La Révolution ». Respecte ce plan.' },
    };
    const { container } = await mount('/app/generate?type=fiche_prep', client).then(async () => {
      cleanup();
      where = null;
      const store = new MemoryStore([], PROFILE_COLLEGE);
      const view = await render(
        <RuntimeContext.Provider value={fakeRuntime(store, { mode: 'web', client, profile: PROFILE_COLLEGE })}>
          <MemoryRouter initialEntries={[{ pathname: '/app/generate', search: '?type=fiche_prep', state: { reuse, reuseNotice: 'Rappel du plan.' } }]}>
            <Routes>
              <Route path="/app/generate" element={<GeneratePage />} />
            </Routes>
          </MemoryRouter>
        </RuntimeContext.Provider>,
      );
      await flush(6);
      return view;
    });
    expect(value(container, '#gen-sujet')).toBe('La Révolution — séance 2 : Les causes');
    expect(value(container, '#gen-consignes')).toContain('Respecte ce plan.');
    expect(note(container)?.textContent).toContain('Rappel du plan.');
    expect(requests).toHaveLength(0);
  });
});
