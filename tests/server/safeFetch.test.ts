// Protection SSRF de la récupération de pages web (sans réseau : DNS et transport injectés).

import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import {
  checkUrlShape, createSafePageFetcher, extractTitle, isPublicAddress, neutralizeUnclosedBlocks, nodeTransport,
  type ResolvedAddress, type Transport,
} from '../../server/safeFetch.js';

const PUBLIC_IP = '93.184.215.14';

function html(body: string, title = 'Page publique'): Response {
  return new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function setup(dns: Record<string, string[]>, handler?: (url: URL) => Response) {
  const connections: { url: string; address: string }[] = [];
  const resolve = async (host: string): Promise<ResolvedAddress[]> =>
    (dns[host] ?? []).map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  const transport: Transport = async (url, init) => {
    connections.push({ url: url.href, address: init.address.address });
    return handler ? handler(url) : html('<p>Contenu de la page, suffisamment long pour être utile.</p>');
  };
  return { connections, fetchPage: createSafePageFetcher({ resolve, fetch: transport }) };
}

describe('isPublicAddress', () => {
  const refused = [
    '127.0.0.1', '127.8.9.10', '10.0.0.1', '10.255.255.255', '192.168.1.20', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10',
    '::1', '::', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', '2002:c0a8:101::1',
    '::127.0.0.1', 'pas-une-ip',
  ];
  const accepted = [PUBLIC_IP, '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4007:80e::200e', '::ffff:8.8.8.8'];
  for (const ip of refused) it(`refuse ${ip}`, () => expect(isPublicAddress(ip)).toBe(false));
  for (const ip of accepted) it(`accepte ${ip}`, () => expect(isPublicAddress(ip)).toBe(true));
});

describe('checkUrlShape', () => {
  it('refuse les schémas autres que http(s), les ports non standard et les identifiants', () => {
    for (const url of ['file:///etc/passwd', 'gopher://exemple.fr/', 'ftp://exemple.fr/', 'javascript:alert(1)', 'data:text/html,x',
      'http://exemple.fr:8080/', 'https://exemple.fr:22/', 'http://user:pass@exemple.fr/', 'pas une url']) {
      expect(() => checkUrlShape(url), url).toThrow();
    }
    expect(checkUrlShape('https://exemple.fr/page#ancre').href).toBe('https://exemple.fr/page');
    expect(checkUrlShape('http://exemple.fr:80/').port).toBe('');
    expect(checkUrlShape('https://exemple.fr:443/x').href).toBe('https://exemple.fr/x');
  });
});

describe('fetchPublicPage (createSafePageFetcher)', () => {
  const blocked: [string, Record<string, string[]>][] = [
    ['http://127.0.0.1/', {}],
    ['http://10.1.2.3/admin', {}],
    ['http://192.168.0.1/', {}],
    ['http://169.254.169.254/latest/meta-data/', {}],
    ['http://[::1]/', {}],
    ['http://[fc00::1]/', {}],
    ['http://[fd00:ec2::254]/', {}],
    ['http://[::ffff:127.0.0.1]/', {}],
    ['http://2130706433/', {}], // 127.0.0.1 en décimal
    ['http://0x7f.1/', {}],
    ['http://localhost/', { localhost: ['127.0.0.1'] }],
    ['http://interne.exemple.fr/', { 'interne.exemple.fr': ['10.0.0.5'] }],
    ['http://mixte.exemple.fr/', { 'mixte.exemple.fr': [PUBLIC_IP, '192.168.1.1'] }],
    ['http://v6.exemple.fr/', { 'v6.exemple.fr': ['fe80::1'] }],
    ['http://inconnu.exemple.fr/', {}],
    ['file:///etc/passwd', {}],
    ['gopher://exemple.fr:70/_GET', { 'exemple.fr': [PUBLIC_IP] }],
    ['http://exemple.fr:6379/', { 'exemple.fr': [PUBLIC_IP] }],
  ];
  for (const [url, dns] of blocked) {
    it(`refuse ${url} sans jamais s'y connecter`, async () => {
      const { connections, fetchPage } = setup(dns);
      expect(await fetchPage(url)).toBeNull();
      expect(connections).toHaveLength(0);
    });
  }

  it('accepte une adresse publique et se connecte à l’IP vérifiée', async () => {
    const { connections, fetchPage } = setup({ 'www.exemple.fr': [PUBLIC_IP] }, () =>
      html('<script>alert("x")</script><nav>menu</nav><h1>Titre</h1><p>Le théorème de Pythagore &amp; ses usages.</p>', 'Pythagore &amp; co'));
    const page = await fetchPage('https://www.exemple.fr/article');
    expect(page).not.toBeNull();
    expect(page!.url).toBe('https://www.exemple.fr/article');
    expect(page!.title).toBe('Pythagore & co');
    expect(page!.text).toContain('Le théorème de Pythagore & ses usages.');
    expect(page!.text).not.toContain('alert');
    expect(page!.text).not.toContain('menu');
    expect(connections).toEqual([{ url: 'https://www.exemple.fr/article', address: PUBLIC_IP }]);
  });

  it('revérifie chaque redirection et refuse une redirection vers le réseau interne', async () => {
    const { connections, fetchPage } = setup({ 'www.exemple.fr': [PUBLIC_IP] }, url =>
      url.pathname === '/depart'
        ? new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } })
        : html('<p>jamais</p>'));
    expect(await fetchPage('https://www.exemple.fr/depart')).toBeNull();
    expect(connections).toHaveLength(1);
  });

  it('suit au plus 3 redirections publiques', async () => {
    const dns = { 'a.exemple.fr': [PUBLIC_IP], 'b.exemple.fr': ['8.8.4.4'] };
    let hops = 0;
    const ok = setup(dns, url => {
      if (url.pathname === '/fin') return html('<p>Page finale après redirections, avec du contenu.</p>');
      hops++;
      return new Response(null, { status: 301, headers: { Location: hops < 3 ? `https://b.exemple.fr/r${hops}` : '/fin' } });
    });
    const page = await ok.fetchPage('https://a.exemple.fr/r0');
    expect(page?.url).toBe('https://b.exemple.fr/fin');
    expect(ok.connections.map(c => c.address)).toEqual([PUBLIC_IP, '8.8.4.4', '8.8.4.4', '8.8.4.4']);

    const loop = setup(dns, () => new Response(null, { status: 302, headers: { Location: 'https://a.exemple.fr/boucle' } }));
    expect(await loop.fetchPage('https://a.exemple.fr/boucle')).toBeNull();
    expect(loop.connections).toHaveLength(4);
  });

  it('refuse les types de contenu autres que text/html et text/plain', async () => {
    for (const type of ['application/pdf', 'application/json', 'image/png', '']) {
      const { fetchPage } = setup({ 'x.exemple.fr': [PUBLIC_IP] }, () =>
        new Response(new TextEncoder().encode('contenu'), { status: 200, headers: type ? { 'Content-Type': type } : {} }));
      expect(await fetchPage('https://x.exemple.fr/'), type).toBeNull();
    }
    const plain = setup({ 'x.exemple.fr': [PUBLIC_IP] }, () =>
      new Response('Texte brut\r\nsur deux lignes', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    expect((await plain.fetchPage('https://x.exemple.fr/'))?.text).toBe('Texte brut\nsur deux lignes');
  });

  it('interrompt la lecture au-delà de 1,5 Mo', async () => {
    let pulled = 0;
    const { fetchPage } = setup({ 'gros.exemple.fr': [PUBLIC_IP] }, () => {
      const chunk = new TextEncoder().encode(`<p>${'a'.repeat(65_536)}</p>`);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
          if (pulled > 50_000_000) controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    const page = await fetchPage('https://gros.exemple.fr/');
    expect(page).not.toBeNull();
    expect(pulled).toBeLessThan(2_000_000);
    expect(page!.text.length).toBeLessThanOrEqual(200_000);
  });

  it('respecte le délai maximal (6 s par défaut, ici 100 ms)', async () => {
    const fetchPage = createSafePageFetcher({
      timeoutMs: 100,
      resolve: async () => [{ address: PUBLIC_IP, family: 4 }],
      fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abandon')))),
    });
    const start = Date.now();
    expect(await fetchPage('https://lent.exemple.fr/')).toBeNull();
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('neutralise les blocs jamais refermés (page tronquée ou hostile)', () => {
    expect(neutralizeUnclosedBlocks('<p>ok</p><script>var secret = 1;')).toBe('<p>ok</p>');
    expect(neutralizeUnclosedBlocks('<nav>a</nav><p>x</p><nav class="y">b')).toBe('<nav>a</nav><p>x</p>< nav class="y">b');
    const hostile = `${'<aside>'.repeat(20_000)}texte`;
    const start = Date.now();
    neutralizeUnclosedBlocks(hostile);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('transport Node : connexion épinglée à l’adresse vérifiée', () => {
  it('se connecte à l’IP fournie sans résoudre le nom d’hôte', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<title>ok</title><p>hôte demandé : ${req.headers.host}</p>`);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      // « nom-inexistant.invalid » ne peut pas être résolu : seule l'IP épinglée permet la connexion.
      const res = await nodeTransport(new URL(`http://nom-inexistant.invalid:${port}/`), {
        address: { address: '127.0.0.1', family: 4 },
        headers: {},
        signal: AbortSignal.timeout(3_000),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`hôte demandé : nom-inexistant.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});

describe('déni de service : pages hostiles (non-régression)', () => {
  it('extractTitle reste linéaire : « <title> » répété sans fermeture (1,5 Mo) traité en moins de 200 ms', () => {
    const hostile = '<p>texte</p>' + '<title>'.repeat(200_000);
    const start = performance.now();
    expect(extractTitle(hostile)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(200);
    expect(extractTitle('<html><head><title> Cours &amp; TD </title></head></html>')).toBe('Cours & TD');
  });

  it('un corps gzip jamais terminé n’immobilise pas la lecture : l’annulation la débloque', async () => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      const gz = zlib.createGzip();
      gz.pipe(res);
      gz.write('<p>début de page</p>');
      gz.flush();
      // le corps n'est jamais terminé
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const controller = new AbortController();
      const res = await nodeTransport(new URL(`http://page-lente.invalid:${port}/`), {
        address: { address: '127.0.0.1', family: 4 },
        headers: {},
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('début');
      setTimeout(() => controller.abort(), 100);
      const outcome = await Promise.race([
        reader.read().then(() => 'terminé', () => 'erreur'),
        new Promise(r => setTimeout(() => r('bloqué'), 3_000)),
      ]);
      expect(outcome).not.toBe('bloqué');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
