// Le même arbre React est envoyé en HTML à tous les visiteurs, puis hydraté : aucun rendu réservé aux robots.
import { build } from 'esbuild';
import { loadEnv } from 'vite';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist-site');
const compiled = path.join(root, 'node_modules/.cache/magistra/site-render.mjs');
const env = loadEnv('production', root, ['VITE_LEGAL_', 'VITE_AUTHOR_']);
await build({
  absWorkingDir: root, entryPoints: ['src/site/render.tsx'], outfile: compiled,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.app.json'), legalComments: 'none',
  define: { 'import.meta.env': JSON.stringify({ ...env, MODE: 'production', PROD: true, DEV: false, SSR: true, BASE_URL: '/' }) },
});

try {
  const { renderPage, SITE_SEO, SITE_ORIGIN, SITE_STRUCTURED_DATA, SITE_IMAGE_PATH, SITE_ROBOTS } = await import(pathToFileURL(compiled).href);
  const template = readFileSync(path.join(output, 'index.html'), 'utf8');
  const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const json = JSON.stringify(SITE_STRUCTURED_DATA).replace(/</g, '\\u003c');
  const hash = `sha256-${createHash('sha256').update(json).digest('base64')}`;
  const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const csp = vercel.headers.flatMap(rule => rule.headers).find(header => header.key.toLowerCase() === 'content-security-policy')?.value;
  if (!csp?.includes(`'${hash}'`)) throw new Error(`La CSP doit autoriser le JSON-LD exact avec '${hash}' (aucun script inline générique).`);
  const verification = process.env.SITE_GOOGLE_VERIFICATION?.trim();
  if (verification && !/^[A-Za-z0-9_-]{20,200}$/.test(verification)) throw new Error('SITE_GOOGLE_VERIFICATION : jeton Google invalide.');
  mkdirSync(path.join(output, 'assets'), { recursive: true });
  copyFileSync(path.join(root, 'build/icon.png'), path.join(output, SITE_IMAGE_PATH));

  for (const [route, page] of Object.entries(SITE_SEO)) {
    const url = `${SITE_ORIGIN}${route}`;
    let html = template
      .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*("\s*\/?>)/, `$1${url}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*("\s*\/?>)/, `$1${escape(page.title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*("\s*\/?>)/, `$1${url}$2`)
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" sizes="512x512" href="${SITE_IMAGE_PATH}" />`)
      .replace(/<noscript>[\s\S]*?<\/noscript>/, '<noscript><a href="/telecharger">Télécharger Magistra pour Windows</a>.</noscript>');
    const rootStart = html.indexOf('<div id="root">');
    const rootEnd = html.lastIndexOf('</div>');
    if (rootStart < 0 || rootEnd < rootStart) throw new Error('Racine HTML introuvable.');
    html = html.slice(0, rootStart) + `<div id="root">${renderPage(route)}</div>` + html.slice(rootEnd + 6);
    const additions = [
      `<meta name="robots" content="${page.index ? SITE_ROBOTS : 'noindex, follow'}" />`,
      `<meta property="og:image" content="${SITE_ORIGIN}${SITE_IMAGE_PATH}" />`,
      '<meta property="og:image:width" content="512" />', '<meta property="og:image:height" content="512" />',
      '<meta property="og:image:type" content="image/png" />', '<meta property="og:image:alt" content="Logo Magistra" />',
      '<meta name="twitter:card" content="summary" />',
      `<meta name="twitter:title" content="${escape(page.title)}" />`,
      `<meta name="twitter:description" content="${escape(page.description)}" />`,
      `<meta name="twitter:image" content="${SITE_ORIGIN}${SITE_IMAGE_PATH}" />`,
      '<meta name="twitter:image:alt" content="Logo Magistra" />',
    ];
    if (route === '/') additions.push(`<script type="application/ld+json">${json}</script>`);
    if (verification) additions.push(`<meta name="google-site-verification" content="${verification}" />`);
    html = html.replace('</head>', `${additions.join('\n    ')}\n  </head>`);
    writeFileSync(path.join(output, route === '/' ? 'index.html' : `${route.slice(1)}.html`), html);
  }
  console.log(`[SEO] ${Object.keys(SITE_SEO).length} pages pré-rendues, métadonnées propres, favicon et JSON-LD.`);
} finally {
  rmSync(compiled, { force: true });
}
