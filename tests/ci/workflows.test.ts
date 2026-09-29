// Garde-fous des workflows GitHub Actions de publication et de validation avec une vraie IA, et cohérence de la
// documentation avec le code (préréglages, commandes). Contrôles textuels : aucune dépendance YAML ajoutée ;
// la syntaxe elle-même est vérifiée par GitHub (et par actionlint en local).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import playwrightConfig from '../../playwright.config';
import { LOCAL_NETWORK_ACCESS_ARGS, OTHER_SITE_PORT, SITE_PORT } from '../../e2e/connector-harness/sites';
import { PROVIDER_PRESETS } from '../../shared/ai/presets';
import { MIN_OLLAMA_VERSION } from '../../shared/ai/models';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const realAI = read('.github/workflows/real-ai.yml');
const readme = read('README.md');
const architecture = read('ARCHITECTURE_IA.md');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** Workflow sans ses lignes de commentaire (les explications citent des commandes). */
function code(text: string): string {
  return text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
}

/** Lignes « uses: » d'un workflow (actions externes). */
function usesLines(text: string): string[] {
  return text.split('\n').filter(l => /^\s*-?\s*uses:\s/.test(l));
}

/** Texte d'un job : de « <nom>: » (2 espaces) au job suivant. */
function job(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l === `  ${name}:`);
  if (start < 0) throw new Error(`job ${name} introuvable`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

describe.each([
  ['release.yml', release],
  ['real-ai.yml', realAI],
])('%s : chaîne d’approvisionnement', (_name, text) => {
  it('toutes les actions sont épinglées par SHA de commit (version en commentaire)', () => {
    const uses = usesLines(text);
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line, line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  it('jeton en lecture seule par défaut, identifiants git non conservés', () => {
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text).toContain('persist-credentials: false');
  });

  it('aucune valeur saisie insérée directement dans un script shell', () => {
    // Les entrées de workflow_dispatch passent par « env: » puis "$VARIABLE" (injection impossible).
    const runBlocks = text.split(/\n\s+run: \|?/).slice(1).map(b => b.split(/\n\s{6}- /)[0]);
    for (const block of runBlocks) expect(block).not.toMatch(/\$\{\{\s*(github\.event\.inputs|inputs)\./);
  });
});

describe('release.yml : application Windows publiée en brouillon', () => {
  it('déclenché par un tag v* ou à la main, jamais par une branche', () => {
    expect(release).toMatch(/on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:/);
    expect(release).not.toMatch(/branches:/);
  });

  it('construction sous Windows : npm ci, build web + Electron, NSIS + zip sans publication, empreintes', () => {
    const build = job(release, 'build');
    expect(build).toContain('runs-on: windows-latest');
    for (const step of ['run: npm ci', 'run: npm run build', 'run: node scripts/build-electron.mjs',
      'npx electron-builder --win nsis zip --x64 --publish never', 'sha256sum "${files[@]}" > SHA256SUMS.txt']) {
      expect(build).toContain(step);
    }
    expect(build).not.toMatch(/^\s+contents: write$/m);
    expect(build).toContain('package-manager-cache: false');
  });

  it('seul le job release peut écrire, et il crée un BROUILLON sans jamais créer de tag', () => {
    const rel = job(release, 'release');
    // Clés YAML seulement (les commentaires en parlent aussi).
    expect(release.match(/^\s+contents: write$/gm)).toHaveLength(1);
    expect(rel).toMatch(/^\s+contents: write$/m);
    expect(rel).toContain('gh release create "$TAG" "${files[@]}" --draft --verify-tag');
    expect(rel).toContain('sha256sum --check --strict SHA256SUMS.txt');
    expect(rel).toContain('GH_TOKEN: ${{ github.token }}');
    expect(rel).not.toMatch(/npm |node /);
    expect(code(release)).not.toMatch(/git (tag|push)\b/);
    expect(code(release)).not.toMatch(/secrets\./);
  });

  it('le tag doit correspondre à la version de package.json (vérification de mise à jour)', () => {
    expect(release).toContain(`version="$(node -p "require('./package.json').version")"`);
    expect(release).toContain('[ "$TAG" != "v$version" ]');
  });
});

describe('real-ai.yml : validation avec une vraie IA', () => {
  it('hebdomadaire et à la main, sans droit d’écriture', () => {
    expect(realAI).toMatch(/schedule:\n\s+- cron: '[^']+'/);
    expect(realAI).toContain('workflow_dispatch:');
    expect(realAI).not.toMatch(/^\s+contents: write$/m);
  });

  it('vrai Ollama (image épinglée par empreinte), petit modèle Apache 2.0, cache du modèle', () => {
    expect(realAI).toMatch(/ollama\/ollama:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}/);
    expect(realAI).toContain("ministral-3:3b");
    expect(realAI).toContain('docker exec ollama ollama pull "$MODEL"');
    expect(realAI).toMatch(/uses: actions\/cache@[0-9a-f]{40}/);
    expect(realAI).toContain('path: ~/.ollama-ci/models');
    // Le port d'Ollama n'est ouvert que sur la boucle locale du runner.
    expect(realAI).toContain('-p 127.0.0.1:11434:11434');
  });

  it('lance npm run test:real-ai avec des délais généreux et joint le rapport', () => {
    expect(realAI).toContain('run: npm run test:real-ai');
    expect(realAI).toContain("REAL_AI_TIMEOUT_S: '1200'");
    expect(realAI).toContain('REAL_AI_REPORT: rapport-vraie-ia/rapport.json');
    expect(pkg.scripts['test:real-ai']).toBe('node scripts/real-ai-check.mjs');
  });
});

describe('documentation', () => {
  it('README : « Brancher une vraie IA » en tête, avec les trois chemins', () => {
    const at = readme.indexOf('## Brancher une vraie IA');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(readme.indexOf('## Fonctionnalités'));
    for (const heading of ['### 1. Site en ligne (Vercel)', '### 2. En local', '### 3. Application Windows']) expect(readme).toContain(heading);
  });

  it('README : les ancres citées par l’interface, la note de version et le README existent', () => {
    // Ancre « à la GitHub » : minuscules, ponctuation retirée, espaces remplacés par des tirets.
    const slug = (title: string) => title.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const anchors = new Set(readme.split('\n').filter(l => /^#{1,6}\s/.test(l)).map(l => slug(l.replace(/^#+\s*/, ''))));
    const links = read('src/lib/links.ts');
    const fromUi = /README_AI_SECTION_URL = `\$\{REPOSITORY_URL\}#([a-z0-9-]+)`/.exec(links)?.[1];
    expect(fromUi).toBe('brancher-une-vraie-ia');
    expect(anchors).toContain(fromUi);
    const fromRelease = /\$SERVER\/\$REPO#([a-z0-9-]+)/.exec(release)?.[1];
    expect(fromRelease).toBe(fromUi);
    for (const [, anchor] of readme.matchAll(/\]\(#([^)]+)\)/g)) expect(anchors, anchor).toContain(anchor);
  });

  it('README : chaque préréglage du code figure dans le tableau', () => {
    for (const preset of PROVIDER_PRESETS) expect(readme, preset.id).toContain(`| \`${preset.id}\` |`);
    expect(readme).toContain('AI_PRESET=ovhcloud');
  });

  it('README : commandes de vérification exactes', () => {
    expect(readme).toContain('npx vercel env pull --environment=production .env.prod.local && npm run ai:check -- --vercel --env-file .env.prod.local');
    expect(readme).toContain('ollama pull ministral-3:8b');
    expect(readme).toContain('npm run test:real-ai');
    expect(pkg.scripts['ai:check']).toBeDefined();
  });

  it('version minimale d’Ollama identique au code', () => {
    expect(readme).toContain(`Ollama ${MIN_OLLAMA_VERSION}`);
    expect(architecture).toContain(MIN_OLLAMA_VERSION);
  });

  it('ARCHITECTURE_IA.md : sections ajoutées', () => {
    for (const title of ['Préréglages et confidentialité par prestataire', 'Mode personnel', 'Détection automatique', 'npm run ai:check',
      'Quotas', 'État « non vérifié »', 'Mise à jour du moteur', 'Proxy', 'Validation avec une vraie IA']) {
      expect(architecture, title).toContain(title);
    }
  });
});

describe('ci.yml et Playwright : E2E du connecteur local', () => {
  it('job « electron » : trousseau de clés, construction du site et de l’application, puis projets « electron » et « connector »', () => {
    const electron = job(ci, 'electron');
    // Dans cet ordre : chaque étape a besoin des précédentes.
    const steps = [
      'run: npx playwright install --with-deps chromium',
      'apt-get install -y --no-install-recommends gnome-keyring dbus',
      'run: npx vite build',
      'run: node scripts/build-electron.mjs',
      'run: xvfb-run -a npm run test:e2e -- --project=electron',
      'run: xvfb-run -a npm run test:e2e -- --project=connector',
    ];
    let previous = -1;
    for (const step of steps) {
      const at = electron.indexOf(step);
      expect(at, step).toBeGreaterThan(previous);
      previous = at;
    }
    expect(electron).toContain('path: test-results/connector-screens');
    // Le projet « web » reste lancé seul dans son job.
    expect(job(ci, 'e2e-web')).toContain('run: npm run test:e2e -- --project=web');
  });

  it('chaque fichier E2E appartient à exactement un projet ; « connector » active la protection Local Network Access', () => {
    const projects = playwrightConfig.projects ?? [];
    expect(projects.map(p => p.name)).toEqual(['web', 'electron', 'connector']);
    const specs = readdirSync(path.join(root, 'e2e')).filter(f => f.endsWith('.spec.ts'));
    expect(specs).toContain('connector-local.spec.ts');
    for (const spec of specs) {
      const owners = projects.filter(p => p.testMatch instanceof RegExp && p.testMatch.test(path.join(root, 'e2e', spec)));
      expect(owners.map(p => p.name), spec).toHaveLength(1);
    }
    const connector = projects.find(p => p.name === 'connector')!;
    expect(connector.use?.launchOptions?.args).toEqual([...LOCAL_NETWORK_ACCESS_ARGS]);
    expect(LOCAL_NETWORK_ACCESS_ARGS).toContain('--enable-features=LocalNetworkAccessChecks');
    expect(LOCAL_NETWORK_ACCESS_ARGS).toContain(`--ip-address-space-overrides=127.0.0.1:${SITE_PORT}=public,127.0.0.1:${OTHER_SITE_PORT}=public`);
    // Aucun contournement : ni désactivation des contrôles, ni autorisation accordée d'office à tous les tests.
    expect(JSON.stringify(playwrightConfig)).not.toMatch(/disable-features=[^"]*LocalNetworkAccess|local-network-access|disable-web-security/i);
  });

  it('le harnais E2E n’entre jamais dans le site publié', () => {
    expect(read('vite.config.ts')).not.toMatch(/e2e|connector-harness/);
    const app = JSON.parse(read('tsconfig.app.json')) as { include: string[] };
    expect(app.include).not.toContain('e2e');
    const harness = read('e2e/connector-harness/vite.config.ts');
    expect(harness).toContain("path.join(root, 'test-results', 'connector-harness-dist')");
    expect(read('.gitignore').split('\n')).toContain('test-results');
    expect(read('index.html')).not.toContain('connector-harness');
  });
});
