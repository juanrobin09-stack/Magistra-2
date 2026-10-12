// Après modification d'un schéma SEO : node scripts/sync-site-csp.mjs ; build:site contrôle ensuite les empreintes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { siteSeoSource } from './site-seo-source.mjs';

const file = new URL('../vercel.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
const header = config.headers.flatMap(rule => rule.headers).find(item => item.key.toLowerCase() === 'content-security-policy');
if (!header || !/script-src\s+'self'(?:\s+'sha256-[A-Za-z0-9+/=]+')*;/.test(header.value)) throw new Error('Directive script-src inattendue ; contrôle manuel requis.');
const hashes = [...new Set(Object.keys(siteSeoSource.SITE_SEO).map(route => siteSeoSource.siteStructuredDataJson(route)).filter(Boolean)
  .map(json => `'sha256-${createHash('sha256').update(json).digest('base64')}'`))];
header.value = header.value.replace(/script-src[^;]*;/, `script-src 'self' ${hashes.join(' ')};`);
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[SEO] ${hashes.length} empreintes JSON-LD exactes synchronisées dans la CSP.`);
