import { useCallback, useEffect, useMemo, useState } from 'react';import { CheckCircle2, Truck, XCircle } from 'lucide-react';import { GlassCard } from './GlassCard';import { DeliveryRecord, DeliveryStatus, getDeliveryById, getTodaysDeliveries, updateDeliveryStatus } from '../../services/deliveryService';import { supabase } from '../../services/supabaseClient';type WorkflowState =
  | 'idle'
  | 'job_assigned'
  | 'accepted'
  | 'navigating'
  | 'completed';

interface TodayJobsSectionProps {
  driverId: string;
  onJobAccepted: (delivery: DeliveryRecord) => void;
  onJobDeclined: (deliveryId: string) => void;
}

const statusClasses: Record<DeliveryStatus, string> = {
  assigned: 'bg-yellow-500/20 text-yellow-200 border-yellow-300/30',
  accepted: 'bg-cyan-500/20 text-cyan-100 border-cyan-300/30',
  in_transit: 'bg-indigo-500/20 text-indigo-200 border-indigo-300/30',
  completed: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
  rejected: 'bg-red-500/20 text-red-200 border-red-300/30',
  cancelled: 'bg-gray-500/20 text-gray-200 border-gray-300/30',
};

export function TodayJobsSection({
  driverId,
  onJobAccepted,
  onJobDeclined,
}: TodayJobsSectionProps) {
  const [jobs, setJobs] = useState<DeliveryRecord[]>([]);
  const [workflowState, setWorkflowState] = useState<WorkflowState>('idle');
  const [activeDeliveryId, setActiveDeliveryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getTodaysDeliveries(driverId);
      setJobs(data);
      if (data.some((d) => d.status === 'assigned')) {
        setWorkflowState('job_assigned');
      } else if (data.some((d) => d.status === 'accepted')) {
        setWorkflowState('accepted');
      } else if (data.some((d) => d.status === 'completed')) {
        setWorkflowState('completed');
      } else {
        setWorkflowState('idle');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!driverId) return;
    const channel = supabase
      .channel(`today-jobs-${driverId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deliveries', filter: `driver_id=eq.${driverId}` },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotification('New delivery assigned.');
            setTimeout(() => setNotification(null), 2500);
          }
          await loadJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, loadJobs]);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => job.status !== 'rejected'),
    [jobs]
  );

  const handleAccept = useCallback(
    async (delivery: DeliveryRecord) => {
      try {
        const { data, error } = await supabase.rpc('accept_delivery_atomic', {
          p_delivery_id: delivery.id,
          p_driver_id: driverId,
        });
        if (error || !data) {
          throw new Error(error?.message || 'Delivery already taken.');
        }
        const latest = await getDeliveryById(delivery.id);
        if (latest) {
          setActiveDeliveryId(latest.id);
          setWorkflowState('accepted');
          onJobAccepted(latest);
        }
        await loadJobs();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept job.');
      }
    },
    [driverId, loadJobs, onJobAccepted]
  );

  const handleDecline = useCallback(
    async (delivery: DeliveryRecord) => {
      const previous = jobs;
      setJobs((prev) => prev.filter((item) => item.id !== delivery.id));
      try {
        await updateDeliveryStatus(delivery.id, 'rejected');
        onJobDeclined(delivery.id);
      } catch (err) {
        setJobs(previous);
        setError(err instanceof Error ? err.message : 'Failed to decline job.');
      }
    },
    [jobs, onJobDeclined]
  );

  return (
    <GlassCard className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl text-primary-urban">Today's Jobs</h3>
        <span className="text-xs text-secondary-urban capitalize">{workflowState.replace('_', ' ')}</span>
      </div>

      {notification && (
        <div className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-500/20 px-3 py-2 text-sm text-cyan-100">
          {notification}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl border border-red-300/30 bg-red-500/20 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {loading && <p className="text-secondary-urban text-sm">Loading jobs...</p>}

      {!loading && visibleJobs.length === 0 && (
        <p className="text-secondary-urban text-sm">No deliveries assigned for today.</p>
      )}

      <div className="space-y-3">
        {visibleJobs.map((job) => {
          const isActive = activeDeliveryId === job.id || job.status === 'accepted';
          return (
            <div
              key={job.id}
              className={`rounded-xl border p-4 ${
                isActive
                  ? 'border-cyan-300/40 bg-cyan-500/10'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-primary-urban">Delivery #{job.id.slice(0, 8)}</p>
                <span className={`rounded-full border px-2 py-1 text-xs ${statusClasses[job.status]}`}>
                  {job.status}
                </span>
              </div>
              <p className="text-sm text-secondary-urban mb-1">{job.pickup_location}</p>
              <p className="text-sm text-secondary-urban mb-3">Dropoff: {job.dropoff_location}</p>

              {job.status === 'assigned' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAccept(job)}
                    className="glass-button rounded-lg bg-emerald-500/30 px-3 py-2 text-sm text-white hover:bg-emerald-500/50"
                  >
                    <CheckCircle2 className="mr-1 inline h-4 w-4" />
                    Accept
                  </button>
                  <button
                    onClick={() => void handleDecline(job)}
                    className="glass-button rounded-lg bg-red-500/30 px-3 py-2 text-sm text-white hover:bg-red-500/50"
                  >
                    <XCircle className="mr-1 inline h-4 w-4" />
                    Decline
                  </button>
                </div>
              )}

              {job.status === 'accepted' && (
                <div className="text-sm text-cyan-100">
                  <Truck className="mr-1 inline h-4 w-4" />
                  Ready for navigation
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
