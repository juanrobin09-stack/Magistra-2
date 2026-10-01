#!/usr/bin/env node
// Inspecte l'application Windows EMPAQUETÉE (release/win-unpacked, produite par electron-builder) : le test de
// démarrage de la CI tourne depuis les sources (`electron .`), car l'application empaquetée ignore --smoke-test
// (electron/devOptions.ts) ; rien d'autre ne regardait donc le résultat final. Ce script ne lance PAS l'exécutable :
// il lit seulement des fichiers, sans effet sur l'application ni sur la génération.
//
// Vérifie :
// 1. les fusibles Electron de Magistra.exe (runAsNode, inspecteur, NODE_OPTIONS, chargement hors asar, intégrité de
//    l'asar, chiffrement des cookies, privilèges file://) : valeurs attendues = electron-builder.json#electronFuses,
//    plus un socle de sécurité codé ici (retirer une clé de la configuration ne désactive donc pas un fusible en
//    silence) ;
// 2. l'intégrité de l'asar : l'empreinte SHA-256 de l'en-tête de resources/app.asar est bien celle inscrite dans
//    l'exécutable (ressource ELECTRONASAR) : c'est elle qu'Electron compare au démarrage ;
// 3. le contenu de app.asar : processus principal, preload, page d'accueil et package.json présents ; ni node_modules,
//    ni sourcemap, ni fichier .env ; aucun secret côté serveur : noms (service_role, SUPABASE_SERVICE_*) et valeurs
//    (clé Supabase sb_secret_… ou jeton JWT dont la charge utile décodée porte le rôle « service_role », clés
//    secrètes Clerk sk_live_/sk_test_, secrets de webhook whsec_) ;
// 4. resources/icon.png (extraResources).
//
// Dépendances : @electron/fuses et @electron/asar, déjà installés par electron-builder (aucune dépendance ajoutée).
// Usage : node scripts/verify-package.mjs [dossier]   (défaut : release/win-unpacked)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Valeurs d'état d'un fusible dans l'exécutable (@electron/fuses, FuseState). */
export const FUSE_DISABLE = 48;
export const FUSE_ENABLE = 49;

/** Position de chaque fusible (FuseV1Options) : les clés sont celles de `electronFuses` dans electron-builder.json. */
export const FUSE_INDEX = {
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
};

/** Socle de sécurité : exigé quoi que dise electron-builder.json. */
export const REQUIRED_FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  grantFileProtocolExtraPrivileges: false,
  onlyLoadAppFromAsar: true,
  enableEmbeddedAsarIntegrityValidation: true,
  enableCookieEncryption: true,
};

/** Fichiers qui doivent figurer dans app.asar (`main` de package.json, preload, page d'accueil). */
export const REQUIRED_ENTRIES = ['package.json', 'dist-electron/main.js', 'dist-electron/preload.cjs', 'dist/index.html'];

/** Motifs de secrets qui ne doivent jamais être livrés dans l'application (jamais de clé serveur côté poste). */
export const SECRET_PATTERNS = [
  [/service_role/i, 'clé « service_role » de Supabase'],
  [/SUPABASE_SERVICE/, 'variable SUPABASE_SERVICE_*'],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, 'clé secrète Supabase (sb_secret_…)'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, 'clé secrète Clerk'],
  [/\bwhsec_[A-Za-z0-9+/=]{16,}/, 'secret de webhook'],
];

/**
 * Jeton JWT (« eyJ….eyJ….… » : « ey » est « { » en base64url) ; seule la charge utile (groupe 1) est décodée.
 * Le jeton commence après un caractère hors base64url : le temps reste linéaire quelle que soit la taille du fichier.
 */
const JWT = /(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]{4,8192}\.(ey[A-Za-z0-9_-]{4,8192})\.[A-Za-z0-9_-]*/g;
const SERVICE_ROLE_CLAIM = /"role"\s*:\s*"service_role"/;

