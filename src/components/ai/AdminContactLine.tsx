// Contact de l'administrateur du site (MAGISTRA_ADMIN_CONTACT, via GET /api/mode), s'il est configuré.

import { adminContactLink } from '@/lib/ai-ui/server';

export default function AdminContactLine({ contact, className }: { contact?: string; className?: string }) {
  const link = adminContactLink(contact);
  if (!link) return null;
  return (
    <p className={className}>
      Contact de l’administrateur :{' '}
      {link.href ? (
        <a
          href={link.href}
          className="text-accent hover:underline underline-offset-2 [overflow-wrap:anywhere]"
          {...(link.href.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {link.text}
        </a>
      ) : (
        <span className="text-mg-50 [overflow-wrap:anywhere]">{link.text}</span>
      )}
    </p>
  );
}
