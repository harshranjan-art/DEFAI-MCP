import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alerts } from '../api/client';

const ALERT_META: Record<string, { label: string; desc: string; badgeCls: string }> = {
  apy_drop: {
    label: 'APY Drop',
    desc: 'Fires when yield on a position drops below your threshold',
    badgeCls: 'bg-orange-900 text-orange-300',
  },
  arb_opportunity: {
    label: 'Arb Opportunity',
    desc: 'Fires when a cross-DEX spread exceeds your threshold',
    badgeCls: 'bg-blue-900 text-blue-300',
  },
  position_health: {
    label: 'Position Health',
    desc: 'Fires when a delta-neutral position needs attention',
    badgeCls: 'bg-red-900 text-red-300',
  },
};

function AlertTypeBadge({ type }: { type: string }) {
  const meta = ALERT_META[type];
  const cls = meta?.badgeCls || 'bg-gray-800 text-gray-300';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {meta?.label || type}
    </span>
  );
}

export default function Alerts() {
  const queryClient = useQueryClient();

  const configQ = useQuery({ queryKey: ['alerts'], queryFn: alerts.get });
  const notifQ = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: alerts.unread,
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => alerts.markRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts-unread'] }),
  });

  const unreadNotifs: any[] = notifQ.data?.notifications || [];
  const alertConfigs: any[] = configQ.data?.alerts || [];

  const markAllRead = () => {
    const ids = unreadNotifs.map((n) => n.id).filter(Boolean);
    if (ids.length > 0) markReadMutation.mutate(ids);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Alerts</h1>

      {/* ── Unread Notifications ─────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            Notifications
            {unreadNotifs.length > 0 && (
              <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                {unreadNotifs.length} unread
              </span>
            )}
          </h2>
          {unreadNotifs.length > 0 && (
            <button
              onClick={markAllRead}
              disabled={markReadMutation.isPending}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition"
            >
              Mark all read
            </button>
          )}
        </div>

        {notifQ.isLoading ? (
          <p className="text-gray-400 text-sm">Loading notifications...</p>
        ) : unreadNotifs.length > 0 ? (
          <div className="space-y-2">
            {unreadNotifs.map((n: any, i: number) => (
              <div
                key={n.id || i}
                className="flex items-start justify-between gap-4 p-3 bg-gray-800 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTypeBadge type={n.type} />
                    {n.created_at && (
                      <span className="text-xs text-gray-500">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm">{n.message}</p>
                </div>
                {n.id && (
                  <button
                    onClick={() => markReadMutation.mutate([n.id])}
                    className="text-xs text-gray-500 hover:text-white transition shrink-0"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No unread notifications. Watchers check every 2–5 min.</p>
        )}
      </div>

      {/* ── Alert Configuration ───────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Alert Configuration</h2>
        <p className="text-gray-500 text-sm mb-4">
          Toggle alerts via MCP{' '}
          <code className="bg-gray-800 px-1 py-0.5 rounded text-xs">set_alerts</code> tool or
          Telegram.
        </p>

        {configQ.isLoading ? (
          <p className="text-gray-400 text-sm">Loading configuration...</p>
        ) : (
          <div className="space-y-2">
            {/* Always show all three types; overlay real config on top */}
            {Object.entries(ALERT_META).map(([type, meta]) => {
              const configured = alertConfigs.find((a: any) => a.type === type);
              const isActive = configured?.active ?? false;
              return (
                <div
                  key={type}
                  className="flex items-center justify-between p-4 bg-gray-800 rounded-lg"
                >
                  <div>
                    <p className="text-white text-sm font-medium">{meta.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{meta.desc}</p>
                    {configured?.threshold != null && (
                      <p className="text-gray-400 text-xs mt-1">
                        Threshold: {configured.threshold}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      isActive
                        ? 'bg-green-900 text-green-300'
                        : 'bg-gray-700 text-gray-400'
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
