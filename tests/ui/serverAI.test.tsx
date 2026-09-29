// @vitest-environment jsdom
// Site web et mode personnel : la VRAIE cause quand l'IA n'est pas prête (réglages, pastille, page Générer),
// le prestataire tiers annoncé clairement, et la carte « Brancher une vraie IA » en démonstration.

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { defaultMessage, type ErrorCode } from '@shared/errors';
import type { Capabilities } from '@shared/types';
import AIStatusBadge from '@/components/ai/AIStatusBadge';
import { RuntimeContext } from '@/lib/runtime/context';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import { PersonalAccessContext, type PersonalAccess } from '@/lib/runtime/personal';
import type { GenerationClient, RuntimeMode } from '@/lib/runtime/types';
import { WINDOWS_DOWNLOAD_URL } from '@/lib/links';
import DashboardPage from '@/pages/DashboardPage';
import GeneratePage from '@/pages/GeneratePage';
import SettingsPage from '@/pages/SettingsPage';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

afterEach(() => {
  cleanup();
  setRuntimeConfig(null);
});

const READY: Capabilities = {
  maxDocumentChars: 30_000,
  research: { academic: false, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'server', message: 'Transmis au serveur Magistra.' },
  engineLabel: 'OVHcloud AI Endpoints',
  ready: true,
};

const OVH_PRIVACY =
  'Les demandes et les extraits de vos documents sont envoyés à « OVHcloud AI Endpoints » (France, centre de données de Gravelines) pour la génération. '
  + 'Aucune conservation des données (annoncé par OVHcloud). Aucune utilisation des textes pour l’entraînement (annoncé par OVHcloud).';

const THIRD_PARTY: Capabilities = {
  ...READY,
  privacy: { level: 'server', message: OVH_PRIVACY },
  providerInfo: {
    label: 'OVHcloud AI Endpoints', thirdParty: true, country: 'France (centre de données de Gravelines)',
    privacyUrl: 'https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities',
  },
};

function notReady(code: ErrorCode, message: string): Capabilities {
  return { ...READY, ready: false, notReady: { code, message } };
}

function client(caps: Capabilities, kind: RuntimeMode = 'web'): GenerationClient {
  return { kind, capabilities: vi.fn(async () => caps), generate: vi.fn(async () => undefined) };
}

async function mount(ui: React.ReactNode, mode: RuntimeMode, caps: Capabilities, access?: PersonalAccess) {
  const store = new MemoryStore([], PROFILE_COLLEGE);
  const runtime = fakeRuntime(store, { mode, client: client(caps, mode), profile: PROFILE_COLLEGE });
  const tree = (
    <RuntimeContext.Provider value={runtime}>
      <MemoryRouter>{ui}</MemoryRouter>
    </RuntimeContext.Provider>
  );
  const view = await render(access ? <PersonalAccessContext.Provider value={access}>{tree}</PersonalAccessContext.Provider> : tree);
  await flush(6);
  return view;
}

