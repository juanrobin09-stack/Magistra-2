// Test de démarrage automatisé (`--smoke-test` ou MAGISTRA_SMOKE_TEST=1), uniquement hors de l'application installée
// (Electron lancé depuis les sources : voir devOptions.ts).
//
// Le processus principal attend l'appel `window.magistra.app.ready()` fait par l'interface après son premier
// rendu, puis vérifie DANS la fenêtre, via le vrai pont IPC :
//   - window.magistra est un objet et #root contient des éléments ;
//   - la fenêtre n'a accès ni à require ni à process (isolation) ;
//   - app.info() et ai.status() répondent (moteur, modèles installés) ;
//   - facultatif (MAGISTRA_SMOKE_GENERATE=1) : une génération complète aboutit.
// Résultat : une ligne « MAGISTRA_SMOKE_RESULT {json} » sur la sortie standard, code 0 (succès) ou 1.

import type { BrowserWindow } from 'electron';

export const SMOKE_RESULT_PREFIX = 'MAGISTRA_SMOKE_RESULT ';

export interface SmokeOptions {
  timeoutMs: number;
  generate: boolean;
  /** État attendu du moteur (ex. « running » avec scripts/mock-ollama.mjs). */
  expectEngine?: string;
}

export function smokeOptionsFrom(argv: readonly string[], env: NodeJS.ProcessEnv): SmokeOptions | null {
  if (!argv.includes('--smoke-test') && env.MAGISTRA_SMOKE_TEST !== '1') return null;
  const timeout = Number(env.MAGISTRA_SMOKE_TIMEOUT_MS);
  return {
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45_000,
    generate: env.MAGISTRA_SMOKE_GENERATE === '1',
    ...(env.MAGISTRA_SMOKE_EXPECT_ENGINE ? { expectEngine: env.MAGISTRA_SMOKE_EXPECT_ENGINE } : {}),
  };
}

/** Script exécuté dans la fenêtre (monde principal) : n'utilise que le pont public. */
function rendererCheckScript(generate: boolean): string {
  return `(async () => {
    // L'interface peut naviguer juste après son premier rendu (redirections) : on attend un contenu stable.
    const root = document.getElementById('root');
    const deadline = Date.now() + 10000;
    while ((!root || root.childElementCount === 0) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
    const out = {
      bridge: typeof window.magistra,
      isElectron: !!(window.magistra && window.magistra.isElectron === true),
      rootChildren: root ? root.childElementCount : 0,
      rootText: root ? root.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160) : '',
      isolated: typeof require === 'undefined' && typeof process === 'undefined',
      url: location.href,
      title: document.title,
    };
    const errText = e => String((e && e.message) || e).slice(0, 300);
    try { out.info = await window.magistra.app.info(); } catch (e) { out.infoError = errText(e); }
    try {
      const s = await window.magistra.ai.status();
      out.ai = {
        engine: s.engine.state, version: s.engine.version || null, url: s.engine.url,
        models: s.installedModels.map(m => m.name), ready: s.ready, headline: s.headline,
        recommended: s.recommendation.tier, selectedTier: s.selectedTier, activeModel: s.activeModel,
        hasKeyField: JSON.stringify(s).includes('apiKey"'),
      };
    } catch (e) { out.aiError = errText(e); }
    try { out.prefs = await window.magistra.prefs.get(); } catch (e) { out.prefsError = errText(e); }
    if (${generate ? 'true' : 'false'}) {
      // Installation du modèle actif si besoin, avec la progression reçue par IPC.
      if (out.ai && !out.ai.models.includes(out.ai.activeModel)) {
        const progress = [];
        const offProgress = window.magistra.ai.onProgress(e => progress.push(e));
        try {
          await window.magistra.ai.pullModel({ tier: out.ai.selectedTier });
          out.pull = { ok: true };
        } catch (e) { out.pull = { ok: false, error: errText(e) }; }
        offProgress();
        const pulls = progress.filter(e => e.kind === 'model-pull');
        out.pull.events = progress.length;
        out.pull.lastPercent = pulls.length ? pulls[pulls.length - 1].percent : null;
        out.pull.ready = progress.some(e => e.kind === 'model-ready');
        try { out.pull.readyAfter = (await window.magistra.ai.status()).ready; } catch (e) { out.pull.statusError = errText(e); }
      }
      out.generation = await new Promise(resolve => {
        const events = [];
        let jobId = null;
        const timer = setTimeout(() => { off(); resolve({ ok: false, reason: 'délai dépassé', events: events.length }); }, 60000);
        const off = window.magistra.generation.onEvent(p => {
          if (jobId && p.jobId !== jobId) return;
          events.push(p.event);
          if (p.event.type === 'done' || p.event.type === 'error') {
            clearTimeout(timer); off();
            const last = p.event;
            resolve({
              ok: last.type === 'done',
              events: events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {}),
              saved: last.type === 'done' ? last.saved : false,
              sources: last.type === 'done' ? last.sources.length : 0,
              chars: last.type === 'done' ? last.content.length : 0,
              error: last.type === 'error' ? last.code + ' — ' + last.message : undefined,
            });
          }
        });
        window.magistra.generation.start({
          type: 'cours', niveau: 'licence_1', sujet: 'La photosynthèse (test de démarrage)', researchMode: 'documents',
          documents: [{ docId: 'smoke', docName: 'notes-de-cours.txt', kind: 'txt', locator: { type: 'lines', start: 1, end: 4 },
            text: 'La photosynthèse convertit l’énergie lumineuse en énergie chimique. Elle se déroule dans les chloroplastes.' }],
        }).then(r => { jobId = r.jobId; }, e => { clearTimeout(timer); off(); resolve({ ok: false, reason: errText(e) }); });
      });
      try { const page = await window.magistra.data.list({ limit: 5 }); out.historyCount = page.items.length; } catch (e) { out.historyError = errText(e); }
    }
    return out;
  })()`;
}

