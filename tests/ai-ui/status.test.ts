import { describe, expect, it } from 'vitest';
import {
  aiPhase, fitBadge, initialTierChoice, phaseInfo, phaseLine, pullStatusText, setupChecks, tierActionLabel, tierLabelFor, toneBadgeClass,
} from '@/lib/ai-ui/status';
import { makeStatus } from './fixtures';

describe('fitBadge', () => {
  it('traduit l’adéquation en libellé simple', () => {
    expect(fitBadge('recommended')).toEqual({ label: 'Recommandé', tone: 'success' });
    expect(fitBadge('ok')).toEqual({ label: 'Adapté', tone: 'accent' });
    expect(fitBadge('slow')).toEqual({ label: 'Lent sur cet ordinateur', tone: 'warning' });
    expect(fitBadge('not_recommended')).toEqual({ label: 'Déconseillé', tone: 'danger' });
  });

  it('utilise les classes de badge de Magistra', () => {
    expect(toneBadgeClass('success')).toBe('badge badge-success');
    expect(toneBadgeClass('accent')).toBe('badge badge-accent');
    expect(toneBadgeClass('warning')).toContain('text-warning');
    expect(toneBadgeClass('danger')).toContain('text-danger');
  });
});

describe('aiPhase / phaseLine (headline)', () => {
  it('moteur non installé', () => {
    const s = makeStatus({ engine: 'not_installed' });
    expect(aiPhase(s)).toBe('engine_missing');
    expect(phaseLine(aiPhase(s))).toBe('○ Non installée');
    expect(phaseInfo('engine_missing').badge).toBe('IA non installée');
  });

  it('moteur installé mais arrêté (ou état inconnu)', () => {
    expect(aiPhase(makeStatus({ engine: 'installed_stopped' }))).toBe('engine_stopped');
    expect(aiPhase(makeStatus({ engine: 'unknown' }))).toBe('engine_stopped');
    expect(phaseLine('engine_stopped')).toBe('○ Moteur arrêté');
  });

  it('moteur en marche sans le modèle choisi', () => {
    const s = makeStatus({ engine: 'running', installed: [] });
    expect(aiPhase(s)).toBe('model_missing');
    expect(phaseLine('model_missing')).toBe('○ Modèle non installé');
  });

  it('IA prête', () => {
    const s = makeStatus({ engine: 'running', installed: ['standard'] });
    expect(s.ready).toBe(true);
    expect(aiPhase(s)).toBe('ready');
    expect(phaseLine('ready')).toBe('● Prête');
    expect(phaseInfo('ready')).toMatchObject({ ok: true, badge: 'IA prête' });
  });

  it('serveur distant', () => {
    expect(aiPhase(makeStatus({ mode: 'remote', ready: false }))).toBe('remote_unavailable');
    expect(aiPhase(makeStatus({ mode: 'remote', ready: true }))).toBe('ready');
    expect(phaseInfo('remote_unavailable').badge).toBe('Serveur IA indisponible');
  });
});

describe('setupChecks', () => {
  const states = (s: ReturnType<typeof makeStatus>) => setupChecks(s).map(c => c.state);

  it('rien d’installé : seule la première vérification échoue, les autres attendent', () => {
    expect(states(makeStatus({ engine: 'not_installed' }))).toEqual(['missing', 'waiting', 'waiting', 'waiting']);
  });

  it('moteur installé mais arrêté', () => {
    expect(states(makeStatus({ engine: 'installed_stopped' }))).toEqual(['ok', 'missing', 'waiting', 'waiting']);
  });

  it('moteur en marche, aucun modèle', () => {
    const checks = setupChecks(makeStatus({ engine: 'running', installed: [] }));
    expect(checks.map(c => c.state)).toEqual(['ok', 'ok', 'missing', 'missing']);
    expect(checks[2].detail).toBe('aucun modèle installé');
    expect(checks[3]).toMatchObject({ label: 'Modèle recommandé installé', detail: 'Magistra Standard' });
  });

  it('tout est prêt', () => {
    const checks = setupChecks(makeStatus({ engine: 'running', installed: ['leger', 'standard'] }));
    expect(checks.map(c => c.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(checks[2].detail).toBe('2 modèles installés');
    expect(checks[3]).toMatchObject({ label: 'Modèle installé', detail: 'Magistra Standard' });
  });

  it('serveur distant : deux vérifications', () => {
    const checks = setupChecks(makeStatus({ mode: 'remote', ready: false }));
    expect(checks.map(c => [c.id, c.state])).toEqual([['remote-configured', 'ok'], ['remote-ready', 'missing']]);
    expect(checks[0].detail).toBe('Serveur du lycée');
  });
});

describe('pullStatusText', () => {
  it('traduit les étapes techniques du téléchargement', () => {
    expect(pullStatusText('pulling manifest')).toBe('Préparation du téléchargement…');
    expect(pullStatusText('pulling 6a0746a1ec1a')).toBe('Téléchargement en cours…');
    expect(pullStatusText('verifying sha256 digest')).toBe('Vérification des fichiers…');
    expect(pullStatusText('writing manifest')).toBe('Finalisation…');
    expect(pullStatusText('success')).toBe('Terminé');
    expect(pullStatusText(undefined)).toBe('Téléchargement en cours…');
  });

  it('garde un message déjà rédigé en français', () => {
    expect(pullStatusText('Téléchargement du modèle')).toBe('Téléchargement du modèle');
    expect(pullStatusText('Reprise du téléchargement')).toBe('Reprise du téléchargement');
  });

  it('ne montre jamais un message technique inconnu', () => {
    expect(pullStatusText('unexpected blob state')).toBe('Téléchargement en cours…');
  });
});

describe('libellés des niveaux', () => {
  it('bouton principal selon l’état du niveau', () => {
    expect(tierActionLabel({ label: 'Magistra Standard', installed: false }, false)).toBe('Installer Magistra Standard');
    expect(tierActionLabel({ label: 'Magistra Léger', installed: true }, false)).toBe('Utiliser Magistra Léger');
    expect(tierActionLabel({ label: 'Magistra Léger', installed: true }, true)).toBe('Magistra Léger est utilisé');
  });

  it('nom affiché d’un téléchargement : jamais le nom technique quand un niveau correspond', () => {
    const s = makeStatus();
    expect(tierLabelFor(s.tiers, { tier: 'qualite' })).toBe('Magistra Qualité');
    expect(tierLabelFor(s.tiers, { model: 'ministral-3:8b' })).toBe('Magistra Léger');
    expect(tierLabelFor(s.tiers, { model: 'llama3.1:8b' })).toBe('llama3.1:8b');
    expect(tierLabelFor(s.tiers, {})).toBe("le modèle d'IA");
  });

  it('présélection : la recommandation au premier démarrage, le niveau actuel dans les réglages', () => {
    const weak = makeStatus({ hardware: { totalRamGB: 8 }, selectedTier: 'standard' });
    expect(weak.recommendation.tier).toBe('leger');
    expect(initialTierChoice(weak, 'setup')).toBe('leger');
    expect(initialTierChoice(weak, 'settings')).toBe('standard');
    // Un niveau déjà installé n'est pas remplacé par la recommandation.
    const installed = makeStatus({ installed: ['leger'], selectedTier: 'leger' });
    expect(initialTierChoice(installed, 'setup')).toBe('leger');
  });
});
