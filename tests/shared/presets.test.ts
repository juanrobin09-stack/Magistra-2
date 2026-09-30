import { describe, expect, it } from 'vitest';
import {
  addressKind, DEFAULT_WEB_PRESET, describeAIEndpoint, getPreset, hostAddressKind, PROVIDER_PRESETS, providerInfoFor,
} from '../../shared/ai/presets';

describe('préréglages de fournisseurs d’IA (site web)', () => {
  it('cinq préréglages, dont la solution gratuite sans clé par défaut (OVHcloud, France)', () => {
    expect(PROVIDER_PRESETS.map(p => p.id)).toEqual(['ovhcloud', 'mistral', 'albert', 'scaleway', 'ollama']);
    const ovh = getPreset(DEFAULT_WEB_PRESET)!;
    expect(ovh).toMatchObject({
      id: 'ovhcloud',
      label: 'OVHcloud AI Endpoints',
      baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
      model: 'Mistral-Small-3.2-24B-Instruct-2506',
      fallbackModels: ['Mistral-Nemo-Instruct-2407'],
      apiKey: 'optional',
      contextTokens: 32_768,
      maxOutputTokens: 4_000,
      provider: 'openai-compatible',
    });
    expect(ovh.privacy).toMatchObject({ thirdParty: true });
    expect(ovh.privacy.country).toMatch(/France/);
    expect(ovh.privacy.retention).toMatch(/Aucune conservation/);
    expect(ovh.notes).toMatch(/2 requêtes par minute/);
  });

  it('Mistral : clé requise, entraînement possible sur l’offre gratuite (dit clairement)', () => {
    const mistral = getPreset('mistral')!;
    expect(mistral).toMatchObject({ baseUrl: 'https://api.mistral.ai/v1', model: 'ministral-14b-2512', apiKey: 'required', provider: 'openai-compatible' });
    expect(mistral.privacy.training).toMatch(/peuvent servir à entraîner/);
    expect(mistral.privacy.training).toMatch(/Admin Console/);
  });

  it('Albert, Scaleway, Ollama', () => {
    expect(getPreset('albert')).toMatchObject({ baseUrl: 'https://albert.api.etalab.gouv.fr/v1', model: 'openweight-medium', apiKey: 'required' });
    expect(getPreset('albert')!.notes).toMatch(/agents de la fonction publique d'État/);
    expect(getPreset('albert')!.privacy.country).toMatch(/SecNumCloud/);
    expect(getPreset('scaleway')).toMatchObject({ baseUrl: 'https://api.scaleway.ai/v1', model: 'mistral-small-3.2-24b-instruct-2506', apiKey: 'required' });
    expect(getPreset('scaleway')!.notes).toMatch(/1 000 000 de tokens/);
    expect(getPreset('ollama')).toMatchObject({ baseUrl: 'http://127.0.0.1:11434', provider: 'ollama' });
    expect(getPreset('ollama')!.privacy.thirdParty).toBe(false);
  });

  it('champs complets et cohérents pour chaque préréglage', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.label.length, p.id).toBeGreaterThan(3);
      expect(() => new URL(p.baseUrl), p.id).not.toThrow();
      expect(p.provider === 'ollama' ? !p.baseUrl.endsWith('/v1') : p.baseUrl.endsWith('/v1'), p.id).toBe(true);
      expect(['none', 'optional', 'required']).toContain(p.apiKey);
      expect(p.maxOutputTokens).toBeLessThan(p.contextTokens);
      expect(p.privacy.country && p.privacy.retention && p.privacy.training, p.id).toBeTruthy();
      if (p.privacy.url) expect(p.privacy.url.startsWith('https://'), p.id).toBe(true);
    }
  });

  it('getPreset : casse ignorée, alias, inconnu', () => {
    expect(getPreset('OVH')?.id).toBe('ovhcloud');
    expect(getPreset(' Mistral ')?.id).toBe('mistral');
    expect(getPreset('inconnu')).toBeUndefined();
    expect(getPreset(undefined)).toBeUndefined();
  });
});

