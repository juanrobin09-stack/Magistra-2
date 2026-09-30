// @vitest-environment jsdom
// Site web et mode personnel : la VRAIE cause quand l'IA n'est pas prête (réglages, pastille, page Générer),
// le prestataire tiers annoncé clairement, et, en démonstration, la carte « Passez à la vraie IA » : une seule voie
// (Magistra pour Windows), sans rien de technique à l'écran.

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
import { resetWindowsReleaseCache, SITE_DOWNLOAD_PATH } from '@/components/localEngine/windowsRelease';
import { README_AI_SECTION_URL, WINDOWS_DOWNLOAD_URL } from '@/lib/links';
import DashboardPage from '@/pages/DashboardPage';
import GeneratePage from '@/pages/GeneratePage';
import SettingsPage from '@/pages/SettingsPage';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import { RELEASE, stubReleaseFetch } from './localEngineHelpers';

afterEach(() => {
  cleanup();
  setRuntimeConfig(null);
  vi.unstubAllGlobals();
  resetWindowsReleaseCache();
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

  it('démonstration : carte « Passez à la vraie IA »', async () => {
    const { container } = await mount(<SettingsPage />, 'demo', READY);
    expect(container.querySelector('[data-testid="connect-real-ai"]')?.textContent).toContain('Passez à la vraie IA');
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

  it('démonstration : carte « Passez à la vraie IA », visible d’emblée (rien à déplier), bouton de téléchargement', async () => {
    const { container } = await mount(<GeneratePage />, 'demo', { ...READY, privacy: { level: 'demo', message: 'Démo.' } });
    const card = container.querySelector<HTMLElement>('[data-testid="connect-real-ai"]');
    expect(card).not.toBeNull();
    expect(card!.closest('details')).toBeNull();
    expect(card!.textContent).toContain('Passez à la vraie IA : installez Magistra sur votre ordinateur Windows.');
    expect(Array.from(card!.querySelectorAll('a')).some(a => a.textContent?.includes('Télécharger Magistra pour Windows'))).toBe(true);
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

describe('Carte « Passez à la vraie IA » (démonstration)', () => {
  const cardOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="connect-real-ai"]')!;
  const downloadOf = (card: HTMLElement) =>
    Array.from(card.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;

  it('une seule voie, en langage simple : Magistra pour Windows, rien de technique à l’écran', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = cardOf(container);
    const text = card.textContent ?? '';
    expect(text).toContain('Passez à la vraie IA : installez Magistra sur votre ordinateur Windows.');
    expect(text).toContain('L’IA y fonctionne gratuitement, en privé, même sans Internet.');
    // Ni commande, ni moteur, ni variable, ni service d'hébergement : c'est le mode d'emploi de l'administrateur.
    expect(text).not.toMatch(/npm|ollama|clerk|supabase|AI_PRESET|OVHcloud|variable|localhost|127\.0\.0\.1|powershell/i);
    expect(text).not.toMatch(/clé API/i);
    expect(text).not.toContain('trois solutions');
    // Une seule action principale, aucun formulaire.
    expect(card.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(card.querySelector('form, input, textarea, select, details')).toBeNull();
  });

  it('téléchargement direct de la dernière version stable (/api/windows-release), trois étapes avec SmartScreen', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = cardOf(container);
    // Le site public en démonstration garde son API : une seule requête, partagée avec la section « Magistra pour Windows ».
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/windows-release');
    const download = downloadOf(card);
    expect(download.getAttribute('href')).toBe(SITE_DOWNLOAD_PATH);
    expect(download.target).toBe('');
    expect(download.className).toContain('btn-primary');
    const steps = Array.from(card.querySelectorAll('ol[aria-label="Installation en trois étapes"] li')).map(li => li.textContent?.trim());
    expect(steps).toEqual([
      '1Téléchargez Magistra.',
      '2Ouvrez le fichier téléchargé. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis « Exécuter quand même ».',
      '3Magistra s’installe en quelques secondes, sans droits d’administrateur, et s’ouvre toute seule.',
    ]);
    // Honnête : l'IA n'est pas dans l'installateur ; son téléchargement est annoncé avant, dans l'application.
    expect(card.textContent).toContain('Ensuite, Magistra vous propose d’activer l’IA : un seul téléchargement de plusieurs Go, dont la taille est annoncée avant.');
  });

  it('un clic télécharge l’installateur : sa taille, sa version et la configuration requise sont annoncées à côté du bouton', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = cardOf(container);
    const facts = card.querySelector<HTMLElement>('[data-testid="windows-installer-facts"]')!;
    expect(facts.textContent?.replace(/\u00a0/g, ' ')).toBe('Installateur : 85,3 Mo · version 2.3.1 · Windows 10 ou 11 (64 bits)');
    expect(downloadOf(card).getAttribute('aria-describedby')).toBe(facts.id);
  });

  it('version inconnue (hébergement sans API, erreur réseau) : téléchargement direct de la dernière version (fichier, même onglet)', async () => {
    stubReleaseFetch(new TypeError('Failed to fetch'));
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    // Taille inconnue : la configuration requise seule, jamais une taille inventée.
    expect(cardOf(container).querySelector('[data-testid="windows-installer-facts"]')?.textContent).toBe('Windows 10 ou 11 (64 bits)');
    const download = downloadOf(cardOf(container));
    expect(download.getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    expect(WINDOWS_DOWNLOAD_URL).toBe('https://github.com/juanrobin09-stack/magistra-2/releases/latest/download/Magistra-Setup.exe');
    expect(download.target).toBe('');
    expect(download.rel).toContain('noopener');
  });

  it('aucune version publiée : le bouton est inactif et le dit, aucun renvoi vers GitHub (la carte reste utile : « Ouvrir Magistra »)', async () => {
    stubReleaseFetch({ available: false, reason: 'none', releasesUrl: 'https://github.com/juanrobin09-stack/magistra-2/releases' });
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = cardOf(container);
    const inactive = card.querySelector<HTMLElement>('[data-testid="windows-download-unavailable"]')!;
    expect(inactive.textContent).toContain('Télécharger Magistra pour Windows');
    expect(inactive.getAttribute('aria-disabled')).toBe('true');
    expect(card.querySelector('[data-testid="windows-installer-facts"]')?.textContent)
      .toBe('Pas encore disponible : la première version de Magistra pour Windows n’est pas encore publiée. Le téléchargement s’activera ici dès sa publication.');
    expect(card.querySelector('[data-testid="open-installed-app"] a')?.getAttribute('href')).toBe('magistra://open');
    // Seul le mode d'emploi administrateur (README) peut mener à GitHub ; jamais pour télécharger.
    const githubLinks = Array.from(card.querySelectorAll('a')).filter(a => a.href.startsWith('https://github.com'));
    expect(githubLinks.every(a => !/releases/.test(a.href))).toBe(true);
  });

  it('« Déjà installée ? Ouvrir Magistra » (magistra://open) ; une ligne discrète pour l’administrateur du site', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mount(<DashboardPage />, 'demo', READY);
    const card = cardOf(container);
    const open = card.querySelector<HTMLElement>('[data-testid="open-installed-app"]')!;
    expect(open.textContent).toContain('Déjà installée ?');
    const openLink = open.querySelector<HTMLAnchorElement>('a')!;
    expect(openLink.textContent?.trim()).toBe('Ouvrir Magistra');
    expect(openLink.getAttribute('href')).toBe('magistra://open');
    expect(openLink.target).toBe('');
    const admin = Array.from(card.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Mode d’emploi'))!;
    expect(admin.getAttribute('href')).toBe(README_AI_SECTION_URL);
    expect(admin.closest('p')?.textContent).toContain('Vous administrez le site de l’établissement ?');
    for (const a of Array.from(card.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'))) expect(a.rel).toContain('noopener');
  });

  it('absente hors démonstration', async () => {
    const { container } = await mount(<DashboardPage />, 'web', READY);
    expect(container.querySelector('[data-testid="connect-real-ai"]')).toBeNull();
  });
});
