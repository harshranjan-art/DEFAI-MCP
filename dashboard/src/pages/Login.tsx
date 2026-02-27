import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, setToken } from '../api/client';

type Tab = 'login' | 'register';

interface RegisterResult {
  userId: string;
  apiKey: string;
  smartAccountAddress: string;
}

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
      className="ml-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export default function Login() {
  const [tab, setTab] = useState<Tab>('register');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Login state
  const [apiKey, setApiKey] = useState('');

  // Register state
  const [privateKey, setPrivateKey] = useState('');
  const [registerResult, setRegisterResult] = useState<RegisterResult | null>(null);

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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.register(privateKey);
      setToken(res.jwt);
      localStorage.setItem('defai_userId', res.userId);
      localStorage.setItem('defai_smartAccount', res.smartAccountAddress);
      setRegisterResult({
        userId: res.userId,
        apiKey: res.apiKey,
        smartAccountAddress: res.smartAccountAddress,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const goToLogin = () => {
    setTab('login');
    setRegisterResult(null);
    setError('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 p-8 rounded-xl shadow-lg w-full max-w-lg">
        <h1 className="text-2xl font-bold text-white mb-2">DeFAI Dashboard</h1>
        <p className="text-gray-400 mb-6">BSC Testnet DeFi Agent</p>

        {/* Tab switcher */}
        {!registerResult && (
          <div className="flex mb-6 border-b border-gray-700">
            <button
              onClick={() => { setTab('register'); setError(''); }}
              className={`flex-1 pb-3 text-sm font-medium transition ${
                tab === 'register'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Register
            </button>
            <button
              onClick={() => { setTab('login'); setError(''); }}
              className={`flex-1 pb-3 text-sm font-medium transition ${
                tab === 'login'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Login
            </button>
          </div>
        )}

        {/* Registration result panel */}
        {registerResult && (
          <div>
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 mb-6">
              <p className="text-green-400 font-medium mb-1">Registration successful!</p>
              <p className="text-green-300/70 text-sm">Save these credentials — you'll need them to connect from other platforms.</p>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Smart Account</label>
                <div className="flex items-center">
                  <a
                    href={`https://testnet.bscscan.com/address/${registerResult.smartAccountAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm font-mono break-all"
                  >
                    {registerResult.smartAccountAddress}
                  </a>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">User ID</label>
                <div className="flex items-center bg-gray-800 rounded-lg px-3 py-2">
                  <code className="text-white text-sm font-mono break-all flex-1">{registerResult.userId}</code>
                  <CopyButton text={registerResult.userId} />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">API Key</label>
                <div className="flex items-center bg-gray-800 rounded-lg px-3 py-2">
                  <code className="text-white text-sm font-mono break-all flex-1">{registerResult.apiKey}</code>
                  <CopyButton text={registerResult.apiKey} />
                </div>
              </div>
            </div>

            {/* Setup instructions */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6 space-y-3">
              <p className="text-gray-300 text-sm font-medium">Setup for other platforms:</p>

              <div>
                <p className="text-gray-400 text-xs font-medium mb-1">Claude Desktop (MCP)</p>
                <div className="bg-gray-900 rounded px-3 py-2 flex items-center">
                  <code className="text-gray-300 text-xs break-all flex-1">DEFAI_USER_ID={registerResult.userId}</code>
                  <CopyButton text={`DEFAI_USER_ID=${registerResult.userId}`} />
                </div>
                <p className="text-gray-500 text-xs mt-1">Add to the "env" section of your Claude Desktop MCP config</p>
              </div>

              <div>
                <p className="text-gray-400 text-xs font-medium mb-1">Telegram</p>
                <div className="bg-gray-900 rounded px-3 py-2 flex items-center">
                  <code className="text-gray-300 text-xs break-all flex-1">/connect {registerResult.userId}</code>
                  <CopyButton text={`/connect ${registerResult.userId}`} />
                </div>
                <p className="text-gray-500 text-xs mt-1">Send this command to the DeFAI Telegram bot</p>
              </div>

              <div>
                <p className="text-gray-400 text-xs font-medium mb-1">Dashboard (next login)</p>
                <p className="text-gray-500 text-xs">Use the Login tab with your API key above</p>
              </div>
            </div>

            <button
              onClick={goToLogin}
              className="w-full p-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
            >
              Go to Login
            </button>

            <button
              onClick={() => navigate('/')}
              className="w-full p-3 mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {/* Login form */}
        {!registerResult && tab === 'login' && (
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

            <p className="text-gray-500 text-xs mt-4 text-center">
              Don't have an API key? Switch to the Register tab.
            </p>
          </form>
        )}

        {/* Register form */}
        {!registerResult && tab === 'register' && (
          <form onSubmit={handleRegister}>
            <label className="block text-sm text-gray-300 mb-1">Private Key</label>
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Enter your EOA private key (hex)"
              className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white mb-4 focus:outline-none focus:border-blue-500"
            />

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 mb-4">
              <p className="text-gray-400 text-xs">
                Your key is encrypted with AES-256-GCM on the server. It is never stored in plaintext.
                After registration, you'll receive a UUID that replaces your private key for all future interactions.
              </p>
            </div>

            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !privateKey}
              className="w-full p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition"
            >
              {loading ? 'Registering...' : 'Register'}
            </button>

            <p className="text-gray-500 text-xs mt-4 text-center">
              Already registered? Switch to the Login tab and use your API key.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
