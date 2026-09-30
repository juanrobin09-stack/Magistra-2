import { describe, expect, it } from 'vitest';
import {
  cleanDeviceName, engineDownloadText, formatMB, formatTransfer, hardwareLines, progressPercent,
} from '@/lib/ai-ui/format';

/** Remplace les espaces insécables par des espaces ordinaires (lisibilité des attentes). */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');
const plainLines = (lines: { label: string; value: string }[]) => lines.map(l => ({ label: l.label, value: plain(l.value) }));

describe('formatMB', () => {
  it('affiche les petites tailles en Mo, arrondies', () => {
    expect(plain(formatMB(850))).toBe('850 Mo');
    expect(plain(formatMB(512.4))).toBe('512 Mo');
    expect(plain(formatMB(1))).toBe('1 Mo');
  });

  it('passe en Go à partir de 1024 Mo, avec une virgule française', () => {
    expect(plain(formatMB(1024))).toBe('1 Go');
    expect(plain(formatMB(3277))).toBe('3,2 Go');
    expect(plain(formatMB(9216))).toBe('9 Go');
    expect(plain(formatMB(15_872))).toBe('15,5 Go');
  });

  it('sépare le nombre et l’unité par une espace insécable', () => {
    expect(formatMB(850)).toBe('850\u00a0Mo');
    expect(formatMB(9216)).toBe('9\u00a0Go');
  });

  it('ne produit jamais de valeur absurde', () => {
    expect(plain(formatMB(0))).toBe('0 Mo');
    expect(plain(formatMB(undefined))).toBe('0 Mo');
    expect(plain(formatMB(null))).toBe('0 Mo');
    expect(plain(formatMB(Number.NaN))).toBe('0 Mo');
    expect(plain(formatMB(-12))).toBe('0 Mo');
  });
});

describe('formatTransfer', () => {
  it('indique la quantité reçue sur le total', () => {
    expect(plain(formatTransfer(120, 850))).toBe('120 Mo sur 850 Mo');
    expect(plain(formatTransfer(2048, 9216))).toBe('2 Go sur 9 Go');
    expect(plain(formatTransfer(700, 9216))).toBe('700 Mo sur 9 Go');
  });

  it('se contente de la quantité reçue si le total est inconnu', () => {
    expect(plain(formatTransfer(120))).toBe('120 Mo téléchargés');
    expect(plain(formatTransfer(120, 0))).toBe('120 Mo téléchargés');
  });
});

describe('progressPercent', () => {
  it('utilise le pourcentage fourni, borné entre 0 et 100', () => {
    expect(progressPercent({ percent: 45.7 })).toBe(45);
    expect(progressPercent({ percent: 150 })).toBe(100);
    expect(progressPercent({ percent: -3 })).toBe(0);
  });

  it('calcule le pourcentage à partir des quantités', () => {
    expect(progressPercent({ completed: 50, total: 200 })).toBe(25);
    expect(progressPercent({ percent: Number.NaN, completed: 1, total: 4 })).toBe(25);
    expect(progressPercent({ completed: 999, total: 1000 })).toBe(99);
  });

  it('renvoie null quand la progression est inconnue', () => {
    expect(progressPercent({})).toBeNull();
    expect(progressPercent({ completed: 50 })).toBeNull();
    expect(progressPercent({ completed: 0, total: 0 })).toBeNull();
  });
});

describe('engineDownloadText', () => {
  it('donne la taille exacte si elle est connue', () => {
    expect(plain(engineDownloadText({ sizeMB: 1229, approxSizeMB: 1100, requiredDiskGB: 5, platformSupported: true }))).toBe('1,2 Go');
  });

  it('sinon, une taille approximative', () => {
    expect(plain(engineDownloadText({ approxSizeMB: 700, requiredDiskGB: 5, platformSupported: true }))).toBe('environ 700 Mo');
  });
});

describe('cleanDeviceName', () => {
  it('retire les mentions techniques', () => {
    expect(plain(cleanDeviceName('Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz'))).toBe('Intel Core i5-8250U');
    expect(plain(cleanDeviceName('Intel® UHD Graphics 620'))).toBe('Intel UHD Graphics 620');
  });

  it('laisse les noms déjà lisibles inchangés', () => {
    expect(plain(cleanDeviceName('AMD Ryzen 7 5800H with Radeon Graphics'))).toBe('AMD Ryzen 7 5800H with Radeon Graphics');
    expect(plain(cleanDeviceName('NVIDIA GeForce RTX 3060'))).toBe('NVIDIA GeForce RTX 3060');
    expect(plain(cleanDeviceName(undefined))).toBe('');
  });
});

describe('hardwareLines', () => {
  it('décrit simplement un ordinateur avec carte graphique', () => {
    const lines = plainLines(hardwareLines({
      totalRamGB: 31.8,
      cpuModel: 'AMD Ryzen 7 5800H with Radeon Graphics',
      cpuCores: 16,
      gpus: [{ name: 'NVIDIA GeForce RTX 3060 Laptop GPU', vramGB: 6 }],
      freeDiskGB: 212.4,
      platform: 'win32',
    }));
    expect(lines).toEqual([
      { label: 'Mémoire vive', value: '32 Go (31,8 Go utilisables)' },
      { label: 'Processeur', value: 'AMD Ryzen 7 5800H with Radeon Graphics (16 cœurs)' },
      { label: 'Carte graphique', value: 'NVIDIA GeForce RTX 3060 Laptop GPU (6 Go de mémoire vidéo)' },
      { label: 'Espace disque libre', value: '212,4 Go' },
    ]);
  });

  it("signale l'absence de carte graphique et omet le disque inconnu", () => {
    const lines = plainLines(hardwareLines({ totalRamGB: 8, cpuCores: 4, gpus: [], platform: 'win32' }));
    expect(lines).toEqual([
      { label: 'Mémoire vive', value: '8 Go' },
      { label: 'Processeur', value: '4 cœurs' },
      { label: 'Carte graphique', value: 'Aucune carte graphique dédiée détectée' },
    ]);
  });

  it('accorde le libellé au pluriel avec plusieurs cartes graphiques', () => {
    const lines = plainLines(hardwareLines({
      totalRamGB: 16, cpuCores: 1, gpus: [{ name: 'Intel(R) UHD Graphics' }, { name: 'NVIDIA RTX A2000', vramGB: 4 }], platform: 'win32',
    }));
    expect(lines[1]).toEqual({ label: 'Processeur', value: '1 cœur' });
    expect(lines[2]).toEqual({ label: 'Cartes graphiques', value: 'Intel UHD Graphics, NVIDIA RTX A2000 (4 Go de mémoire vidéo)' });
  });
});