export class SmokeTest {
  private readonly options: SmokeOptions;
  private readonly exit: (code: number) => void;
  private readonly startedAt = Date.now();
  private finished = false;
  private running = false;
  private win: BrowserWindow | null = null;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly notes: string[] = [];

  constructor(options: SmokeOptions, exit: (code: number) => void) {
    this.options = options;
    this.exit = exit;
    this.timer = setTimeout(() => this.finish(false, `Délai de ${Math.round(options.timeoutMs / 1000)} s dépassé sans app.ready()`), options.timeoutMs);
  }

  note(message: string): void {
    this.notes.push(message);
  }

  attach(win: BrowserWindow): void {
    this.win = win;
    const wc = win.webContents;
    wc.on('render-process-gone', (_e, details) => this.finish(false, `Processus d'affichage arrêté (${details.reason})`));
    wc.on('preload-error', (_e, preloadPath, error) => this.finish(false, `Erreur du preload ${preloadPath} : ${error.message}`));
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame) this.finish(false, `Échec du chargement de ${url} : ${description} (${code})`);
    });
    wc.on('console-message', details => {
      if (details.level === 'error') this.note(`console.error : ${String(details.message).slice(0, 300)}`);
    });
  }

  async onAppReady(): Promise<void> {
    if (this.finished || this.running || !this.win) return;
    this.running = true;
    try {
      const checks = (await this.win.webContents.executeJavaScript(rendererCheckScript(this.options.generate), false)) as Record<string, unknown>;
      const failures: string[] = [];
      if (checks.bridge !== 'object' || checks.isElectron !== true) failures.push('window.magistra absent');
      if (!(Number(checks.rootChildren) > 0)) failures.push('#root vide');
      if (checks.isolated !== true) failures.push('isolation de la fenêtre incomplète');
      if (checks.infoError) failures.push(`app.info : ${String(checks.infoError)}`);
      if (checks.aiError) failures.push(`ai.status : ${String(checks.aiError)}`);
      const ai = checks.ai as { engine?: string; hasKeyField?: boolean } | undefined;
      if (ai?.hasKeyField) failures.push('une clé API transite vers la fenêtre');
      if (this.options.expectEngine && ai?.engine !== this.options.expectEngine) {
        failures.push(`moteur « ${ai?.engine ?? 'inconnu'} » au lieu de « ${this.options.expectEngine} »`);
      }
      if (this.options.generate) {
        const gen = checks.generation as { ok?: boolean; error?: string; reason?: string } | undefined;
        if (!gen?.ok) failures.push(`génération : ${gen?.error ?? gen?.reason ?? 'échec'}`);
      }
      // Rechargement réel (Ctrl+R) sur la route courante : jamais d'écran blanc.
      const reload = await this.reloadCheck();
      checks.afterReload = reload;
      if (!(reload.rootChildren > 0)) failures.push(`écran vide après rechargement de ${reload.url}`);
      this.finish(failures.length === 0, failures.join(' ; ') || undefined, checks);
    } catch (err) {
      this.finish(false, `Vérification impossible : ${(err as Error)?.message ?? String(err)}`);
    }
  }

  private async reloadCheck(): Promise<{ url: string; rootChildren: number }> {
    const wc = this.win!.webContents;
    const loaded = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 15_000);
      wc.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    wc.reload();
    await loaded;
    return (await wc.executeJavaScript(`(async () => {
      const root = document.getElementById('root');
      const deadline = Date.now() + 10000;
      while ((!root || root.childElementCount === 0) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      // Laisse aboutir les premiers appels du pont (profil, état de l'IA) avant la fermeture de la fenêtre.
      await new Promise(r => setTimeout(r, 500));
      return { url: location.href, rootChildren: root ? root.childElementCount : 0 };
    })()`, false)) as { url: string; rootChildren: number };
  }

  fail(reason: string): void {
    this.finish(false, reason);
  }

  private finish(ok: boolean, reason?: string, checks?: Record<string, unknown>): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    const summary = {
      ok,
      ...(reason ? { reason } : {}),
      durationMs: Date.now() - this.startedAt,
      ...(checks ? { checks } : {}),
      ...(this.notes.length ? { notes: this.notes.slice(0, 20) } : {}),
    };
    process.stdout.write(`${SMOKE_RESULT_PREFIX}${JSON.stringify(summary)}\n`);
    this.exit(ok ? 0 : 1);
  }
}
