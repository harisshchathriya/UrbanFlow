import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { GlassCard } from './GlassCard';
import { KPICard } from './KPICard';
import { LoadingSpinner } from './LoadingSpinner';
import { Leaf, Calendar, TrendingUp, Award } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type EmissionMatch = {
  id: string;
  co2: number;
  created_at: string;
  route: string;
  savings: number;
};

type DailyEmission = {
  date: string;
  co2: number;
};

export function CO2Dashboard() {
  const [matches, setMatches] = useState<EmissionMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailyEmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const totalCO2 = matches.reduce((sum, m) => sum + (m.co2 || 0), 0);

  const today = new Date().toISOString().split('T')[0];
  const todayCO2 = matches
    .filter((m) => m.created_at.startsWith(today))
    .reduce((sum, m) => sum + (m.co2 || 0), 0);

  const thisWeekCO2 = matches
    .filter((m) => {
      const d = new Date(m.created_at);
      const now = new Date();
      const weekAgo = new Date(now.setDate(now.getDate() - 7));
      return d >= weekAgo;
    })
    .reduce((sum, m) => sum + (m.co2 || 0), 0);

  const averageMatchCO2 = matches.length
    ? Math.round((totalCO2 / matches.length) * 10) / 10
    : 0;

  useEffect(() => {
    const last7Days: DailyEmission[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const co2 = matches
        .filter((m) => m.created_at.startsWith(dateStr))
        .reduce((sum, m) => sum + (m.co2 || 0), 0);
      last7Days.push({
        date: dateStr.slice(5),
        co2: Math.round(co2 * 10) / 10,
      });
    }
    setDailyData(last7Days);
  }, [matches]);

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('consolidation_matches')
        .select('id, co2, created_at, route, savings')
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        setMatches([]);
      } else {
        setMatches((data || []) as EmissionMatch[]);
      }
      setLoading(false);
    };

    fetchMatches();

    const subscription = supabase
      .channel('co2-dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consolidation_matches' },
        fetchMatches
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  if (loading) {
    return (
      <GlassCard className="mb-6 p-8 flex justify-center items-center">
        <LoadingSpinner />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="mb-6">
      <h2 className="text-xl text-primary-urban mb-4 flex items-center gap-2">
        <Leaf className="w-5 h-5" />
        CO2 Intelligence Dashboard
      </h2>

      {error && (
        <p className="text-sm text-red-300 mb-4">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard icon={Leaf} label="Total CO2 Saved" value={`${totalCO2.toFixed(1)} kg`} />
        <KPICard icon={Calendar} label="Today" value={`${todayCO2.toFixed(1)} kg`} />
        <KPICard icon={TrendingUp} label="This Week" value={`${thisWeekCO2.toFixed(1)} kg`} />
        <KPICard icon={Award} label="Avg per Match" value={`${averageMatchCO2} kg`} />
      </div>

      {dailyData.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm text-muted-urban mb-2">Daily CO2 Savings (Last 7 Days)</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="co2Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.5rem',
                    color: '#f1f5f9',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="co2"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#co2Gradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm text-muted-urban mb-2">Recent High-Impact Consolidations</h3>
        <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
          {matches.slice(0, 5).map((match) => (
            <div key={match.id} className="glass-card p-3 rounded-lg flex justify-between items-center text-sm">
              <span className="truncate max-w-[200px] text-primary-urban">{match.route}</span>
              <span className="text-emerald-400 font-medium">{match.co2} kg CO2</span>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
