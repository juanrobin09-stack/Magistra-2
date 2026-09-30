// État de l'IA du serveur (site web, mode personnel) et transparence sur le prestataire : fonctions pures.

import { describe, expect, it } from 'vitest';
import { defaultMessage, type ErrorCode } from '@shared/errors';
import type { Capabilities } from '@shared/types';
import {
  adminContactLink, NOT_CONFIGURED_PERSONAL_TEXT, NOT_CONFIGURED_WEB_TEXT, providerPolicyUrl, serverAIView, serverPrivacyMessage,
  STATUS_UNKNOWN_TEXT,
} from '@/lib/ai-ui/server';

const BASE: Capabilities = {
  maxDocumentChars: 1000,
  research: { academic: false, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'server', message: '' },
  engineLabel: 'OVHcloud AI Endpoints',
  ready: true,
};

const notReady = (code: ErrorCode, message = `Message précis ${code}.`): Capabilities => ({ ...BASE, ready: false, notReady: { code, message } });

describe('serverAIView : la vraie cause, par code', () => {
  it('AI_NOT_CONFIGURED : texte dédié (préréglage gratuit, vérification) au lieu de « réessayez »', () => {
    const web = serverAIView(notReady('AI_NOT_CONFIGURED', defaultMessage('AI_NOT_CONFIGURED')), { mode: 'web' });
    expect(web).toMatchObject({ state: 'not_ready', code: 'AI_NOT_CONFIGURED', badge: 'Aucune IA branchée', detail: NOT_CONFIGURED_WEB_TEXT });
    expect(web.detail).toContain("Aucune intelligence artificielle n'est encore branchée sur ce site.");
    expect(web.detail).toContain('AI_PRESET=ovhcloud, gratuit, sans clé');
    expect(web.detail).toContain('npm run ai:check');
    expect(web.advice).toContain('transmettez le code');
    expect(web.advice).not.toMatch(/quelques instants/);

    const personal = serverAIView(notReady('AI_NOT_CONFIGURED', ''), { mode: 'personal' });
    expect(personal.detail).toBe(NOT_CONFIGURED_PERSONAL_TEXT);
    expect(personal.detail).toContain('Ollama');
    // Commandes de vérification adaptées : --dev pour « npm run dev », configuration de production pour Vercel.
    expect(personal.detail).toContain('npm run ai:check -- --dev');
    expect(web.detail).toContain('--vercel --env-file .env.prod.local');
  });

  it('AI_NOT_CONFIGURED avec une cause précise (clé manquante, préréglage mal écrit, LM Studio sans modèle) : cause gardée', () => {
    const causes = [
      "Le service d'IA « Mistral AI (La Plateforme) » exige une clé d'accès : l'administrateur doit renseigner AI_API_KEY.",
      "AI_PRESET n'est pas reconnu. L'administrateur doit choisir l'un des préréglages : ovhcloud, mistral, albert, scaleway, ollama.",
      "Aucune IA n'est encore branchée : LM Studio est démarré sur la machine du serveur Magistra, mais aucun modèle de conversation n'y est disponible.",
    ];
    for (const cause of causes) {
      const web = serverAIView(notReady('AI_NOT_CONFIGURED', cause), { mode: 'web' });
      expect(web).toMatchObject({ state: 'not_ready', code: 'AI_NOT_CONFIGURED', badge: 'Aucune IA branchée', detail: cause });
      expect(web.advice).toContain('transmettez le code');
      const personal = serverAIView(notReady('AI_NOT_CONFIGURED', cause), { mode: 'personal' });
      expect(personal.detail).toBe(cause);
      expect(personal.detail).not.toBe(NOT_CONFIGURED_PERSONAL_TEXT);
      expect(personal.advice).toContain('npm run ai:check -- --dev');
    }
  });

  it('chaque cause a son titre et garde le message précis du serveur', () => {
    const titles = new Set<string>();
    for (const code of ['AI_AUTH_FAILED', 'MODEL_NOT_INSTALLED', 'AI_SERVER_UNREACHABLE', 'AI_QUOTA_EXCEEDED', 'AI_SERVER_UNAVAILABLE'] as ErrorCode[]) {
      const view = serverAIView(notReady(code), { mode: 'web' });
      expect(view.detail).toBe(`Message précis ${code}.`);
      expect(view.code).toBe(code);
      titles.add(view.title);
    }
    expect(titles.size).toBe(5);
  });

  it('quota atteint : le message (avec l’heure de reprise) est affiché tel quel', () => {
    const view = serverAIView(notReady('AI_QUOTA_EXCEEDED', 'Quota atteint : nouvel essai possible à 14 h 05.'), { mode: 'web' });
    expect(view).toMatchObject({ badge: 'Quota IA atteint', detail: 'Quota atteint : nouvel essai possible à 14 h 05.' });
    expect(view.advice).toContain('quota');
  });

  it('panne passagère : « réessayez dans quelques instants »', () => {
    expect(serverAIView(notReady('AI_BUSY'), { mode: 'web' }).advice).toContain('quelques instants');
  });

  it('état non vérifié (AI_STATUS_UNKNOWN) : ni prêt ni en panne, la génération reste possible', () => {
    const view = serverAIView({ ...BASE, aiWarning: { code: 'AI_STATUS_UNKNOWN', message: 'x' } }, { mode: 'web' });
    expect(view).toMatchObject({ state: 'unverified', detail: STATUS_UNKNOWN_TEXT });
    expect(STATUS_UNKNOWN_TEXT).toContain('la génération reste possible');
  });

  it('autre avertissement : IA prête, avertissement affiché', () => {
    const view = serverAIView({ ...BASE, aiWarning: { code: 'MODEL_NOT_INSTALLED', message: 'Modèle absent de la liste (alias possible).' } }, { mode: 'web' });
    expect(view).toMatchObject({ state: 'ready', warning: 'Modèle absent de la liste (alias possible).' });
  });

  it('vérification en cours, puis échec de la vérification elle-même', () => {
    expect(serverAIView(null, { mode: 'web', loading: true }).state).toBe('checking');
    expect(serverAIView(null, { mode: 'web', checkError: 'Réseau indisponible.' })).toMatchObject({ state: 'not_ready', detail: 'Réseau indisponible.' });
  });
});

