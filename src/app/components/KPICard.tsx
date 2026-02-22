import { LucideIcon } from 'lucide-react';import { GlassCard } from './GlassCard';interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  status?: 'active' | 'warning' | 'error';
}

export function KPICard({ icon: Icon, label, value, change, trend, status }: KPICardProps) {
  const getTrendColor = () => {
    if (trend === 'up') return 'text-green-300';
    if (trend === 'down') return 'text-red-300';
    return 'text-secondary-urban';
  };

  return (
    <GlassCard hover>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-muted-urban text-sm mb-2">{label}</p>
          <div className="flex items-center gap-3">
            {status && <span className={`status-dot status-${status}`} />}
            <p className="text-3xl text-primary-urban">{value}</p>
          </div>
          {change && (
            <p className={`text-sm mt-2 ${getTrendColor()}`}>
              {change}
            </p>
          )}
        </div>
        <div className="glass-card rounded-xl p-3">
          <Icon className="w-6 h-6 text-cyan-glow" />
        </div>
      </div>
    </GlassCard>
  );
}
