// Contact de l'éditeur (pages légales, Réglages → « À propos ») : l'adresse e-mail devient un lien « mailto: », le reste
// du texte (« Service X, … ») est affiché tel quel. Fichier séparé des pages légales : les Réglages ne chargent pas leurs textes.

import { emailOf } from '@/lib/legal';

export default function ContactLink({ contact, className }: { contact: string; className?: string }) {
  const email = emailOf(contact);
  if (!email) return <>{contact}</>;
  const at = contact.indexOf(email);
  return (
    <>
      {contact.slice(0, at)}
      <a href={`mailto:${email}`} className={className}>{email}</a>
      {contact.slice(at + email.length)}
    </>
  );
}
