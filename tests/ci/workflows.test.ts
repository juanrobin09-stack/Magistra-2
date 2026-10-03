// Garde-fous des workflows GitHub Actions de publication et de validation avec une vraie IA, et cohérence de la
// documentation avec le code (préréglages, commandes). Contrôles textuels : aucune dépendance YAML ajoutée ;
// la syntaxe elle-même est vérifiée par GitHub (et par actionlint en local).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import playwrightConfig from '../../playwright.config';
import { LEGAL_ENV_NAMES } from '../../src/lib/legal';
import { LOCAL_NETWORK_ACCESS_ARGS, OTHER_SITE_PORT, SITE_PORT } from '../../e2e/connector-harness/sites';
import { CONNECTOR_HARNESS_DIR, CONNECTOR_HARNESS_DIRS, CONNECTOR_PROJECTS, E2E_OUTPUT_DIRS, E2E_SCREENSHOT_DIRS, type E2EProject } from '../../e2e/outputDirs';
import { PROVIDER_PRESETS } from '../../shared/ai/presets';
import { MIN_OLLAMA_VERSION } from '../../shared/ai/models';
import { OFFICIAL_WEB_ORIGINS } from '../../shared/localConnector';
import { SITE_LEGACY_ORIGIN, SITE_ORIGIN } from '../../shared/site';

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

/** Variables du bloc « env: » d'une étape, avec leur valeur telle qu'écrite dans le workflow. */
const envOf = (step: string) => Object.fromEntries([...step.matchAll(/^\s+(VITE_[A-Z_]+): (.+)$/gm)].map(m => [m[1], m[2].trim()]));
const fromRepositoryVariables = (names: string[]) => Object.fromEntries(names.map(name => [name, `\${{ vars.${name} }}`]));
/** Script shell d'une étape « run: | », sans son indentation. */
const scriptOf = (step: string) => step.slice(step.indexOf('run: |\n') + 'run: |\n'.length).split('\n').map(l => l.slice(10)).join('\n');
const hasBash = spawnSync('bash', ['--version']).status === 0;

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
    expect(steps[0]).toContain('[www.mag-istra.fr/telecharger](https://www.mag-istra.fr/telecharger)');
    // L'ancienne adresse du projet reste citée (alias valable) ; ces deux liens sont ceux de SITE_ORIGIN et SITE_LEGACY_ORIGIN.
    expect(steps[0]).toContain('[magistra-2.vercel.app/telecharger](https://magistra-2.vercel.app/telecharger)');
    expect(steps[0]).toContain(`${SITE_ORIGIN}/telecharger`);
    expect(steps[0]).toContain(`${SITE_LEGACY_ORIGIN}/telecharger`);
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
    for (const heading of ['### 1. Application Windows', '### 2. En local', '### 3. Hébergement personnel avancé (`npm start`), hors site public']) expect(readme).toContain(heading);
    // Le site public n'est plus un chemin pour brancher une IA : il n'en exécute aucune.
    expect(readme).not.toContain('### 1. Site en ligne (Vercel)');
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
    expect(readme).toContain('`npm run ai:check` (serveur autonome : lit `.env`) ou `npm run ai:check -- --dev` (`npm run dev`)');
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

