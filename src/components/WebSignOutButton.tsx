// Site web uniquement (à l'intérieur de ClerkProvider) : déconnexion puis retour à l'accueil,
// pour sortir d'un compte dont le profil ne peut pas être chargé.

import { useClerk } from '@clerk/react';

export default function WebSignOutButton({ label }: { label: string }) {
  const clerk = useClerk();
  return (
    <button type="button" className="btn-secondary text-sm py-2 px-5" onClick={() => void clerk.signOut({ redirectUrl: '/' })}>
      {label}
    </button>
  );
}
