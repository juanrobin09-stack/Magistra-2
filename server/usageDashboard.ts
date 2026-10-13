import { USAGE_RETENTION_DAYS, type UsageSnapshot } from '../shared/usageTelemetry.js';

export interface DownloadSnapshot {
  total: number;
  releases: Array<{ version: string; downloads: number }>;
  complete: boolean;
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);
const DAY = 86_400_000;

export function usageMetrics(snapshot: UsageSnapshot, now = new Date(), month = now.toISOString().slice(0, 7)) {
  const today = now.toISOString().slice(0, 10);
  const daily = snapshot.days.find(d => d.period === today);
  const monthly = snapshot.months.find(m => m.period === month);
  const openings = snapshot.days.filter(d => d.period.startsWith(month)).reduce((n, d) => n + d.openings, 0);
  const todayMs = Date.parse(today + 'T00:00:00Z');
  const partialMonth = Date.parse(month + '-01T00:00:00Z') < todayMs - USAGE_RETENTION_DAYS * DAY;
  const retention = (window: 7 | 30) => {
    const matured = snapshot.cohorts.filter(c => todayMs - Date.parse(c.period + 'T00:00:00Z') > window * DAY);
    const base = matured.reduce((n, c) => n + c.firstUses, 0);
    const returned = matured.reduce((n, c) => n + (window === 7 ? c.returned7 : c.returned30), 0);
    return { base, returned, percent: base ? 100 * returned / base : null };
  };
  return { today: daily?.active ?? 0, monthly: monthly?.active ?? 0, openings,
    average: monthly?.active && !partialMonth ? openings / monthly.active : null, partialMonth,
    retention7: retention(7), retention30: retention(30) };
}

/** Les données ne sont rendues qu'après authentification côté serveur ; aucun fichier statique ne les contient. */
export function renderUsageDashboard(snapshot: UsageSnapshot, downloads: DownloadSnapshot | null, now: Date, selectedMonth?: string): string {
  const month = selectedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth) ? selectedMonth : now.toISOString().slice(0, 7);
  const m = usageMetrics(snapshot, now, month);
  const percent = (value: number | null) => value === null ? 'En attente' : number(value) + ' %';
  const row = (values: Array<string | number>) => '<tr>' + values.map(v => '<td>' + escape(typeof v === 'number' ? number(v) : v) + '</td>').join('') + '</tr>';
  const card = (title: string, value: string, detail: string) => `<article><h2>${escape(title)}</h2><strong>${escape(value)}</strong><p>${escape(detail)}</p></article>`;
  const days = snapshot.days.filter(d => d.period.startsWith(month)).sort((a, b) => b.period.localeCompare(a.period));
  const months = snapshot.months.slice().sort((a, b) => b.period.localeCompare(a.period));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Statistiques privées · Magistra</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#f4f1fc;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 22px}header{display:flex;justify-content:space-between;gap:20px;align-items:start}h1{font-size:32px;margin:6px 0}h2{font-size:16px;margin:0;color:#c9c0dc}p{color:#aaa4b8;margin:10px 0}a{color:#c4b0ff}nav{display:flex;gap:14px;flex-wrap:wrap;margin:26px 0}.badge{display:inline-block;border:1px solid #504568;border-radius:30px;padding:4px 12px;color:#d9caff;font-size:13px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}article,.panel{border:1px solid #342d44;background:#16131e;border-radius:18px;padding:22px}article strong{display:block;font-size:34px;margin-top:8px;color:#cebaff}article p{font-size:13px}.panel{margin-top:22px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:12px 8px;border-bottom:1px solid #332c43}th{color:#c9c0dc}.scroll{overflow:auto}summary{cursor:pointer;font-weight:600}footer{font-size:13px;margin-top:26px} @media(max-width:600px){header{display:block}h1{font-size:27px}main{padding:24px 16px}}
  </style></head><body><main><header><div><span class="badge">Accès privé · Juan Robin</span><h1>La vie de Magistra</h1><p>Statistiques des installations Windows participantes. Périodes en UTC.</p></div><a href="/tableau-prive">Actualiser</a></header>
  <nav>${months.map(x => `<a href="/tableau-prive?month=${escape(x.period)}"${x.period === month ? ' aria-current="page"' : ''}>${escape(x.period)}</a>`).join('') || '<span>Les premiers chiffres apparaîtront après participation.</span>'}</nav>
  ${m.partialMonth ? '<p>Historique partiel : les jours de plus de 400 jours ont été supprimés. La moyenne mensuelle est indisponible pour cette période.</p>' : ''}
  <div class="cards">${card('Actives aujourd’hui', number(m.today), 'Installations utilisées au moins une fois aujourd’hui.')}${card('Actives dans le mois', number(m.monthly), month + ' · chaque installation comptée une fois.')}${card('Ouvertures dans le mois', number(m.openings), 'Nouveaux lancements affichés ; les activités seules ne comptent pas comme ouvertures.')}${card('Ouvertures par installation', m.average === null ? '—' : number(m.average), 'Ouvertures du mois / installations actives du même mois.')}${card('Retour dans les 7 jours', percent(m.retention7.percent), `${m.retention7.returned} retours / ${m.retention7.base} premiers usages évaluables.`)}${card('Retour dans les 30 jours', percent(m.retention30.percent), `${m.retention30.returned} retours / ${m.retention30.base} premiers usages évaluables.`)}${card('Téléchargements', downloads ? number(downloads.total) : 'Indisponible', downloads?.complete ? 'Installateurs EXE et ZIP, toutes versions stables.' : 'Lecture GitHub indisponible ou historique partiel.')}</div>
  <section class="panel"><h2>Activité quotidienne · ${escape(month)}</h2><div class="scroll"><table><thead><tr><th>Date UTC</th><th>Installations actives</th><th>Ouvertures</th></tr></thead><tbody>${days.map(d => row([d.period, d.active, d.openings])).join('') || '<tr><td colspan="3">Aucune mesure reçue pour ce mois.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><details><summary>Retours et limites du comptage</summary><p>Un retour signifie une activité sur un autre jour dans les 7 ou 30 jours suivant le premier usage mesuré après accord. Les cohortes récentes sont en attente. Les taux concernent les périodes arrivées à échéance ; des envois différés hors ligne peuvent encore les compléter pendant 35 jours.</p><p>Ces chiffres concernent des profils locaux participants, pas des personnes uniques. Plusieurs ordinateurs, une réinstallation ou un retrait suivi d’un nouvel accord peuvent créer une nouvelle participation. Les téléchargements incluent les essais, mises à jour et téléchargements répétés. Les jetons distincts par jour et par mois ne permettent pas un profil individuel permanent.</p><p>Seuls des compteurs d’usage sont reçus. Aucun document, consigne, identité, clé API, adresse IP ou empreinte matérielle n’est stocké dans les statistiques. Les agrégats sont conservés 400 jours ; les jetons de déduplication sont supprimés au plus tard 77 jours après leur création.</p></details></section>
  <section class="panel"><details><summary>Téléchargements par version</summary><div class="scroll"><table><thead><tr><th>Version</th><th>Fichiers téléchargés</th></tr></thead><tbody>${downloads?.releases.map(d => row([d.version, d.downloads])).join('') || '<tr><td colspan="2">Lecture GitHub indisponible.</td></tr>'}</tbody></table></div></details></section>
  <footer><a href="/api/usage-dashboard?format=json">Exporter les agrégats JSON</a> · Mis à jour le ${escape(now.toISOString())}. Aucune statistique antérieure à la mise en service ne peut être reconstituée.</footer></main></body></html>`;
}
