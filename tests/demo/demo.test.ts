// Mode démonstration : qualité des exemples pré-rédigés et restitution en flux.

import { describe, expect, it } from 'vitest';
import { ALL_TYPES, type TypeContenu } from '@shared/catalog';
import { DEMO_NOTICE, getDemoExample, runDemoGeneration } from '@shared/demo';
import { DEMO_CONTENT, type DemoExample } from '@shared/demo/content';
import type { NiveauScolaire } from '@shared/levels';
import type { GenerationEvent, GenerationRequest } from '@shared/types';
import { COMMERCIAL_VENDOR } from '../vendor';

/** Mots au sens usuel : suites de lettres ou de chiffres (les signes Markdown ne comptent pas). */
function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

const hasTable = (md: string) => /^\|.*\|\s*$/m.test(md) && /^\|(\s*:?-{3,}:?\s*\|)+\s*$/m.test(md);
const hasQuote = (md: string) => /^> \S/m.test(md);

type Variant = 'scolaire' | 'superieur';
const EXAMPLES: [string, TypeContenu, Variant, DemoExample][] = ALL_TYPES.flatMap(type => {
  const entry = DEMO_CONTENT[type];
  const list: [string, TypeContenu, Variant, DemoExample][] = [[`${type} (scolaire)`, type, 'scolaire', entry.scolaire]];
  if (entry.superieur) list.push([`${type} (supérieur)`, type, 'superieur', entry.superieur]);
  return list;
});

function request(type: TypeContenu, niveau: NiveauScolaire): GenerationRequest {
  return { type, niveau, matiere: 'autre', sujet: 'Sujet quelconque', researchMode: 'documents' };
}

