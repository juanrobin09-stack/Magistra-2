// Site web uniquement (à l'intérieur de ClerkProvider) : à la déconnexion, la copie hors ligne du profil enseignant
// est effacée du navigateur (poste partagé de la salle des professeurs). Couvre le menu du <UserButton> de Clerk comme
// le bouton « Se déconnecter » de l'application.

import { useEffect } from 'react';
import { useClerk } from '@clerk/react';
import { clearProfileCache, createSignOutWatcher } from '@/lib/runtime/web';

export default function ProfileCacheCleaner() {
  const clerk = useClerk();
  useEffect(() => {
    const listener = createSignOutWatcher(clearProfileCache);
    // Rattrapage : une session déjà ouverte au montage est mémorisée pour que sa déconnexion soit détectée.
    listener({ user: clerk.user });
    return clerk.addListener(listener);
  }, [clerk]);
  return null;
}
