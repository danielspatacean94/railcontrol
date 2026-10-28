import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  AlertCircle,
  Box,
  Clock3,
  Power,
  RefreshCw,
  Server,
  Square,
} from 'lucide-react';
import {
  railwayService,
  type RailwayServiceState,
} from '@/services/railway.service';

type Action = 'start' | 'stop' | null;

const statusTone: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  ACTIVE: {
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    label: 'Running',
  },
  SUCCESS: {
    dot: 'bg-emerald-400',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    label: 'Running',
  },
  DEPLOYING: {
    dot: 'bg-sky-400',
    badge: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    label: 'Deploying',
  },
  BUILDING: {
    dot: 'bg-amber-400',
    badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    label: 'Building',
  },
  INITIALIZING: {
    dot: 'bg-violet-400',
    badge: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    label: 'Initializing',
  },
  REMOVING: {
    dot: 'bg-orange-400',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    label: 'Stopping',
  },
  REMOVED: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    label: 'Stopped',
  },
  STOPPED: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    label: 'Stopped',
  },
  SLEEPING: {
    dot: 'bg-indigo-400',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
    label: 'Sleeping',
  },
  CRASHED: {
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    label: 'Crashed',
  },
  FAILED: {
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    label: 'Failed',
  },
};

function messageFrom(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
  }
  return 'Something went wrong. Please try again.';
}

function formatDate(value: string | null) {
  if (!value) return 'No deployment yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function DashboardPage() {
  const [service, setService] = useState<RailwayServiceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await railwayService.status();
      setService(data);
      setError(null);
      setLastChecked(new Date());
    } catch (requestError) {
      setError(messageFrom(requestError));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = async (nextAction: Exclude<Action, null>) => {
    if (
      nextAction === 'stop' &&
      !window.confirm(
        'Stop this service? Its active deployment will be removed.',
      )
    )
      return;
    setAction(nextAction);
    setError(null);
    try {
      const { data } =
        nextAction === 'start'
          ? await railwayService.start()
          : await railwayService.stop();
      setService(data);
      setLastChecked(new Date());
    } catch (requestError) {
      setError(messageFrom(requestError));
      await refresh(true);
    } finally {
      setAction(null);
    }
  };

  const tone = statusTone[service?.status ?? 'STOPPED'] ?? {
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    label: service?.status ?? 'Unknown',
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-[#101827] px-6 py-7 text-white shadow-sm sm:px-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="absolute -bottom-28 right-24 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <Activity size={13} className="text-violet-300" />
              Railway service control
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Container control room
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Start, stop, and monitor a Railway service without leaving this
              dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || action !== null}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Unable to update service</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-slate-100 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
              <Server size={23} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Service
              </p>
              <h2 className="mt-0.5 truncate text-lg font-semibold text-slate-900">
                {loading && !service
                  ? 'Loading service...'
                  : (service?.serviceName ?? 'Not configured')}
              </h2>
            </div>
          </div>
          <span
            className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${tone.badge}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${tone.dot} ${service?.isRunning ? 'animate-pulse' : ''}`}
            />
            {loading && !service ? 'Checking...' : tone.label}
          </span>
        </div>

        <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
          <Metric
            icon={<Box size={14} />}
            label="Deployment"
            value={
              service?.deploymentId ? service.deploymentId.slice(0, 12) : '-'
            }
            mono
          />
          <Metric
            icon={<Activity size={14} />}
            label="API status"
            value={service?.status ?? 'Unknown'}
          />
          <Metric
            icon={<Clock3 size={14} />}
            label="Created"
            value={formatDate(service?.deployedAt ?? null)}
          />
        </div>

        <div className="flex flex-col gap-4 bg-slate-50/70 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-xs text-slate-500">
            {lastChecked
              ? `Last checked ${lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : 'Waiting for first status check'}
            <span className="mx-2 text-slate-300">|</span>Auto-refreshes every 5
            seconds
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void runAction('stop')}
              disabled={!service?.canStop || action !== null || loading}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
            >
              {action === 'stop' ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Square size={14} fill="currentColor" />
              )}
              {action === 'stop' ? 'Stopping...' : 'Stop service'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('start')}
              disabled={!service?.canStart || action !== null || loading}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none"
            >
              {action === 'start' ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Power size={16} />
              )}
              {action === 'start'
                ? 'Starting...'
                : service?.status === 'SLEEPING'
                  ? 'Start / wake'
                  : 'Start service'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white px-6 py-5 sm:px-8">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        {icon} {label}
      </div>
      <p
        className={`mt-2 truncate text-sm font-semibold text-slate-700 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}
