// OCR des pages images, entièrement sur cet ordinateur. Le worker et ses modèles sont empaquetés
// dans /ocr : aucune URL de document ni aucun service distant ne sont transmis au moteur.
// Le protocole du worker Tesseract.js 7 est utilisé directement pour pouvoir terminer le worker
// même si son initialisation se bloque (createWorker ne le rend qu'après cette initialisation).

export const OCR_LANGUAGES = 'fra+eng+jpn';
export const OCR_TIMEOUT_MS = 90_000;

export type OcrImage = HTMLCanvasElement | OffscreenCanvas | Blob;
export interface OcrResult { text: string; confidence: number }
export interface OcrProgress { stage: 'initializing' | 'recognizing'; progress: number }
export type OcrProgressCallback = (progress: OcrProgress) => void;

/** Adaptateur injectable dans les tests ; le moteur est accessible avant son initialisation. */
export interface OcrEngine {
  initialize(): Promise<void>;
  recognize(image: OcrImage): Promise<OcrResult>;
  terminate(): void;
}

export interface OcrSessionOptions {
  onProgress?: OcrProgressCallback;
  signal?: AbortSignal;
  timeoutMs?: number;
  engineFactory?: (onProgress: OcrProgressCallback) => OcrEngine;
}

export interface OcrSession {
  recognize(image: OcrImage): Promise<OcrResult>;
  dispose(): Promise<void>;
}

export class OcrError extends Error {
  constructor(public readonly code: 'OCR_TIMEOUT' | 'OCR_UNAVAILABLE' | 'OCR_DISPOSED' | 'OCR_INITIALIZATION_FAILED') {
    super(code === 'OCR_TIMEOUT'
      ? 'La reconnaissance du texte a dépassé le délai prévu.'
      : code === 'OCR_DISPOSED'
        ? 'La lecture du document a été arrêtée.'
        : 'La reconnaissance locale du texte est indisponible.');
    this.name = 'OcrError';
  }
}

function notify(callback: OcrProgressCallback | undefined, value: OcrProgress): void {
  try { callback?.(value); } catch { /* L'affichage de la progression ne doit pas arrêter la lecture. */ }
}

// Un seul moteur résident : les trois modèles et les pixels d'une page ne sont pas multipliés
// par le nombre de PDF déposés. La place passe au document suivant lors de dispose().
let occupied = false;
const waiting: Array<() => void> = [];
function acquire(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const grant = () => {
      signal.removeEventListener('abort', cancel);
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        const next = waiting.shift();
        if (next) next();
        else occupied = false;
      });
    };
    const cancel = () => {
      const index = waiting.indexOf(grant);
      if (index >= 0) waiting.splice(index, 1);
      signal.removeEventListener('abort', cancel);
      reject(new OcrError('OCR_DISPOSED'));
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    if (!occupied) { occupied = true; grant(); }
    else waiting.push(grant);
  });
}

function bounded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new OcrError('OCR_TIMEOUT'))), timeoutMs);
    const cancel = () => finish(() => reject(new OcrError('OCR_DISPOSED')));
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      settle();
    };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    // Des handlers restent attachés au travail interrompu : une réponse tardive ne crée pas
    // de rejet non traité et ne modifie pas la session qui a pris sa suite.
    work.then(value => finish(() => resolve(value)), () => finish(() => reject(new OcrError('OCR_UNAVAILABLE'))));
  });
}

export function createOcrSession(options: OcrSessionOptions = {}): OcrSession {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(OCR_TIMEOUT_MS, options.timeoutMs!))
    : OCR_TIMEOUT_MS;
  let engine: OcrEngine | null = null;
  let release: (() => void) | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let initializationFailed = false;
  const progress: OcrProgressCallback = value => {
    if (!controller.signal.aborted) notify(options.onProgress, value);
  };
  const stopEngine = () => {
    const previous = engine;
    engine = null;
    try { previous?.terminate(); } catch { /* Nettoyage sans masquer l'erreur de lecture. */ }
  };
  const checkActive = () => {
    if (controller.signal.aborted) throw new OcrError('OCR_DISPOSED');
  };
  const releasePlace = () => {
    release?.();
    release = null;
  };
  const close = () => {
    controller.abort();
    stopEngine();
    releasePlace();
  };
  if (options.signal?.aborted) close();
  else options.signal?.addEventListener('abort', close, { once: true });

  return {
    recognize(image) {
      const result = tail.then(async () => {
        checkActive();
        if (initializationFailed) throw new OcrError('OCR_INITIALIZATION_FAILED');
        release ??= await acquire(controller.signal);
        checkActive();
        for (let attempt = 0; attempt < 2; attempt++) {
          let initializing = false;
          try {
            if (!engine) {
              initializing = true;
              progress({ stage: 'initializing', progress: 0 });
              engine = (options.engineFactory ?? createLocalEngine)(progress);
              await bounded(engine.initialize(), timeoutMs, controller.signal);
              initializing = false;
            }
            checkActive();
            progress({ stage: 'recognizing', progress: 0 });
            const value = await bounded(engine.recognize(image), timeoutMs, controller.signal);
            checkActive();
            progress({ stage: 'recognizing', progress: 1 });
            return {
              text: value.text.split(String.fromCharCode(0)).join('').trim(),
              confidence: Number.isFinite(value.confidence) ? Math.max(0, Math.min(100, value.confidence)) : 0,
            };
          } catch (error) {
            stopEngine();
            checkActive();
            if (attempt === 1) {
              if (initializing) {
                initializationFailed = true;
                throw new OcrError('OCR_INITIALIZATION_FAILED');
              }
              throw error instanceof OcrError ? error : new OcrError('OCR_UNAVAILABLE');
            }
          }
        }
        throw new OcrError('OCR_UNAVAILABLE');
      }).finally(() => {
        // dispose peut arriver entre l'attribution de la place et la reprise de await acquire.
        if (controller.signal.aborted) releasePlace();
      });
      tail = result.catch(() => {});
      return result;
    },
    async dispose() {
      options.signal?.removeEventListener('abort', close);
      close();
      await tail;
      releasePlace();
    },
  };
}

