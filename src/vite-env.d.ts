/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé publique Clerk (mode web). Absente : le site fonctionne en mode démonstration. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Informations légales de l'éditeur (pages légales, Réglages) : remplacent les valeurs par défaut de src/lib/legal.ts. */
  readonly VITE_LEGAL_PUBLISHER?: string;
  readonly VITE_LEGAL_DIRECTOR?: string;
  readonly VITE_LEGAL_ADDRESS?: string;
  readonly VITE_LEGAL_CONTACT?: string;
  readonly VITE_LEGAL_HOST?: string;
  readonly VITE_LEGAL_DATA_REGION?: string;
  /** Profil professionnel de l'auteur (https, 300 caractères au plus) ; repli : profil LinkedIn par défaut (shared/author.ts). */
  readonly VITE_AUTHOR_PROFILE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
