#!/usr/bin/env node
// Audit de sécurité d'Electron, livré aux utilisateurs dans l'application Windows alors qu'il est déclaré en
// devDependencies (comme l'exige electron-builder) : `npm audit --omit=dev` ne le voit donc pas.
//
// Règle :
// - ÉCHEC (code 1) : avis de sécurité de gravité « high » ou « critical » portant sur le paquet electron lui-même,
//   c'est-à-dire sur le moteur (Chromium, Node.js) embarqué dans l'exécutable installé chez les enseignants ;
// - avertissement seulement : dépendances d'installation d'electron (@electron/get…) et chaîne d'electron-builder,
//   exécutées sur la machine de construction et jamais livrées ; tout autre outil de développement est ignoré
//   (vite, eslint, vitest… : sans effet sur l'application installée).
//
// Usage : node scripts/audit-electron.mjs [--report rapport.json]
//   --report : lit un rapport `npm audit --json` existant au lieu de lancer npm (tests).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
/** Outils de construction de l'application Windows : signalés, jamais bloquants. */
const BUILD_TOOLS = ['electron-builder', 'app-builder-lib', 'dmg-builder', 'electron-builder-squirrel-windows', 'builder-util'];

function loadReport(args) {
  const i = args.indexOf('--report');
  if (i >= 0) return JSON.parse(readFileSync(args[i + 1], 'utf8'));
  // Windows : npm est un script .cmd, lancé par l'interpréteur de commandes (arguments fixes).
  const res = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  // npm audit sort avec un code non nul dès qu'une vulnérabilité existe : seul le rapport JSON compte.
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`rapport npm audit illisible (${(res.stderr || res.error?.message || 'aucune sortie').trim().slice(0, 300)})`);
  }
}

/** Avis de sécurité portés directement par un paquet (et non hérités d'une dépendance). */
function directAdvisories(vuln) {
  return (Array.isArray(vuln?.via) ? vuln.via : []).filter(v => v && typeof v === 'object');
}

function describe(name, vuln) {
  const via = (Array.isArray(vuln?.via) ? vuln.via : []).map(v => (typeof v === 'string' ? v : `${v.title ?? 'avis'} (${v.url ?? v.source ?? '?'})`));
  return `${name} [${vuln?.severity ?? '?'}] ← ${via.join(' ; ') || 'inconnu'}`;
}

export function evaluate(report) {
  if (!report || typeof report !== 'object' || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error(report?.error?.summary ? `npm audit : ${report.error.summary}` : 'rapport npm audit inattendu');
  }
  const vulns = report.vulnerabilities;
  const failures = [];
  const warnings = [];
  const electron = vulns.electron;
  if (electron) {
    const serious = directAdvisories(electron).filter(a => BLOCKING.has(a.severity));
    if (serious.length) failures.push(...serious.map(a => `electron [${a.severity}] ${a.title ?? ''} ${a.url ?? ''} (versions touchées : ${a.range ?? '?'})`.trim()));
    else if (BLOCKING.has(electron.severity)) warnings.push(describe('electron (dépendance d’installation)', electron));
  }
  for (const name of BUILD_TOOLS) {
    if (vulns[name] && BLOCKING.has(vulns[name].severity)) warnings.push(describe(name, vulns[name]));
  }
  return { failures, warnings };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  let result;
  try {
    result = evaluate(loadReport(process.argv.slice(2)));
  } catch (err) {
    console.error(`[audit-electron] Audit impossible : ${err?.message ?? err}`);
    process.exit(1);
  }
  for (const w of result.warnings) console.log(`::warning title=Audit outils de construction::${w}`);
  if (result.failures.length) {
    for (const f of result.failures) console.error(`::error title=Audit Electron::${f}`);
    console.error(`[audit-electron] ${result.failures.length} vulnérabilité(s) grave(s) dans Electron : mettez à jour le paquet electron.`);
    process.exit(1);
  }
  console.log(`[audit-electron] Electron : aucune vulnérabilité « high » ou « critical »${result.warnings.length ? ` (${result.warnings.length} avertissement(s) sur les outils de construction)` : ''}.`);
}
