// Textes transmis au site par le connecteur local : état du moteur (GET /v1/status) et messages d'erreur, jamais
// d'adresse, de port, de chemin ni de nom d'hôte d'un serveur distant ; libellé du navigateur (User-Agent).

import { describe, expect, it } from 'vitest';
import { defaultMessage } from '../../shared/errors.js';
import type { Capabilities } from '../../shared/types.js';
import { buildConnectorStatus, isShareableText, publicEvent, publicMessage, REMOTE_ENGINE_LABEL } from '../../electron/connector/status.js';
import { browserFromUserAgent } from '../../electron/connector/userAgent.js';

const LOCAL: Capabilities = {
  maxDocumentChars: 20_835,
  research: { academic: true, web: true, institutional: true, wikipedia: false },
  privacy: { level: 'local', message: 'IA locale' },
  engineLabel: 'Magistra Standard',
  ready: true,
};

describe('textes transmis au site', () => {
  it('messages ordinaires conservés ; adresses, ports, chemins remplacés par le message générique du code', () => {
    for (const ok of [
      'Le modèle Magistra Standard n’est pas encore installé. Installez-le depuis l’assistant de configuration.',
      'Le moteur IA est installé mais arrêté : Magistra le démarrera au lancement de la génération.',
      'Le moteur IA installé (Ollama 0.12.3) est trop ancien.',
      'Réessayez dans quelques instants (heure de Paris).',
    ]) {
      expect(isShareableText(ok), ok).toBe(true);
    }
    for (const leak of [
      'Serveur injoignable (http://127.0.0.1:11434).', 'Moteur sur localhost', 'Adresse 192.168.1.20 refusée', 'Hôte ollama:11434',
      'Fichier C:\\Users\\prof\\AppData\\Roaming\\Magistra\\ai-config.json', 'Chemin /home/prof/.ollama/models introuvable',
      'Partage \\\\serveur\\modeles\\ inaccessible', 'Adresse [::1]:11434',
    ]) {
      expect(isShareableText(leak), leak).toBe(false);
      expect(publicMessage('AI_SERVER_UNREACHABLE', leak)).toBe(defaultMessage('AI_SERVER_UNREACHABLE'));
    }
    expect(publicMessage('INTERNAL', '')).toBe(defaultMessage('INTERNAL'));
    expect(publicMessage('INTERNAL', 'x'.repeat(601))).toBe(defaultMessage('INTERNAL'));
  });

  it('évènements : erreurs et avertissements filtrés, contenu inchangé', () => {
    expect(publicEvent({ type: 'error', code: 'AI_TIMEOUT', message: 'Délai (http://127.0.0.1:11434)', retryable: true, partial: 'texte' }))
      .toEqual({ type: 'error', code: 'AI_TIMEOUT', message: defaultMessage('AI_TIMEOUT'), retryable: true, partial: 'texte' });
    expect(publicEvent({ type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'https://searx.univ.fr indisponible' }))
      .toEqual({ type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: defaultMessage('RESEARCH_UNAVAILABLE') });
    const delta = { type: 'delta' as const, text: 'Voir http://exemple.fr' };
    expect(publicEvent(delta)).toBe(delta);
  });

  it('état du moteur local : prêt, libellé, capacités (sans confidentialité ni prestataire)', () => {
    expect(buildConnectorStatus({ version: '2.1.0', capabilities: { ...LOCAL, aiWarning: { code: 'AI_STATUS_UNKNOWN', message: 'État non vérifié.' } }, busy: true })).toEqual({
      version: '2.1.0',
      engine: { ready: true, local: true, label: 'Magistra Standard', warning: { code: 'AI_STATUS_UNKNOWN', message: 'État non vérifié.' } },
      capabilities: { maxDocumentChars: 20_835, research: { academic: true, web: true, institutional: true, wikipedia: false } },
      busy: true,
    });
  });

  it('moteur local non prêt : cause précise ; cause absente : message générique', () => {
    const notReady = { code: 'MODEL_NOT_INSTALLED' as const, message: 'Le modèle Magistra Standard n’est pas encore installé.' };
    expect(buildConnectorStatus({ version: '2', capabilities: { ...LOCAL, ready: false, notReady }, busy: false }).engine)
      .toEqual({ ready: false, local: true, label: 'Magistra Standard', notReady });
    expect(buildConnectorStatus({ version: '2', capabilities: { ...LOCAL, ready: false }, busy: false }).engine.notReady?.code).toBe('AI_SERVER_UNAVAILABLE');
  });

  it('application réglée sur un serveur distant : jamais prête pour le site, libellé neutre, LOCAL_ENGINE_REMOTE', () => {
    const remote: Capabilities = {
      ...LOCAL,
      privacy: { level: 'remote', message: 'Serveur de l’université' },
      engineLabel: 'gpu.univ-exemple.fr',
      providerInfo: { label: 'Université', thirdParty: false },
    };
    const status = buildConnectorStatus({ version: '2', capabilities: remote, busy: false });
    expect(status.engine).toEqual({ ready: false, local: false, label: REMOTE_ENGINE_LABEL, notReady: { code: 'LOCAL_ENGINE_REMOTE', message: defaultMessage('LOCAL_ENGINE_REMOTE') } });
    expect(JSON.stringify(status)).not.toMatch(/univ|Université/);
  });

  it('libellé du modèle douteux (adresse) : libellé générique', () => {
    expect(buildConnectorStatus({ version: '2', capabilities: { ...LOCAL, engineLabel: 'http://127.0.0.1:11434/llama' }, busy: false }).engine.label).toBe('IA locale');
  });
});

describe('navigateur déduit du User-Agent', () => {
  it('Chrome, Edge, Firefox reconnus ; les autres : « Navigateur »', () => {
    const cases: [string | undefined, string][] = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Google Chrome'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'Microsoft Edge'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Mozilla Firefox'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0', 'Navigateur'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Navigateur'],
      ['curl/8.9.1', 'Navigateur'],
      ['', 'Navigateur'],
      [undefined, 'Navigateur'],
      [`Chrome/1 ${'x'.repeat(2_000)}`, 'Navigateur'],
    ];
    for (const [ua, label] of cases) expect(browserFromUserAgent(ua), String(ua).slice(0, 60)).toBe(label);
  });
});