describe('serverPrivacyMessage', () => {
  it('prestataire tiers : envoi annoncé, avec pays, conservation et entraînement', () => {
    const msg = serverPrivacyMessage('x', {
      label: 'Mistral AI (La Plateforme)', thirdParty: true, country: 'Union européenne (Mistral AI, France)',
      retention: 'Selon les conditions de Mistral AI', training: 'Les demandes peuvent servir à entraîner les modèles',
    });
    expect(msg).toBe(
      'Les demandes et les extraits de vos documents sont envoyés à « Mistral AI (La Plateforme) » (Union européenne, Mistral AI, France) '
      + 'pour la génération. Selon les conditions de Mistral AI. Les demandes peuvent servir à entraîner les modèles. '
      + 'Vos fichiers originaux ne quittent pas votre navigateur.',
    );
  });

  it('lieu décrit par un nom commun : minuscule ; nom propre : majuscule conservée', () => {
    expect(serverPrivacyMessage('x', { label: 'Serveur du lycée', thirdParty: false, country: 'Réseau local (établissement)' }))
      .toContain('« Serveur du lycée » (réseau local, établissement) pour la génération.');
    expect(serverPrivacyMessage('x', { label: 'Groq', thirdParty: true, country: 'États-Unis' }))
      .toContain('envoyés à « Groq » (États-Unis) pour la génération.');
  });

  it('pays inconnu : dit tel quel', () => {
    expect(serverPrivacyMessage('x', { label: 'Service inconnu', thirdParty: true, country: 'Inconnu' }))
      .toContain("(pays d'hébergement non précisé)");
  });

  it('IA locale du serveur : pas de tiers', () => {
    const msg = serverPrivacyMessage('x', {
      label: 'IA locale du serveur Magistra', thirdParty: false, country: 'Même machine que le serveur Magistra',
      retention: "Aucune transmission à un service d'IA en ligne",
    });
    expect(msg).toContain('transmis au serveur Magistra puis à « IA locale du serveur Magistra » (même machine que le serveur Magistra)');
    expect(msg).toContain("Aucune transmission à un service d'IA en ligne.");
    expect(msg).not.toContain('envoyés à');
  });

  it('ancien serveur sans fiche : message historique', () => {
    expect(serverPrivacyMessage('Serveur du lycée', undefined)).toContain("serveur d'IA configuré par l'administrateur (Serveur du lycée)");
  });
});

describe('liens', () => {
  it('politique du prestataire : https uniquement', () => {
    expect(providerPolicyUrl({ label: 'x', thirdParty: true, privacyUrl: 'https://exemple.fr/conditions' })).toBe('https://exemple.fr/conditions');
    expect(providerPolicyUrl({ label: 'x', thirdParty: true, privacyUrl: 'javascript:alert(1)' })).toBeNull();
    expect(providerPolicyUrl({ label: 'x', thirdParty: true, privacyUrl: 'http://exemple.fr' })).toBeNull();
    expect(providerPolicyUrl(undefined)).toBeNull();
  });

  it('contact de l’administrateur : courriel, lien https ou simple texte', () => {
    expect(adminContactLink('dsi@lycee.fr')).toEqual({ text: 'dsi@lycee.fr', href: 'mailto:dsi@lycee.fr' });
    expect(adminContactLink('https://aide.lycee.fr')).toEqual({ text: 'https://aide.lycee.fr', href: 'https://aide.lycee.fr/' });
    expect(adminContactLink('M. Dupont, salle 12')).toEqual({ text: 'M. Dupont, salle 12', href: null });
    expect(adminContactLink('javascript:alert(1)')).toEqual({ text: 'javascript:alert(1)', href: null });
    expect(adminContactLink('  ')).toBeNull();
  });
});
