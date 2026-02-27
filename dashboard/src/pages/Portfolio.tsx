import { useQuery } from '@tanstack/react-query';
import { portfolio } from '../api/client';

export default function Portfolio() {
  const { data, isLoading } = useQuery({ queryKey: ['portfolio'], queryFn: portfolio.get });

  if (isLoading) return <p className="text-gray-400">Loading portfolio...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Portfolio</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Total Value" value={`$${data?.totalValueUsd?.toFixed(2) || '0.00'}`} />
        <Stat title="Yield Earned" value={`$${data?.yieldEarned?.toFixed(2) || '0.00'}`} />
        <Stat title="Arb Profits" value={`$${data?.arbProfits?.toFixed(2) || '0.00'}`} />
      </div>

      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Positions ({data?.positions?.length || 0})
        </h2>

        {data?.positions?.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">ID</th>
                <th className="text-left py-2">Token</th>
                <th className="text-left py-2">Amount</th>
                <th className="text-left py-2">Protocol</th>
                <th className="text-left py-2">APY</th>
                <th className="text-left py-2">Opened</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-800 text-gray-300">
                  <td className="py-2 font-mono text-xs">{p.id}</td>
                  <td className="py-2">{p.token}</td>
                  <td className="py-2">{p.amount}</td>
                  <td className="py-2">
                    {p.protocol}
                    {p.metadata?.isSimulated && (
                      <span className="ml-1 text-xs text-yellow-500">[sim]</span>
                    )}
                  </td>
                  <td className="py-2">{p.entry_apy?.toFixed(2) || '?'}%</td>
                  <td className="py-2 text-gray-500">{p.opened_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500">No active positions. Use MCP or Telegram to deposit.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-gray-400 text-sm">{title}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}