interface WorkerReply {
  workerId: string;
  jobId: string;
  action: string;
  status: 'resolve' | 'reject' | 'progress';
  data?: { text?: string; confidence?: number; status?: string; progress?: number };
}

function assetUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(`ocr/${path}`, base).href;
}

async function imageBytes(image: OcrImage): Promise<Uint8Array<ArrayBuffer>> {
  let blob: Blob;
  if (image instanceof Blob) blob = image;
  else if ('convertToBlob' in image) blob = await image.convertToBlob({ type: 'image/png' });
  else {
    blob = await new Promise<Blob>((resolve, reject) => {
      image.toBlob(value => value ? resolve(value) : reject(new OcrError('OCR_UNAVAILABLE')), 'image/png');
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

function createLocalEngine(onProgress: OcrProgressCallback): OcrEngine {
  // Classic worker : Tesseract importe le core local avec importScripts ; aucune blob URL ni CDN.
  const worker = new Worker(assetUrl('worker.min.js'));
  const workerId = 'magistra-ocr';
  let jobCounter = 0;
  let stopped = false;
  const pending = new Map<string, { resolve: (value: WorkerReply['data']) => void; reject: (error: OcrError) => void }>();
  const rejectPending = () => {
    for (const job of pending.values()) job.reject(new OcrError('OCR_UNAVAILABLE'));
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (stopped) return;
    const reply = event.data;
    if (reply.workerId !== workerId) return;
    const job = pending.get(reply.jobId);
    if (!job) return;
    if (reply.status === 'progress') {
      const value = reply.data?.progress;
      notify(onProgress, {
        stage: reply.action === 'recognize' ? 'recognizing' : 'initializing',
        progress: typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0,
      });
    } else {
      pending.delete(reply.jobId);
      if (reply.status === 'resolve') job.resolve(reply.data);
      else job.reject(new OcrError('OCR_UNAVAILABLE'));
    }
  };
  worker.onerror = event => { event.preventDefault(); rejectPending(); };
  worker.onmessageerror = rejectPending;
  function command(action: string, payload: object, transfers: Transferable[] = []): Promise<WorkerReply['data']> {
    if (stopped) return Promise.reject(new OcrError('OCR_UNAVAILABLE'));
    const jobId = `magistra-${++jobCounter}`;
    return new Promise((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      try { worker.postMessage({ workerId, jobId, action, payload }, transfers); }
      catch { pending.delete(jobId); reject(new OcrError('OCR_UNAVAILABLE')); }
    });
  }
  return {
    async initialize() {
      await command('load', { options: { lstmOnly: true, corePath: assetUrl('core'), logging: false } });
      await command('loadLanguage', {
        langs: OCR_LANGUAGES,
        options: { langPath: assetUrl('lang'), cacheMethod: 'none', gzip: true, lstmOnly: true },
      });
      await command('initialize', { langs: OCR_LANGUAGES, oem: 1, config: {} });
      await command('setParameters', { params: { tessedit_pageseg_mode: '3', user_defined_dpi: '200' } });
    },
    async recognize(image) {
      const bytes = await imageBytes(image);
      const data = await command('recognize', { image: bytes, options: { rotateAuto: true }, output: { text: true } }, [bytes.buffer]);
      return { text: data?.text ?? '', confidence: data?.confidence ?? 0 };
    },
    terminate() {
      if (stopped) return;
      stopped = true;
      worker.terminate();
      rejectPending();
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
    },
  };
}
