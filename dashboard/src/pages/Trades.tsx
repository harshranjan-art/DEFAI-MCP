import { useQuery } from '@tanstack/react-query';
import { trades } from '../api/client';

export default function Trades() {
  const { data, isLoading } = useQuery({ queryKey: ['trades'], queryFn: () => trades.get(50) });

  if (isLoading) return <p className="text-gray-400">Loading trades...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Trade History</h1>

      <div className="bg-gray-900 rounded-xl p-6 overflow-x-auto">
        {data?.trades && data.trades.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">Type</th>
                <th className="text-left py-2">From</th>
                <th className="text-left py-2">To</th>
                <th className="text-left py-2">Protocol</th>
                <th className="text-left py-2">Price</th>
                <th className="text-left py-2">Tx</th>
                <th className="text-left py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t: any) => (
                <tr key={t.id} className="border-b border-gray-800 text-gray-300">
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      t.type.includes('buy') ? 'bg-green-900 text-green-300' :
                      t.type.includes('sell') ? 'bg-red-900 text-red-300' :
                      'bg-gray-800 text-gray-300'
                    }`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="py-2">{t.from_amount} {t.from_token}</td>
                  <td className="py-2">{t.to_amount} {t.to_token}</td>
                  <td className="py-2">{t.protocol}</td>
                  <td className="py-2">${t.price_usd?.toFixed(2) || '—'}</td>
                  <td className="py-2">
                    {t.tx_hash && !t.tx_hash.startsWith('0xsim_') ? (
                      <a
                        href={`https://testnet.bscscan.com/tx/${t.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        {t.tx_hash.slice(0, 10)}...
                      </a>
                    ) : (
                      <span className="text-gray-500 text-xs">simulated</span>
                    )}
                  </td>
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
