#!/usr/bin/env node
// Inspecte le build du SITE VITRINE (npm run build:site → dist-site/) : le site ne présente Magistra et ne propose le
// téléchargement de l'application Windows que par un code qui n'embarque rien de l'application. Ce script ne lance
// rien : il lit seulement les fichiers produits.
//
// Vérifie :
// 1. le dossier existe et contient index.html ;
// 2. aucun fichier .js / .mjs / .cjs / .css / .html ne contient (casse ignorée) un service de connexion (clerk), une
//    base de données (supabase), l'export ou la lecture de PDF (jspdf, pdfjs), une route de l'API de l'application
//    (/api/generate, /api/generation, /api/history, /api/profile, /api/account, /api/status, /api/stats, /api/mode ;
//    seule /api/windows-release est permise), le port du connecteur local (47831), le connecteur lui-même
//    (localConnector), ni une clé secrète (sk_live_…, sk_test_…, service_role, sb_secret_…, whsec_…) ;
// 3. index.html ne contient aucun script en ligne (la politique de sécurité du site peut ainsi les refuser) ni aucune
//    ressource chargée depuis un autre domaine ;
// 4. aucune sourcemap (.map) n'est publiée.
//
// Usage : node scripts/verify-site.mjs [dossier]   (défaut : dist-site)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './mainModule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Textes qui n'ont rien à faire dans le site (comparaison sans tenir compte de la casse) : [texte, ce qu'il révèle]. */
export const FORBIDDEN_TEXTS = [
  ['clerk', 'service de connexion (Clerk)'],
  ['supabase', 'base de données de l\'application (Supabase)'],
  ['jspdf', 'export PDF (jsPDF)'],
  ['pdfjs', 'lecture de PDF (pdf.js)'],
  ['/api/generate', 'route de génération de l\'application'],
  ['/api/generation', 'route d\'une génération de l\'application'],
  ['/api/history', 'route de l\'historique de l\'application'],
  ['/api/profile', 'route du profil de l\'application'],
  ['/api/account', 'route du compte de l\'application'],
  ['/api/status', 'route d\'état de l\'IA de l\'application'],
  ['/api/stats', 'route des statistiques de l\'application'],
  ['/api/mode', 'route de découverte du mode de l\'application'],
  ['47831', 'port du connecteur local'],
  ['localConnector', 'connecteur local'],
  ['/onboarding', 'création du profil de l\'application'],
  ['Refaire mon profil', 'action du profil de l\'application'],
  ['Depuis ce site', 'phrase du site avec comptes (connecteur local)'],
];

/** Clés et secrets : jamais livrés (même motifs que scripts/verify-package.mjs pour l'application empaquetée). */
export const SECRET_PATTERNS = [
  [/\bsk_(?:live|test)_[A-Za-z0-9]{8,}|\bsk_[A-Za-z0-9]{24,}/, 'clé secrète (sk_…)'],
  [/service_role/i, 'clé « service_role »'],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'clé secrète de base de données (sb_secret_…)'],
  [/\bwhsec_[A-Za-z0-9+/=]{8,}/, 'secret de webhook (whsec_…)'],
];

const TEXT_EXTENSIONS = /\.(?:js|mjs|cjs|css|html)$/i;

/** Fichiers du dossier, chemins relatifs avec « / », triés. */
export function listFiles(dir) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Texte interdit ou secret dans un fichier texte du build. `files` : [{ name, text }]. */
export function checkForbiddenContent(files) {
  const errors = [];
  for (const { name, text } of files) {
    const lower = text.toLowerCase();
    for (const [needle, what] of FORBIDDEN_TEXTS) {
      if (lower.includes(needle.toLowerCase())) errors.push(`${name} : contient « ${needle} » (${what}) : le site vitrine n'embarque rien de l'application`);
    }
    for (const [pattern, what] of SECRET_PATTERNS) {
      if (pattern.test(text)) errors.push(`${name} : contient une ${what}`);
    }
  }
  return errors;
}

/** Balises qui chargent une ressource : une adresse absolue ou « // » y est un chargement depuis un autre domaine. */
const RESOURCE_TAG = /<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*>/gi;
const EXTERNAL_REFERENCE = /\b(?:src|href|data)\s*=\s*["']?\s*(?:https?:)?\/\//i;

/** index.html : aucun script en ligne, aucune ressource d'un autre domaine. */
export function checkIndexHtml(html) {
  const errors = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [, attributes, body] = match;
    if (!/\bsrc\s*=/i.test(attributes) || body.trim()) errors.push('index.html : script en ligne (le site charge tout son code depuis des fichiers)');
  }
  const opened = (html.match(/<script\b/gi) ?? []).length;
  const closed = (html.match(/<\/script\s*>/gi) ?? []).length;
  if (opened !== closed) errors.push('index.html : balises <script> mal formées (ouvertes et fermées en nombre différent)');
  for (const [tag] of html.matchAll(RESOURCE_TAG)) {
    if (EXTERNAL_REFERENCE.test(tag)) errors.push(`index.html : ressource chargée depuis un autre domaine (${tag.slice(0, 80)})`);
  }
  return errors;
}

/** Aucune sourcemap publiée. */
export function checkNoSourceMaps(names) {
  return names.filter(name => /\.map$/i.test(name)).map(name => `${name} : sourcemap publiée (le code source du site n'est pas à livrer)`);
}

/** Inspecte un dossier de build du site : retourne la liste des erreurs (vide si tout est conforme). */
export function verifySite(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [`${dir} introuvable (npm run build:site l'a-t-il construit ?)`];
  const names = listFiles(dir);
  if (!names.includes('index.html')) return [`${path.join(dir, 'index.html')} introuvable : le site n'a pas de page d'entrée`];
  const errors = [...checkNoSourceMaps(names)];
  const files = [];
  for (const name of names.filter(n => TEXT_EXTENSIONS.test(n))) {
    try {
      files.push({ name, text: readFileSync(path.join(dir, name), 'utf8') });
    } catch {
      errors.push(`${name} : illisible`);
    }
  }
  errors.push(...checkForbiddenContent(files));
  const index = files.find(f => f.name === 'index.html');
  if (index) errors.push(...checkIndexHtml(index.text));
  return errors;
}

if (isMainModule(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(root, 'dist-site'));
  let errors;
  try {
    errors = verifySite(dir);
  } catch (err) {
    errors = [`inspection impossible : ${err?.message ?? err}`];
  }
  if (errors.length) {
    for (const e of errors) console.error(`::error title=Site vitrine::${e}`);
    console.error(`[verify-site] ${errors.length} écart(s) dans ${dir}.`);
    process.exit(1);
  }
  console.log(`[verify-site] ${dir} : aucun code de l'application, aucun script en ligne, aucune sourcemap.`);
}