describe('informations légales de l’éditeur dans l’installateur Windows (surcharges facultatives VITE_LEGAL_*)', () => {
  // Les quatre informations lues par src/lib/legal.ts pour les pages légales de l'installateur : chacune a une valeur
  // par défaut, la variable de dépôt ne sert qu'à la remplacer. L'hébergeur et la région des données ne concernent que
  // le site en ligne.
  const PUBLISHER_VARS = [LEGAL_ENV_NAMES.publisher, LEGAL_ENV_NAMES.director, LEGAL_ENV_NAMES.address, LEGAL_ENV_NAMES.contact];
  // Le profil de l'auteur (lien de « Magistra, créé par Juan Robin ») est transmis avec les mêmes variables de dépôt.
  const BUILD_ENV_VARS = [...PUBLISHER_VARS, 'VITE_AUTHOR_PROFILE_URL'];

  it('release.yml : l’étape « Build web » transmet les quatre surcharges légales et le profil de l’auteur depuis les VARIABLES du dépôt, jamais depuis les secrets', () => {
    const web = stepWith(job(release, 'build'), 'run: npm run build');
    expect(envOf(web)).toEqual(fromRepositoryVariables(BUILD_ENV_VARS));
    expect(code(release)).not.toMatch(/secrets\./);
  });

  it('ci.yml : le build web du job d’installateur Windows transmet les mêmes variables, et lui seul', () => {
    const web = stepWith(job(ci, 'windows-package'), 'run: npx vite build');
    expect(envOf(web)).toEqual(fromRepositoryVariables(BUILD_ENV_VARS));
    expect(code(ci)).not.toMatch(/secrets\./);
    expect(code(ci).match(/VITE_LEGAL_PUBLISHER:/g)).toHaveLength(1);
    expect(code(ci).match(/VITE_AUTHOR_PROFILE_URL:/g)).toHaveLength(1);
  });

  it('plus d’indicateur de validation des textes ni d’avertissement « à compléter » : une variable absente laisse la valeur par défaut', () => {
    for (const [name, text] of [['release.yml', release], ['ci.yml', ci]] as const) {
      expect(text, name).not.toContain('VITE_LEGAL_VALIDATED');
      expect(text, name).not.toMatch(/à compléter|Information légale manquante|Informations légales de l'éditeur$/m);
    }
    // Aucune étape ne vérifie plus les variables légales : seules les surcharges sont transmises à la construction.
    expect(job(release, 'build')).not.toContain("name: Informations légales de l'éditeur");
    expect(code(release)).not.toMatch(/for name in VITE_LEGAL/);
  });

  it('README et .env.example : où renseigner les surcharges pour l’installateur, valeurs par défaut, aucune variable de validation', () => {
    const maintainers = readme.slice(readme.indexOf('### Mainteneurs'), readme.indexOf('## Déploiement du site (Vercel)'));
    const section = maintainers.slice(maintainers.indexOf('**Informations légales de l\'installateur Windows**'), maintainers.indexOf('**Profil de l\'auteur**'));
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('Settings → Secrets and variables → Actions → onglet Variables');
    for (const name of PUBLISHER_VARS) expect(section, name).toContain(`\`${name}\``);
    expect(section).toContain('**valeur par défaut**');
    expect(section).toContain('`juanrobin89@gmail.com`');
    expect(section).toMatch(/`VITE_LEGAL_HOST` \(hébergeur du site vitrine\) et `VITE_LEGAL_DATA_REGION` \([^)]*\) ne concernent pas l'application Windows/);
    for (const name of [...PUBLISHER_VARS, LEGAL_ENV_NAMES.host]) expect(read('.env.example'), name).toMatch(new RegExp(`^${name}=$`, 'm'));
    for (const [name, text] of [['README.md', readme], ['.env.example', read('.env.example')], ['ARCHITECTURE_IA.md', architecture]] as const) {
      expect(text, name).not.toContain('VITE_LEGAL_VALIDATED');
      expect(text, name).not.toMatch(/avis « projet de texte|bandeau « à compléter/);
    }
    expect(read('.env.example')).toContain('juanrobin89@gmail.com');
    expect(read('.env.example')).toContain('Vercel Inc., États-Unis (https://vercel.com)');
  });
});

describe('profil de l’auteur : variable de build VITE_AUTHOR_PROFILE_URL (lien de « Magistra, créé par Juan Robin »)', () => {
  const AUTHOR_STEP = "name: Profil de l'auteur";

  it('release.yml : avertissement non bloquant avant la construction, valeur lue par env: (jamais interpolée dans le script), variable de dépôt', () => {
    const build = job(release, 'build');
    const step = stepWith(build, AUTHOR_STEP);
    expect(step).toContain('shell: bash');
    expect(envOf(step)).toEqual(fromRepositoryVariables(['VITE_AUTHOR_PROFILE_URL']));
    const script = scriptOf(step);
    expect(script).toContain('::warning title=');
    expect(script).not.toMatch(/\bexit\b|::error/);
    expect(script).not.toContain('${{');
    expect(build.indexOf(AUTHOR_STEP)).toBeLessThan(build.indexOf('run: npm run build'));
    expect(code(release)).not.toMatch(/secrets\./);
  });

  it.skipIf(!hasBash)('release.yml : le script n’avertit que si la variable est absente ou blanche, ne recopie jamais sa valeur, et réussit toujours', () => {
    const script = scriptOf(stepWith(job(release, 'build'), AUTHOR_STEP));
    const run = (env: Record<string, string>) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
    for (const env of [{}, { VITE_AUTHOR_PROFILE_URL: '' }, { VITE_AUTHOR_PROFILE_URL: '  \t ' }] as Record<string, string>[]) {
      const missing = run(env);
      expect(missing.status).toBe(0);
      expect(missing.stdout.match(/^::warning title=Profil de l'auteur manquant::La variable de dépôt VITE_AUTHOR_PROFILE_URL /gm)).toHaveLength(1);
    }
    const set = run({ VITE_AUTHOR_PROFILE_URL: 'https://exemple.fr/profil-secret' });
    expect(set.status).toBe(0);
    expect(set.stdout).toBe('');
  });

  it('ci.yml : seul l’installateur d’essai la reçoit (le site vitrine de la CI se construit sans, avec le profil par défaut)', () => {
    expect(job(ci, 'windows-package')).toContain('VITE_AUTHOR_PROFILE_URL: ${{ vars.VITE_AUTHOR_PROFILE_URL }}');
    for (const name of ['checks', 'e2e-web', 'electron']) expect(job(ci, name), name).not.toContain('VITE_AUTHOR_PROFILE_URL');
  });

  it('README, .env.example : variable de build facultative et publique, vide par défaut, profil GitHub par défaut', () => {
    expect(read('.env.example')).toMatch(/^VITE_AUTHOR_PROFILE_URL=$/m);
    expect(read('.env.example')).toContain('https://github.com/juanrobin09-stack');
    expect(readme).toContain('`VITE_AUTHOR_PROFILE_URL`');
    expect(readme).toContain('https://github.com/juanrobin09-stack');
  });
});

describe('ci.yml : site vitrine construit et vérifié à chaque envoi', () => {
  /** Chaque fragment apparaît dans le job, dans cet ordre. */
  function expectInOrder(text: string, fragments: string[]): void {
    let previous = -1;
    for (const fragment of fragments) {
      const at = text.indexOf(fragment);
      expect(at, fragment).toBeGreaterThan(previous);
      previous = at;
    }
  }

  it('job « Lint, typecheck, tests, build web » : build:site puis verify:site, après le build web', () => {
    const checks = job(ci, 'checks');
    expect(checks).toContain('name: Lint, typecheck, tests, build web');
    expectInOrder(checks, ['run: npx vite build', 'run: npm run build:site', 'run: npm run verify:site', 'run: npm run build:server']);
  });

  it('la politique de sécurité du contenu est contrôlée sur la page réelle du site construit (le test ignoré par « npm test » est rejoué)', () => {
    const checks = job(ci, 'checks');
    expectInOrder(checks, ['run: npm run build:site', 'run: npx vitest run tests/server/deploy.test.ts tests/site/siteBuild.test.ts', 'run: npm run build:server']);
  });

  it('job « E2E web (démo) » : construit aussi le site, puis lance les projets « web » et « site »', () => {
    const e2e = job(ci, 'e2e-web');
    expect(e2e).toContain('name: E2E web (démo)');
    expectInOrder(e2e, ['run: npx vite build', 'run: npm run build:site', 'run: npm run test:e2e -- --project=web', 'run: npm run test:e2e -- --project=site']);
    expect(code(ci)).not.toMatch(/playwright test(?![^\n]*--project)/);
  });

  it('aucun secret : le site vitrine se construit sans clé (ni Clerk, ni Supabase, ni IA)', () => {
    for (const name of ['checks', 'e2e-web']) expect(job(ci, name), name).not.toMatch(/secrets\.|CLERK|SUPABASE|AI_|VITE_CLERK/);
  });
});

describe('README : attribution, architecture et déploiement du site vitrine', () => {
  const section = (heading: string) => {
    const start = readme.indexOf(heading);
    expect(start, heading).toBeGreaterThanOrEqual(0);
    const end = readme.indexOf('\n## ', start + heading.length);
    return readme.slice(start, end < 0 ? undefined : end);
  };
  const top = readme.slice(0, readme.indexOf('\n## '));

  it('en tête : « Magistra, créé par Juan Robin », courte présentation, lien du profil (remplaçable), un projet FutureAI', () => {
    expect(readme.startsWith('# Magistra, créé par Juan Robin\n')).toBe(true);
    expect(top).toContain('[Juan Robin](https://github.com/juanrobin09-stack)');
    expect(top).toContain('`VITE_AUTHOR_PROFILE_URL`');
    expect(top).toMatch(/profil professionnel/);
    expect(top).toContain('Un projet [FutureAI](https://futurai.space)');
    // Aucune biographie inventée : seulement ce que le dépôt établit (auteur, outil libre et gratuit, IA sur l'ordinateur).
    expect(top).not.toMatch(/\b(ancien|diplômé|ingénieur|docteur|enseignant depuis|passionné|fondateur|CEO)\b/i);
  });

  it('architecture : le produit est l’application Windows, le site une vitrine statique (build:site, Vercel), ni connexion ni compte', () => {
    expect(top).toContain("**Le produit, c'est l'application Windows**");
    expect(top).toContain('**Le site est une vitrine statique**');
    expect(top).toContain('`npm run build:site`');
    expect(top).toContain('**Aucune application dans le navigateur, aucune connexion, aucun compte**');
    expect(top).toContain('hors site public');
  });

  it('« Déploiement du site (Vercel) » : ni Clerk, ni Supabase, ni IA ; variables de build et variables lues par les fonctions du site', () => {
    const deploy = section('## Déploiement du site (Vercel)');
    const beforeCleanup = deploy.slice(0, deploy.indexOf('### Nettoyage de Vercel'));
    expect(deploy).toContain('**aucune clé Clerk, Supabase ni IA**');
    expect(beforeCleanup).not.toMatch(/\b(?:CLERK|SUPABASE|AI)_[A-Z_]+|NODEJS_HELPERS|VITE_CLERK/);
    // La région de la base de données n'existe que pour l'hébergement personnel avec base distante : pas sur le site vitrine.
    for (const name of [...Object.values(LEGAL_ENV_NAMES).filter(n => n !== 'VITE_LEGAL_DATA_REGION'), 'VITE_AUTHOR_PROFILE_URL', 'GITHUB_TOKEN', 'MAGISTRA_RELEASES_REPO']) {
      expect(beforeCleanup, name).toContain(`\`${name}\``);
    }
    expect(beforeCleanup).not.toContain('VITE_LEGAL_DATA_REGION');
    for (const fragment of ['`npm run build:site`', '`dist-site/`', '`api/windows-release.ts`', '`api/download.ts`', 'sans `preload`']) expect(deploy, fragment).toContain(fragment);
    // Les fonctions du site fonctionnent sans autre variable : le README le dit.
    expect(deploy).toMatch(/fonctionnent sans aucune autre variable/);
  });

  it('README : adresse officielle du site et ancienne adresse (alias), rattachement du domaine à Vercel, liste exacte des origines de l’application', () => {
    const deploy = section('## Déploiement du site (Vercel)');
    const domain = deploy.slice(deploy.indexOf('### Domaine du site (www.mag-istra.fr)'), deploy.indexOf('### Nettoyage de Vercel'));
    expect(domain.length).toBeGreaterThan(500);
    for (const fragment of [
      `\`${SITE_ORIGIN}\``, `\`${SITE_LEGACY_ORIGIN}\``, '*Settings* → *Domains* → *Add*', 'ajoutez `www.mag-istra.fr`', '**domaine principal**', 'branche `master`',
      'Ajoutez ensuite `mag-istra.fr`', '**redirection vers `www.mag-istra.fr`**', 'Enregistrements DNS', '**CNAME** pour `www`', '**A** (ou **ALIAS**/**ANAME**', 'la valeur donnée par Vercel',
      'HTTPS', '`curl -sI https://www.mag-istra.fr/`', '`curl -sI https://mag-istra.fr/`', '`VITE_LEGAL_*`', '`VITE_AUTHOR_PROFILE_URL`', 'reste **`master`**',
      '**Ne redirigez pas l\'ancienne adresse.**', 'aucune redirection vers le nouveau domaine', '**2.0.4**', '`OFFICIAL_WEB_ORIGINS`',
    ]) {
      expect(domain, fragment).toContain(fragment);
    }
    // Étapes numérotées dans l'ordre : domaine, DNS, HTTPS, variables, ancienne adresse, application.
    expect(domain.split('\n').filter(l => /^\d\. /.test(l))).toHaveLength(6);
    // Mise en production et vérification : le nouveau domaine d'abord, l'ancienne adresse conservée.
    expect(deploy).toContain("Le site public (`www.mag-istra.fr`, et l'ancienne adresse Vercel `magistra-2.vercel.app`) sert la branche **`master`**");
    expect(deploy).toContain('`curl -sI https://www.mag-istra.fr/` montre la CSP et `Strict-Transport-Security`');
    // Chapitre du connecteur : les deux adresses exactes de la liste compilée, l'apex absent, version de l'application.
    const custom = readme.slice(readme.indexOf('**Adresses du site public**'), readme.indexOf('**Ports 47831–47833**'));
    expect(custom.length).toBeGreaterThan(500);
    for (const origin of OFFICIAL_WEB_ORIGINS) expect(custom, origin).toContain(`\`${origin}\``);
    expect(custom).toContain("l'apex `https://mag-istra.fr` n'y figure pas");
    expect(custom).toContain('La comparaison est **exacte**');
    expect(custom).toContain('à partir de la version **2.0.4**');
    expect(readme).not.toContain("aujourd'hui `https://magistra-2.vercel.app`, l'adresse du site public");
    // Le domaine ne tient pas dans le code de vercel.json (voir tests/server/deploy.test.ts) : aucune redirection n'y est annoncée.
    expect(read('vercel.json')).not.toMatch(/mag-istra|redirects/);
  });

  it('« Nettoyage de Vercel » : les anciennes variables peuvent être supprimées, la base Supabase et l’instance Clerk supprimées ou mises en pause', () => {
    const cleanup = readme.slice(readme.indexOf('### Nettoyage de Vercel'), readme.indexOf('## Hébergement personnel avancé'));
    for (const name of ['CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'CLERK_WEBHOOK_SECRET', 'VITE_CLERK_PUBLISHABLE_KEY',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_PRESET', 'AI_API_KEY']) {
      expect(cleanup, name).toContain(`\`${name}\``);
    }
    expect(cleanup).toContain('**supprimées**');
    expect(cleanup).toMatch(/Clerk\*\* \(et son webhook\) et la base \*\*Supabase\*\* peuvent être supprimées ou mises en pause/);
  });

  it('« Hébergement personnel avancé (hors site public) » : npm start, mode personnel et comptes Clerk auto-hébergés conservés', () => {
    const advanced = section('## Hébergement personnel avancé (hors site public)');
    for (const kept of ['`npm start`', 'mode personnel', '/api/clerk-webhook', '`CLERK_SECRET_KEY`', '`CLERK_WEBHOOK_SECRET`', '`SUPABASE_SERVICE_ROLE_KEY`',
      'supabase-schema.sql', '`CSP_EXTRA_ORIGINS`', '`MAGISTRA_AUTH`', '### Restreindre les inscriptions', '### Serveur Node autonome']) {
      expect(advanced, kept).toContain(kept);
    }
    expect(advanced).toContain("Rien de ce chapitre n'est utilisé par le site public");
  });

  it('plus de consigne de se connecter au site ni de configurer Clerk, Supabase ou l’IA dans Vercel', () => {
    expect(readme).not.toMatch(/connectez-vous au site/i);
    expect(readme).not.toMatch(/Sur le site, Magistra/);
    expect(readme).not.toMatch(/vercel env pull|NODEJS_HELPERS=0|ai:check -- --vercel --env-file/);
    expect(readme).not.toContain('## Site web : déploiement');
  });
});

describe('ci.yml : permissions', () => {
  it('lecture seule par défaut, aucun droit d’écriture', () => {
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code(ci)).not.toMatch(/contents: write/);
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
    expect(projects.map(p => p.name).filter(name => name !== 'site')).toEqual(['web', 'electron', 'connector', 'connector-edge']);
    // Site vitrine construit (dist-site/), servi par vite preview sur son propre port.
    const site = projects.find(p => p.name === 'site');
    if (site) expect(site.use?.baseURL).toBe('http://127.0.0.1:4174');
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
