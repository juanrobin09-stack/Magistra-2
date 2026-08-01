import { MessageCircle } from 'lucide-react';
import { ALPHA_FEEDBACK_EMAIL } from '@/lib/alpha';

const FEEDBACK_SUBJECT = 'Magistra Alpha - Retour';

const FEEDBACK_BODY = [
  '------------------------------------',
  'Type :',
  '(Bug / Idée / Suggestion)',
  '',
  'Description :',
  '',
  'Étapes pour reproduire (si bug) :',
  '',
  'Navigateur :',
  '',
  'Commentaires :',
  '------------------------------------',
].join('\n');

const FEEDBACK_MAILTO =
  `mailto:${ALPHA_FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(FEEDBACK_BODY)}`;

// Bouton discret : ouvre le client mail du testeur avec un e-mail prérempli.
// Aucun backend, aucune base de données — juste un lien mailto.
export default function FeedbackButton() {
  return (
    <a
      href={FEEDBACK_MAILTO}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-mg-800 border border-white/10 text-mg-300 text-xs font-medium shadow-lg hover:text-accent hover:border-accent/25 transition-all"
    >
      <MessageCircle size={14} /> Envoyer un retour
    </a>
  );
}
