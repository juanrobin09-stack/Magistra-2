import type { LucideIcon } from 'lucide-react';

interface IconBadgeProps {
  icon: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Pictogramme décoratif, toujours accompagné d'un libellé visible. La couleur vient du contexte de l'outil. */
export default function IconBadge({ icon: Icon, size = 'md', className = 'text-accent' }: IconBadgeProps) {
  return (
    <span className={`icon-badge icon-badge--${size} ${className}`} aria-hidden="true">
      <Icon strokeWidth={1.7} focusable="false" />
    </span>
  );
}
