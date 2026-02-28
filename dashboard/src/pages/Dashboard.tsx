import { useQuery } from '@tanstack/react-query';
import { portfolio, trades, markets, arb } from '../api/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const portfolioQ = useQuery({ queryKey: ['portfolio'], queryFn: portfolio.get });
  const tradesQ = useQuery({ queryKey: ['trades'], queryFn: () => trades.get(5) });
  const yieldsQ = useQuery({ queryKey: ['yields'], queryFn: markets.yields, refetchInterval: 30000 });
  const arbQ = useQuery({ queryKey: ['arb'], queryFn: arb.session, refetchInterval: 15000 });

  const smartAccount = localStorage.getItem('defai_smartAccount') || '';

  return (
    <div className="p-8 space-y-6 bg-white min-h-screen">
      {/* Page header */}
      <div className="flex items-center justify-between border-b-2 border-black pb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Dashboard</h1>
        {smartAccount && (
          <a
            href={`https://testnet.bscscan.com/address/${smartAccount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs font-bold bg-black text-[#F5C518] px-4 py-2 hover:bg-[#F5C518] hover:text-black transition-all border-2 border-black"
          >
            {smartAccount.slice(0, 6)}...{smartAccount.slice(-4)} ↗
          </a>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Value" value={`$${portfolioQ.data?.totalValueUsd?.toFixed(2) || '0.00'}`} />
        <StatCard title="Yield Earned" value={`$${portfolioQ.data?.yieldEarned?.toFixed(2) || '0.00'}`} />
        <StatCard title="Arb Profits" value={`$${portfolioQ.data?.arbProfits?.toFixed(2) || '0.00'}`} />
        <StatCard title="Positions" value={String(portfolioQ.data?.positions?.length || 0)} accent />
      </div>

      {/* APY Chart */}
      <div className="border-2 border-black bg-white p-6">
        <h2 className="font-display text-xl tracking-wide uppercase mb-4">Top Yield Rates</h2>
        {yieldsQ.data?.yields && yieldsQ.data.yields.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={yieldsQ.data.yields.slice(0, 10).map((y: any, i: number) => ({
              name: y.protocol || `#${i + 1}`,
              apy: y.apy,
            }))}>
              <XAxis dataKey="name" stroke="#000" fontSize={11} tick={{ fontFamily: 'Space Mono' }} />
              <YAxis stroke="#000" fontSize={11} tick={{ fontFamily: 'Space Mono' }} />
              <Tooltip
                contentStyle={{
                  background: '#000',
                  border: '2px solid #F5C518',
                  borderRadius: 0,
                  color: '#F5C518',
                  fontFamily: 'Space Mono',
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="apy" stroke="#F5C518" strokeWidth={3} dot={{ r: 5, fill: '#000', stroke: '#F5C518', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="font-mono text-sm text-gray-500">Loading yield data...</p>
        )}
      </div>

      {/* Active Arb Session */}
      {arbQ.data?.session && (
        <div className={`border-2 border-black p-6 ${
          arbQ.data.session.status === 'active' ? 'bg-[#F5C518]' : 'bg-white'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl tracking-wide uppercase">Arbitrage Bot</h2>
            <span className={`font-mono text-xs font-bold px-3 py-1 border-2 ${
              arbQ.data.session.status === 'active'
                ? 'border-black bg-black text-[#F5C518]'
                : 'border-black bg-white text-black'
            }`}>
              {arbQ.data.session.status.toUpperCase()}
            </span>
          </div>

          <p className="font-mono text-xs text-black/60 mb-4 border-l-4 border-black pl-3">
            Prices from DexScreener (BSC mainnet) + CoinGecko — real market data.
            PancakeSwap trades execute on-chain (BSC Testnet).
            Thena &amp; BiSwap execution is simulated.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'PNL', value: `$${arbQ.data.session.total_pnl_usd.toFixed(4)}`, highlight: arbQ.data.session.total_pnl_usd >= 0 },
              { label: 'TRADES', value: String(arbQ.data.session.trades_count) },
              { label: 'MAX LOSS', value: `$${arbQ.data.session.max_loss_usd}` },
              { label: 'EXPIRES', value: new Date(arbQ.data.session.expires_at).toLocaleTimeString() },
            ].map((item) => (
              <div key={item.label} className="border-2 border-black bg-white p-3">
                <p className="font-mono text-xs text-gray-500 uppercase">{item.label}</p>
                <p className="font-mono font-bold text-sm mt-1 text-black">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="border-2 border-black bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl tracking-wide uppercase">Recent Trades</h2>
          <Link
            to="/trades"
            className="font-mono text-xs font-bold border-2 border-black px-3 py-1.5 hover:bg-[#F5C518] transition-all"
          >
            VIEW ALL →
          </Link>
        </div>
        {tradesQ.data?.trades && tradesQ.data.trades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-2 border-black">
              <thead>
                <tr className="bg-black text-[#F5C518] font-mono text-xs">
                  <th className="text-left px-4 py-3 font-bold">TYPE</th>
                  <th className="text-left px-4 py-3 font-bold">FROM</th>
                  <th className="text-left px-4 py-3 font-bold">TO</th>
                  <th className="text-left px-4 py-3 font-bold">PROTOCOL</th>
                  <th className="text-left px-4 py-3 font-bold">TIME</th>
                </tr>
              </thead>
              <tbody>
                {tradesQ.data.trades.map((t: any, i: number) => (
                  <tr key={t.id} className={`font-mono text-xs border-b border-black ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}>
                    <td className="px-4 py-3">
                      <span className={`font-bold px-2 py-0.5 border ${
                        t.type === 'buy'
                          ? 'bg-[#F5C518] text-black border-black'
                          : t.type === 'sell'
                          ? 'bg-black text-[#F5C518] border-black'
                          : 'bg-white text-black border-black'
                      }`}>{t.type?.toUpperCase()}</span>
                    </td>
                    <td className="px-4 py-3">{t.from_amount} {t.from_token}</td>
                    <td className="px-4 py-3">{t.to_amount} {t.to_token}</td>
                    <td className="px-4 py-3">{t.protocol}</td>
                    <td className="px-4 py-3 text-gray-500">{t.executed_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="font-mono text-sm text-gray-500">No trades yet.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, accent }: { title: string; value: string; accent?: boolean }) {
  return (
    <div className={`border-2 border-black p-5 ${accent ? 'bg-[#F5C518]' : 'bg-white'}`}>
      <p className="font-mono text-xs font-bold uppercase text-gray-500">{title}</p>
      <p className="font-display text-3xl mt-1 text-black">{value}</p>
    </div>
  );
}