describe('nature de l’adresse du serveur d’IA', () => {
  it('boucle locale, réseau privé, public', () => {
    for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'app.localhost']) expect(hostAddressKind(h), h).toBe('loopback');
    for (const h of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.20', '169.254.1.1', '100.64.0.1', 'fd12:3456::1', 'fe80::1', 'ollama', 'pc-prof.local', 'ia.lycee.lan', 'gpu.internal']) {
      expect(hostAddressKind(h), h).toBe('private');
    }
    for (const h of ['172.32.0.1', '8.8.8.8', 'api.mistral.ai', '2001:db8::1']) expect(hostAddressKind(h), h).toBe('public');
    expect(addressKind('http://192.168.1.20:11434')).toBe('private');
    expect(addressKind('pas une url')).toBeNull();
  });
});

describe('prestataire déduit de AI_BASE_URL (transparence)', () => {
  it('hôte d’un préréglage (y compris un point d’accès OVH propre à un modèle)', () => {
    expect(describeAIEndpoint('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1')).toMatchObject({ kind: 'preset', presetId: 'ovhcloud', label: 'OVHcloud AI Endpoints' });
    expect(describeAIEndpoint('https://mistral-small-3-2-24b-instruct-2506.endpoints.kepler.ai.cloud.ovh.net/api/openai_compat/v1').presetId).toBe('ovhcloud');
    expect(describeAIEndpoint('https://api.mistral.ai/v1').presetId).toBe('mistral');
    expect(describeAIEndpoint('https://albert.api.etalab.gouv.fr/v1').presetId).toBe('albert');
    expect(describeAIEndpoint('https://api.scaleway.ai/v1').presetId).toBe('scaleway');
  });

  it('prestataire connu sans préréglage, tiers non identifié, IA locale ou du réseau local', () => {
    expect(describeAIEndpoint('https://router.huggingface.co/v1')).toMatchObject({ kind: 'known', label: 'Hugging Face Inference Providers', privacy: { thirdParty: true } });
    expect(describeAIEndpoint('https://api.groq.com/openai/v1').privacy.country).toBe('États-Unis');
    const unknown = describeAIEndpoint('https://ia.exemple.com/secret-path/v1?token=abc');
    expect(unknown).toMatchObject({ kind: 'unknown', label: "Service d'IA en ligne non identifié (ia.exemple.com)", privacy: { thirdParty: true } });
    expect(JSON.stringify(unknown)).not.toMatch(/secret-path|token=abc/);
    expect(describeAIEndpoint('http://127.0.0.1:11434')).toMatchObject({ kind: 'loopback', privacy: { thirdParty: false } });
    expect(describeAIEndpoint('http://192.168.1.20:8000/v1')).toMatchObject({ kind: 'private', privacy: { thirdParty: false } });
  });

  it('providerInfoFor : jamais d’URL ni de clé ; le libellé de l’administrateur ne masque pas le prestataire', () => {
    const info = providerInfoFor('https://api.mistral.ai/v1', "IA de l'académie");
    expect(info).toMatchObject({ label: "IA de l'académie (Mistral AI (La Plateforme))", thirdParty: true });
    expect(info.privacyUrl).toMatch(/^https:\/\/help\.mistral\.ai\//);
    expect(providerInfoFor('https://api.mistral.ai/v1', 'Mistral AI').label).toBe('Mistral AI');
    expect(providerInfoFor('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1')).toMatchObject({ label: 'OVHcloud AI Endpoints', thirdParty: true });
    expect(providerInfoFor('http://127.0.0.1:11434', 'Ollama du lycée')).toMatchObject({ label: 'Ollama du lycée', thirdParty: false });
    const secretUrl = 'https://user:motdepasse@ia.exemple.com/v1/cle-sk-123';
    const serialized = JSON.stringify(providerInfoFor(secretUrl));
    expect(serialized).not.toMatch(/motdepasse|cle-sk-123|https:\/\/ia\.exemple\.com/);
  });
});
