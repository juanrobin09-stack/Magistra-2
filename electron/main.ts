import { app, BrowserWindow, ipcMain, shell } from 'electron';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { buildSystemPrompt, buildUserPrompt } from '../src/lib/prompts';

// ─── Config (stored in %APPDATA%/Roaming/Magistra/) ───────────────────────────

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig(): Record<string, string> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(data: Record<string, string>) {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[magistra] Failed to write config:', e);
  }
}

function cfg(key: string): string {
  return readConfig()[key] || process.env[key.toUpperCase().replace(/-/g, '_')] || '';
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function sb(urlPath: string, options: RequestInit = {}) {
  const url = cfg('supabaseUrl');
  const key = cfg('supabaseServiceKey');
  if (!url || !key) throw new Error('Supabase non configuré. Allez dans Paramètres.');

  const res = await fetch(`${url}/rest/v1/${urlPath}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.method === 'POST' ? 'return=representation' : 'return=minimal',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const MAX_DAILY = 20;

async function ensureProfile(userId: string) {
  await sb('profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: userId }),
  });
}

async function checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().split('T')[0];
  const data = await sb(`usage?user_id=eq.${userId}&date=eq.${today}&select=generation_count`);
  const count = data?.[0]?.generation_count ?? 0;
  return { allowed: count < MAX_DAILY, remaining: MAX_DAILY - count };
}

async function incrementUsage(userId: string, tokens: number) {
  await sb('rpc/increment_usage', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_tokens: tokens }),
  });
}

async function saveGeneration(data: Record<string, unknown>) {
  const result = await sb('generations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  return result?.[0];
}

// ─── JSON body parser ─────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ─── API route handlers ───────────────────────────────────────────────────────

async function handleGenerate(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = (await readBody(req)) as Parameters<typeof buildUserPrompt>[0] & {
    userId: string;
  };

  if (!body.userId || !body.type || !body.matiere || !body.niveau || !body.sujet) {
    return json(res, 400, { error: 'Champs requis manquants.' });
  }

  const anthropicKey = cfg('anthropicKey');
  if (!anthropicKey) {
    return json(res, 500, {
      error: 'Clé API Anthropic manquante. Configurez-la dans Paramètres > Clés API.',
    });
  }

  try {
    await ensureProfile(body.userId);

    const { allowed, remaining } = await checkRateLimit(body.userId);
    if (!allowed) {
      return json(res, 429, {
        error: 'Limite quotidienne atteinte (20 générations/jour). Revenez demain !',
        remaining: 0,
      });
    }

    const systemPrompt = buildSystemPrompt(body.type, body.niveau);
    const userPrompt = buildUserPrompt(body);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[magistra] Anthropic error:', errText);
      return json(res, 502, { error: 'Erreur lors de la génération. Réessayez.' });
    }

    const anthropicData = await anthropicRes.json() as {
      content: Array<{ text: string }>;
      usage: { output_tokens: number };
    };
    const contenu: string = anthropicData.content?.[0]?.text ?? '';
    const tokensUsed: number = anthropicData.usage?.output_tokens ?? 0;

    if (!contenu) {
      return json(res, 502, { error: "Réponse vide de l'IA. Réessayez dans quelques instants." });
    }

    const saved = await saveGeneration({
      user_id: body.userId,
      type: body.type,
      matiere: body.matiere,
      niveau: body.niveau,
      sujet: body.sujet,
      duree: body.duree,
      objectifs: body.objectifs,
      difficulte: body.difficulte,
      consignes: body.consignes,
      contenu,
      tokens_used: tokensUsed,
    });

    await incrementUsage(body.userId, tokensUsed);

    return json(res, 200, {
      id: saved?.id,
      contenu,
      remaining: remaining - 1,
      tokens_used: tokensUsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur.';
    console.error('[magistra] Generate error:', err);
    return json(res, 500, { error: msg });
  }
}

async function handleHistory(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlObj = new URL(req.url ?? '/', `http://localhost`);
  const userId = urlObj.searchParams.get('userId');
  if (!userId) return json(res, 400, { error: 'userId required' });

  try {
    const data = await sb(
      `generations?user_id=eq.${userId}&order=created_at.desc&limit=100&select=id,type,matiere,niveau,sujet,contenu,is_favorite,created_at`
    );
    return json(res, 200, data ?? []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur.';
    console.error('[magistra] History error:', err);
    return json(res, 500, { error: msg });
  }
}

async function handleFavorite(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = (await readBody(req)) as { id: string; userId: string; isFavorite: boolean };
  if (!body.id || !body.userId) return json(res, 400, { error: 'id and userId required' });

  try {
    const url = cfg('supabaseUrl');
    const key = cfg('supabaseServiceKey');
    await fetch(`${url}/rest/v1/generations?id=eq.${body.id}&user_id=eq.${body.userId}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ is_favorite: body.isFavorite }),
    });
    return json(res, 200, { success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur.';
    return json(res, 500, { error: msg });
  }
}

async function handleDelete(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = (await readBody(req)) as { id: string; userId: string };
  if (!body.id || !body.userId) return json(res, 400, { error: 'id and userId required' });

  try {
    const url = cfg('supabaseUrl');
    const key = cfg('supabaseServiceKey');
    await fetch(`${url}/rest/v1/generations?id=eq.${body.id}&user_id=eq.${body.userId}`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
    });
    return json(res, 200, { success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur.';
    return json(res, 500, { error: msg });
  }
}

// ─── Static file server ───────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function getDistPath(): string {
  // __dirname is dist-electron/ after build
  return app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.resolve(__dirname, '../dist');
}

function serveStatic(urlPath: string, res: http.ServerResponse) {
  const distPath = getDistPath();
  const cleanPath = urlPath.split('?')[0];
  let filePath = path.join(distPath, cleanPath === '/' ? 'index.html' : cleanPath);

  // SPA fallback: serve index.html for unknown routes
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distPath, 'index.html');
  }

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ─── HTTP server (API + static on same port) ──────────────────────────────────

export const API_PORT = 3721;

function startServer() {
  const server = http.createServer(async (req, res) => {
    // CORS for renderer
    res.setHeader('Access-Control-Allow-Origin', `http://localhost:${API_PORT}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = req.url ?? '/';

    if (url.startsWith('/api/')) {
      if (url.startsWith('/api/generate') && req.method === 'POST') return handleGenerate(req, res);
      if (url.startsWith('/api/history') && req.method === 'GET') return handleHistory(req, res);
      if (url.startsWith('/api/favorite') && req.method === 'PATCH') return handleFavorite(req, res);
      if (url.startsWith('/api/delete') && req.method === 'DELETE') return handleDelete(req, res);
      return json(res, 404, { error: 'Unknown API route' });
    }

    serveStatic(url, res);
  });

  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`[magistra] Server running on http://127.0.0.1:${API_PORT}`);
  });

  server.on('error', (err) => {
    console.error('[magistra] Server error:', err);
  });

  return server;
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    // App icon
    ...(process.platform === 'win32'
      ? { icon: path.join(__dirname, '../public/icon.png') }
      : {}),
  });

  // Open external links in default browser (important for Clerk OAuth popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (!app.isPackaged) mainWindow?.webContents.openDevTools();
  });

  // Dev: load from Vite dev server; Prod: load from local HTTP server
  const url = app.isPackaged
    ? `http://127.0.0.1:${API_PORT}`
    : 'http://localhost:5173';

  mainWindow.loadURL(url);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('config:get', (_e, key: string) => {
  const val = cfg(key);
  // Mask sensitive keys (show only last 4 chars)
  if ((key === 'anthropicKey' || key === 'supabaseServiceKey') && val.length > 8) {
    return val.slice(0, 4) + '••••••••' + val.slice(-4);
  }
  return val;
});

ipcMain.handle('config:get-raw', (_e, key: string) => cfg(key));

ipcMain.handle('config:set', (_e, key: string, value: string) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
  return true;
});

ipcMain.handle('config:has', (_e, key: string) => {
  return Boolean(cfg(key));
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
