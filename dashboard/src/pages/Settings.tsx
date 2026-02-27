import { useQuery } from '@tanstack/react-query';
import { alerts } from '../api/client';

export default function Settings() {
  const alertsQ = useQuery({ queryKey: ['alerts'], queryFn: alerts.get });
  const smartAccount = localStorage.getItem('defai_smartAccount') || '';
  const userId = localStorage.getItem('defai_userId') || '';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Account Info */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-gray-400">User ID: </span>
            <code className="text-gray-200 bg-gray-800 px-2 py-0.5 rounded">{userId}</code>
          </div>
          <div>
            <span className="text-gray-400">Smart Account: </span>
            {smartAccount ? (
              <a
                href={`https://testnet.bscscan.com/address/${smartAccount}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                {smartAccount}
              </a>
            ) : (
              <span className="text-gray-500">Not set</span>
            )}
          </div>
          <div>
            <span className="text-gray-400">Chain: </span>
            <span className="text-gray-200">BSC Testnet (ID: 97)</span>
          </div>
        </div>
      </div>

      {/* Alert Configuration */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Alert Settings</h2>
        <p className="text-gray-400 text-sm mb-4">
          Configure alerts via MCP (<code>set_alerts</code>) or Telegram. Alerts are delivered via Telegram if linked.
        </p>

        {alertsQ.data?.alerts && alertsQ.data.alerts.length > 0 ? (
          <div className="space-y-2">
            {alertsQ.data.alerts.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between bg-gray-800 rounded-lg p-3">
                <div>
                  <span className="text-gray-200">{a.type}</span>
                  {a.threshold && (
                    <span className="text-gray-500 text-xs ml-2">threshold: {a.threshold}</span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  a.active ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'
                }`}>
                  {a.active ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No alerts configured.</p>
        )}
      </div>

      {/* Link Instructions */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Link Telegram</h2>
        <p className="text-gray-400 text-sm">
          To receive alerts via Telegram, open the DeFAI bot and send:
        </p>
        <code className="block bg-gray-800 p-3 rounded-lg text-gray-200 text-sm mt-2">
          /link {userId}
        </code>
      </div>
    </div>
  );
}
