// Le point du nom « Magistra. » est doré partout où le nom est écrit avec son point (jamais la couleur d'accent violette).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const WORDMARK_FILES = [
  'src/components/layout/AppLayout.tsx',
  'src/components/PersonalAccess.tsx',
  'src/pages/legal/LegalParts.tsx',
  'src/pages/landing/LandingContent.tsx',
  'src/pages/SetupPage.tsx',
];

describe('point doré du nom « Magistra. »', () => {
  it('chaque nom écrit avec son point utilise la couleur dorée, jamais l’accent', () => {
    for (const file of WORDMARK_FILES) {
      const source = read(file);
      expect(source, file).toMatch(/Magistra<span className="text-gold">\.<\/span>/);
      expect(source, file).not.toMatch(/Magistra<span className="text-accent">\.<\/span>/);
    }
  });

  it('aucun point de nom ne reste à la couleur d’accent dans src/ (tous les fichiers)', () => {
    const files = [...WORDMARK_FILES, 'src/components/AppIntro.tsx'];
    for (const file of files) expect(read(file), file).not.toMatch(/text-accent">\.<\/span>/);
  });

  it('la couleur dorée est définie une fois et l’animation d’ouverture (.intro-dot) l’utilise', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/--color-gold:\s*#d4af37;/);
    expect(css).toMatch(/\.intro-dot\s*\{[^}]*color:\s*var\(--color-gold\)/);
    expect(css).not.toMatch(/\.intro-dot\s*\{[^}]*color:\s*var\(--color-accent\)/);
  });
});