async function collect(gen: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('DEMO_CONTENT', () => {
  it('couvre exactement les 11 outils', () => {
    expect(Object.keys(DEMO_CONTENT).sort()).toEqual([...ALL_TYPES].sort());
    expect(ALL_TYPES).toHaveLength(11);
  });

  it("propose une variante supérieur pour chaque outil (sauf éventuellement le cahier journal)", () => {
    for (const type of ALL_TYPES.filter(t => t !== 'cahier_journal')) {
      expect(DEMO_CONTENT[type].superieur, type).toBeDefined();
    }
  });

  it.each(EXAMPLES)('%s : contenu réel, propre et assez long', (_label, _type, _variant, example) => {
    const md = example.markdown;
    expect(example.subject.trim().length).toBeGreaterThan(0);
    expect(example.level.trim().length).toBeGreaterThan(0);
    const words = countWords(md);
    expect(words).toBeGreaterThanOrEqual(250);
    expect(words).toBeLessThanOrEqual(700);
    expect(md).toMatch(/^#{1,3} \S/m);
    expect(md).not.toMatch(/lorem/i);
    expect(md).not.toMatch(/cl[ée]\s*api/i);
    expect(md).not.toMatch(COMMERCIAL_VENDOR);
    expect(md).not.toMatch(/10\.\d{4,}\//);
    expect(md).not.toMatch(/\bdoi\s*:/i);
    expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
    // Aucun « $ » : il serait interprété comme délimiteur mathématique par le rendu.
    expect(md).not.toContain('$');
  });

  it('montre un Markdown riche : tableaux et citations dans la plupart des exemples', () => {
    const withTable = EXAMPLES.filter(([, , , e]) => hasTable(e.markdown)).length;
    const withQuote = EXAMPLES.filter(([, , , e]) => hasQuote(e.markdown)).length;
    expect(withTable / EXAMPLES.length).toBeGreaterThanOrEqual(0.8);
    expect(withQuote / EXAMPLES.length).toBeGreaterThanOrEqual(0.8);
  });

  it('appréciations : 10 appréciations numérotées (scolaire) et 6 commentaires (supérieur)', () => {
    expect(DEMO_CONTENT.appreciations.scolaire.markdown.match(/^\d{1,2}\. \S/gm)).toHaveLength(10);
    expect(DEMO_CONTENT.appreciations.superieur?.markdown.match(/^\*\*\d\. /gm)).toHaveLength(6);
  });

  it('différenciation : trois versions du même exercice', () => {
    for (const e of [DEMO_CONTENT.differenciation.scolaire, DEMO_CONTENT.differenciation.superieur!]) {
      for (const label of ['Accompagnement renforcé', 'Standard', 'Approfondissement']) {
        expect(e.markdown, label).toMatch(new RegExp(`^## .*${label}`, 'm'));
      }
    }
  });

  it('courrier : champs entre crochets, et message supérieur adressé aux étudiants', () => {
    expect(DEMO_CONTENT.lettre_parents.scolaire.markdown).toMatch(/\[Nom de l'élève\]/);
    expect(DEMO_CONTENT.lettre_parents.scolaire.markdown).toMatch(/\[Date[^\]]*\]/);
    const sup = DEMO_CONTENT.lettre_parents.superieur!.markdown;
    expect(sup).toMatch(/étudiants/i);
    expect(sup).not.toMatch(/parent/i);
    expect(sup).toMatch(/\[[^\]]+\]/);
  });

  it("corrigé : texte d'élève cité puis correction, note sur 20 à partir du collège", () => {
    for (const e of [DEMO_CONTENT.corrige.scolaire, DEMO_CONTENT.corrige.superieur!]) {
      expect(e.markdown).toMatch(/^> \S/m);
      expect(e.markdown).toMatch(/\/20/);
    }
  });
});

describe('getDemoExample', () => {
  it('choisit la variante supérieur pour un niveau master_1', () => {
    expect(getDemoExample({ type: 'cours', niveau: 'master_1' })).toBe(DEMO_CONTENT.cours.superieur);
    for (const type of ALL_TYPES) {
      const expected = DEMO_CONTENT[type].superieur ?? DEMO_CONTENT[type].scolaire;
      expect(getDemoExample({ type, niveau: 'master_1' }), type).toBe(expected);
    }
  });

  it('choisit la variante scolaire pour un niveau 5eme', () => {
    expect(getDemoExample({ type: 'cours', niveau: '5eme' })).toBe(DEMO_CONTENT.cours.scolaire);
    for (const type of ALL_TYPES) {
      expect(getDemoExample({ type, niveau: '5eme' }), type).toBe(DEMO_CONTENT[type].scolaire);
    }
  });

  it('traite BTS, licence et doctorat comme du supérieur, le CP comme du scolaire', () => {
    for (const niveau of ['bts', 'licence_1', 'doctorat'] as NiveauScolaire[]) {
      expect(getDemoExample({ type: 'exercices', niveau })).toBe(DEMO_CONTENT.exercices.superieur);
    }
    expect(getDemoExample({ type: 'exercices', niveau: 'cp' })).toBe(DEMO_CONTENT.exercices.scolaire);
  });
});

describe('runDemoGeneration', () => {
  it('émet des évènements delta puis un done qui commence par le bandeau de démonstration', async () => {
    const req = request('cours', 'master_1');
    const events = await collect(runDemoGeneration(req, { delayMs: 0 }));
    const types = events.map(e => e.type);

    expect(types).not.toContain('error');
    const firstDelta = types.indexOf('delta');
    const doneIndex = types.indexOf('done');
    expect(firstDelta).toBeGreaterThanOrEqual(0);
    expect(types.filter(t => t === 'delta').length).toBeGreaterThan(1);
    expect(doneIndex).toBe(events.length - 1);
    expect(firstDelta).toBeLessThan(doneIndex);
    expect(types.slice(firstDelta, doneIndex).every(t => t === 'delta')).toBe(true);

    const done = events[doneIndex];
    if (done.type !== 'done') throw new Error('évènement done attendu');
    const streamed = events.map(e => (e.type === 'delta' ? e.text : '')).join('');
    expect(streamed).toBe(done.content);
    expect(done.content.startsWith(`> ${DEMO_NOTICE}`)).toBe(true);
    expect(done.content).toContain(DEMO_CONTENT.cours.superieur!.subject);
    expect(done.content).toContain(DEMO_CONTENT.cours.superieur!.markdown.trim());
    expect(done.model).toBe('démonstration');
    expect(done.saved).toBe(false);
    expect(done.internetUsed).toBe(false);
  });

  it.each(ALL_TYPES)('%s : restitue l’exemple scolaire pour un niveau de collège', async type => {
    const events = await collect(runDemoGeneration(request(type, '5eme'), { delayMs: 0 }));
    const done = events.at(-1);
    if (done?.type !== 'done') throw new Error('évènement done attendu');
    expect(done.content.startsWith(`> ${DEMO_NOTICE}`)).toBe(true);
    expect(done.content).toContain(DEMO_CONTENT[type].scolaire.markdown.trim());
  });

  it("s'interrompt proprement si la génération est annulée", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(runDemoGeneration(request('cours', '5eme'), { signal: controller.signal, delayMs: 0 }));
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.code).toBe('GENERATION_ABORTED');
    expect(events.some(e => e.type === 'done')).toBe(false);
  });
});
