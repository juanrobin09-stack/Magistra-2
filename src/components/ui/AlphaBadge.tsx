import { FlaskConical } from 'lucide-react';
import { ALPHA_MODE } from '@/lib/alpha';

// Badge discret signalant la phase Alpha. Disparaît automatiquement si ALPHA_MODE est désactivé.
export default function AlphaBadge({ className = '' }: { className?: string }) {
  if (!ALPHA_MODE) return null;

  return (
    <span
      title="Magistra est en phase de test privée avec un petit groupe d'enseignants."
      className={`badge badge-accent ${className}`}
    >
      <FlaskConical size={11} /> Version Alpha
    </span>
  );
}
