/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique Clerk (mode web). Absente : le site fonctionne en mode démonstration. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
