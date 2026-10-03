// Document entier entouré de « ```markdown … ``` » : comportement réel de Ministral 3 3B (vrai Ollama,
// scripts/real-ai-check.mjs). La pipeline doit retirer ce bloc AVANT de vérifier les citations, sinon le texte
// est traité comme du code : citations inventées conservées et « Sources utilisées » absente.

import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { MagistraError } from '../../shared/errors';
import { unwrapDocumentFence } from '../../shared/markdownFence';
import { runGeneration } from '../../shared/pipeline';
import type { DocumentPassage, GenerationEvent, GenerationRequest } from '../../shared/types';
import { unwrapDocumentFence as unwrapForDisplay } from '@/lib/generation/result';
import { collect } from './helpers';

const DOC: DocumentPassage = {
  docId: 'eau', docName: 'cycle-de-l-eau.txt', kind: 'txt', locator: { type: 'lines', start: 1, end: 16 },
  text: "L'eau s'évapore sous l'effet de la chaleur du Soleil, se condense en nuages puis retombe en précipitations.",
};

function request(): GenerationRequest {
  return { type: 'cours', niveau: 'cm1', matiere: 'sciences_primaire', sujet: "Le cycle de l'eau", researchMode: 'documents', documents: [DOC] };
}

const FENCED = [
  '```markdown',
  "# Le cycle de l'eau",
  '',
  "L'eau s'évapore puis se condense en nuages [S1, p. 3].",
  'Selon une étude célèbre, la pluie tombe toujours le mardi [S9] (doi:10.9999/invente.2024).',
  '```',
  '',
].join('\n');

describe('bloc englobant SANS langage (« ``` » seul, vrai Ministral 3 3B)', () => {
  it('document rédigé : déballé, refermé ou tronqué (forme réelle de gen2), avec ~~~ ou un bloc intérieur', () => {
    expect(unwrapDocumentFence('```\n# Cours\n\nÉvaporation [S1].\n```')).toBe('# Cours\n\nÉvaporation [S1].');
    const truncated = "```\n[Nom de l'enseignant]\n\n**Objet : Information**\n\nMadame, Monsieur, aux heures d";
    expect(unwrapDocumentFence(truncated)).toBe("[Nom de l'enseignant]\n\n**Objet : Information**\n\nMadame, Monsieur, aux heures d");
    expect(unwrapDocumentFence('~~~\n## Partie 1\n- point\n~~~')).toBe('## Partie 1\n- point');
    expect(unwrapDocumentFence('```\n# TD\n\n```python\nprint(1)\n```\n\nFin [S1].\n```')).toBe('# TD\n\n```python\nprint(1)\n```\n\nFin [S1].');
    const withNote = '```\n# Cours\n\nÉvaporation [S1].\n```\n\n---\n**Note** : relire [S1].\n';
    expect(unwrapDocumentFence(withNote, { complete: true })).toBe('# Cours\n\nÉvaporation [S1].\n\n---\n**Note** : relire [S1].');
  });

  it('vrai code, ou code suivi de prose : jamais modifié (la prose ne devient jamais du code)', () => {
    for (const text of [
      '```\nx = 1\nprint(x)\n```',
      '```\n# Calcul\nfor i in range(3):\n    print(i)\n```',
      '```\nx = 1\n```\n\nExplication [S1].',
      '```\nx = 1\n```\n\nExplica',
      '```\nint main() {\n  return 0;\n}\n```',
      '```\n# Installer\nnpm install\n```',
      '```\n- item\n- item2\n```',
      '```\n',
      '```\n[Nom de',
      '```python\nprint(1)\n```',
    ]) {
      expect(unwrapDocumentFence(text), text).toBe(text);
      expect(unwrapDocumentFence(text, { complete: true }), text).toBe(text);
    }
    // Pendant le flux, une note après la clôture n'est jamais retirée (la clôture pourrait ouvrir un bloc intérieur).
    const stream = '```\n# Cours\n\nÉvaporation [S1].\n```\n\n---\n**Note** : relire [S1].\n';
    expect(unwrapDocumentFence(stream)).toBe(stream);
  });

  it('pipeline : citations vérifiées, [S7] inventée retirée, « Sources utilisées » ajoutée, aucun faux avertissement', async () => {
    const reply = "```\n# Cours\n\nL'eau s'évapore [S1]. Invention [S7].\n```\n";
    const events = await collect<GenerationEvent>(runGeneration(request(), { provider: new MockProvider({ reply, chunkSize: 7 }) }));
    const done = events.find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    expect(done!.content.startsWith('```')).toBe(false);
    expect(done!.content).not.toContain('[S7]');
    expect(done!.content).toContain('## Sources utilisées');
    expect(done!.content).toContain('[S1] cycle-de-l-eau.txt');
    expect(done!.content).not.toContain('Aucune des sources fournies');
    expect(done!.sources.map(x => x.n)).toEqual([1]);
    expect(unwrapForDisplay(reply)).toBe("# Cours\n\nL'eau s'évapore [S1]. Invention [S7].");
  });

  it('pipeline : texte tronqué (longueur maximale) dans un bloc sans langage : même vérification', async () => {
    const reply = "```\n# Cours\n\nL'eau s'évapore [S1]. Invention [S7].\n\nLa suite n'arrive jam";
    const events = await collect<GenerationEvent>(runGeneration(request(), { provider: new MockProvider({ reply, chunkSize: 7, finishReason: 'length' }) }));
    const done = events.find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    expect(done!.content.startsWith('```')).toBe(false);
    expect(done!.content).not.toContain('[S7]');
    expect(done!.content).toContain('## Sources utilisées');
  });
});

