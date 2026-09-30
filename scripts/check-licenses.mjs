// Vérifie que toutes les dépendances de production ont une licence compatible
// avec la distribution open source et non lucrative de Magistra (licence MIT).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED = [
  /^MIT$/, /^ISC$/, /^0BSD$/, /^BSD-[23]-Clause$/, /^Apache-2\.0$/, /^Unlicense$/, /^CC0-1\.0$/, /^OFL-1\.1$/,
  /^\(MIT OR GPL-3\.0-or-later\)$/, /^\(MPL-2\.0 OR Apache-2\.0\)$/, /^\(MIT AND Zlib\)$/, /^MIT OR SEE LICENSE IN FEEL-FREE\.md$/,
];
// Paquets vérifiés à la main (licence décrite dans un fichier plutôt qu'un identifiant SPDX).
const REVIEWED = new Map([
  ['dejavu-fonts-ttf', 'Licence des polices DejaVu (dérivée de Bitstream Vera) : libre, redistribution et incorporation autorisées.'],
]);

const out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8', shell: process.platform === 'win32' });
const dirs = [...new Set(out.split(/\r?\n/).slice(1).filter(Boolean))];
const problems = [];
const counts = new Map();
for (const dir of dirs) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'INCONNUE';
  counts.set(license, (counts.get(license) ?? 0) + 1);
  if (REVIEWED.has(pkg.name)) continue;
  if (!ALLOWED.some(re => re.test(license))) problems.push(`${pkg.name}@${pkg.version} : ${license}`);
}
for (const [license, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${license}`);
if (problems.length) {
  console.error(`\nLicences à vérifier (${problems.length}) :\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\n${dirs.length} dépendances de production : toutes les licences sont compatibles.`);
