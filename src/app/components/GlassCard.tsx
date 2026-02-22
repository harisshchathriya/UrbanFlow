import { ReactNode } from 'react';interface GlassCardProps {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  hover?: boolean;
}

export function GlassCard({ children, className = '', strong = false, hover = false }: GlassCardProps) {
  const baseClass = strong ? 'glass-card-strong' : 'glass-card';
  const hoverClass = hover ? 'hover-lift' : '';
  
  return (
    <div className={`${baseClass} ${hoverClass} rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}
