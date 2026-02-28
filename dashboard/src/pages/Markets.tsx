import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { markets } from '../api/client';

const TABS = ['Yield Rates', 'DEX Prices', 'Funding Rates'] as const;
type Tab = typeof TABS[number];

export default function Markets() {
  const [activeTab, setActiveTab] = useState<Tab>('Yield Rates');

  const yieldsQ = useQuery({ queryKey: ['yields'], queryFn: markets.yields, refetchInterval: 30000 });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: () => markets.prices(), refetchInterval: 30000 });
  const fundingQ = useQuery({ queryKey: ['funding'], queryFn: markets.funding, refetchInterval: 60000 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Markets</h1>
      </div>

      {/* Data source disclaimer */}
      <div className="bg-gray-900 rounded-xl px-5 py-3 text-xs text-gray-500 leading-relaxed">
        Yield data sourced from{' '}
        <span className="text-gray-400 font-medium">Venus</span>,{' '}
        <span className="text-gray-400 font-medium">Beefy</span>, and{' '}
        <span className="text-gray-400 font-medium">DefiLlama</span> — live on-chain APYs.{' '}
        DEX prices scraped live from{' '}
        <span className="text-gray-400 font-medium">DexScreener</span> (BSC mainnet) +{' '}
        <span className="text-gray-400 font-medium">CoinGecko</span> — real market data.{' '}
        Funding rates from{' '}
        <span className="text-gray-400 font-medium">Binance Futures</span> (mainnet).{' '}
        <span className="text-yellow-500">sim</span> = simulated execution; no testnet contracts for Thena/BiSwap.
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Yield Rates */}
      {activeTab === 'Yield Rates' && (
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Yield Rates</h2>
          {yieldsQ.isLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : yieldsQ.data?.yields && yieldsQ.data.yields.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800 text-left">
                    <th className="py-2 pr-4 font-medium">Protocol</th>
                    <th className="py-2 pr-4 font-medium">Pool</th>
                    <th className="py-2 pr-4 font-medium">Token</th>
                    <th className="py-2 pr-4 font-medium">APY</th>
                    <th className="py-2 pr-4 font-medium">TVL</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldsQ.data.yields.slice(0, 30).map((y: any, i: number) => (
                    <tr key={i} className="border-b border-gray-800 text-gray-300 hover:bg-gray-800/30 transition">
                      <td className="py-2 pr-4 font-medium text-white">{y.protocol}</td>
                      <td className="py-2 pr-4">{y.pool || '—'}</td>
                      <td className="py-2 pr-4">{y.token}</td>
                      <td className="py-2 pr-4 font-semibold text-green-400">{y.apy?.toFixed(2)}%</td>
                      <td className="py-2 pr-4">{y.tvl ? `$${(y.tvl / 1e6).toFixed(1)}M` : '—'}</td>
                      <td className="py-2">
                        {y.isSimulated ? (
                          <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-500 text-xs rounded">sim</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-green-900/50 text-green-400 text-xs rounded">live</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500">No yield data available.</p>
          )}
        </div>
      )}

      {/* DEX Prices */}
      {activeTab === 'DEX Prices' && (
        <div className="bg-gray-900 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">DEX Prices</h2>
            <span className="text-xs text-gray-500">Live from DexScreener · BSC mainnet</span>
          </div>
          {pricesQ.isLoading ? (
            <p className="text-gray-500">Loading prices...</p>
          ) : pricesQ.data?.quotes && pricesQ.data.quotes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800 text-left">
                    <th className="py-2 pr-4 font-medium">DEX</th>
                    <th className="py-2 pr-4 font-medium">Pair</th>
                    <th className="py-2 pr-4 font-medium">Price</th>
                    <th className="py-2 font-medium">Price Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {pricesQ.data.quotes.map((q: any, i: number) => (
                    <tr key={i} className="border-b border-gray-800 text-gray-300 hover:bg-gray-800/30 transition">
                      <td className="py-2 pr-4 font-medium text-white">{q.dex}</td>
                      <td className="py-2 pr-4">{q.fromToken}/{q.toToken}</td>
                      <td className="py-2 pr-4 font-mono">${q.effectivePrice?.toFixed(4)}</td>
                      <td className="py-2">
                        <span className={q.priceImpact > 1 ? 'text-red-400' : 'text-gray-300'}>
                          {q.priceImpact?.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500">No price data available.</p>
          )}
        </div>
      )}

      {/* Funding Rates */}
      {activeTab === 'Funding Rates' && (
        <div className="bg-gray-900 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Funding Rates</h2>
            <span className="text-xs text-gray-500">Binance Futures · mainnet</span>
          </div>
          {fundingQ.isLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : fundingQ.data?.rates ? (
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
            <p className="text-gray-500">No funding rate data available.</p>
          )}
        </div>
      )}
    </div>
  );
}
