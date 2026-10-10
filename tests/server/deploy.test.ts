// Cohérence des fichiers de déploiement (Vercel, serveur autonome, Supabase, .env.example).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_HOST, CONNECTOR_PORTS } from '../../shared/localConnector.js';
import { SITE_ORIGIN } from '../../shared/site.js';
import { SITE_STRUCTURED_DATA } from '../../shared/siteSeo.js';
import { ROUTE_METHODS } from '../../server/handlers.js';
import { securityHeaders } from '../../server/standalone.js';
import { COMMERCIAL_VENDOR } from '../vendor';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const JSON_LD_HASH = `'sha256-${createHash('sha256').update(JSON.stringify(SITE_STRUCTURED_DATA).replace(/</g, '\\u003c')).digest('base64')}'`;

interface VercelConfig {
  buildCommand: string;
  outputDirectory: string;
  cleanUrls: boolean;
  trailingSlash: boolean;
  redirects: { source: string; destination: string; permanent: boolean }[];
  rewrites: { source: string; destination: string }[];
  functions: Record<string, { maxDuration?: number }>;
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

/**
 * Lecture stricte (liste blanche) de scripts/verify-site.mjs : elle lit l'HTML comme un navigateur (références de
 * caractères nommées, caractères de contrôle, commentaires, <base>, formulaires…), là où expectFitsPolicy compare des
 * littéraux (un « https:&sol;&sol;hôte » ou un « \u0001https://hôte » y échapperait).
 */
async function siteIndexErrors(html: string, source = false): Promise<string[]> {
  const verify = (await import(pathToFileURL(path.join(root, 'scripts', 'verify-site.mjs')).href)) as { checkIndexHtml(page: string, options?: { source?: boolean }): string[] };
  return verify.checkIndexHtml(html, { source });
}

/** Directives d'une politique de sécurité du contenu : { 'script-src': ["'self'"], … }. */
function parseCsp(csp: string): Record<string, string[]> {
  return Object.fromEntries(csp.split(';').map(d => d.trim()).filter(Boolean).map(d => d.split(/\s+/)).map(([name, ...values]) => [name, values]));
}

describe('déploiement', () => {
  const vercel = JSON.parse(read('vercel.json')) as VercelConfig;

  /** Réécriture vers l'interface (application monopage). */
  const isSpaRewrite = (url: string) => vercel.rewrites.some(r => r.destination === '/index.html' && new RegExp(`^${r.source}$`).test(url));
  const globalHeaders = () => Object.fromEntries(vercel.headers.find(h => h.source === '/(.*)')!.headers.map(h => [h.key, h.value]));

  it('vercel.json : pages statiques propres et vraies 404, sans réécriture SPA globale', () => {
    expect(vercel.buildCommand).toBe('npm run build:site');
    expect(vercel.outputDirectory).toBe('dist-site');
    expect(vercel.rewrites).toEqual([
      { source: '/telecharger', destination: '/api/download' },
    ]);
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
    expect(isSpaRewrite('/mentions-legales')).toBe(false);
    expect(isSpaRewrite('/api/windows-release')).toBe(false);
    // Un fichier de /assets/ qui n'existe plus (ancien hash après un déploiement) donne un vrai 404, pas index.html
    // en 200 « immutable » (comme le serveur autonome).
    expect(isSpaRewrite('/assets/index-ancienhash.js')).toBe(false);
    expect(isSpaRewrite('/page-inexistante')).toBe(false);
    for (const file of Object.keys(vercel.functions)) expect(existsSync(path.join(root, file)), file).toBe(true);
  });

  it('vercel.json : en-têtes de sécurité du site vitrine, valeur par valeur', () => {
    expect(globalHeaders()).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      // Sans « preload » : l'inscription à la liste des navigateurs est irréversible, elle reste une décision du propriétaire.
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' ${JSON_LD_HASH}; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; `
        + "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    });
    expect(globalHeaders()['Strict-Transport-Security']).not.toMatch(/preload/i);
    expect(JSON.stringify(vercel)).not.toContain('Access-Control-Allow-Origin');
    // Les ressources hachées de /assets/ sont immuables ; rien d'autre ne l'est.
    const assets = vercel.headers.filter(h => h.source === '/assets/(.*)');
    expect(assets).toEqual([{ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]);
  });

  it('nouveau domaine du site : vercel.json ne change pas (aucune redirection de l’ancienne adresse, aucune règle d’hôte, CSP sans aucun domaine)', () => {
    // Le domaine se rattache au projet dans Vercel (Settings → Domains) : une redirection permanente écrite ici casserait
    // l'ancienne adresse tant que le nouveau domaine n'est pas attaché et validé.
    expect(Object.keys(vercel).sort()).toEqual(['$schema', 'buildCommand', 'cleanUrls', 'framework', 'functions', 'headers', 'outputDirectory', 'redirects', 'regions', 'rewrites', 'trailingSlash']);
    expect(vercel.redirects.every(r => r.destination === '/' && r.permanent)).toBe(true);
    expect(JSON.stringify(vercel)).not.toMatch(/mag-istra|vercel\.app|"has"|"missing"|"host"|"statusCode"/);
    expect(vercel.rewrites.every(r => r.destination.startsWith('/'))).toBe(true);
    // CSP : uniquement le site lui-même (et des images et polices data:) ; ni le nouveau domaine, ni aucun service externe.
    const csp = parseCsp(globalHeaders()['Content-Security-Policy']);
    expect(Object.keys(csp).sort()).toEqual([
      'base-uri', 'connect-src', 'default-src', 'font-src', 'form-action', 'frame-ancestors', 'img-src', 'object-src', 'script-src', 'style-src',
    ]);
    for (const [directive, values] of Object.entries(csp)) {
      for (const value of values) {
        if (directive === 'script-src' && value === JSON_LD_HASH) continue;
        expect(value, directive).toMatch(/^(?:'self'|'none'|'unsafe-inline'|data:)$/);
      }
    }
    expect(globalHeaders()['Content-Security-Policy']).not.toMatch(/https?:|\*|mag-istra/);
    expect(csp['script-src']).toEqual(["'self'", JSON_LD_HASH]);
    expect(csp['img-src']).toEqual(["'self'", 'data:']);
  });

  it('en-têtes communs : le site vitrine et le serveur autonome envoient les mêmes (la CSP du site est plus stricte que celle de l’interface avec comptes)', () => {
    const standalone = securityHeaders();
    for (const name of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) expect(globalHeaders()[name], name).toBe(standalone[name]);
    expect(globalHeaders()['Content-Security-Policy']).not.toBe(standalone['Content-Security-Policy']);
  });

  it('serveur autonome (interface avec comptes) : connect-src autorise EXACTEMENT les trois ports du connecteur local, et nulle autre directive', () => {
    const csp = securityHeaders()['Content-Security-Policy'];
    const directives = parseCsp(csp);
    const loopback = (values: string[]) => values.filter(v => /127\.0\.0\.1|localhost|\[::1\]/i.test(v));
    const expected = CONNECTOR_PORTS.map(port => `http://${CONNECTOR_HOST}:${port}`);
    expect(expected).toEqual(['http://127.0.0.1:47831', 'http://127.0.0.1:47832', 'http://127.0.0.1:47833']);
    expect(loopback(directives['connect-src'])).toEqual(expected);
    for (const [name, values] of Object.entries(directives)) {
      if (name !== 'connect-src') expect(loopback(values), name).toEqual([]);
    }
    // Ni joker de port, ni schéma générique, ni ws: : seulement les trois adresses exactes.
    expect(csp).not.toMatch(/127\.0\.0\.1:\*|http:\s|http:;|ws:|localhost/);
    // Ces directives transformeraient http://127.0.0.1 en https:// (ou le bloqueraient) : le connecteur deviendrait injoignable.
    expect(csp).not.toMatch(/upgrade-insecure-requests|block-all-mixed-content/);
  });

  it('GET /api/windows-release : fonction Vercel courte, hors de la réécriture vers l’interface', () => {
    expect(vercel.functions['api/windows-release.ts'].maxDuration).toBeGreaterThanOrEqual(10);
    expect(vercel.functions['api/windows-release.ts'].maxDuration).toBeLessThanOrEqual(30);
    expect(isSpaRewrite('/api/windows-release')).toBe(false);
  });

  it('GET /telecharger (lien du site) : réécrit vers la fonction de téléchargement, jamais vers l’interface', () => {
    // La seule réécriture publique conduit à la fonction de téléchargement.
    const first = vercel.rewrites.findIndex(r => new RegExp(`^${r.source}$`).test('/telecharger'));
    expect(vercel.rewrites[first]).toEqual({ source: '/telecharger', destination: '/api/download' });
    expect(first).toBe(0);
    expect(vercel.functions['api/download.ts'].maxDuration).toBeLessThanOrEqual(30);
  });

  it('deux fonctions Vercel seulement (versions Windows et téléchargement), aucune route de comptes ni d’IA', () => {
    const files = readdirSync(path.join(root, 'api')).sort();
    expect(files).toEqual(['download.ts', 'windows-release.ts']);
    expect(Object.keys(vercel.functions).sort()).toEqual(['api/download.ts', 'api/windows-release.ts']);
    // Les autres routes du contrat restent celles du serveur autonome : le site déployé n'en sert aucune, et la
    // réécriture vers l'interface ne les avale pas (404 franc, jamais index.html en 200).
    for (const route of Object.keys(ROUTE_METHODS)) {
      const served = route === 'windows-release' || route === 'download';
      expect(files.includes(`${route}.ts`), route).toBe(served);
      expect(`api/${route}.ts` in vercel.functions, route).toBe(served);
      expect(isSpaRewrite(`/api/${route}`), route).toBe(false);
    }
    expect(existsSync(path.join(root, 'netlify.toml'))).toBe(false);
  });

  it('aucune mention d’un fournisseur d’IA commercial imposé ni de quota', () => {
    const files = [
      '.env.example', 'vercel.json', 'supabase-schema.sql', 'scripts/build-server.mjs',
      ...readdirSync(path.join(root, 'server')).map(f => `server/${f}`),
      ...readdirSync(path.join(root, 'api')).map(f => `api/${f}`),
    ];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(COMMERCIAL_VENDOR);
      expect(text, file).not.toMatch(/générations\s*\/\s*jour|MAX_GENERATIONS_PER_DAY/i);
    }
  });

  it('les API personnelles restent dans leur intégration optionnelle, sans fournisseur imposé ailleurs', () => {
    let tracked: string[];
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      return; // archive sans git : les autres tests couvrent les fichiers du serveur
    }
    const AUDIT_DOCS = new Set(['ANALYSE.md', 'CORRECTIONS.md']);
    // Les API personnelles sont un choix explicite dans l'application Windows. Le serveur, la vitrine,
    // les prompts et le catalogue des modèles locaux restent indépendants de ces fournisseurs.
    const PERSONAL_API_FILES = new Set([
      'README.md', 'e2e/electron-local.spec.ts', 'e2e/electron-personal-api-preload.cjs',
      'electron/aiConfig.ts', 'electron/validate.ts', 'shared/ipc.ts',
      'shared/ai/anthropic.ts', 'shared/ai/factory.ts', 'shared/ai/personalProviders.ts',
      'shared/ai/presets.ts', 'shared/ai/provider.ts',
      'src/components/ai/AdvancedAIOptions.tsx', 'src/components/ai/PersonalAPISettings.tsx',
      'tests/electron/aiConfig.test.ts', 'tests/electron/personalAPI.test.ts',
      'tests/shared/ai.anthropic.test.ts', 'tests/ui/personalAPI.test.tsx', 'tests/server/deploy.test.ts',
    ]);
    const BINARY = /\.(png|ico|jpe?g|gif|webp|woff2?|ttf|otf|pdf|zip)$/i;
    const offenders = tracked
      .filter(f => !AUDIT_DOCS.has(f) && !PERSONAL_API_FILES.has(f) && !BINARY.test(f) && existsSync(path.join(root, f)))
      .filter(f => COMMERCIAL_VENDOR.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('.env.example : deux parties, le site vitrine (variables de build, jeton GitHub facultatif) puis l’hébergement personnel, aucune valeur secrète', () => {
    const env = read('.env.example');
    const siteAt = env.indexOf('# 1. SITE VITRINE (Vercel)');
    const personalAt = env.indexOf('# 2. HÉBERGEMENT PERSONNEL (npm start, npm run dev)');
    expect(siteAt).toBeGreaterThan(0);
    expect(personalAt).toBeGreaterThan(siteAt);
    const variables = (text: string) => [...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map(m => ({ name: m[1], value: m[2] }));
    const site = variables(env.slice(siteAt, personalAt));
    const personal = variables(env.slice(personalAt));

    // Site vitrine : informations légales, profil de l'auteur (publics par nature, vides), puis les deux variables lues
    // par les fonctions du site. Ni Clerk, ni Supabase, ni IA.
    expect(site.map(v => v.name)).toEqual([
      'VITE_LEGAL_PUBLISHER', 'VITE_LEGAL_DIRECTOR', 'VITE_LEGAL_ADDRESS', 'VITE_LEGAL_CONTACT', 'VITE_LEGAL_HOST',
      'VITE_AUTHOR_PROFILE_URL', 'MAGISTRA_RELEASES_REPO', 'GITHUB_TOKEN',
    ]);
    // Surcharges facultatives, toutes vides : les valeurs par défaut (éditeur, contact, hébergeur) sont dans le code
    // (src/lib/legal.ts) ; aucune variable ne valide plus les textes.
    for (const v of site) expect(v.value, v.name).toBe('');
    expect(variables(env).some(v => v.name === 'VITE_LEGAL_VALIDATED')).toBe(false);
    expect(env).not.toContain('VITE_LEGAL_VALIDATED');

    // Hébergement personnel : les seules variables VITE_ sont la région de la base (pages légales) et la clé publiable
    // Clerk ; toutes les valeurs secrètes sont vides.
    expect(personal.filter(v => v.name.startsWith('VITE_')).map(v => v.name)).toEqual(['VITE_LEGAL_DATA_REGION', 'VITE_CLERK_PUBLISHABLE_KEY']);
    expect(variables(env).filter(v => v.name.startsWith('VITE_')).map(v => v.name)).toEqual([
      ...site.filter(v => v.name.startsWith('VITE_')).map(v => v.name), 'VITE_LEGAL_DATA_REGION', 'VITE_CLERK_PUBLISHABLE_KEY',
    ]);
    expect(personal.find(v => v.name === 'VITE_LEGAL_DATA_REGION')?.value).toBe('');
    for (const secret of ['CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'CLERK_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_API_KEY', 'GITHUB_TOKEN']) {
      expect(variables(env).find(v => v.name === secret)?.value, secret).toBe('');
    }
    for (const name of ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_SERVER_LABEL', 'AI_CONTEXT_TOKENS', 'AI_MAX_OUTPUT_TOKENS',
      'AI_TIMEOUT_SECONDS', 'SEARXNG_URL', 'CROSSREF_MAILTO', 'RESEARCH_ACADEMIC', 'RESEARCH_WIKIPEDIA', 'RESEARCH_TRUSTED_ONLY', 'RATE_LIMIT_PER_MINUTE',
      'RATE_LIMIT_GLOBAL_PER_MINUTE', 'MAX_CONCURRENT_GENERATIONS_PER_USER', 'MAX_CONCURRENT_GENERATIONS',
      'CLERK_AUTHORIZED_PARTIES', 'CLERK_WEBHOOK_SECRET', 'SUPABASE_URL', 'PORT', 'CSP_EXTRA_ORIGINS']) {
      expect(personal.some(v => v.name === name), name).toBe(true);
    }
    // Le site vitrine n'utilise ni compte ni IA : rien de tout cela dans sa partie du fichier.
    expect(site.filter(v => /^(CLERK_|SUPABASE_|AI_|MAGISTRA_AUTH|MAGISTRA_STORE|MAGISTRA_DATA_DIR)/.test(v.name))).toEqual([]);
    // Aucune consigne de configurer Clerk, Supabase ou l'IA dans Vercel ni de modifier la CSP de vercel.json.
    expect(env).not.toMatch(/api\/generate\.ts|NODEJS_HELPERS|vercel env pull|ajoutez ce domaine aux directives/i);
  });

  it('.env.example : préréglages (solution gratuite la plus simple), mode personnel, détection locale, transparence', () => {
    const env = read('.env.example');
    for (const name of ['AI_PRESET', 'AI_AUTODETECT', 'AI_HEALTH_TIMEOUT_MS', 'AI_PROVIDER_PRIVACY_URL', 'MAGISTRA_AUTH', 'MAGISTRA_ADMIN_CONTACT',
      'MAGISTRA_STORE', 'MAGISTRA_DATA_DIR', 'HOST']) {
      expect(env, name).toMatch(new RegExp(`^${name}=`, 'm'));
    }
    // Préréglage conseillé présent mais commenté : aucun envoi à un tiers sans décision de l'administrateur.
    expect(env).toMatch(/^# AI_PRESET=ovhcloud$/m);
    expect(env).toMatch(/^AI_PRESET=$/m);
    expect(env).toContain('SOLUTION GRATUITE LA PLUS SIMPLE');
    expect(env).toContain("L'interface l'annonce");
    expect(env).toMatch(/^HOST=127\.0\.0\.1$/m);
  });

  it('npm run ai:check et dist-server/ai-check.js ; données du mode personnel ignorées par git', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['ai:check']).toBe('node scripts/build-server.mjs --run-ai-check');
    const build = read('scripts/build-server.mjs');
    expect(build).toContain("'aiCheck.ts'");
    expect(build).toContain("'ai-check.js'");
    expect(build).toContain('projectRoot: root');
    expect(read('.gitignore')).toMatch(/^\.magistra-data$/m);
  });

  it('supabase-schema.sql : aucune politique permissive active, fonctions protégées', () => {
    const sql = read('supabase-schema.sql');
    const active = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
    expect(active).not.toMatch(/CREATE POLICY/i);
    expect(active).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(active).toMatch(/DROP TABLE IF EXISTS public\.usage/);
    expect(active).toMatch(/REVOKE ALL ON TABLE public\.profiles, public\.generations, public\.api_requests, public\.active_generations FROM PUBLIC, anon, authenticated/);
    for (const table of ['profiles', 'generations', 'api_requests', 'active_generations']) {
      expect(active).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    }
    for (const fn of ['magistra_register_request', 'magistra_begin_generation', 'magistra_end_generation', 'magistra_stats']) {
      expect(active).toMatch(new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)\\s*RETURNS[\\s\\S]*?SECURITY DEFINER\\s*SET search_path = public`));
      expect(active).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(active).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
    expect(active).toMatch(/pg_advisory_xact_lock/);
    // Limite globale : générations seulement (« save » = enregistrement de Magistra locale, hors budget du serveur d'IA).
    expect(active).toMatch(/ALTER TABLE public\.api_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'generate'/);
    expect(active).toMatch(/WHERE created_at >= now\(\) - make_interval\(secs => p_window_seconds\)\s+AND kind = 'generate'/);
    expect(active).toMatch(/INSERT INTO public\.api_requests \(user_id, created_at, kind\) VALUES \(p_user_id, now\(\), p_kind\)/);
    expect(active).toMatch(/DROP FUNCTION IF EXISTS public\.magistra_begin_generation\(text, integer, integer, integer, integer, integer\);/);
    // Ménage des places de génération : seulement par un appel qui les gère (jamais avec la durée d'une autre demande).
    expect(active).toMatch(/IF p_max_active > 0 THEN\s+DELETE FROM public\.active_generations WHERE started_at < now\(\) - make_interval\(secs => p_active_ttl_seconds\);\s+END IF;/);
    // Réexécutable : aucune création qui échouerait la seconde fois.
    expect(active).toMatch(/CREATE TABLE IF NOT EXISTS public\.active_generations/);
    expect(active).not.toMatch(/CREATE FUNCTION/i);
  });
});

describe('CSP du site vitrine (vercel.json)', () => {
  const vercel = JSON.parse(read('vercel.json')) as VercelConfig;
  const header = (name: string) => vercel.headers.find(h => h.source === '/(.*)')!.headers.find(h => h.key === name)!.value;
  const csp = header('Content-Security-Policy');
  const directives = parseCsp(csp);

  it('script-src : ressources du site et empreinte JSON-LD précise, jamais de script inline générique ni d’eval', () => {
    expect(directives['script-src']).toEqual(["'self'", JSON_LD_HASH]);
    expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval|strict-dynamic|unsafe-hashes/);
    // « unsafe-inline » n'est toléré que pour les styles (attribut « style » du squelette de chargement).
    for (const [name, values] of Object.entries(directives)) {
      expect(values.includes("'unsafe-inline'"), name).toBe(name === 'style-src');
    }
  });

  it('aucun domaine tiers, aucun joker, aucun schéma ouvert : seulement le site lui-même, « none » et data:', () => {
    const allowed = new Set(["'self'", "'none'", 'data:']);
    for (const [name, values] of Object.entries(directives)) {
      for (const value of values) {
        if (value === "'unsafe-inline'" && name === 'style-src') continue;
        if (value === JSON_LD_HASH && name === 'script-src') continue;
        expect(allowed.has(value), `${name} ${value}`).toBe(true);
      }
    }
    expect(csp).not.toMatch(/https?:|wss?:|blob:|filesystem:|\*/);
    expect(JSON.stringify(vercel)).not.toMatch(/clerk|cloudflare|supabase|127\.0\.0\.1|localhost|challenges\./i);
  });

  it('directives exactes : défaut, connexions et images du site, objets et formulaires fermés, jamais intégré dans un cadre', () => {
    expect(directives).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", JSON_LD_HASH],
      'connect-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
    });
    // Ni cadre, ni travailleur : plus aucune entrée pour un service de connexion ou le connecteur local.
    for (const name of ['frame-src', 'child-src', 'worker-src', 'manifest-src', 'media-src']) expect(directives[name], name).toBeUndefined();
  });

  it('Permissions-Policy : toutes les fonctions sensibles fermées', () => {
    const features = header('Permissions-Policy').split(',').map(f => f.trim());
    expect(features.sort()).toEqual(['camera=()', 'geolocation=()', 'microphone=()', 'payment=()', 'serial=()', 'usb=()']);
  });

  /** Lien canonique de la page d'accueil du site : à l'adresse officielle, exactement. */
  const CANONICAL_LINK = `<link rel="canonical" href="${SITE_ORIGIN}/" />`;

  /** La page doit tenir dans cette politique : aucun script en ligne, aucun gestionnaire d'évènement, aucune ressource externe. */
  function expectFitsPolicy(html: string): void {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attributes, body] of scripts) {
      if (attributes === ' type="application/ld+json"') {
        expect(JSON.parse(body)).toEqual(SITE_STRUCTURED_DATA);
        expect(`'sha256-${createHash('sha256').update(body).digest('base64')}'`).toBe(JSON_LD_HASH);
        continue;
      }
      expect(attributes).toMatch(/\bsrc="(?!(?:https?:)?\/\/)[^"]+"/);
      expect(body.trim()).toBe('');
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
    // Aucune ressource exécutable ou média externe. Les liens de navigation et métadonnées sont contrôlés par verify-site.
    const withoutCanonical = html.replace(CANONICAL_LINK, '');
    for (const [, url] of withoutCanonical.matchAll(/\b(?:src|action|poster)\s*=\s*"([^"]*)"/gi)) expect(url, url).not.toMatch(/^(?:https?:)?\/\//);
    // Le seul style en ligne est l'attribut « style » du squelette de chargement (style-src 'unsafe-inline').
    expect(html).not.toMatch(/<style\b[^>]*>(?![\s]*<\/style>)/i);
  }

  it('index.html (squelette de chargement) tient dans la politique', () => {
    const html = read('index.html');
    expectFitsPolicy(html);
    // La page de l'application n'a pas de lien canonique (celui du site est dans site/index.html).
    expect(html).not.toContain('rel="canonical"');
    expect(html).toMatch(/<div id="root"><div role="status"[^>]* style="[^"]*">/);
    // Icône « data: » : couverte par img-src.
    expect(html).toMatch(/<link rel="icon"[^>]* href="data:image\/svg\+xml,/);
  });

  it.skipIf(!existsSync(path.join(root, 'dist-site', 'index.html')))('dist-site/index.html (site construit) tient dans la politique', async () => {
    const html = read('dist-site/index.html');
    expectFitsPolicy(html);
    expect([...html.matchAll(/rel="canonical"/g)]).toHaveLength(1);
    expect(html).toContain(CANONICAL_LINK);
    expect(await siteIndexErrors(html)).toEqual([]);
  });

  it('site/index.html (source) : le lien canonique est la seule adresse absolue d\'un attribut ; Open Graph sans image ni autre ressource', async () => {
    const html = read('site/index.html');
    expect(html).toContain(CANONICAL_LINK);
    expect(html.replace(CANONICAL_LINK, '')).not.toMatch(/\b(?:src|href|action|poster)\s*=\s*"(?:https?:)?\/\//i);
    expect(html).not.toMatch(/og:image|og:video|og:audio/);
    expect(await siteIndexErrors(html, true)).toEqual([]);
  });

  it('un contournement de la lecture littérale (référence nommée, préfixe de contrôle, commentaire vide, <base>, formulaire) échappe à expectFitsPolicy mais pas à la liste blanche', async () => {
    const evil = 'evil.example';
    const page = (fragment: string) => read('site/index.html').replace('</head>', `${fragment}</head>`);
    /** Aucun « src|href|action|poster="https?://hôte… » littéral : la lecture par expressions régulières de expectFitsPolicy ne voit rien. */
    const literalAddresses = (html: string) => [...html.matchAll(/\b(?:src|href|action|poster)\s*=\s*"((?:https?:)?\/\/[^"]*)"/gi)].filter(([, url]) => url.includes(evil));
    for (const fragment of [
      `<script type="module" src="https:&sol;&sol;${evil}/x.js"></script>`,
      `<img src="https&colon;//${evil}/x.png">`,
      `<link rel=stylesheet href="https&colon;//${evil}/a.css">`,
      `<script type="module" src="\u0001https://${evil}/x.js"></script>`,
    ]) {
      expect(literalAddresses(page(fragment)), fragment).toEqual([]);
      expect((await siteIndexErrors(page(fragment), true)).length, fragment).toBeGreaterThan(0);
    }
    // Commentaire vide, <base> et formulaire : visibles pour une lecture littérale seulement s'ils portent une adresse en clair ; la liste blanche les refuse dans tous les cas.
    for (const fragment of [`<!--><script src="https://${evil}/x.js"></script>-->`, `<base href="https://${evil}/">`, `<form action="https://${evil}/"></form>`, '<base target="_blank">', '<form></form>']) {
      expect((await siteIndexErrors(page(fragment), true)).length, fragment).toBeGreaterThan(0);
    }
  });
});
