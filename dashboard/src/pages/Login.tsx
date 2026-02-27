import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, setToken } from '../api/client';

export default function Login() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login(apiKey);
      setToken(res.jwt);
      localStorage.setItem('defai_userId', res.userId);
      localStorage.setItem('defai_smartAccount', res.smartAccountAddress);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 p-8 rounded-xl shadow-lg w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-2">DeFAI Dashboard</h1>
        <p className="text-gray-400 mb-6">BSC Testnet DeFi Agent</p>

        <form onSubmit={handleLogin}>
          <label className="block text-sm text-gray-300 mb-1">API Key</label>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="dfai_k_..."
            className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white mb-4 focus:outline-none focus:border-blue-500"
          />

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="text-gray-500 text-xs mt-4 text-center">
          Get your API key from the MCP <code>wallet_setup</code> tool
        </p>
      </div>
    </div>
  );
}
