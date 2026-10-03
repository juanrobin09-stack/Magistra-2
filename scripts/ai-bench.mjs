#!/usr/bin/env node
// Mesure précise de la lenteur d'un Ollama (outil du mainteneur, aucune dépendance) : chargement du modèle, lecture de
// la demande, rédaction, premier mot, placement (carte graphique, processeur), empreinte du texte produit et
// rechargement du modèle, pour chaque taille de contexte (num_ctx) et chaque taille de demande.
//
//   node scripts/ai-bench.mjs --model ministral-3:3b --ctx 4096,8192,12288 --scenario court,moyen --runs 3 --json bench.json
//
// Seul le moteur de cet ordinateur est mesuré (autre adresse : --allow-remote). Aucun modèle n'est téléchargé et aucune
// donnée réelle n'est envoyée : les demandes sont des textes français synthétiques. Les mesures ne changent rien à
// Magistra ; elles servent à comparer des réglages (contexte) sur la même machine avant de les généraliser.
// Code de sortie : 0 si toutes les mesures ont abouti, 1 sinon, 2 si les options sont invalides.

import { writeFileSync } from 'node:fs';
import { buildReport, formatTable, parseArgs, runBench, SEED, tableRows, TABLE_HEADERS, USAGE } from './lib/aiBench.mjs';
import { isMainModule } from './mainModule.mjs';

export async function main(argv, out = line => console.log(line)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    out(err.message);
    out('');
    for (const line of USAGE) out(line);
    return 2;
  }
  if (opts.help) {
    for (const line of USAGE) out(line);
    return 0;
  }
  out(`Mesure de ${opts.model} sur ${opts.baseUrl} : contexte ${opts.ctx.join(', ')}, scénario ${opts.scenarios.join(', ')}, ${opts.runs} exécution(s).`);
  let outcome;
  try {
    outcome = await runBench(opts, { log: out });
  } catch (err) {
    out(`Mesure impossible : ${err.message}`);
    return 1;
  }
  out('');
  out(formatTable(TABLE_HEADERS, tableRows(outcome.results)));
  out('');
  out(`Moteur Ollama ${outcome.version}. Graine ${SEED}, température 0 : une empreinte différente d'un contexte à l'autre signale un texte différent.`);
  if (outcome.results.some(r => r.summary.placement && r.summary.placement.processor !== 'cpu')) {
    out(
      'Calcul : déduit de /api/ps (size_vram). Sur un processeur à instructions AMX (Xeon récents), Ollama 0.34 compte une partie des poids '
      + "du processeur comme de la mémoire de carte graphique : en cas de doute, le journal d'Ollama (« inference compute ») fait foi.",
    );
  }
  if (opts.json) {
    try {
      writeFileSync(opts.json, `${JSON.stringify(buildReport(opts, outcome.version, outcome.results), null, 2)}\n`, 'utf8');
      out(`Mesures détaillées écrites dans ${opts.json}.`);
    } catch (err) {
      out(`Écriture de ${opts.json} impossible : ${String(err?.code ?? err?.message ?? err).slice(0, 80)}.`);
      return 1;
    }
  }
  return outcome.results.some(r => r.error) ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
