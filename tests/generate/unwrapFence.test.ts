import { describe, expect, it } from 'vitest';
import { unwrapDocumentFence } from '@/lib/generation/result';
import { exportDocFor } from '@/components/history/logic';
import { makeRecord } from '../ui/helpers';

describe('unwrapDocumentFence', () => {
  it('retire le bloc englobant « ```markdown … ``` »', () => {
    expect(unwrapDocumentFence('```markdown\n# Titre\n\nTexte.\n```')).toBe('# Titre\n\nTexte.');
    expect(unwrapDocumentFence('\n```md\n# Titre\n```\n\n')).toBe('# Titre');
    expect(unwrapDocumentFence('~~~markdown\n# Titre\n~~~')).toBe('# Titre');
  });

  it('pendant le flux (clôture pas encore reçue)', () => {
    expect(unwrapDocumentFence('```markdown\n# Titre\n\nDébut')).toBe('# Titre\n\nDébut');
  });

  it('garde les blocs de code intérieurs', () => {
    const doc = '```markdown\n# TD\n\n```python\nprint(1)\n```\n\nFin.\n```';
    expect(unwrapDocumentFence(doc)).toBe('# TD\n\n```python\nprint(1)\n```\n\nFin.');
    // Bloc englobant jamais refermé : la clôture finale appartient au bloc intérieur, elle reste.
    const open = '```markdown\n# TD\n\n```python\nprint(1)\n```';
    expect(unwrapDocumentFence(open)).toBe('# TD\n\n```python\nprint(1)\n```');
  });

  it('ne touche pas un document normal ni un vrai bloc de code initial', () => {
    for (const text of ['# Titre\n\nTexte.', '```python\nprint(1)\n```', 'Intro\n```markdown\nexemple\n```', '']) {
      expect(unwrapDocumentFence(text)).toBe(text);
    }
  });

  it('bloc sans langage autour d’un document rédigé (vrai Ministral 3 3B) : retiré ; autour de code : conservé', () => {
    expect(unwrapDocumentFence("```\n[Nom de l'enseignant]\n\n**Objet : Sortie**\n\nMadame, Monsieur,\n```")).toBe(
      "[Nom de l'enseignant]\n\n**Objet : Sortie**\n\nMadame, Monsieur,",
    );
    expect(unwrapDocumentFence('```\nx = 1\nprint(x)\n```')).toBe('```\nx = 1\nprint(x)\n```');
    const doc = exportDocFor(makeRecord(1, { contenu: '```\n# Titre\n\n- point **important**\n```' }));
    expect(doc.content).toBe('# Titre\n\n- point **important**');
  });

  it('historique : export et affichage sans le bloc englobant', () => {
    const doc = exportDocFor(makeRecord(1, { contenu: '```markdown\n# Titre\n```' }));
    expect(doc.content).toBe('# Titre');
  });
});