describe('unwrapDocumentFence (cœur partagé)', () => {
  it('retire le bloc englobant, refermé ou non (texte tronqué)', () => {
    expect(unwrapDocumentFence('```markdown\n# Titre\n\nTexte.\n```')).toBe('# Titre\n\nTexte.');
    expect(unwrapDocumentFence('\n```md\n# Titre\n```\n\n')).toBe('# Titre');
    expect(unwrapDocumentFence('~~~markdown\n# Titre\n~~~')).toBe('# Titre');
    expect(unwrapDocumentFence('```markdown\n# Titre\n\nDébut')).toBe('# Titre\n\nDébut');
  });

  it('garde les blocs de code intérieurs et ne touche pas un vrai bloc de code', () => {
    expect(unwrapDocumentFence('```markdown\n# TD\n\n```python\nprint(1)\n```\n\nFin.\n```')).toBe('# TD\n\n```python\nprint(1)\n```\n\nFin.');
    expect(unwrapDocumentFence('```markdown\n# TD\n\n```python\nprint(1)\n```')).toBe('# TD\n\n```python\nprint(1)\n```');
    for (const text of ['# Titre\n\nTexte.', '```python\nprint(1)\n```', 'Intro\n```markdown\nexemple\n```', '']) {
      expect(unwrapDocumentFence(text)).toBe(text);
    }
  });

  it('texte complet : bloc englobant refermé PUIS suivi d’une note (non-régression, vrai Ministral 3 3B)', () => {
    // Forme réelle observée dans l'application Windows avec un vrai Ollama : blocs intérieurs indentés dans des
    // listes, clôture du bloc englobant, puis une « Note pour l'enseignant ». Sans correction, cette clôture isolée
    // ouvrait un bloc de code jusqu'à la fin du document (note et « Sources utilisées » en texte brut).
    const real = [
      '```markdown',
      "# **Le cycle de l'eau**",
      '- **Exemple** :',
      '    ```',
      'Évaporation → Condensation → Précipitations',
      '    ```',
      '- **Résumé** :',
      '  ```',
      'Évaporation (océan) → Condensation (nuages)',
      '  ```',
      '- Schéma du cycle de l’eau ([S1]).',
      '```',
      '',
      '---',
      "**Note pour l'enseignant** :",
      '- Ce cours intègre la lecture du texte fourni ([S1]).',
    ].join('\n');
    const unwrapped = unwrapDocumentFence(real, { complete: true });
    expect(unwrapped.startsWith("# **Le cycle de l'eau**")).toBe(true);
    expect(unwrapped.split('\n').filter(l => l.trim().startsWith('```'))).toHaveLength(4);
    expect(unwrapped).toContain("- Schéma du cycle de l’eau ([S1]).\n\n---\n**Note pour l'enseignant** :");
    // Pendant le flux ou pour un texte tronqué, rien n'est deviné (la dernière clôture peut ouvrir un vrai bloc).
    expect(unwrapDocumentFence(real)).toBe(real.slice('```markdown\n'.length));
    // Un bloc intérieur indenté n'est jamais pris pour la clôture du bloc englobant.
    const inner = '```markdown\n# A\n\n- liste :\n  ```\n  code\n  ```\n- suite\n  ```\n  encore';
    expect(unwrapDocumentFence(inner, { complete: true })).toBe(inner.slice('```markdown\n'.length));
  });

  it("même résultat que l'affichage de l'interface (src/lib/generation/result.ts)", () => {
    for (const text of [FENCED, '```md\n# A\n```', '```markdown\n# A\n\n```js\nx\n```', 'Texte', '```python\nx\n```']) {
      expect(unwrapDocumentFence(text)).toBe(unwrapForDisplay(text));
    }
  });
});

