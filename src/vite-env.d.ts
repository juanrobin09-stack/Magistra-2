/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique Clerk (mode web). Absente : le site fonctionne en mode démonstration. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Informations légales de l'éditeur du site (pages Mentions légales et Confidentialité) ; « à compléter » si absentes. */
  readonly VITE_LEGAL_PUBLISHER?: string;
  readonly VITE_LEGAL_DIRECTOR?: string;
  readonly VITE_LEGAL_ADDRESS?: string;
  readonly VITE_LEGAL_CONTACT?: string;
  readonly VITE_LEGAL_HOST?: string;
  readonly VITE_LEGAL_DATA_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
