import { useQuery } from '@tanstack/react-query';
import { arb } from '../api/client';
import { Link } from 'react-router-dom';

export default function ArbExecutions() {
  const execQ = useQuery({
    queryKey: ['arb-executions'],
    queryFn: () => arb.executions(100),
    refetchInterval: 30_000,
  });

  const executions: any[] = Array.isArray(execQ.data?.executions) ? execQ.data.executions : [];

  return (
    <div className="p-8 bg-white min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-black pb-6 mb-6">
        <div>
          <h1 className="font-display text-4xl tracking-wide uppercase">Arb Executions</h1>
          <p className="font-mono text-xs text-gray-500 mt-1">
            {execQ.isLoading ? 'Loading...' : `${executions.length} trade${executions.length !== 1 ? 's' : ''}`} — auto-refreshes every 30s
          </p>
        </div>
        <Link
          to="/"
          className="font-mono text-xs font-bold border-2 border-black px-3 py-1.5 hover:bg-[#F5C518] transition-all"
        >
          ← DASHBOARD
        </Link>
      </div>

      {/* Executions Table */}
      <div className="border-2 border-black">
        {execQ.isLoading ? (
          <p className="font-mono text-sm text-gray-500 p-6">Loading executions...</p>
        ) : execQ.isError ? (
          <p className="font-mono text-sm text-gray-500 p-6">Failed to load executions.</p>
        ) : executions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-2 border-black">
              <thead>
                <tr className="bg-black text-[#F5C518] font-mono text-xs">
                  <th className="text-left px-4 py-3 font-bold">LEG</th>
                  <th className="text-left px-4 py-3 font-bold">PROTOCOL</th>
                  <th className="text-left px-4 py-3 font-bold">FROM</th>
                  <th className="text-left px-4 py-3 font-bold">TO</th>
                  <th className="text-right px-4 py-3 font-bold">PRICE (USD)</th>
                  <th className="text-left px-4 py-3 font-bold">TIME</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((t: any, i: number) => {
                  const isBuy = t.type === 'arb_buy';
                  return (
                    <tr
                      key={t.id ?? i}
                      className={`font-mono text-xs border-b border-black ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}
                    >
                      <td className="px-4 py-3">
                        <span className={`font-bold px-2 py-0.5 border border-black ${
                          isBuy ? 'bg-[#F5C518] text-black' : 'bg-black text-[#F5C518]'
                        }`}>
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">{t.protocol}</td>
                      <td className="px-4 py-3">{t.from_amount} {t.from_token}</td>
                      <td className="px-4 py-3">{t.to_amount} {t.to_token}</td>
                      <td className="px-4 py-3 text-right">${parseFloat(t.price_usd).toFixed(4)}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {t.executed_at ? new Date(t.executed_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-mono text-sm text-gray-500">No arb executions yet.</p>
            <p className="font-mono text-xs text-gray-400 mt-1">Start an arb session via Telegram to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