/** Le texte contient-il un JWT dont la charge utile est celle d'une clé « service_role » (illisible en clair, car encodée) ? */
function hasServiceRoleJwt(text) {
  for (const [, payload] of text.matchAll(JWT)) {
    if (SERVICE_ROLE_CLAIM.test(Buffer.from(payload, 'base64url').toString('utf8'))) return true;
  }
  return false;
}

const TEXT_EXTENSIONS = /\.(?:js|cjs|mjs|html|css|json|svg|txt)$/i;

/** Chemin d'entrée d'asar normalisé : séparateurs « / », sans « / » initial. */
function normalizeEntry(entry) {
  return String(entry).replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Chemin d'entrée avec les séparateurs du système : @electron/asar découpe les chemins avec `path.sep`, donc sous
 * Windows « dist/assets/x.js » n'est trouvé que sous la forme « dist\assets\x.js » (les fichiers de premier niveau
 * se lisent dans les deux formes, d'où un défaut qui ne touche que les dossiers imbriqués).
 */
export function nativeEntryPath(entry, sep = path.sep) {
  return normalizeEntry(entry).split('/').join(sep);
}

/**
 * Compare les fusibles lus dans l'exécutable (`wire` : position → état) aux valeurs attendues.
 * Retourne la liste des écarts (vide si tout est conforme).
 */
export function checkFuses(wire, builderFuses) {
  const errors = [];
  const expected = { ...REQUIRED_FUSES };
  for (const [name, value] of Object.entries(builderFuses ?? {})) {
    if (!(name in FUSE_INDEX)) {
      errors.push(`electron-builder.json : fusible inconnu « ${name} »`);
      continue;
    }
    if (name in REQUIRED_FUSES && REQUIRED_FUSES[name] !== value) {
      errors.push(`electron-builder.json : le fusible ${name} doit rester ${REQUIRED_FUSES[name] ? 'activé' : 'désactivé'}`);
    }
    expected[name] = value;
  }
  for (const [name, enabled] of Object.entries(expected)) {
    const state = wire?.[FUSE_INDEX[name]];
    const want = enabled ? FUSE_ENABLE : FUSE_DISABLE;
    if (state !== want) {
      const actual = state === FUSE_ENABLE ? 'activé' : state === FUSE_DISABLE ? 'désactivé' : `absent ou inconnu (${state ?? 'non lu'})`;
      errors.push(`fusible ${name} : ${enabled ? 'activé' : 'désactivé'} attendu, ${actual} dans l'exécutable`);
    }
  }
  return errors;
}

/** Contenu de app.asar : fichiers indispensables présents, rien d'indésirable. */
export function checkAsarEntries(rawEntries) {
  const errors = [];
  const entries = rawEntries.map(normalizeEntry);
  const set = new Set(entries);
  for (const required of REQUIRED_ENTRIES) {
    if (!set.has(required)) errors.push(`app.asar : fichier manquant « ${required} »`);
  }
  const nodeModules = entries.filter(e => e === 'node_modules' || e.startsWith('node_modules/') || e.includes('/node_modules/'));
  if (nodeModules.length) errors.push(`app.asar : node_modules ne doit pas être livré (${nodeModules.length} entrée(s), ex. « ${nodeModules[0]} »)`);
  const maps = entries.filter(e => e.endsWith('.map'));
  if (maps.length) errors.push(`app.asar : sourcemap livrée (« ${maps[0]} »)`);
  const envFiles = entries.filter(e => /(^|\/)\.env(\.|$)/.test(e));
  if (envFiles.length) errors.push(`app.asar : fichier d'environnement livré (« ${envFiles[0]} »)`);
  return errors;
}

/** Aucun secret serveur dans le texte des fichiers livrés. `files` : [{ name, text }]. */
export function checkNoSecrets(files) {
  const errors = [];
  for (const { name, text } of files) {
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) errors.push(`app.asar : ${label} trouvée dans « ${name} »`);
    }
    if (hasServiceRoleJwt(text)) errors.push(`app.asar : clé « service_role » de Supabase (jeton JWT encodé) trouvée dans « ${name} »`);
  }
  return errors;
}

