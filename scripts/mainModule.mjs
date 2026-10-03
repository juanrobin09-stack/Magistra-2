// Garde « exécution directe » des scripts : vrai seulement quand le fichier est celui lancé par `node`, jamais
// lorsqu'il est importé (tests, scripts/dev-electron.mjs).

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vrai si le module d'URL `moduleUrl` (import.meta.url) est le script lancé par `node`. Les chemins réels sont
 * comparés : Node résout le module principal (lien symbolique, jonction), alors que process.argv[1] garde le chemin
 * saisi ; une comparaison brute serait fausse et le script sortirait en code 0 sans rien faire.
 */
export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(entry) === realpathSync.native(self);
  } catch {
    return path.resolve(entry) === path.resolve(self);
  }
}
