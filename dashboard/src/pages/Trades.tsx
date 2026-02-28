import { useQuery } from '@tanstack/react-query';
import { trades } from '../api/client';

export default function Trades() {
  const { data, isLoading } = useQuery({ queryKey: ['trades'], queryFn: () => trades.get(50) });

  if (isLoading) return (
    <div className="p-8">
      <p className="font-mono text-sm text-gray-500">Loading trades...</p>
    </div>
  );

  return (
    <div className="p-8 space-y-6 bg-white min-h-screen">
      {/* Header */}
      <div className="border-b-2 border-black pb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Trade History</h1>
        <p className="font-mono text-xs text-gray-500 mt-1">Last 50 trades · BSC Testnet</p>
      </div>

      {/* Table */}
      <div className="border-2 border-black bg-white">
        {data?.trades && data.trades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-black text-[#F5C518] font-mono text-xs">
                  <th className="text-left px-4 py-3 font-bold">TYPE</th>
                  <th className="text-left px-4 py-3 font-bold">FROM</th>
                  <th className="text-left px-4 py-3 font-bold">TO</th>
                  <th className="text-left px-4 py-3 font-bold">PROTOCOL</th>
                  <th className="text-left px-4 py-3 font-bold">PRICE</th>
                  <th className="text-left px-4 py-3 font-bold">TX</th>
                  <th className="text-left px-4 py-3 font-bold">TIME</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t: any, i: number) => (
                  <tr key={t.id} className={`border-b border-black font-mono text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}>
                    <td className="px-4 py-3">
                      <span className={`font-bold px-2 py-0.5 border-2 border-black ${
                        t.type?.includes('buy')
                          ? 'bg-[#F5C518] text-black'
                          : t.type?.includes('sell')
                          ? 'bg-black text-[#F5C518]'
                          : 'bg-white text-black'
                      }`}>
                        {t.type?.toUpperCase() || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{t.from_amount} {t.from_token}</td>
                    <td className="px-4 py-3">{t.to_amount} {t.to_token}</td>
                    <td className="px-4 py-3">{t.protocol}</td>
                    <td className="px-4 py-3 font-bold">${t.price_usd?.toFixed(2) || '—'}</td>
                    <td className="px-4 py-3">
                      {t.tx_hash && !t.tx_hash.startsWith('0xsim_') ? (
                        <a
                          href={`https://testnet.bscscan.com/tx/${t.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2 decoration-[#F5C518] hover:text-[#F5C518] transition-colors"
                        >
                          {t.tx_hash.slice(0, 10)}...
                        </a>
                      ) : (
                        <span className="bg-black text-[#F5C518] px-1.5 py-0.5 text-xs font-bold">SIM</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{t.executed_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="font-mono text-sm text-gray-500">No trades yet.</p>
            <p className="font-mono text-xs text-gray-400 mt-1">Execute trades via MCP tools or Telegram.</p>
          </div>
        )}
      </div>
    </div>
  );
}
