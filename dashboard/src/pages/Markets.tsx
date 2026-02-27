import { useQuery } from '@tanstack/react-query';
import { markets } from '../api/client';

export default function Markets() {
  const yieldsQ = useQuery({ queryKey: ['yields'], queryFn: markets.yields, refetchInterval: 30000 });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: () => markets.prices(), refetchInterval: 30000 });
  const fundingQ = useQuery({ queryKey: ['funding'], queryFn: markets.funding, refetchInterval: 60000 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Markets</h1>

      {/* Yield Table */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Yield Rates</h2>
        {yieldsQ.data?.yields ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">Protocol</th>
                <th className="text-left py-2">Pool</th>
                <th className="text-left py-2">Token</th>
                <th className="text-left py-2">APY</th>
                <th className="text-left py-2">TVL</th>
                <th className="text-left py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {yieldsQ.data.yields.slice(0, 20).map((y: any, i: number) => (
                <tr key={i} className="border-b border-gray-800 text-gray-300">
                  <td className="py-2">{y.protocol}</td>
                  <td className="py-2">{y.pool || '—'}</td>
                  <td className="py-2">{y.token}</td>
                  <td className="py-2 font-medium text-green-400">{y.apy?.toFixed(2)}%</td>
                  <td className="py-2">{y.tvl ? `$${(y.tvl / 1e6).toFixed(1)}M` : '—'}</td>
                  <td className="py-2">
                    {y.isSimulated ? (
                      <span className="text-yellow-500 text-xs">simulated</span>
                    ) : (
                      <span className="text-green-500 text-xs">live</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500">Loading...</p>
        )}
      </div>

      {/* Prices Table */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">DEX Prices</h2>
        {pricesQ.data?.quotes && pricesQ.data.quotes.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">DEX</th>
                <th className="text-left py-2">Pair</th>
                <th className="text-left py-2">Price</th>
                <th className="text-left py-2">Impact</th>
              </tr>
            </thead>
            <tbody>
              {pricesQ.data.quotes.map((q: any, i: number) => (
                <tr key={i} className="border-b border-gray-800 text-gray-300">
                  <td className="py-2">{q.dex}</td>
                  <td className="py-2">{q.fromToken}/{q.toToken}</td>
                  <td className="py-2">${q.effectivePrice?.toFixed(4)}</td>
                  <td className="py-2">{q.priceImpact?.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500">Loading prices...</p>
        )}
      </div>

      {/* Funding Rates */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Funding Rates (Binance)</h2>
        {fundingQ.data?.rates ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(fundingQ.data.rates).map(([symbol, rates]: [string, any]) => (
              <div key={symbol} className="bg-gray-800 rounded-lg p-4">
                <p className="font-medium text-white">{symbol}</p>
                {rates[0] && (
                  <p className={`text-lg font-bold mt-1 ${
                    rates[0].fundingRate > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {rates[0].fundingRate?.toFixed(4)}%
                  </p>
                )}
                <p className="text-gray-500 text-xs mt-1">
                  {rates[0]?.fundingTime ? new Date(rates[0].fundingTime).toLocaleString() : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">Loading...</p>
        )}
      </div>
    </div>
  );
}
