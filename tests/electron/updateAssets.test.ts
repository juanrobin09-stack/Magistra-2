import { describe, expect, it } from 'vitest';
import { checkForUpdate } from '../../electron/updateCheck';
import { LEGACY_UPDATE_CHECKSUMS_FILE, UPDATE_CHECKSUMS_FILE } from '../../shared/updateAssets';

const base = 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases/download/v2.0.10/';
const asset = (name: string) => ({ name, size: 119000000, browser_download_url: base + name });
function check(sums: ReturnType<typeof asset>[]) {
  return checkForUpdate({ currentVersion: '2.0.9', fetch: async () => Response.json({
    tag_name: 'v2.0.10', html_url: 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases/tag/v2.0.10', draft: false, prerelease: false,
    assets: [asset('Magistra-Setup-2.0.10.exe'), ...sums],
  }) });
}
describe('capacité du transport de mise à jour corrigé', () => {
  it('reconnaît le fichier v2 tout en lisant encore les anciennes publications', async () => {
    for (const name of [UPDATE_CHECKSUMS_FILE, LEGACY_UPDATE_CHECKSUMS_FILE]) {
      expect((await check([asset(name)])).installer?.checksumsUrl).toBe(base + name);
    }
  });
  it('préfère v2 ; une entrée ambiguë ou étrangère ne bascule pas sur le fichier historique', async () => {
    expect((await check([asset(LEGACY_UPDATE_CHECKSUMS_FILE), asset(UPDATE_CHECKSUMS_FILE)])).installer?.checksumsUrl).toBe(base + UPDATE_CHECKSUMS_FILE);
    for (const invalid of [[asset(UPDATE_CHECKSUMS_FILE), asset(UPDATE_CHECKSUMS_FILE)], [{ ...asset(UPDATE_CHECKSUMS_FILE), browser_download_url: 'https://evil.example/file' }]]) {
      const result = await check([...invalid, asset(LEGACY_UPDATE_CHECKSUMS_FILE)]);
      expect(result.installer).toBeUndefined();
      expect(result.url).toContain('/releases/tag/v2.0.10');
    }
  });
});
