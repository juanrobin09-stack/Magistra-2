// @vitest-environment jsdom
// « Mettre à jour le moteur IA » : même action du pont que l'installation, avec { update: true } ;
// l'installation habituelle garde un appel sans argument.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIStatus, MagistraBridge } from '@shared/ipc';
import { useAIStatus, type AIController } from '@/hooks/useAIStatus';
import { cleanup, flush, render } from '../ui/helpers';
import { makeStatus } from './fixtures';

afterEach(() => {
  cleanup();
  delete (window as { magistra?: unknown }).magistra;
});

function installBridge(status: AIStatus) {
  const installEngine = vi.fn(async () => undefined);
  const bridge = {
    isElectron: true,
    ai: {
      status: vi.fn(async () => status),
      refresh: vi.fn(async () => status),
      installEngine,
      onProgress: vi.fn(() => () => undefined),
    },
  } as unknown as MagistraBridge;
  (window as { magistra?: unknown }).magistra = bridge;
  return installEngine;
}

let controller: AIController | null = null;
function Probe() {
  controller = useAIStatus();
  return null;
}

describe('useAIStatus().installEngine', () => {
  it('mise à jour : le pont reçoit { update: true } ; installation : aucun argument', async () => {
    const status = makeStatus({ engine: 'running', installed: [], engineVersion: '0.12.3', outdated: true });
    const installEngine = installBridge(status);
    await render(<Probe />);
    await flush();
    expect(controller).not.toBeNull();

    await controller!.installEngine({ update: true });
    expect(installEngine).toHaveBeenLastCalledWith({ update: true });

    await controller!.installEngine();
    expect(installEngine).toHaveBeenCalledTimes(2);
    expect(installEngine.mock.calls[1]).toEqual([]);
  });
});