/** Empreintes SHA-256 d'asar inscrites dans l'exécutable (ressource ELECTRONASAR : JSON `{"file":…,"alg":"SHA256","value":"…"}`). */
export function readEmbeddedAsarHashes(exe) {
  const marker = Buffer.from('"alg":"SHA256","value":"');
  const hashes = [];
  for (let at = exe.indexOf(marker); at >= 0; at = exe.indexOf(marker, at + marker.length)) {
    const value = exe.subarray(at + marker.length, at + marker.length + 64).toString('latin1');
    if (/^[0-9a-f]{64}$/.test(value)) hashes.push(value);
  }
  return hashes;
}

/** L'empreinte de l'en-tête de l'asar (celle qu'Electron recalcule au démarrage) est-elle celle de l'exécutable ? */
export function checkAsarIntegrity(exe, headerString) {
  const actual = createHash('sha256').update(headerString).digest('hex');
  const embedded = readEmbeddedAsarHashes(exe);
  if (!embedded.length) return ["exécutable : aucune empreinte d'intégrité d'asar (ressource ELECTRONASAR) n'est inscrite"];
  if (!embedded.includes(actual)) return ["exécutable : l'empreinte d'intégrité inscrite ne correspond pas à resources/app.asar (asar modifié après la construction ?)"];
  return [];
}

function loadModule(mod) {
  return mod.default && typeof mod.default === 'object' ? { ...mod.default, ...mod } : mod;
}

/** Inspecte un dossier win-unpacked : retourne la liste des erreurs. */
export async function verifyPackage(dir) {
  const errors = [];
  const exe = path.join(dir, 'Magistra.exe');
  const asarFile = path.join(dir, 'resources', 'app.asar');
  const icon = path.join(dir, 'resources', 'icon.png');
  if (!existsSync(exe)) return [`${exe} introuvable (electron-builder a-t-il construit le dossier win-unpacked ?)`];
  if (!existsSync(asarFile)) return [`${asarFile} introuvable : l'application n'est pas empaquetée en asar`];
  if (!existsSync(icon)) errors.push('resources/icon.png manquant (extraResources)');

  const builder = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  const fuses = loadModule(await import('@electron/fuses'));
  const asar = loadModule(await import('@electron/asar'));

  errors.push(...checkFuses(await fuses.getCurrentFuseWire(exe), builder.electronFuses));

  const entries = asar.listPackage(asarFile, { isPack: false });
  errors.push(...checkAsarEntries(entries));
  const texts = [];
  for (const entry of entries.map(normalizeEntry).filter(e => TEXT_EXTENSIONS.test(e))) {
    try {
      texts.push({ name: entry, text: asar.extractFile(asarFile, nativeEntryPath(entry)).toString('utf8') });
    } catch {
      errors.push(`app.asar : « ${entry} » illisible`);
    }
  }
  errors.push(...checkNoSecrets(texts));
  errors.push(...checkAsarIntegrity(readFileSync(exe), asar.getRawHeader(asarFile).headerString));
  return errors;
}

/**
 * Vrai si ce fichier est le script lancé par `node`. Les chemins réels sont comparés : Node résout le module principal
 * (lien symbolique, jonction), alors que process.argv[1] garde le chemin saisi ; une comparaison brute serait fausse et
 * le script sortirait en code 0 sans rien vérifier.
 */
function isMainModule() {
  const self = fileURLToPath(import.meta.url);
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(self);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(self);
  }
}

if (isMainModule()) {
  const dir = path.resolve(process.argv[2] ?? path.join(root, 'release', 'win-unpacked'));
  let errors;
  try {
    errors = await verifyPackage(dir);
  } catch (err) {
    errors = [`inspection impossible : ${err?.message ?? err}`];
  }
  if (errors.length) {
    for (const e of errors) console.error(`::error title=Paquet Windows::${e}`);
    console.error(`[verify-package] ${errors.length} écart(s) dans ${dir}.`);
    process.exit(1);
  }
  console.log(`[verify-package] ${dir} : fusibles, intégrité et contenu de l'asar conformes.`);
}
