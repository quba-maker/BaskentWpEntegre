'use client';

import React, { useEffect, useState } from 'react';

export default function SystemHealthPage() {
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [chaosAction, setChaosAction] = useState<string | null>(null);
  const [chaosResult, setChaosResult] = useState<any>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/system-health', {
        headers: { 'x-admin-secret': process.env.NEXT_PUBLIC_ADMIN_SECRET || '' }
      });
      const data = await res.json();
      if (data.success) {
        setHealthData(data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerChaos = async (action: string) => {
    setChaosAction(action);
    try {
      const res = await fetch(`/api/test/chaos?action=${action}`, {
        method: 'POST',
        headers: { 'x-chaos-secret': process.env.NEXT_PUBLIC_CHAOS_SECRET || '' }
      });
      const data = await res.json();
      setChaosResult(data);
      fetchHealth(); // Refresh stats
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setChaosAction(null), 2000);
    }
  };

  if (loading && !healthData) {
    return <div className="p-8 text-white">Loading System Health...</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center border-b border-neutral-800 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">System Health & Certification</h1>
            <p className="text-sm text-neutral-500 mt-1">Live operational metrics and chaos engineering controls.</p>
          </div>
          <div className="text-xs text-neutral-500">
            Last Updated: {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleTimeString() : 'N/A'}
          </div>
        </div>

        {/* METRICS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard 
            title="Queue Lag (Pending)" 
            value={healthData?.queue?.lag} 
            status={healthData?.queue?.lag > 100 ? 'critical' : healthData?.queue?.lag > 0 ? 'warning' : 'ok'}
          />
          <MetricCard 
            title="Stale Locks" 
            value={healthData?.locks?.stale} 
            status={healthData?.locks?.stale > 0 ? 'critical' : 'ok'}
          />
          <MetricCard 
            title="Tenants Over Budget" 
            value={healthData?.tenants?.overBudget} 
            status={healthData?.tenants?.overBudget > 0 ? 'warning' : 'ok'}
          />
          <MetricCard 
            title="Unresolved DLQ Jobs" 
            value={healthData?.dlq?.unresolved} 
            status={healthData?.dlq?.unresolved > 0 ? 'warning' : 'ok'}
          />
        </div>

        {/* CHAOS CONTROLS */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 mt-8">
          <h2 className="text-lg font-medium text-white mb-4">Chaos Engineering Lab</h2>
          <p className="text-sm text-neutral-400 mb-6">
            Inject faults into the system to test recovery chron-jobs and orchestration resilience.
          </p>
          
          <div className="flex flex-wrap gap-4">
            <ChaosButton 
              label="Simulate Deadlock" 
              action="simulate_deadlock" 
              isExecuting={chaosAction === 'simulate_deadlock'} 
              onClick={() => triggerChaos('simulate_deadlock')} 
            />
            <ChaosButton 
              label="Inject Queue Lag" 
              action="simulate_queue_lag" 
              isExecuting={chaosAction === 'simulate_queue_lag'} 
              onClick={() => triggerChaos('simulate_queue_lag')} 
            />
            <ChaosButton 
              label="Overload Tenant Budget" 
              action="overload_tenant_budget" 
              isExecuting={chaosAction === 'overload_tenant_budget'} 
              onClick={() => triggerChaos('overload_tenant_budget')} 
            />
          </div>

          {chaosResult && (
            <div className="mt-4 p-4 bg-neutral-950 border border-neutral-800 rounded text-xs font-mono text-green-400">
              {JSON.stringify(chaosResult, null, 2)}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function MetricCard({ title, value, status }: { title: string, value: number, status: 'ok' | 'warning' | 'critical' }) {
  const statusColors = {
    ok: 'text-emerald-400',
    warning: 'text-amber-400',
    critical: 'text-rose-500'
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 flex flex-col justify-between">
      <div className="text-sm text-neutral-400">{title}</div>
      <div className={`text-4xl font-light mt-4 tracking-tight ${statusColors[status]}`}>
        {value ?? '-'}
      </div>
    </div>
  );
}

function ChaosButton({ label, action, isExecuting, onClick }: { label: string, action: string, isExecuting: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={isExecuting}
      className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-sm font-medium rounded-lg text-white transition-colors border border-neutral-700 focus:outline-none disabled:opacity-50"
    >
      {isExecuting ? 'Injecting...' : label}
    </button>
  );
}
