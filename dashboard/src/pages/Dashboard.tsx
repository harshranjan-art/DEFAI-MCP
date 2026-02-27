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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        {smartAccount && (
          <a
            href={`https://testnet.bscscan.com/address/${smartAccount}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 text-sm hover:underline"
          >
            {smartAccount.slice(0, 6)}...{smartAccount.slice(-4)}
          </a>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          title="Total Value"
          value={`$${portfolioQ.data?.totalValueUsd?.toFixed(2) || '0.00'}`}
        />
        <Card
          title="Yield Earned"
          value={`$${portfolioQ.data?.yieldEarned?.toFixed(2) || '0.00'}`}
        />
        <Card
          title="Arb Profits"
          value={`$${portfolioQ.data?.arbProfits?.toFixed(2) || '0.00'}`}
        />
        <Card
          title="Positions"
          value={String(portfolioQ.data?.positions?.length || 0)}
        />
      </div>

      {/* APY Chart */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Top Yield Rates</h2>
        {yieldsQ.data?.yields && yieldsQ.data.yields.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={yieldsQ.data.yields.slice(0, 10).map((y: any, i: number) => ({
              name: y.protocol || `#${i+1}`,
              apy: y.apy,
            }))}>
              <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8, color: '#fff' }}
              />
              <Line type="monotone" dataKey="apy" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500">Loading yield data...</p>
        )}
      </div>

      {/* Active Arb Session */}
      {arbQ.data?.session && (
        <div className={`rounded-xl p-6 border ${
          arbQ.data.session.status === 'active'
            ? 'bg-green-900/20 border-green-700/50'
            : 'bg-gray-900 border-gray-800'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Arbitrage Bot</h2>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${
              arbQ.data.session.status === 'active'
                ? 'bg-green-700/40 text-green-300'
                : 'bg-gray-700 text-gray-400'
            }`}>
              {arbQ.data.session.status.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-400">PnL</p>
              <p className={`font-semibold ${arbQ.data.session.total_pnl_usd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${arbQ.data.session.total_pnl_usd.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-gray-400">Trades</p>
              <p className="text-white font-semibold">{arbQ.data.session.trades_count}</p>
            </div>
            <div>
              <p className="text-gray-400">Max Loss</p>
              <p className="text-white font-semibold">${arbQ.data.session.max_loss_usd}</p>
            </div>
            <div>
              <p className="text-gray-400">Expires</p>
              <p className="text-white font-semibold text-xs">{new Date(arbQ.data.session.expires_at).toLocaleTimeString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="bg-gray-900 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Trades</h2>
          <Link to="/trades" className="text-blue-400 text-sm hover:underline">View all</Link>
        </div>
        {tradesQ.data?.trades && tradesQ.data.trades.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">Type</th>
                <th className="text-left py-2">From</th>
                <th className="text-left py-2">To</th>
                <th className="text-left py-2">Protocol</th>
                <th className="text-left py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {tradesQ.data.trades.map((t: any) => (
                <tr key={t.id} className="border-b border-gray-800 text-gray-300">
                  <td className="py-2">{t.type}</td>
                  <td className="py-2">{t.from_amount} {t.from_token}</td>
                  <td className="py-2">{t.to_amount} {t.to_token}</td>
                  <td className="py-2">{t.protocol}</td>
                  <td className="py-2 text-gray-500">{t.executed_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500">No trades yet.</p>
        )}
      </div>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-gray-400 text-sm">{title}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}
