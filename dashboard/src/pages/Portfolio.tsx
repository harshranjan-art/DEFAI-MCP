import { useQuery } from '@tanstack/react-query';
import { portfolio } from '../api/client';

const TYPE_BADGE: Record<string, string> = {
  yield:         'bg-[#F5C518] text-black border-black',
  delta_neutral: 'bg-black text-[#F5C518] border-black',
  lp:            'bg-white text-black border-black',
  spot:          'bg-black text-white border-black',
};

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_BADGE[type] || 'bg-white text-black border-black';
  return (
    <span className={`px-2 py-0.5 text-xs font-mono font-bold border-2 ${cls}`}>
      {type?.replace('_', ' ').toUpperCase() || '—'}
    </span>
  );
}

function StatCard({ title, value, sub, pnl }: { title: string; value: string; sub?: string; pnl?: boolean }) {
  return (
    <div className="border-2 border-black bg-white p-5">
      <p className="font-mono text-xs font-bold uppercase text-gray-500">{title}</p>
      <p className={`font-display text-3xl mt-1 ${pnl !== undefined ? (pnl ? 'text-black' : 'text-black') : 'text-black'}`}>
        {value}
      </p>
      {sub && <p className="font-mono text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function Portfolio() {
  const { data, isLoading } = useQuery({ queryKey: ['portfolio'], queryFn: portfolio.get });

  const smartAccount = data?.smartAccountAddress || localStorage.getItem('defai_smartAccount');
  const openPositions = (data?.positions || []).filter((p: any) => p.status === 'open');
  const totalPnl = openPositions.reduce((sum: number, p: any) => sum + (p.pnl_usd || 0), 0);

  if (isLoading) return (
    <div className="p-8">
      <p className="font-mono text-sm text-gray-500">Loading portfolio...</p>
    </div>
  );

  return (
    <div className="p-8 space-y-6 bg-white min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-black pb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Portfolio</h1>
        {smartAccount && (
          <a
            href={`https://testnet.bscscan.com/address/${smartAccount}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs font-bold bg-black text-[#F5C518] px-4 py-2 hover:bg-[#F5C518] hover:text-black transition-all border-2 border-black"
          >
            {smartAccount.slice(0, 8)}...{smartAccount.slice(-6)} ↗
          </a>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Value"
          value={`$${(data?.totalValueUsd || 0).toFixed(2)}`}
          sub={`${openPositions.length} open position${openPositions.length !== 1 ? 's' : ''}`}
        />
        <StatCard title="Yield Earned" value={`$${(data?.yieldEarned || 0).toFixed(4)}`} />
        <StatCard title="Arb Profits" value={`$${(data?.arbProfits || 0).toFixed(4)}`} />
        <div className={`border-2 border-black p-5 ${totalPnl >= 0 ? 'bg-[#F5C518]' : 'bg-black'}`}>
          <p className={`font-mono text-xs font-bold uppercase ${totalPnl >= 0 ? 'text-black/60' : 'text-white/60'}`}>Unrealised PnL</p>
          <p className={`font-display text-3xl mt-1 ${totalPnl >= 0 ? 'text-black' : 'text-[#F5C518]'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Positions table */}
      <div className="border-2 border-black bg-white">
        <div className="px-6 py-4 border-b-2 border-black">
          <h2 className="font-display text-xl tracking-wide uppercase">
            Open Positions ({openPositions.length})
          </h2>
        </div>

        {openPositions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-black text-[#F5C518] font-mono text-xs">
                  <th className="text-left px-4 py-3 font-bold">ID</th>
                  <th className="text-left px-4 py-3 font-bold">TYPE</th>
                  <th className="text-left px-4 py-3 font-bold">TOKEN</th>
                  <th className="text-left px-4 py-3 font-bold">AMOUNT</th>
                  <th className="text-left px-4 py-3 font-bold">PROTOCOL</th>
                  <th className="text-left px-4 py-3 font-bold">ENTRY APY</th>
                  <th className="text-right px-4 py-3 font-bold">VALUE (USD)</th>
                  <th className="text-right px-4 py-3 font-bold">PNL</th>
                  <th className="text-left px-4 py-3 font-bold">OPENED</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p: any, i: number) => {
                  const pnl = p.pnl_usd || 0;
                  const pnlPositive = pnl >= 0;
                  return (
                    <tr key={p.id} className={`border-b border-black font-mono text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500">{p.id}</span>
                          {p.tx_hash && !p.tx_hash.startsWith('0xsim_') && (
                            <a
                              href={`https://testnet.bscscan.com/tx/${p.tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-black underline decoration-[#F5C518] text-xs"
                            >
                              ↗
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={p.type} /></td>
                      <td className="px-4 py-3 font-bold">{p.token}</td>
                      <td className="px-4 py-3">{p.amount}</td>
                      <td className="px-4 py-3">
                        {p.protocol}
                        {p.metadata?.isSimulated && (
                          <span className="ml-1 text-[#F5C518] bg-black px-1 text-xs font-bold">SIM</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{p.entry_apy != null ? `${p.entry_apy.toFixed(2)}%` : '—'}</td>
                      <td className="px-4 py-3 text-right">{p.current_value_usd != null ? `$${p.current_value_usd.toFixed(2)}` : '—'}</td>
                      <td className={`px-4 py-3 text-right font-bold ${pnlPositive ? 'text-black' : 'text-black'}`}>
                        <span className={`px-2 py-0.5 border-2 border-black ${pnlPositive ? 'bg-[#F5C518]' : 'bg-black text-[#F5C518]'}`}>
                          {pnlPositive ? '+' : ''}${pnl.toFixed(4)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{p.opened_at ? new Date(p.opened_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="font-mono text-sm text-gray-500">No active positions.</p>
            <p className="font-mono text-xs text-gray-400 mt-1">Use MCP or Telegram to deposit.</p>
          </div>
        )}
      </div>
    </div>
  );
}