describe('pipeline : réponse entourée de « ```markdown »', () => {
  it('citations vérifiées, inventions retirées et « Sources utilisées » ajoutée', async () => {
    const provider = new MockProvider({ reply: FENCED, chunkSize: 7 });
    const events = await collect<GenerationEvent>(runGeneration(request(), { provider }));
    const done = events.find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    expect(done).toBeDefined();
    const content = done!.content;
    expect(content.startsWith('```')).toBe(false);
    expect(content).toContain("se condense en nuages [S1].");
    expect(content).not.toContain('[S9]');
    expect(content).not.toContain('10.9999/invente.2024');
    expect(content).toContain('## Sources utilisées');
    expect(content).toContain('[S1] cycle-de-l-eau.txt — lignes 1 à 16');
    expect(done!.sources.map(s => s.n)).toEqual([1]);
  });

  it('bloc englobant refermé avant une note finale : note et « Sources utilisées » restent du Markdown', async () => {
    const reply = '```markdown\n# Cours\n\nÉvaporation [S1].\n```\n\n---\n**Note** : relire le texte fourni [S1].\n';
    const events = await collect<GenerationEvent>(runGeneration(request(), { provider: new MockProvider({ reply, chunkSize: 9 }) }));
    const done = events.find((e): e is Extract<GenerationEvent, { type: 'done' }> => e.type === 'done');
    expect(done!.content).not.toContain('```');
    expect(done!.content.replace(/\u00a0/g, ' ')).toContain('**Note** : relire le texte fourni [S1].');
    expect(done!.content).toMatch(/\n## Sources utilisées\n\n- \[S1\] cycle-de-l-eau\.txt/);
  });

  it('texte partiel après une panne : même vérification', async () => {
    const reply = '```markdown\n# Cours\n\nÉvaporation [S1]. Invention [S7].\n\nSuite du cours qui ne viendra jamais.';
    const provider = new MockProvider({ reply, chunkSize: 12, failAfterChunks: 4, failWith: new MagistraError('AI_SERVER_UNAVAILABLE') });
    const events = await collect<GenerationEvent>(runGeneration(request(), { provider, retryDelaysMs: [] }));
    const error = events.find((e): e is Extract<GenerationEvent, { type: 'error' }> => e.type === 'error');
    expect(error?.partial).toBeDefined();
    expect(error!.partial!.startsWith('```')).toBe(false);
    expect(error!.partial).toContain('Évaporation [S1].');
    expect(error!.partial).not.toContain('[S7]');
    expect(error!.partial).toContain('## Sources utilisées');
  });
});