describe('Réglages — IA du serveur', () => {
  it('aucune IA branchée (mode personnel) : texte dédié et code, jamais « momentanément impossible »', async () => {
    const { container } = await mount(<SettingsPage />, 'personal', notReady('AI_NOT_CONFIGURED', defaultMessage('AI_NOT_CONFIGURED')));
    const section = container.querySelector('section[aria-labelledby="settings-ai"]')!;
    expect(section.textContent).toContain("Aucune intelligence artificielle n'est branchée");
    expect(section.textContent).toContain('ollama pull ministral-3:8b');
    expect(section.textContent).toContain('AI_NOT_CONFIGURED');
    expect(section.textContent).not.toContain('momentanément impossible');
  });

  it('aucune IA branchée pour une cause précise (préréglage sans clé) : la cause du serveur, jamais « Installez Ollama »', async () => {
    const cause = "Le service d'IA « Scaleway Generative APIs » exige une clé d'accès : l'administrateur doit renseigner AI_API_KEY.";
    const { container } = await mount(<SettingsPage />, 'personal', notReady('AI_NOT_CONFIGURED', cause));
    const section = container.querySelector('section[aria-labelledby="settings-ai"]')!;
    expect(section.textContent).toContain(cause);
    expect(section.textContent).not.toContain('Installez Ollama');
    expect(section.textContent).toContain('npm run ai:check -- --dev');
  });

  it('clé refusée : message précis du serveur (et non « indisponible, réessayez »)', async () => {
    const { container } = await mount(<SettingsPage />, 'personal', notReady('AI_AUTH_FAILED', "Le service d'IA a refusé la clé : vérifiez AI_API_KEY."));
    const section = container.querySelector('section[aria-labelledby="settings-ai"]')!;
    expect(section.textContent).toContain("Le service d'IA refuse l'accès");
    expect(section.textContent).toContain("Le service d'IA a refusé la clé : vérifiez AI_API_KEY.");
    expect(section.textContent).toContain('AI_AUTH_FAILED');
  });

  it('prestataire tiers : envoi annoncé dans « Confidentialité », avec le lien de ses engagements', async () => {
    const { container } = await mount(<SettingsPage />, 'personal', THIRD_PARTY);
    const privacy = container.querySelector('section[aria-labelledby="settings-privacy"]')!;
    expect(privacy.textContent).toContain('envoyés à « OVHcloud AI Endpoints » (France, centre de données de Gravelines)');
    expect(privacy.textContent).not.toMatch(/restent (chez vous|sur cet ordinateur)/);
    const link = privacy.querySelector<HTMLAnchorElement>('a[href^="https://docs.ovhcloud.com"]');
    expect(link?.rel).toContain('noopener');
  });

  it('mode personnel : pas de compte Clerk ; « Oublier le code d’accès »', async () => {
    const access: PersonalAccess = { hasCode: true, submit: vi.fn(() => 'changed' as const), forget: vi.fn() };
    const { container } = await mount(<SettingsPage />, 'personal', READY, access);
    const account = container.querySelector('section[aria-labelledby="settings-account"]')!;
    expect(account.textContent).toContain('aucun compte');
    expect(account.textContent).not.toContain('Gérer mon compte');
    await click(button(account, /Oublier le code d'accès/));
    expect(access.forget).toHaveBeenCalledOnce();
  });

  it('démonstration : carte « Brancher une vraie IA »', async () => {
    const { container } = await mount(<SettingsPage />, 'demo', READY);
    expect(container.querySelector('[data-testid="connect-real-ai"]')).not.toBeNull();
  });
});

describe('Pastille d’état (barre latérale)', () => {
  it('cause précise, avec le code dans l’info-bulle', async () => {
    const { container } = await mount(<AIStatusBadge />, 'web', notReady('AI_QUOTA_EXCEEDED', 'Quota atteint : reprise à 14 h 05.'));
    const link = container.querySelector('a')!;
    expect(link.textContent).toContain('Quota IA atteint');
    expect(link.title).toContain('Quota atteint : reprise à 14 h 05.');
    expect(link.title).toContain('AI_QUOTA_EXCEEDED');
  });

  it('aucune IA branchée', async () => {
    const { container } = await mount(<AIStatusBadge />, 'personal', notReady('AI_NOT_CONFIGURED', 'x'));
    expect(container.textContent).toContain('Aucune IA branchée');
  });

  it('état non vérifié : ni « disponible » ni « indisponible »', async () => {
    const caps = { ...READY, aiWarning: { code: 'AI_STATUS_UNKNOWN' as const, message: 'x' } };
    const { container } = await mount(<AIStatusBadge />, 'web', caps);
    expect(container.textContent).toContain("État de l'IA non vérifié");
    expect(container.textContent).not.toMatch(/indisponible|disponible/);
  });
});

describe('Page Générer', () => {
  it('état non vérifié (AI_STATUS_UNKNOWN) : avertissement seulement, bouton Générer actif', async () => {
    const caps = { ...READY, aiWarning: { code: 'AI_STATUS_UNKNOWN' as const, message: 'x' } };
    const { container } = await mount(<GeneratePage />, 'web', caps);
    expect(container.textContent).toContain('État du serveur d\'IA non vérifié : la génération reste possible.');
    const submit = button(container, /Générer : /);
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(false);
    expect(container.querySelector('#gen-ai-title')).toBeNull();
  });

  it('IA non prête : vraie cause et code', async () => {
    const { container } = await mount(<GeneratePage />, 'web', notReady('MODEL_NOT_INSTALLED', 'Le modèle « x » n’est pas disponible sur le serveur d’IA.'));
    expect(container.querySelector('#gen-ai-title')?.textContent).toBe("Modèle d'IA introuvable");
    expect(container.textContent).toContain('Le modèle « x » n’est pas disponible sur le serveur d’IA.');
    expect(container.textContent).toContain('MODEL_NOT_INSTALLED');
  });

  it('prestataire tiers : annoncé à côté du bouton Générer', async () => {
    const { container } = await mount(<GeneratePage />, 'web', THIRD_PARTY);
    const note = container.querySelector('[aria-label="Confidentialité"]')!;
    expect(note.textContent).toContain('envoyés à « OVHcloud AI Endpoints »');
    expect(note.textContent).not.toContain('restent sur cet ordinateur');
    expect(note.querySelector('a[href^="https://docs.ovhcloud.com"]')).not.toBeNull();
    // Section « Sources » : les passages transmis ont un destinataire nommé.
    expect(container.textContent).toContain('seuls les passages utiles sont transmis à « OVHcloud AI Endpoints » au moment de générer');
  });

  it('IA sans prestataire tiers : aucun destinataire extérieur nommé dans « Sources »', async () => {
    const { container } = await mount(<GeneratePage />, 'web', READY);
    expect(container.textContent).toContain('seuls les passages utiles sont transmis au moment de générer');
  });

  it('démonstration : carte « Brancher une vraie IA » (discrète, repliée)', async () => {
    const { container } = await mount(<GeneratePage />, 'demo', { ...READY, privacy: { level: 'demo', message: 'Démo.' } });
    const card = container.querySelector<HTMLDetailsElement>('[data-testid="connect-real-ai"]');
    expect(card).not.toBeNull();
    expect(card!.open).toBe(false);
  });
});

describe('Page Générer : destinataire des textes annoncé même sans réponse de /api/status', () => {
  /** Page montée avec un client dont la vérification (/api/status) reste en attente ou échoue. */
  async function mountPending(capabilities: () => Promise<Capabilities>, mode: RuntimeMode = 'web') {
    const store = new MemoryStore([], PROFILE_COLLEGE);
    const generate = vi.fn(async () => undefined);
    const runtime = fakeRuntime(store, { mode, client: { kind: mode, capabilities: vi.fn(capabilities), generate }, profile: PROFILE_COLLEGE });
    const view = await render(
      <RuntimeContext.Provider value={runtime}>
        <MemoryRouter initialEntries={['/app/generate?type=cours&sujet=La%20photosynth%C3%A8se']}><GeneratePage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(6);
    return { ...view, generate };
  }
  const never = () => new Promise<Capabilities>(() => undefined);
  const networkError = async (): Promise<Capabilities> => {
    throw new TypeError('Failed to fetch');
  };
  const OVH_INFO = THIRD_PARTY.providerInfo!;

  it('vérification en cours, prestataire inconnu : bouton « Vérification du service d’IA… » désactivé, annonce prudente', async () => {
    const { container, generate } = await mountPending(never);
    const submit = button(container, /Vérification du service d'IA/);
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(true);
    const note = container.querySelector('[aria-label="Confidentialité"]')!;
    expect(note.textContent).toContain("n'a pas encore pu être vérifié");
    expect(note.textContent).toContain('service en ligne extérieur');
    expect(note.textContent).not.toContain('restent sur cet ordinateur');
    expect(container.textContent).toContain("transmis au service d'IA configuré par l'administrateur au moment de générer");
    // La touche Entrée ne contourne pas l'attente.
    const form = container.querySelector('form[aria-label="Demande de génération"]')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(generate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Vérification du service d'IA en cours");
  });

  it('vérification en échec, prestataire inconnu : annonce prudente, génération possible, carte qui renvoie à l’encadré', async () => {
    const { container } = await mountPending(networkError);
    const note = container.querySelector('[aria-label="Confidentialité"]')!;
    expect(note.textContent).toContain('service en ligne extérieur');
    expect(container.textContent).toContain("comme indiqué dans l'encadré « Confidentialité »");
    const submit = button(container, /Générer : /);
    expect(submit!.disabled).toBe(false);
  });

  it('vérification en attente ou en échec, prestataire annoncé par /api/mode : OVHcloud nommé, génération possible', async () => {
    for (const caps of [never, networkError]) {
      setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: OVH_INFO });
      const { container, generate } = await mountPending(caps);
      const note = container.querySelector('[aria-label="Confidentialité"]')!;
      expect(note.textContent).toContain('envoyés à « OVHcloud AI Endpoints »');
      expect(note.querySelector('a[href^="https://docs.ovhcloud.com"]')).not.toBeNull();
      expect(container.textContent).toContain('seuls les passages utiles sont transmis à « OVHcloud AI Endpoints » au moment de générer');
      const submit = button(container, /Générer : /);
      expect(submit!.disabled).toBe(false);
      await click(submit);
      expect(generate).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('mode personnel, vérification en cours : annonce adaptée (votre serveur Magistra), jamais « restent sur cet ordinateur »', async () => {
    const { container } = await mountPending(never, 'personal');
    const note = container.querySelector('[aria-label="Confidentialité"]')!;
    expect(note.textContent).toContain('votre serveur Magistra');
    expect(note.textContent).toContain('service en ligne');
    expect(note.textContent).not.toContain('restent sur cet ordinateur');
    expect(button(container, /Vérification du service d'IA/)!.disabled).toBe(true);
  });

  it('application Windows et démonstration : jamais bloquées par cette attente', async () => {
    const { container } = await mountPending(never, 'demo');
    expect(button(container, /Générer : /)!.disabled).toBe(false);
  });
});

describe('Carte « Brancher une vraie IA »', () => {
  it('tableau de bord en démonstration : trois chemins en langage simple, liens utiles, aucun formulaire', async () => {
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = container.querySelector('[data-testid="connect-real-ai"]')!;
    const text = card.textContent ?? '';
    expect(text).toContain('Brancher une vraie IA');
    expect(text).toContain('L’application Windows');
    expect(text).toContain('npm run dev');
    expect(text).toContain('Ollama');
    expect(text).toContain('AI_PRESET=ovhcloud');
    expect(text).toContain('OVHcloud, en France');
    // Sur le site en ligne, l'IA seule ne suffit pas : sans comptes (Clerk), il reste en démonstration (server/personal.ts,
    // resolveAuth) ; sans base de données (Supabase), les routes de données répondent SERVER_MISCONFIGURED (server/handlers.ts).
    expect(text).toContain('comptes enseignants (Clerk), sans lesquels il reste en démonstration');
    expect(text).toContain('(Supabase), sans laquelle il affiche une erreur de configuration');
    expect(card.querySelector(`a[href="${WINDOWS_DOWNLOAD_URL}"]`)).not.toBeNull();
    expect(WINDOWS_DOWNLOAD_URL).toBe('https://github.com/juanrobin09-stack/magistra-2/releases/latest');
    expect(card.querySelector('a[href^="https://github.com/juanrobin09-stack/magistra-2#"]')).not.toBeNull();
    for (const a of Array.from(card.querySelectorAll('a'))) expect(a.getAttribute('rel')).toContain('noopener');
    expect(card.querySelector('form, input, textarea, select')).toBeNull();
    expect(text).not.toMatch(/clé API/i);
  });

  it('absente hors démonstration', async () => {
    const { container } = await mount(<DashboardPage />, 'web', READY);
    expect(container.querySelector('[data-testid="connect-real-ai"]')).toBeNull();
  });
});
