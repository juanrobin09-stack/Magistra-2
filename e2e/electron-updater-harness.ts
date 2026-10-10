import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import { createUpdateFetch } from '../electron/updateFetch';

app.setPath('userData', process.env.MAGISTRA_USER_DATA_DIR!);
const fetch = createUpdateFetch(options => net.request(options));
Object.assign(globalThis, {
  async __nativeUpdateProbe(url: string, read: boolean, timeoutMs: number) {
    await app.whenReady();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      const bytes = read ? Buffer.from(await response.arrayBuffer()) : null;
      return { status: response.status, location: response.headers.get('location'), body: !!response.body,
        bytes: bytes?.length, sha256: bytes && createHash('sha256').update(bytes).digest('hex') };
    } catch (error) {
      return { error: (error as Error).message, errorName: (error as Error).name };
    }
  },
});
