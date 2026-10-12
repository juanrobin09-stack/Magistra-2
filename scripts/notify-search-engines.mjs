// Aperçu sans réseau par défaut. --submit s'utilise seulement après publication validée.
// Une réponse 200/202 d'IndexNow confirme la réception ; elle ne garantit ni indexation ni classement.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 512 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Le même catalogue sert au sitemap et aux notifications : aucune URL légale/API/404. */
export function createSubmission(source) {
  const { SITE_ORIGIN, SITE_PATHS, SITE_SEO, INDEXNOW_KEY, INDEXNOW_PATH } = source;
  const origin = new URL(SITE_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== SITE_ORIGIN || origin.port) {
    throw fail('INVALID_ORIGIN', 'L’origine du site doit être une origine HTTPS canonique, sans port.');
  }
  if (!/^[a-f0-9]{32}$/.test(INDEXNOW_KEY) || INDEXNOW_PATH !== `/${INDEXNOW_KEY}.txt`) {
    throw fail('INVALID_KEY', 'Le fichier de validation IndexNow doit correspondre au jeton public.');
  }
  if (!Array.isArray(SITE_PATHS) || SITE_PATHS.length === 0 || SITE_PATHS.length > 10_000) {
    throw fail('INVALID_PATHS', 'La notification nécessite entre 1 et 10 000 URL indexables.');
  }
  const urlList = [...new Set(SITE_PATHS)].map(route => {
    if (typeof route !== 'string' || !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(route) || !SITE_SEO[route]?.index) {
      throw fail('INVALID_ROUTE', `La route ${String(route)} n’est pas une page canonique indexable.`);
    }
    return `${SITE_ORIGIN}${route}`;
  });
  return { host: origin.hostname, key: INDEXNOW_KEY, keyLocation: `${SITE_ORIGIN}${INDEXNOW_PATH}`, urlList };
}

async function readBoundedText(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    throw fail('RESPONSE_TOO_LARGE', 'La réponse dépasse la taille autorisée pour cette vérification.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw fail('RESPONSE_TOO_LARGE', 'La réponse dépasse la taille autorisée pour cette vérification.');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function request(fetchImpl, url, options = {}) {
  try {
    return await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw fail('REQUEST_FAILED', `Échec de la vérification de ${url} : ${error.message}`);
  }
}

/** Refuse la soumission si une page publiée est absente, redirigée, noindex ou mal canonicalisée. */
export async function validatePublishedSite(submission, fetchImpl = fetch) {
  const keyResponse = await request(fetchImpl, submission.keyLocation);
  if (keyResponse.status !== 200 || !(keyResponse.headers.get('content-type') ?? '').startsWith('text/plain')) {
    throw fail('KEY_NOT_PUBLISHED', 'Le fichier public de validation IndexNow doit répondre 200 en texte brut.');
  }
  if ((await readBoundedText(keyResponse, 1024)).trim() !== submission.key) {
    throw fail('KEY_MISMATCH', 'Le fichier de validation publié ne contient pas le jeton attendu.');
  }
  for (const url of submission.urlList) {
    const response = await request(fetchImpl, url);
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').startsWith('text/html')) {
      throw fail('PAGE_NOT_PUBLISHED', `La page canonique ${url} doit répondre 200 en HTML.`);
    }
    const headerRobots = response.headers.get('x-robots-tag') ?? '';
    const html = await readBoundedText(response, MAX_HTML_BYTES);
    const dom = new JSDOM(html);
    try {
      const { document } = dom.window;
      const canonicals = document.querySelectorAll('link[rel="canonical"]');
      if (canonicals.length !== 1 || canonicals[0].getAttribute('href') !== url) {
        throw fail('CANONICAL_MISMATCH', `La page ${url} doit déclarer exactement sa propre URL canonique.`);
      }
      const metaRobots = [...document.querySelectorAll('meta')]
        .filter(meta => /^(robots|googlebot|bingbot)$/i.test(meta.getAttribute('name') ?? ''))
        .map(meta => meta.getAttribute('content') ?? '').join(',');
      if (!/(?:^|[\s,])index(?:$|[\s,])/i.test(metaRobots)
        || /(?:^|[\s,:])(noindex|none)(?:$|[\s,])/i.test(`${headerRobots},${metaRobots}`)) {
        throw fail('PAGE_NOT_INDEXABLE', `La page ${url} doit autoriser explicitement son indexation.`);
      }
      if (!document.querySelector('main h1')?.textContent?.trim()) {
        throw fail('PAGE_EMPTY', `La page ${url} doit exposer son titre principal dans le HTML publié.`);
      }
    } finally {
      dom.window.close();
    }
  }
  return { keyFileVerified: true, canonicalPagesVerified: submission.urlList.length };
}

export async function notifySearchEngines({ submit = false, source, fetchImpl = fetch } = {}) {
  const catalog = source ?? (await import('./site-seo-source.mjs')).siteSeoSource;
  const submission = createSubmission(catalog);
  const result = {
    mode: submit ? 'submit' : 'dry-run', endpoint: INDEXNOW_ENDPOINT, host: submission.host,
    keyLocation: submission.keyLocation, urlCount: submission.urlList.length, urls: submission.urlList, submitted: false,
  };
  if (!submit) return result;
  const validation = await validatePublishedSite(submission, fetchImpl);
  const response = await request(fetchImpl, INDEXNOW_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(submission),
  });
  if (response.status !== 200 && response.status !== 202) {
    const reasons = {
      400: 'format refusé', 403: 'validation du fichier clé refusée',
      422: 'URL ou fichier clé hors du site déclaré', 429: 'limite de notifications atteinte',
    };
    throw fail('SUBMISSION_REJECTED', `IndexNow répond ${response.status} (${reasons[response.status] ?? 'erreur du service'}).`);
  }
  return {
    ...result, ...validation, submitted: true, status: response.status,
    state: response.status === 200 ? 'received' : 'key-validation-pending',
    indexingGuaranteed: false,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('node scripts/notify-search-engines.mjs [--dry-run | --submit]\nSans option : aperçu local, aucune requête. --submit : vérifie la publication puis notifie IndexNow.');
    } else {
      if (args.some(arg => arg !== '--submit' && arg !== '--dry-run') || (args.includes('--submit') && args.includes('--dry-run'))) {
        throw fail('INVALID_ARGUMENTS', 'Utilisez --dry-run ou --submit, sans autre option.');
      }
      console.log(JSON.stringify(await notifySearchEngines({ submit: args.includes('--submit') }), null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ submitted: false, code: error.code ?? 'UNEXPECTED_ERROR', error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
