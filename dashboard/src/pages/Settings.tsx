import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { alerts } from '../api/client';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 px-3 py-1 text-xs font-mono font-bold border-2 border-black bg-white hover:bg-[#F5C518] transition-all"
    >
      {copied ? 'COPIED!' : 'COPY'}
    </button>
  );
}

export default function Settings() {
  const alertsQ = useQuery({ queryKey: ['alerts'], queryFn: alerts.get });
  const smartAccount = localStorage.getItem('defai_smartAccount') || '';
  const userId = localStorage.getItem('defai_userId') || '';

  return (
    <div className="p-8 space-y-6 bg-white min-h-screen">
      {/* Header */}
      <div className="border-b-2 border-black pb-6">
        <h1 className="font-display text-4xl tracking-wide uppercase">Settings</h1>
      </div>

      {/* Account Info */}
      <div className="border-2 border-black">
        <div className="px-6 py-4 border-b-2 border-black bg-[#F5C518]">
          <h2 className="font-display text-xl tracking-wide uppercase">Account</h2>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <p className="font-mono text-xs font-bold uppercase text-gray-500 mb-2">User ID</p>
            <div className="flex items-center border-2 border-black bg-[#F5F5F5] px-3 py-2">
              <code className="font-mono text-sm text-black break-all flex-1">{userId || 'Not set'}</code>
              {userId && <CopyButton text={userId} />}
            </div>
          </div>

          <div>
            <p className="font-mono text-xs font-bold uppercase text-gray-500 mb-2">Smart Account</p>
            <div className="flex items-center border-2 border-black bg-[#F5F5F5] px-3 py-2">
              {smartAccount ? (
                <a
                  href={`https://testnet.bscscan.com/address/${smartAccount}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-black break-all flex-1 underline underline-offset-2 decoration-[#F5C518]"
                >
                  {smartAccount}
                </a>
              ) : (
                <span className="font-mono text-sm text-gray-500">Not set</span>
              )}
            </div>
          </div>

          <div>
            <p className="font-mono text-xs font-bold uppercase text-gray-500 mb-2">Chain</p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 bg-black text-[#F5C518] font-mono text-xs font-bold px-4 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F5C518]"></span>
                BSC TESTNET · ID: 97
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Settings */}
      <div className="border-2 border-black">
        <div className="px-6 py-4 border-b-2 border-black bg-white">
          <h2 className="font-display text-xl tracking-wide uppercase">Alert Settings</h2>
          <p className="font-mono text-xs text-gray-500 mt-1">
            Configure via MCP <span className="bg-black text-[#F5C518] px-1 font-bold text-xs">set_alerts</span> or Telegram.
            Alerts are delivered via Telegram if linked.
          </p>
        </div>

        {alertsQ.data?.alerts && alertsQ.data.alerts.length > 0 ? (
          <div className="divide-y-2 divide-black">
            {alertsQ.data.alerts.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <span className="font-mono font-bold text-sm text-black">{a.type?.toUpperCase().replace('_', ' ')}</span>
                  {a.threshold && (
                    <span className="font-mono text-xs text-gray-500 ml-3">threshold: {a.threshold}</span>
                  )}
                </div>
                <span className={`font-mono text-xs font-bold px-3 py-1.5 border-2 border-black ${
                  a.active ? 'bg-[#F5C518] text-black' : 'bg-white text-black'
                }`}>
                  {a.active ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <p className="font-mono text-sm text-gray-500">No alerts configured.</p>
          </div>
        )}
      </div>

      {/* Link Telegram */}
      <div className="border-2 border-black">
        <div className="px-6 py-4 border-b-2 border-black bg-white">
          <h2 className="font-display text-xl tracking-wide uppercase">Link Telegram</h2>
        </div>
        <div className="p-6">
          <p className="font-mono text-sm text-gray-600 mb-4">
            To receive alerts via Telegram, open the DeFAI bot and send:
          </p>
          <div className="border-2 border-black bg-[#F5C518] px-5 py-4 flex items-center justify-between">
            <code className="font-mono text-sm font-bold text-black">/link {userId}</code>
            {userId && <CopyButton text={`/link ${userId}`} />}
          </div>
          <p className="font-mono text-xs text-gray-500 mt-3">
            After linking, all active alerts will be delivered to your Telegram account.
          </p>
        </div>
      </div>
    </div>
  );
}
