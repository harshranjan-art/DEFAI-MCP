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
    <div className="p-8 space-y-6 bg-white min-h-screen">
      {/* Header */}
      <div className="border-b-2 border-black pb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Markets</h1>
      </div>

      {/* Data source disclaimer */}
      <div className="border-l-4 border-[#F5C518] bg-[#F5F5F5] px-5 py-3 font-mono text-xs text-gray-600 leading-relaxed">
        Yield data: <span className="font-bold text-black">Venus</span>, <span className="font-bold text-black">Beefy</span>, <span className="font-bold text-black">DefiLlama</span> — live on-chain APYs.{' '}
        DEX prices: <span className="font-bold text-black">DexScreener</span> (BSC mainnet) + <span className="font-bold text-black">CoinGecko</span>.{' '}
        Funding rates: <span className="font-bold text-black">Binance Futures</span> (mainnet).{' '}
        <span className="bg-black text-[#F5C518] px-1 font-bold">SIM</span> = simulated execution; no testnet contracts for Thena/BiSwap.
      </div>

      {/* Tabs */}
      <div className="flex border-2 border-black w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 font-mono text-xs font-bold transition-all ${
              activeTab === tab
                ? 'bg-[#F5C518] text-black'
                : 'bg-white text-black hover:bg-[#F5F5F5]'
            } ${tab !== TABS[0] ? 'border-l-2 border-black' : ''}`}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Yield Rates */}
      {activeTab === 'Yield Rates' && (
        <div className="border-2 border-black">
          <div className="px-6 py-4 border-b-2 border-black bg-white">
            <h2 className="font-display text-xl tracking-wide uppercase">Yield Rates</h2>
          </div>
          {yieldsQ.isLoading ? (
            <p className="font-mono text-sm text-gray-500 p-6">Loading...</p>
          ) : yieldsQ.data?.yields && yieldsQ.data.yields.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black text-[#F5C518] font-mono text-xs">
                    <th className="text-left px-4 py-3 font-bold">PROTOCOL</th>
                    <th className="text-left px-4 py-3 font-bold">POOL</th>
                    <th className="text-left px-4 py-3 font-bold">TOKEN</th>
                    <th className="text-left px-4 py-3 font-bold">APY</th>
                    <th className="text-left px-4 py-3 font-bold">TVL</th>
                    <th className="text-left px-4 py-3 font-bold">SOURCE</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldsQ.data.yields.slice(0, 30).map((y: any, i: number) => (
                    <tr key={i} className={`border-b border-black font-mono text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}>
                      <td className="px-4 py-3 font-bold">{y.protocol}</td>
                      <td className="px-4 py-3">{y.pool || '—'}</td>
                      <td className="px-4 py-3">{y.token}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold bg-[#F5C518] px-2 py-0.5 border border-black">
                          {y.apy?.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">{y.tvl ? `$${(y.tvl / 1e6).toFixed(1)}M` : '—'}</td>
                      <td className="px-4 py-3">
                        {y.isSimulated ? (
                          <span className="bg-black text-[#F5C518] text-xs font-bold px-2 py-0.5">SIM</span>
                        ) : (
                          <span className="bg-[#F5C518] text-black text-xs font-bold px-2 py-0.5 border border-black">LIVE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-mono text-sm text-gray-500 p-6">No yield data available.</p>
          )}
        </div>
      )}

      {/* DEX Prices */}
      {activeTab === 'DEX Prices' && (
        <div className="border-2 border-black">
          <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between bg-white">
            <h2 className="font-display text-xl tracking-wide uppercase">DEX Prices</h2>
            <span className="font-mono text-xs text-gray-500">Live · DexScreener · BSC mainnet</span>
          </div>
          {pricesQ.isLoading ? (
            <p className="font-mono text-sm text-gray-500 p-6">Loading prices...</p>
          ) : pricesQ.data?.quotes && pricesQ.data.quotes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black text-[#F5C518] font-mono text-xs">
                    <th className="text-left px-4 py-3 font-bold">DEX</th>
                    <th className="text-left px-4 py-3 font-bold">PAIR</th>
                    <th className="text-left px-4 py-3 font-bold">PRICE</th>
                    <th className="text-left px-4 py-3 font-bold">PRICE IMPACT</th>
                  </tr>
                </thead>
                <tbody>
                  {pricesQ.data.quotes.map((q: any, i: number) => (
                    <tr key={i} className={`border-b border-black font-mono text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F5F5]'}`}>
                      <td className="px-4 py-3 font-bold">{q.dex}</td>
                      <td className="px-4 py-3">{q.fromToken}/{q.toToken}</td>
                      <td className="px-4 py-3 font-bold">${q.effectivePrice?.toFixed(4)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold px-2 py-0.5 border ${
                          q.priceImpact > 1
                            ? 'bg-black text-[#F5C518] border-black'
                            : 'bg-white text-black border-black'
                        }`}>
                          {q.priceImpact?.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-mono text-sm text-gray-500 p-6">No price data available.</p>
          )}
        </div>
      )}

      {/* Funding Rates */}
      {activeTab === 'Funding Rates' && (
        <div className="border-2 border-black">
          <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between bg-white">
            <h2 className="font-display text-xl tracking-wide uppercase">Funding Rates</h2>
            <span className="font-mono text-xs text-gray-500">Binance Futures · mainnet</span>
          </div>
          {fundingQ.isLoading ? (
            <p className="font-mono text-sm text-gray-500 p-6">Loading...</p>
          ) : fundingQ.data?.rates ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
              {Object.entries(fundingQ.data.rates).map(([symbol, rates]: [string, any]) => (
                <div key={symbol} className="border-2 border-black p-4 bg-white">
                  <p className="font-mono font-bold text-sm">{symbol}</p>
                  {rates[0] && (
                    <p className={`font-display text-2xl mt-2 ${rates[0].fundingRate > 0 ? 'text-black' : 'text-black'}`}>
                      <span className={`px-2 py-0.5 ${rates[0].fundingRate > 0 ? 'bg-[#F5C518]' : 'bg-black text-[#F5C518]'}`}>
                        {rates[0].fundingRate?.toFixed(4)}%
                      </span>
                    </p>
                  )}
                  <p className="font-mono text-xs text-gray-500 mt-2">
                    {rates[0]?.fundingTime ? new Date(rates[0].fundingTime).toLocaleString() : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-sm text-gray-500 p-6">No funding rate data available.</p>
          )}
        </div>
      )}
    </div>
  );
}
