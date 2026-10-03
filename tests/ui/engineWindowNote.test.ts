// Message « une fenêtre Ollama peut s'ouvrir : fermez-la » (installation de l'IA, application Windows) :
//  - un texte constant UNIQUE, jamais recopié dans un composant ;
//  - la règle des textes de Magistra locale (« jamais le nom du moteur ») n'a qu'une exception : ces deux textes ;
//  - ils ne servent jamais sur le site (filtre des messages venus de l'application, graphe d'imports du site vitrine).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as texts from '@/components/localEngine/texts';
import * as windowsTexts from '@/components/localEngine/windowsTexts';
import { ENGINE_WINDOW_DONE_NOTE, ENGINE_WINDOW_NOTE } from '@/components/localEngine/texts';
import { isDisplayableText, localEngineMessage } from '@/lib/localConnector/texts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Les seuls textes de ces fichiers autorisés à nommer le moteur (par nom d'export). */
const MAY_NAME_THE_ENGINE = ['ENGINE_WINDOW_DONE_NOTE', 'ENGINE_WINDOW_NOTE'];

/** Chaînes écrites dans un module de textes : les exports qui sont du texte ou une liste de textes. */
function stringExports(mod: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'string') out.push([name, value]);
    else if (Array.isArray(value) && value.every(v => typeof v === 'string')) out.push([name, value.join(' ')]);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('Message sur la fenêtre d’Ollama : texte', () => {
  it('avant et pendant : fenêtre Ollama possible, c’est normal, ce qu’est Ollama, la fermer simplement, Magistra continue', () => {
    expect(ENGINE_WINDOW_NOTE).toMatch(/une fenêtre Ollama peut s’ouvrir/);
    expect(ENGINE_WINDOW_NOTE).toMatch(/c’est normal/);
    expect(ENGINE_WINDOW_NOTE).toMatch(/Ollama est le moteur d’IA qui fonctionne sur votre ordinateur/);
    expect(ENGINE_WINDOW_NOTE).toMatch(/Fermez-la simplement/);
    expect(ENGINE_WINDOW_NOTE).toMatch(/Magistra continue/);
    // L'icône près de l'horloge peut rester : le moteur doit continuer à tourner.
    expect(ENGINE_WINDOW_NOTE).toMatch(/icône d’Ollama près de l’horloge peut rester/);
  });

  it('après : « si elle est encore ouverte », sans promettre qu’elle s’ouvre ni dire « pendant l’installation »', () => {
    expect(ENGINE_WINDOW_DONE_NOTE).toMatch(/Si une fenêtre Ollama est encore ouverte/);
    expect(ENGINE_WINDOW_DONE_NOTE).toMatch(/vous pouvez la fermer/);
    expect(ENGINE_WINDOW_DONE_NOTE).toMatch(/l’IA de Magistra continue de fonctionner/);
    expect(ENGINE_WINDOW_DONE_NOTE).not.toMatch(/Pendant l’installation|peut s’ouvrir/);
  });

  it('courts, en français soigné : une ou deux phrases d’explication, pas de détail technique', () => {
    for (const note of [ENGINE_WINDOW_NOTE, ENGINE_WINDOW_DONE_NOTE]) {
      expect(note.length, note).toBeLessThan(300);
      expect(note).not.toMatch(/localhost|127\.0\.0\.1|11434|\.exe|--hide|processus|port\b/i);
      expect(note).not.toMatch(/ {2}|'/);
    }
  });
});

describe('Règle « jamais le nom du moteur » : seul ce message y fait exception', () => {
  it('dans les textes de Magistra locale (texts.ts, windowsTexts.ts), seuls les deux textes sur la fenêtre nomment Ollama', () => {
    const naming = [...stringExports(texts), ...stringExports(windowsTexts)]
      .filter(([, value]) => /ollama/i.test(value))
      .map(([name]) => name)
      .sort();
    expect(naming).toEqual(MAY_NAME_THE_ENGINE);
  });

  it('contre-épreuve : le parcours des exports voit bien les textes (ils ne sont pas vides)', () => {
    const names = stringExports(texts).map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(['LOCAL_INTRO_TEXT', 'NOT_DETECTED_DETAIL', 'ENGINE_WINDOW_NOTE', 'ENGINE_WINDOW_DONE_NOTE']));
    expect(stringExports(windowsTexts).map(([name]) => name)).toEqual(expect.arrayContaining(['INSTALL_STEPS', 'ACTIVATE_AI_NOTE']));
  });
});

describe('Texte unique, jamais dupliqué', () => {
  it('la phrase affichée n’est écrite que dans localEngine/texts.ts (hors commentaires)', () => {
    const carriers = sourceFiles(path.join(root, 'src'))
      .filter(file => /fenêtre Ollama|peut s(?:’|')ouvrir/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(file => path.relative(root, file).split(path.sep).join('/'));
    expect(carriers).toEqual(['src/components/localEngine/texts.ts']);
  });

  it('chaque endroit qui l’affiche passe par EngineWindowNote, qui lit les constantes', () => {
    const note = readFileSync(path.join(root, 'src/components/ai/EngineWindowNote.tsx'), 'utf8');
    expect(note).toContain("from '@/components/localEngine/texts'");
    expect(note).toMatch(/ENGINE_WINDOW_NOTE/);
    expect(note).toMatch(/ENGINE_WINDOW_DONE_NOTE/);
    for (const file of ['src/components/ai/ActivateAICard.tsx', 'src/components/ai/EngineSetupPanel.tsx', 'src/pages/SetupPage.tsx']) {
      const source = stripComments(readFileSync(path.join(root, file), 'utf8'));
      expect(source, file).toContain('<EngineWindowNote');
      expect(source, file).not.toMatch(/ENGINE_WINDOW_(?:DONE_)?NOTE/);
    }
  });
});

describe('Jamais sur le site', () => {
  it('le filtre des messages venus de l’application les refuse (ils nomment le moteur) : ils ne passent jamais par le site', () => {
    expect(isDisplayableText(ENGINE_WINDOW_NOTE)).toBe(false);
    expect(isDisplayableText(ENGINE_WINDOW_DONE_NOTE)).toBe(false);
    for (const note of [ENGINE_WINDOW_NOTE, ENGINE_WINDOW_DONE_NOTE]) {
      expect(localEngineMessage('ENGINE_NOT_RUNNING', note)).not.toMatch(/Ollama/);
    }
  });
});
