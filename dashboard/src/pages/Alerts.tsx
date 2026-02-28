import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alerts } from '../api/client';

const ALERT_META: Record<string, { label: string; desc: string }> = {
  apy_drop: {
    label: 'APY DROP',
    desc: 'Fires when yield on a position drops below your threshold',
  },
  arb_opportunity: {
    label: 'ARB OPPORTUNITY',
    desc: 'Fires when a cross-DEX spread exceeds your threshold',
  },
  position_health: {
    label: 'POSITION HEALTH',
    desc: 'Fires when a delta-neutral position needs attention',
  },
};

function AlertTypeBadge({ type }: { type: string }) {
  const meta = ALERT_META[type];
  return (
    <span className="font-mono text-xs font-bold px-2 py-0.5 bg-black text-[#F5C518]">
      {meta?.label ?? type?.toUpperCase() ?? 'ALERT'}
    </span>
  );
}

export default function Alerts() {
  const queryClient = useQueryClient();

  const configQ = useQuery({
    queryKey: ['alerts'],
    queryFn: alerts.get,
  });

  const notifQ = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: alerts.unread,
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => alerts.markRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts-unread'] });
    },
  });

  const unreadNotifs: any[] = Array.isArray(notifQ.data?.notifications)
    ? notifQ.data!.notifications
    : [];

  const alertConfigs: any[] = Array.isArray(configQ.data?.alerts)
    ? configQ.data!.alerts
    : [];

  const markAllRead = () => {
    const ids = unreadNotifs.map((n: any) => n.id).filter(Boolean);
    if (ids.length > 0) markReadMutation.mutate(ids);
  };

  return (
    <div className="p-8 bg-white min-h-screen">

      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-black pb-6 mb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Alerts</h1>
        {unreadNotifs.length > 0 && (
          <span className="font-display text-xl bg-[#F5C518] px-4 py-1 border-2 border-black">
            {unreadNotifs.length} UNREAD
          </span>
        )}
      </div>

      {/* Unread Notifications */}
      <div className="border-2 border-black mb-6">
        <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between bg-white">
          <h2 className="font-display text-xl tracking-wide uppercase">Notifications</h2>
          {unreadNotifs.length > 0 && (
            <button
              onClick={markAllRead}
              disabled={markReadMutation.isPending}
              className="font-mono text-xs font-bold border-2 border-black px-3 py-1.5 hover:bg-[#F5C518] disabled:opacity-50 transition-all"
            >
              MARK ALL READ
            </button>
          )}
        </div>

        {notifQ.isLoading ? (
          <p className="font-mono text-sm text-gray-500 p-6">Loading notifications...</p>
        ) : notifQ.isError ? (
          <p className="font-mono text-sm text-gray-500 p-6">Could not load notifications.</p>
        ) : unreadNotifs.length > 0 ? (
          <div>
            {unreadNotifs.map((n: any, i: number) => (
              <div
                key={n.id ?? i}
                className="flex items-start justify-between gap-4 p-5 border-b-2 border-black last:border-b-0 border-l-4 border-l-[#F5C518] hover:bg-[#F5F5F5] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <AlertTypeBadge type={n.type ?? 'alert'} />
                    {n.created_at && (
                      <span className="font-mono text-xs text-gray-500">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-sm text-black">{n.message}</p>
                </div>
                {n.id && (
                  <button
                    onClick={() => markReadMutation.mutate([n.id])}
                    className="font-mono text-xs font-bold border-2 border-black px-2 py-1 hover:bg-black hover:text-[#F5C518] transition-all shrink-0"
                  >
                    DISMISS
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-mono text-sm text-gray-500">No unread notifications.</p>
            <p className="font-mono text-xs text-gray-400 mt-1">Watchers check every 2–5 min.</p>
          </div>
        )}
      </div>

      {/* Alert Configuration */}
      <div className="border-2 border-black">
        <div className="px-6 py-4 border-b-2 border-black bg-white">
          <h2 className="font-display text-xl tracking-wide uppercase">Alert Configuration</h2>
          <p className="font-mono text-xs text-gray-500 mt-1">
            Toggle via MCP{' '}
            <span className="bg-black text-[#F5C518] px-1 font-bold">set_alerts</span>{' '}
            tool or Telegram.
          </p>
        </div>

        {configQ.isLoading ? (
          <p className="font-mono text-sm text-gray-500 p-6">Loading configuration...</p>
        ) : configQ.isError ? (
          <p className="font-mono text-sm text-gray-500 p-6">Could not load alert config.</p>
        ) : (
          <div>
            {Object.entries(ALERT_META).map(([type, meta], idx) => {
              const configured = alertConfigs.find((a: any) => a.type === type);
              const isActive = configured?.active === true;
              return (
                <div
                  key={type}
                  className={`flex items-center justify-between p-5 transition-colors ${
                    idx < Object.keys(ALERT_META).length - 1 ? 'border-b-2 border-black' : ''
                  } ${isActive ? 'bg-[#F5C518]' : 'bg-white hover:bg-[#F5F5F5]'}`}
                >
                  <div>
                    <p className="font-mono font-bold text-sm text-black">{meta.label}</p>
                    <p className="font-mono text-xs text-gray-600 mt-0.5">{meta.desc}</p>
                    {configured?.threshold != null && (
                      <p className="font-mono text-xs text-gray-500 mt-1">
                        Threshold: {configured.threshold}
                      </p>
                    )}
                  </div>
                  <span
                    className={`font-mono text-xs font-bold px-3 py-1.5 border-2 border-black ${
                      isActive ? 'bg-black text-[#F5C518]' : 'bg-white text-black'
                    }`}
                  >
                    {isActive ? 'ON' : 'OFF'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
