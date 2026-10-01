// Garde-fous des workflows GitHub Actions de publication et de validation avec une vraie IA, et cohérence de la
// documentation avec le code (préréglages, commandes). Contrôles textuels : aucune dépendance YAML ajoutée ;
// la syntaxe elle-même est vérifiée par GitHub (et par actionlint en local).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import playwrightConfig from '../../playwright.config';
import { LOCAL_NETWORK_ACCESS_ARGS, OTHER_SITE_PORT, SITE_PORT } from '../../e2e/connector-harness/sites';
import { CONNECTOR_HARNESS_DIR, CONNECTOR_HARNESS_DIRS, CONNECTOR_PROJECTS, E2E_OUTPUT_DIRS, E2E_SCREENSHOT_DIRS, type E2EProject } from '../../e2e/outputDirs';
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

/** Étape d'un job (de sa ligne « - » à l'étape suivante) contenant `marker`. */
function stepWith(jobText: string, marker: string): string {
  const steps = jobText.split(/\n(?= {6}- )/);
  const found = steps.filter(step => step.includes(marker));
  if (found.length !== 1) throw new Error(`étape « ${marker} » : ${found.length} trouvée(s)`);
  return found[0];
}

/** Texte d'un job : de « <nom>: » (2 espaces) au job suivant. */
function job(text: string, name: string): string {
  const lines = text.split('\n');
  // Recherche dans la section « jobs: » seulement (« release: » est aussi un déclencheur de release.yml).
  const jobs = lines.indexOf('jobs:');
  const start = lines.findIndex((l, i) => i > jobs && l === `  ${name}:`);
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
  it('déclenché par un tag v*, une release publiée depuis GitHub ou à la main, jamais par une branche', () => {
    expect(release).toMatch(/on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}release:\n {4}types: \[published\]\n {2}workflow_dispatch:/);
    expect(release).not.toMatch(/branches:/);
    // Tag poussé et release publiée qui le crée : même groupe, exécutions successives.
    expect(release).toContain('group: release-${{ github.event.inputs.tag || github.event.release.tag_name || github.ref_name }}');
    // Brouillon publié à la main avec son installateur : aucune reconstruction.
    expect(job(release, 'build')).toContain("if: github.event_name != 'release' || !contains(join(github.event.release.assets.*.name, ','), 'Magistra-Setup-')");
  });

  it('release publiée sans installateur : fichiers AJOUTÉS, jamais remplacés', () => {
    const rel = job(release, 'release');
    const published = rel.slice(rel.indexOf('elif [ "$state" = "false" ]'), rel.indexOf('else\n', rel.indexOf('elif [ "$state" = "false" ]')));
    expect(published).toContain('gh release upload "$TAG" "${files[@]}"\n');
    expect(published).not.toContain('--clobber');
    expect(published).toContain('grep -Fxq "Magistra-Setup-$VERSION.exe"');
    // Un seul --clobber dans tout le fichier : celui du brouillon.
    expect(release.match(/--clobber/g)).toHaveLength(1);
  });

  it('installateur aussi publié sous le nom FIXE Magistra-Setup.exe (lien direct du site : releases/latest/download)', () => {
    const build = job(release, 'build');
    expect(build).toContain('cp "Magistra-Setup-$VERSION.exe" "Magistra-Setup.exe"');
    expect(build).toContain('files+=("Magistra-Setup.exe")');
    // Le fichier au nom fixe a lui aussi son empreinte, et part dans l'artefact puis dans la release.
    expect(build.indexOf('files+=("Magistra-Setup.exe")')).toBeLessThan(build.indexOf('sha256sum "${files[@]}" > SHA256SUMS.txt'));
    expect(build).toContain('release/Magistra-Setup.exe\n');
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

  it('textes destinés aux enseignants (notes de version liées depuis le site, installation) : jamais de ligne de commande', () => {
    expect(release).not.toMatch(/PowerShell|Get-FileHash/);
    const start = readme.indexOf('## Installer Magistra (enseignants)');
    expect(start).toBeGreaterThanOrEqual(0);
    const install = readme.slice(start);
    expect(install.slice(0, install.indexOf('\n---'))).not.toMatch(/PowerShell|Get-FileHash/);
    // La commande reste documentée pour le service informatique (section des mainteneurs).
    expect(readme.slice(readme.indexOf('### Mainteneurs'))).toContain('Get-FileHash');
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
  it('README : l’installation de l’enseignant en tête, en trois étapes, sans rien de technique', () => {
    const teacher = readme.indexOf('## Installer Magistra (enseignants)');
    const admin = readme.indexOf('## Brancher une vraie IA');
    expect(teacher).toBeGreaterThan(0);
    expect(teacher).toBeLessThan(admin);
    expect(readme.slice(0, teacher)).not.toMatch(/^## /m); // première section du README
    const section = readme.slice(teacher, admin);
    const steps = section.split('\n').filter(l => /^\d\. /.test(l));
    expect(steps).toHaveLength(3);
    // Le bouton du site et le lien DU SITE (/telecharger : le serveur renvoie au fichier de l'installateur), jamais un
    // lien GitHub.
    expect(steps[0]).toContain('**Télécharger Magistra pour Windows**');
    expect(steps[0]).toContain('[magistra-2.vercel.app/telecharger](https://magistra-2.vercel.app/telecharger)');
    expect(steps[0]).not.toMatch(/github\.com/);
    expect(steps[1]).toContain('« Windows a protégé votre ordinateur »');
    expect(steps[1]).toContain('**Informations complémentaires** puis **Exécuter quand même**');
    expect(steps[2]).toContain('sans droits d\'administrateur, et s\'ouvre toute seule');
    expect(section).toContain('**Déjà installée ?**');
    expect(section).toContain('**Ouvrir Magistra**');
    // Les détails techniques restent dans les sections administrateur et développeur, plus bas (un lien y mène).
    expect(section).toContain('[Brancher une vraie IA](#brancher-une-vraie-ia)');
    expect(section).not.toMatch(/npm|ollama|clerk|supabase|AI_PRESET|powershell|variable|localhost/i);
  });

  it('README : « Brancher une vraie IA » (administrateurs et développeurs) avant les fonctionnalités, avec les trois chemins', () => {
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

describe('ci.yml : installateur Windows construit à chaque envoi', () => {
  it('mêmes options que release.yml (NSIS + zip, sans publication, sans signature), installateur gardé à essayer', () => {
    const win = job(ci, 'windows-package');
    expect(win).toContain('runs-on: windows-latest');
    expect(win).toContain('npx electron-builder --win nsis zip --x64 --publish never');
    expect(job(release, 'build')).toContain('npx electron-builder --win nsis zip --x64 --publish never');
    // Le paquet publié est inspecté comme celui de la CI (fusibles, asar), avant le calcul des empreintes.
    const build = job(release, 'build');
    expect(build).toContain('node scripts/verify-package.mjs');
    expect(build.indexOf('node scripts/verify-package.mjs')).toBeLessThan(build.indexOf('sha256sum'));
    expect(win).toContain('node scripts/verify-package.mjs');
    expect(win).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(win).not.toContain('--dir');
    expect(win).toContain('name: magistra-installateur-windows');
    expect(win).toContain('path: release/Magistra-Setup-*.exe');
    expect(win).toContain('if-no-files-found: error');
    // Aucun droit d'écriture : l'installateur reste dans l'exécution, jamais publié par la CI.
    expect(win).not.toMatch(/contents: write/);
  });
});

describe('ci.yml et Playwright : E2E du connecteur local', () => {
  it('job « electron » : trousseau de clés, construction du site et de l’application, puis projets « electron » et « connector », captures de chacun', () => {
    const electron = job(ci, 'electron');
    // Dans cet ordre : chaque étape a besoin des précédentes ; les captures de l'application partent AVANT le
    // lancement du projet « connector ».
    const steps = [
      'run: npx playwright install --with-deps chromium',
      'apt-get install -y --no-install-recommends gnome-keyring dbus',
      'run: npx vite build',
      'run: node scripts/build-electron.mjs',
      'run: xvfb-run -a npm run test:e2e -- --project=electron',
      `path: ${E2E_SCREENSHOT_DIRS.electron}`,
      'run: xvfb-run -a npm run test:e2e -- --project=connector',
      `path: ${E2E_SCREENSHOT_DIRS.connector}`,
    ];
    let previous = -1;
    for (const step of steps) {
      const at = electron.indexOf(step);
      expect(at, step).toBeGreaterThan(previous);
      previous = at;
    }
    // Captures envoyées même après un échec (c'est alors qu'elles servent), sous deux noms distincts.
    const names = new Set<string>();
    for (const dir of [E2E_SCREENSHOT_DIRS.electron, E2E_SCREENSHOT_DIRS.connector]) {
      const upload = stepWith(electron, `path: ${dir}`);
      expect(upload, dir).toMatch(/^\s+if: always\(\)$/m);
      expect(upload, dir).toMatch(/uses: actions\/upload-artifact@/);
      names.add(/^\s+name: (\S+)$/m.exec(upload.split('with:')[1] ?? '')?.[1] ?? '');
    }
    expect([...names].filter(Boolean)).toHaveLength(2);
    // Le projet « web » reste lancé seul dans son job.
    expect(job(ci, 'e2e-web')).toContain('run: npm run test:e2e -- --project=web');
    // Microsoft Edge n'est pas installé par la CI : « connector-edge » n'y est jamais lancé (vérification à la main).
    expect(code(ci)).not.toContain('connector-edge');
    expect(code(ci)).not.toMatch(/playwright test(?![^\n]*--project)/);
  });

  it('CI Linux : trousseau de clés exigé par l’E2E du connecteur (jamais de repli silencieux « autorisations en mémoire »)', () => {
    const connectorSpec = read('e2e/connector-local.spec.ts');
    expect(connectorSpec).toContain("if (process.env.CI && process.platform === 'linux' && keyring === null) {");
    // Le démon arrêté avant de lire son mot de passe ne fait pas planter le test (EPIPE) : il est constaté (null).
    expect(connectorSpec).toContain("keyring.stdin?.on('error', () => undefined);");
  });

  it('chaque projet a son propre dossier de sortie : lancer l’un ne vide jamais ce que l’autre a produit (captures, traces)', () => {
    const projects = playwrightConfig.projects ?? [];
    // Aucun dossier commun : Playwright vide, au début d'un lancement, le dossier de chaque projet lancé.
    expect(playwrightConfig.outputDir).toBeUndefined();
    const dirs = projects.map(p => p.outputDir ?? '');
    expect(dirs).toEqual(projects.map(p => E2E_OUTPUT_DIRS[p.name as E2EProject]));
    for (const [i, a] of dirs.entries()) {
      expect(a).toMatch(/^test-results\/[a-z]+(-[a-z]+)?$/);
      for (const [j, b] of dirs.entries()) if (i !== j) expect(`${b}/`.startsWith(`${a}/`), `${a} ⊃ ${b}`).toBe(false);
    }
    // Ce que produit un projet est rangé dans SON dossier.
    expect(E2E_SCREENSHOT_DIRS.electron.startsWith(`${E2E_OUTPUT_DIRS.electron}/`)).toBe(true);
    for (const project of CONNECTOR_PROJECTS) {
      expect(E2E_SCREENSHOT_DIRS[project].startsWith(`${E2E_OUTPUT_DIRS[project]}/`), project).toBe(true);
      expect(CONNECTOR_HARNESS_DIRS[project].startsWith(`${E2E_OUTPUT_DIRS[project]}/`), project).toBe(true);
    }
    expect(CONNECTOR_HARNESS_DIR).toBe(CONNECTOR_HARNESS_DIRS.connector);
    const electronSpec = read('e2e/electron-local.spec.ts');
    const connectorSpec = read('e2e/connector-local.spec.ts');
    expect(electronSpec).toContain('fromRoot(E2E_SCREENSHOT_DIRS.electron)');
    // Dossiers du projet LANCÉ (« connector » ou « connector-edge ») : jamais ceux de l'autre.
    expect(connectorSpec).toContain('fromRoot(E2E_SCREENSHOT_DIRS[currentProject()])');
    expect(connectorSpec).toContain('fromRoot(CONNECTOR_HARNESS_DIRS[currentProject()])');
    // Aucun autre chemin de test-results/ codé en dur (il échapperait à cette règle).
    for (const [file, text] of [['electron', electronSpec], ['connector', connectorSpec], ['harness', read('e2e/connector-harness/vite.config.ts')]]) {
      expect(code(text), file).not.toMatch(/['"`]test-results/);
    }
  });

  it('chaque fichier E2E appartient à exactement un projet (le connecteur : un par navigateur) ; « connector » et « connector-edge » activent la protection Local Network Access', () => {
    const projects = playwrightConfig.projects ?? [];
    expect(projects.map(p => p.name)).toEqual(['web', 'electron', 'connector', 'connector-edge']);
    const specs = readdirSync(path.join(root, 'e2e')).filter(f => f.endsWith('.spec.ts'));
    expect(specs).toContain('connector-local.spec.ts');
    for (const spec of specs) {
      const owners = projects.filter(p => p.testMatch instanceof RegExp && p.testMatch.test(path.join(root, 'e2e', spec))).map(p => p.name);
      expect(owners, spec).toEqual(spec.startsWith('connector-') ? [...CONNECTOR_PROJECTS] : [expect.any(String)]);
    }
    const connector = projects.find(p => p.name === 'connector')!;
    const edge = projects.find(p => p.name === 'connector-edge')!;
    expect(connector.use?.launchOptions?.args).toEqual([...LOCAL_NETWORK_ACCESS_ARGS]);
    // Même tests, mêmes options ; seul le navigateur change (Microsoft Edge installé : canal « msedge »).
    expect(String(edge.testMatch)).toBe(String(connector.testMatch));
    expect(edge.use?.launchOptions?.args).toEqual([...LOCAL_NETWORK_ACCESS_ARGS]);
    expect(edge.use?.channel).toBe('msedge');
    expect(edge.use?.userAgent).toMatch(/ Edg\//);
    expect(connector.use?.channel).toBeUndefined();
    // Edge absent (CI Linux) : tests ignorés proprement, jamais en échec.
    expect(read('e2e/connector-local.spec.ts')).toContain("test.skip(({ channel }) => channel === 'msedge' && msedgeExecutable() === null, MSEDGE_MISSING_REASON);");
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
    expect(harness).toContain("export const HARNESS_OUT_DIR = path.join(root, ...CONNECTOR_HARNESS_DIR.split('/'));");
    expect(harness).toMatch(/outDir: HARNESS_OUT_DIR,/);
    expect(CONNECTOR_HARNESS_DIR.split('/')[0]).toBe('test-results');
    expect(read('.gitignore').split('\n')).toContain('test-results');
    expect(read('index.html')).not.toContain('connector-harness');
  });
});
