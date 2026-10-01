// Cohérence des fichiers de déploiement (Vercel, serveur autonome, Supabase, .env.example).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_HOST, CONNECTOR_PORTS } from '../../shared/localConnector.js';
import { ROUTE_METHODS } from '../../server/handlers.js';
import { securityHeaders } from '../../server/standalone.js';
import { COMMERCIAL_VENDOR } from '../vendor';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

interface VercelConfig {
  rewrites: { source: string; destination: string }[];
  functions: Record<string, { maxDuration?: number }>;
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

describe('déploiement', () => {
  const vercel = JSON.parse(read('vercel.json')) as VercelConfig;

  /** Réécriture vers l'interface (application monopage). */
  const spaRule = () => vercel.rewrites.find(r => r.destination === '/index.html')!;

  it('vercel.json : réécriture SPA hors /api et durée longue pour la génération', () => {
    expect(vercel.rewrites).toEqual([
      { source: '/telecharger', destination: '/api/download' },
      { source: '/((?!api/|assets/).*)', destination: '/index.html' },
    ]);
    const spa = new RegExp(`^${spaRule().source}$`);
    expect(spa.test('/app/generate')).toBe(true);
    expect(spa.test('/api/generate')).toBe(false);
    // Un fichier de /assets/ qui n'existe plus (ancien hash après un déploiement) donne un vrai 404, pas index.html
    // en 200 « immutable » (comme le serveur autonome).
    expect(spa.test('/assets/index-ancienhash.js')).toBe(false);
    expect(spa.test('/assets-publics')).toBe(true);
    expect(vercel.functions['api/generate.ts'].maxDuration).toBe(300);
    for (const file of Object.keys(vercel.functions)) expect(existsSync(path.join(root, file)), file).toBe(true);
  });

  it('vercel.json et le serveur autonome envoient les mêmes en-têtes de sécurité', () => {
    const global = vercel.headers.find(h => h.source === '/(.*)')!;
    const fromVercel = Object.fromEntries(global.headers.map(h => [h.key, h.value]));
    expect(fromVercel).toEqual(securityHeaders());
    expect(JSON.stringify(vercel)).not.toContain('Access-Control-Allow-Origin');
  });

  it('CSP : connect-src autorise EXACTEMENT les trois ports du connecteur local, et nulle autre directive', () => {
    const global = vercel.headers.find(h => h.source === '/(.*)')!;
    const csp = global.headers.find(h => h.key === 'Content-Security-Policy')!.value;
    const directives = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
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
    expect(new RegExp(`^${spaRule().source}$`).test('/api/windows-release')).toBe(false);
  });

  it('GET /telecharger (lien du site) : réécrit vers la fonction de téléchargement AVANT la réécriture vers l’interface', () => {
    // Vercel applique la première réécriture qui correspond : /telecharger ne doit jamais tomber sur l'interface.
    const first = vercel.rewrites.findIndex(r => new RegExp(`^${r.source}$`).test('/telecharger'));
    expect(vercel.rewrites[first]).toEqual({ source: '/telecharger', destination: '/api/download' });
    expect(first).toBeLessThan(vercel.rewrites.indexOf(spaRule()));
    expect(vercel.functions['api/download.ts'].maxDuration).toBeLessThanOrEqual(30);
  });

  it('une fonction Vercel par route du contrat, et plus aucune ancienne route', () => {
    const files = readdirSync(path.join(root, 'api')).sort();
    expect(files).toEqual([
      'account.ts', 'clerk-webhook.ts', 'download.ts', 'generate.ts', 'generation.ts', 'history.ts', 'mode.ts', 'profile.ts', 'stats.ts',
      'status.ts', 'windows-release.ts',
    ]);
    // Chaque route du serveur a sa fonction Vercel, servie hors de la réécriture vers l'interface.
    for (const route of Object.keys(ROUTE_METHODS)) {
      expect(files, route).toContain(`${route}.ts`);
      expect(vercel.functions[`api/${route}.ts`], route).toBeDefined();
      expect(new RegExp(`^${spaRule().source}$`).test(`/api/${route}`), route).toBe(false);
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

  it('dépôt entier : aucun fournisseur d’IA commercial, hors documents d’audit', () => {
    let tracked: string[];
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      return; // archive sans git : les autres tests couvrent les fichiers du serveur
    }
    const AUDIT_DOCS = new Set(['ANALYSE.md', 'CORRECTIONS.md']);
    const BINARY = /\.(png|ico|jpe?g|gif|webp|woff2?|ttf|otf|pdf|zip)$/i;
    const offenders = tracked
      .filter(f => !AUDIT_DOCS.has(f) && !BINARY.test(f) && existsSync(path.join(root, f)))
      .filter(f => COMMERCIAL_VENDOR.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('.env.example : seule VITE_CLERK_PUBLISHABLE_KEY est publique, aucune valeur secrète', () => {
    const env = read('.env.example');
    const vars = [...env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map(m => ({ name: m[1], value: m[2] }));
    expect(vars.filter(v => v.name.startsWith('VITE_')).map(v => v.name)).toEqual(['VITE_CLERK_PUBLISHABLE_KEY']);
    for (const secret of ['CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'CLERK_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'AI_API_KEY', 'GITHUB_TOKEN']) {
      expect(vars.find(v => v.name === secret)?.value, secret).toBe('');
    }
    for (const name of ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_SERVER_LABEL', 'AI_CONTEXT_TOKENS', 'AI_MAX_OUTPUT_TOKENS',
      'AI_TIMEOUT_SECONDS', 'SEARXNG_URL', 'CROSSREF_MAILTO', 'RESEARCH_ACADEMIC', 'RESEARCH_WIKIPEDIA', 'RATE_LIMIT_PER_MINUTE',
      'RATE_LIMIT_GLOBAL_PER_MINUTE', 'MAX_CONCURRENT_GENERATIONS_PER_USER', 'MAX_CONCURRENT_GENERATIONS',
      'CLERK_AUTHORIZED_PARTIES', 'CLERK_WEBHOOK_SECRET', 'SUPABASE_URL', 'PORT', 'CSP_EXTRA_ORIGINS', 'MAGISTRA_RELEASES_REPO', 'GITHUB_TOKEN']) {
      expect(vars.some(v => v.name === name), name).toBe(true);
    }
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
