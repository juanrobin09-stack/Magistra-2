interface ElectronAPI {
  isElectron: true;
  getConfig: (key: string) => Promise<string>;
  getConfigRaw: (key: string) => Promise<string>;
  setConfig: (key: string, value: string) => Promise<boolean>;
  hasConfig: (key: string) => Promise<boolean>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
