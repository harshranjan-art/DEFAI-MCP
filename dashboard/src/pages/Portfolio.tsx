import { useQuery } from '@tanstack/react-query';
import { portfolio } from '../api/client';

const TYPE_COLORS: Record<string, string> = {
  yield:         'bg-blue-900 text-blue-300',
  delta_neutral: 'bg-purple-900 text-purple-300',
  lp:            'bg-yellow-900 text-yellow-300',
  spot:          'bg-green-900 text-green-300',
};

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type] || 'bg-gray-800 text-gray-300';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {type?.replace('_', ' ') || '—'}
    </span>
  );
}

function Stat({ title, value, sub, color }: { title: string; value: string; sub?: string; color?: 'green' | 'red' }) {
  const valueClass = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-gray-400 text-sm">{title}</p>
      <p className={`text-xl font-bold mt-1 ${valueClass}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function Portfolio() {
  const { data, isLoading } = useQuery({ queryKey: ['portfolio'], queryFn: portfolio.get });

  const smartAccount =
    data?.smartAccountAddress || localStorage.getItem('defai_smartAccount');

  const openPositions = (data?.positions || []).filter((p: any) => p.status === 'open');
  const totalPnl = openPositions.reduce((sum: number, p: any) => sum + (p.pnl_usd || 0), 0);

  if (isLoading) return <p className="text-gray-400">Loading portfolio...</p>;

  return (
    <div className="space-y-6">
      {/* Header with smart account link */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        {smartAccount && (
          <a
            href={`https://testnet.bscscan.com/address/${smartAccount}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 font-mono transition"
          >
            {smartAccount.slice(0, 8)}...{smartAccount.slice(-6)} ↗
          </a>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          title="Total Value"
          value={`$${(data?.totalValueUsd || 0).toFixed(2)}`}
          sub={`${openPositions.length} open position${openPositions.length !== 1 ? 's' : ''}`}
        />
        <Stat
          title="Yield Earned"
          value={`$${(data?.yieldEarned || 0).toFixed(4)}`}
          color="green"
        />
        <Stat
          title="Arb Profits"
          value={`$${(data?.arbProfits || 0).toFixed(4)}`}
          color="green"
        />
        <Stat
          title="Unrealised PnL"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(4)}`}
          color={totalPnl >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Positions table */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Open Positions ({openPositions.length})
        </h2>

        {openPositions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800 text-left">
                  <th className="py-2 pr-4 font-medium">ID</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Token</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Protocol</th>
                  <th className="py-2 pr-4 font-medium">Entry APY</th>
                  <th className="py-2 pr-4 font-medium text-right">Value (USD)</th>
                  <th className="py-2 pr-4 font-medium text-right">PnL</th>
                  <th className="py-2 font-medium">Opened</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p: any) => {
                  const pnl = p.pnl_usd || 0;
                  const pnlPositive = pnl >= 0;
                  return (
                    <tr key={p.id} className="border-b border-gray-800 text-gray-300 hover:bg-gray-800/30 transition">
                      {/* ID + optional tx link */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-xs text-gray-500">{p.id}</span>
                          {p.tx_hash && !p.tx_hash.startsWith('0xsim_') && (
                            <a
                              href={`https://testnet.bscscan.com/tx/${p.tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-500 hover:text-blue-400 text-xs"
                            >
                              ↗
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Type badge */}
                      <td className="py-3 pr-4">
                        <TypeBadge type={p.type} />
                      </td>

                      {/* Token */}
                      <td className="py-3 pr-4 font-medium text-white">{p.token}</td>

                      {/* Amount */}
                      <td className="py-3 pr-4">{p.amount}</td>

                      {/* Protocol + simulated tag */}
                      <td className="py-3 pr-4">
                        {p.protocol}
                        {p.metadata?.isSimulated && (
                          <span className="ml-1 text-xs text-yellow-500">[sim]</span>
                        )}
                      </td>

                      {/* Entry APY */}
                      <td className="py-3 pr-4">
                        {p.entry_apy != null ? `${p.entry_apy.toFixed(2)}%` : '—'}
                      </td>

                      {/* Current value */}
                      <td className="py-3 pr-4 text-right">
                        {p.current_value_usd != null ? `$${p.current_value_usd.toFixed(2)}` : '—'}
                      </td>

                      {/* PnL per position */}
                      <td className={`py-3 pr-4 text-right font-medium ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {pnlPositive ? '+' : ''}${pnl.toFixed(4)}
                      </td>

                      {/* Opened date */}
                      <td className="py-3 text-gray-500 text-xs">
                        {p.opened_at ? new Date(p.opened_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">No active positions. Use MCP or Telegram to deposit.</p>
        )}
      </div>
    </div>
  );
}
