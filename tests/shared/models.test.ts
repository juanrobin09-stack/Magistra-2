import { describe, expect, it } from 'vitest';
import {
  compareVersions, formatGB, getTier, installedModelForTier, installedTiers, MIN_OLLAMA_VERSION, MODEL_TIERS, modelMatchesTier,
  nominalRamGB, normalizeModelName, ollamaVersionStatus, parseVersion, recommendTier, tierForModel, type HardwareInfo,
} from '../../shared/ai/models';

function hw(partial: Partial<HardwareInfo>): HardwareInfo {
  return { totalRamGB: 16, cpuCores: 8, gpus: [], platform: 'win32', freeDiskGB: 200, ...partial };
}

function fits(rec: ReturnType<typeof recommendTier>): Record<string, string> {
  return Object.fromEntries(rec.tiers.map(t => [t.id, t.fit]));
}

describe('recommendTier — ne jamais rendre la machine inutilisable', () => {
  it('4 Go : aucun modèle local recommandé, orientation vers un serveur distant', () => {
    const rec = recommendTier(hw({ totalRamGB: 4, cpuCores: 2 }));
    expect(rec.localPossible).toBe(false);
    expect(rec.tier).toBe('leger');
    expect(rec.machine).toBe('modeste');
    expect(fits(rec)).toEqual({ leger: 'not_recommended', standard: 'not_recommended', qualite: 'not_recommended' });
    expect(rec.tiers.some(t => t.fit === 'recommended')).toBe(false);
    expect(rec.summary).toMatch(/aucun modèle local/);
    expect(rec.warning).toMatch(/4 Go de mémoire.*serveur d'IA distant/);
  });

  it('8 Go sans carte graphique (PC modeste) : Magistra Léger, avec conseil de fermer les applications', () => {
    const rec = recommendTier(hw({ totalRamGB: 8, cpuCores: 4 }));
    expect(rec).toMatchObject({ tier: 'leger', machine: 'modeste', localPossible: true });
    expect(fits(rec)).toEqual({ leger: 'recommended', standard: 'not_recommended', qualite: 'not_recommended' });
    expect(rec.summary).toBe('Ordinateur modeste : Magistra Léger est recommandé.');
    expect(rec.warning).toMatch(/lente/);
  });

  it('16 Go sans carte graphique (PC correct) : Magistra Standard ; Qualité déconseillé', () => {
    const rec = recommendTier(hw({ totalRamGB: 16 }));
    expect(rec).toMatchObject({ tier: 'standard', machine: 'correct', localPossible: true });
    expect(fits(rec)).toEqual({ leger: 'ok', standard: 'recommended', qualite: 'not_recommended' });
    expect(rec.summary).toBe('Ordinateur correct : Magistra Standard est recommandé.');
  });

  it('32 Go + carte graphique 24 Go (PC puissant) : Magistra Qualité, rapide', () => {
    const rec = recommendTier(hw({ totalRamGB: 32, gpus: [{ name: 'NVIDIA RTX 4090', vramGB: 24 }] }));
    expect(rec).toMatchObject({ tier: 'qualite', machine: 'puissant', localPossible: true, warning: undefined });
    expect(fits(rec)).toEqual({ leger: 'ok', standard: 'ok', qualite: 'recommended' });
    expect(rec.tiers.find(t => t.id === 'qualite')?.note).toMatch(/carte graphique/);
  });

  it('disque plein : aucun modèle recommandé, message sur l’espace disque', () => {
    const rec = recommendTier(hw({ totalRamGB: 16, freeDiskGB: 3 }));
    expect(rec.localPossible).toBe(false);
    expect(rec.tiers.every(t => t.fit === 'not_recommended')).toBe(true);
    expect(rec.warning).toMatch(/Espace disque insuffisant/);
  });

  it('disque juste suffisant pour Léger : on redescend de Standard à Léger', () => {
    const rec = recommendTier(hw({ totalRamGB: 16, freeDiskGB: getTier('leger').downloadGB + 3 }));
    expect(rec).toMatchObject({ tier: 'leger', localPossible: true });
    expect(fits(rec).standard).toBe('not_recommended');
    expect(rec.tiers.find(t => t.id === 'standard')?.note).toMatch(/Espace disque insuffisant/);
  });

  it('carte graphique 16 Go mais disque trop petit pour Qualité : Standard', () => {
    const rec = recommendTier(hw({ totalRamGB: 32, gpus: [{ name: 'RTX 4080', vramGB: 16 }], freeDiskGB: 12 }));
    expect(rec).toMatchObject({ tier: 'standard', localPossible: true });
    expect(fits(rec).qualite).toBe('not_recommended');
  });

  it('8 Go de mémoire + carte graphique 12 Go : Standard (le modèle tient sur la carte graphique)', () => {
    const rec = recommendTier(hw({ totalRamGB: 8, gpus: [{ name: 'RTX 3060', vramGB: 12 }] }));
    expect(rec).toMatchObject({ tier: 'standard', machine: 'correct', localPossible: true });
  });

  it('valeurs matérielles absentes ou aberrantes : prudence', () => {
    const rec = recommendTier({ totalRamGB: Number.NaN, cpuCores: 4, gpus: [{ name: 'Intel UHD' }], platform: 'win32' });
    expect(rec.localPossible).toBe(false);
    expect(rec.tiers.some(t => t.fit === 'recommended')).toBe(false);
  });

  it('un niveau recommandé n’est jamais « not_recommended »', () => {
    for (const ram of [2, 4, 6, 8, 12, 16, 24, 32, 64]) {
      for (const vram of [0, 6, 8, 12, 16, 24]) {
        for (const disk of [2, 8, 12, 20, 500]) {
          const rec = recommendTier(hw({ totalRamGB: ram, gpus: vram ? [{ name: 'GPU', vramGB: vram }] : [], freeDiskGB: disk }));
          const recommended = rec.tiers.filter(t => t.fit === 'recommended');
          if (rec.localPossible) {
            expect(recommended.map(t => t.id)).toEqual([rec.tier]);
            const tier = getTier(rec.tier);
            expect(disk).toBeGreaterThanOrEqual(tier.downloadGB + 2);
            expect(ram >= tier.minRamGB || (vram >= tier.fastVramGB && ram >= tier.minRamGB / 2)).toBe(true);
          } else {
            expect(recommended).toHaveLength(0);
          }
        }
      }
    }
  });
});

describe('recommendTier — mémoire réellement visible par le système', () => {
  it('un PC vendu « 16 Go » qui en déclare 15,7 (ou 14) reçoit Magistra Standard', () => {
    for (const ram of [15.7, 15.4, 14]) {
      const rec = recommendTier(hw({ totalRamGB: ram }));
      expect(rec.tier, String(ram)).toBe('standard');
      expect(rec.tiers.find(t => t.id === 'standard')?.fit).toBe('recommended');
    }
  });

  it('un PC « 8 Go » qui en déclare 7,7 peut utiliser Magistra Léger ; « 32 Go » (31,7) n’est pas bridé', () => {
    const eight = recommendTier(hw({ totalRamGB: 7.7 }));
    expect(eight.localPossible).toBe(true);
    expect(eight.tier).toBe('leger');
    expect(recommendTier(hw({ totalRamGB: 31.7 })).tiers.find(t => t.id === 'qualite')?.fit).not.toBe('not_recommended');
  });

  it('capacité nominale : arrondi au format vendu seulement si l’écart est faible', () => {
    expect(nominalRamGB(15.7)).toBe(16);
    expect(nominalRamGB(7.7)).toBe(8);
    expect(nominalRamGB(31.7)).toBe(32);
    expect(nominalRamGB(10)).toBe(10);
    expect(nominalRamGB(4)).toBe(4);
    expect(nominalRamGB(0)).toBe(0);
    expect(nominalRamGB(Number.NaN)).toBe(0);
  });
});

describe('recommendTier — notes cohérentes avec la recommandation', () => {
  it('la note du niveau recommandé est réécrite (plus de « Fonctionne, mais lentement » sous un badge « recommandé »)', () => {
    const modest = recommendTier(hw({ totalRamGB: 8, cpuCores: 4 }));
    const leger = modest.tiers.find(t => t.id === 'leger')!;
    expect(leger.fit).toBe('recommended');
    expect(leger.note).toBe('Recommandé pour cet ordinateur : génération progressive sans carte graphique, assez lente (fermez les autres applications pendant la rédaction).');
    expect(leger.note).not.toMatch(/^Fonctionne/);

    const comfortable = recommendTier(hw({ totalRamGB: 24 })).tiers.find(t => t.fit === 'recommended')!;
    expect(comfortable).toMatchObject({ id: 'standard', note: 'Recommandé pour cet ordinateur : génération progressive sans carte graphique.' });

    const gpu = recommendTier(hw({ totalRamGB: 32, gpus: [{ name: 'RTX 4090', vramGB: 24 }] })).tiers.find(t => t.fit === 'recommended')!;
    expect(gpu).toMatchObject({ id: 'qualite', note: 'Recommandé pour cet ordinateur : rapide grâce à la carte graphique.' });
  });

  it('les autres niveaux gardent leur propre note, jamais « Recommandé »', () => {
    for (const ram of [4, 8, 16, 32]) {
      const rec = recommendTier(hw({ totalRamGB: ram }));
      for (const t of rec.tiers.filter(x => x.fit !== 'recommended')) expect(t.note).not.toMatch(/recommandé/i);
    }
  });

  it('les descriptions statiques sont neutres : la recommandation vient uniquement de recommendTier', () => {
    for (const tier of MODEL_TIERS) expect(tier.description).not.toMatch(/recommand/i);
  });
});

describe('catalogue des modèles', () => {
  it('trois niveaux, licence ouverte, recherche par nom technique, niveau par défaut', () => {
    expect(MODEL_TIERS.map(t => t.label)).toEqual(['Magistra Léger', 'Magistra Standard', 'Magistra Qualité']);
    for (const tier of MODEL_TIERS) expect(tier.license).toBe('Apache 2.0');
    expect(tierForModel('ministral-3:14b')?.id).toBe('standard');
    expect(getTier('inconnu').id).toBe('standard');
    expect(formatGB(7.84)).toBe('7,8 Go');
  });
});

describe('alias des niveaux (modèle déjà installé sous un autre nom, G4)', () => {
  it('chaque niveau exige Ollama 0.13.1 (ministral-3)', () => {
    expect(MIN_OLLAMA_VERSION).toBe('0.13.1');
    for (const tier of MODEL_TIERS) expect(tier.minOllama).toBe('0.13.1');
  });

  it('les alias officiels sont reconnus comme le même niveau', () => {
    for (const name of ['ministral-3', 'ministral-3:latest', 'ministral-3:8b-instruct-2512-q4_K_M', 'Ministral-3:8B', 'registry.ollama.ai/library/ministral-3:8b']) {
      expect(tierForModel(name)?.id, name).toBe('leger');
    }
    expect(tierForModel('ministral-3:14b-instruct-2512-q4_K_M')?.id).toBe('standard');
    for (const name of ['mistral-small3.2', 'mistral-small3.2:latest', 'mistral-small3.2:24b-instruct-2506-q4_K_M']) {
      expect(tierForModel(name)?.id, name).toBe('qualite');
    }
    expect(tierForModel('ministral-3:3b')).toBeUndefined();
    expect(tierForModel('')).toBeUndefined();
  });

  it('les variantes q8 / fp16 ne sont PAS équivalentes (mémoire bien plus grande)', () => {
    for (const name of ['ministral-3:8b-instruct-2512-q8_0', 'ministral-3:8b-instruct-2512-fp16', 'ministral-3:14b-instruct-2512-q8_0', 'mistral-small3.2:24b-instruct-2506-fp16']) {
      expect(tierForModel(name), name).toBeUndefined();
      expect(MODEL_TIERS.some(t => modelMatchesTier(name, t)), name).toBe(false);
    }
  });

  it('installedModelForTier renvoie le nom RÉELLEMENT installé (à passer à /api/chat), le nom du catalogue en priorité', () => {
    const tags = [{ name: 'ministral-3:latest' }, { name: 'nomic-embed-text:latest' }, { name: 'mistral-small3.2:24b-instruct-2506-q4_K_M' }];
    expect(installedModelForTier('leger', tags)).toBe('ministral-3:latest');
    expect(installedModelForTier('standard', tags)).toBeUndefined();
    expect(installedModelForTier(getTier('qualite'), tags)).toBe('mistral-small3.2:24b-instruct-2506-q4_K_M');
    expect(installedModelForTier('leger', ['ministral-3:latest', 'ministral-3:8b'])).toBe('ministral-3:8b');
    expect(installedModelForTier('leger', ['ministral-3:8b-instruct-2512-q8_0'])).toBeUndefined();
    expect(installedTiers(tags).map(t => [t.tier.id, t.model])).toEqual([['leger', 'ministral-3:latest'], ['qualite', 'mistral-small3.2:24b-instruct-2506-q4_K_M']]);
    expect(installedTiers([])).toEqual([]);
  });

  it('normalizeModelName', () => {
    expect(normalizeModelName(' Mistral ')).toBe('mistral:latest');
    expect(normalizeModelName('library/ministral-3:8B')).toBe('ministral-3:8b');
    expect(normalizeModelName('hf.co/org/modele-gguf')).toBe('hf.co/org/modele-gguf:latest');
  });
});

describe('versions (Ollama)', () => {
  it('compareVersions : semver tolérant (préfixe v, parties manquantes, pré-versions, métadonnées)', () => {
    expect(compareVersions('0.13.1', '0.13.1')).toBe(0);
    expect(compareVersions('v0.13.1', '0.13.1')).toBe(0);
    expect(compareVersions('0.13', '0.13.0')).toBe(0);
    expect(compareVersions('0.12.3', '0.13.1')).toBe(-1);
    expect(compareVersions('0.34.4', '0.13.1')).toBe(1);
    expect(compareVersions('0.9.10', '0.9.9')).toBe(1);
    expect(compareVersions('0.13.1-rc1', '0.13.1')).toBe(-1);
    expect(compareVersions('0.13.1-rc2', '0.13.1-rc10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('0.13.1+build.5', '0.13.1')).toBe(0);
    expect(compareVersions('inconnue', '0.13.1')).toBeNaN();
    expect(parseVersion(' V0.34.4 ')).toEqual({ core: [0, 34, 4], pre: [] });
    expect(parseVersion('0.12.3-mock')).toEqual({ core: [0, 12, 3], pre: ['mock'] });
    expect(parseVersion('pas une version')).toBeNull();
  });

  it('ollamaVersionStatus : à jour, trop ancien, ou inconnu (jamais bloquant)', () => {
    expect(ollamaVersionStatus('0.34.4')).toBe('ok');
    expect(ollamaVersionStatus('0.13.1')).toBe('ok');
    expect(ollamaVersionStatus('v0.13.1-rc1')).toBe('ok');
    expect(ollamaVersionStatus('0.40.0-rc0')).toBe('ok');
    expect(ollamaVersionStatus('0.13.0')).toBe('outdated');
    expect(ollamaVersionStatus('0.12.3-mock')).toBe('outdated');
    expect(ollamaVersionStatus('0.6.2')).toBe('outdated');
    expect(ollamaVersionStatus('0.0.0')).toBe('unknown');
    expect(ollamaVersionStatus('inconnue')).toBe('unknown');
    expect(ollamaVersionStatus(null)).toBe('unknown');
    expect(ollamaVersionStatus('0.14.0', '0.15')).toBe('outdated');
  });
});
