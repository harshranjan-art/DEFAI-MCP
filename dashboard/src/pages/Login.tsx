import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, setToken } from '../api/client';
import logo from '../assets/image.png';

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
      className="ml-2 px-3 py-1 text-xs font-mono font-bold border-2 border-black bg-white text-black hover:bg-[#F5C518] transition-all"
    >
      {copied ? 'COPIED!' : 'COPY'}
    </button>
  );
}

export default function Login() {
  const [tab, setTab] = useState<Tab>('register');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [apiKey, setApiKey] = useState('');
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
    <div className="bg-white">
      {/* Above-fold: header + hero fills exactly one viewport */}
      <div className="min-h-screen flex flex-col">
        {/* Header bar */}
        <header className="flex items-center justify-between px-6 border-b-2 border-black">
          <img src={logo} alt="DeFAI" className="h-16 w-auto object-contain block" />
          <div className="flex items-center gap-3">
            <span className="bg-black text-white font-mono font-bold text-sm px-5 py-2 rounded-full">
              BNB
            </span>
            <button
              onClick={() => document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' })}
              className="w-11 h-11 rounded-full bg-[#F5C518] border-2 border-black flex items-center justify-center hover:bg-black hover:text-[#F5C518] transition-all text-black font-bold text-lg"
            >
              →
            </button>
          </div>
        </header>

        {/* Hero section — flex-1 fills remaining viewport after header */}
        <section className="flex-1 flex items-center justify-center px-8">
          <div className="max-w-5xl w-full">
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-none tracking-wide uppercase text-center">
              <span className="text-black">"DEFI IS </span>
              <span className="text-[#F5C518]">BROKEN</span>
              <span className="text-black"> FOR HUMANS,</span>
              <br />
              <span className="text-black">AND </span>
              <span className="text-[#F5C518]">AI</span>
              <span className="text-black"> CAN'T ACCESS IT</span>
              <br />
              <span className="text-black">EITHER"</span>
            </h1>
            <div className="flex justify-center mt-10">
              <button
                onClick={() => document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-display text-lg px-10 py-4 bg-black text-[#F5C518] border-2 border-black hover:bg-[#F5C518] hover:text-black transition-all tracking-widest"
              >
                GET STARTED
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Auth section — below the fold, requires scroll */}
      <section id="auth-section" className="border-t-2 border-black bg-[#F5F5F5] py-16 px-8">
        <div className="max-w-lg mx-auto">
          <div className="border-2 border-black bg-white p-8">
            <h2 className="font-display text-2xl mb-1 tracking-wide">ACCESS DASHBOARD</h2>
            <p className="font-mono text-sm text-gray-600 mb-8">BSC Testnet DeFi Agent</p>

            {/* Registration result */}
            {registerResult && (
              <div>
                <div className="bg-[#F5C518] border-2 border-black p-4 mb-6">
                  <p className="font-mono font-bold text-black text-sm">REGISTRATION SUCCESSFUL</p>
                  <p className="font-mono text-xs text-black/70 mt-1">
                    Save these credentials — you'll need them to connect from other platforms.
                  </p>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block font-mono text-xs font-bold text-gray-500 mb-1 uppercase">Smart Account</label>
                    <div className="flex items-center border-2 border-black bg-[#F5F5F5] px-3 py-2">
                      <a
                        href={`https://testnet.bscscan.com/address/${registerResult.smartAccountAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-black font-mono text-xs break-all flex-1 underline underline-offset-2 decoration-[#F5C518]"
                      >
                        {registerResult.smartAccountAddress}
                      </a>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs font-bold text-gray-500 mb-1 uppercase">User ID</label>
                    <div className="flex items-center border-2 border-black bg-[#F5F5F5] px-3 py-2">
                      <code className="text-black font-mono text-xs break-all flex-1">{registerResult.userId}</code>
                      <CopyButton text={registerResult.userId} />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs font-bold text-gray-500 mb-1 uppercase">API Key</label>
                    <div className="flex items-center border-2 border-black bg-[#F5F5F5] px-3 py-2">
                      <code className="text-black font-mono text-xs break-all flex-1">{registerResult.apiKey}</code>
                      <CopyButton text={registerResult.apiKey} />
                    </div>
                  </div>
                </div>

                {/* Setup instructions */}
                <div className="border-2 border-black p-4 mb-6 space-y-4 bg-white">
                  <p className="font-mono text-xs font-bold uppercase text-black">Setup for Other Platforms</p>

                  <div>
                    <p className="font-mono text-xs font-bold text-gray-500 mb-1">CLAUDE DESKTOP (MCP)</p>
                    <div className="border-2 border-black bg-[#F5F5F5] px-3 py-2 flex items-center">
                      <code className="font-mono text-xs break-all flex-1">DEFAI_USER_ID={registerResult.userId}</code>
                      <CopyButton text={`DEFAI_USER_ID=${registerResult.userId}`} />
                    </div>
                    <p className="font-mono text-xs text-gray-500 mt-1">Add to "env" section in Claude Desktop MCP config</p>
                  </div>

                  <div>
                    <p className="font-mono text-xs font-bold text-gray-500 mb-1">TELEGRAM</p>
                    <div className="border-2 border-black bg-[#F5F5F5] px-3 py-2 flex items-center">
                      <code className="font-mono text-xs break-all flex-1">/connect {registerResult.userId}</code>
                      <CopyButton text={`/connect ${registerResult.userId}`} />
                    </div>
                    <p className="font-mono text-xs text-gray-500 mt-1">Send this command to the DeFAI Telegram bot</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={goToLogin}
                    className="flex-1 p-3 font-mono font-bold text-sm border-2 border-black bg-white text-black hover:bg-black hover:text-[#F5C518] transition-all"
                  >
                    LOGIN
                  </button>
                  <button
                    onClick={() => navigate('/')}
                    className="flex-1 p-3 font-mono font-bold text-sm border-2 border-black bg-[#F5C518] text-black hover:bg-black hover:text-[#F5C518] transition-all"
                  >
                    DASHBOARD →
                  </button>
                </div>
              </div>
            )}

            {/* Tab switcher */}
            {!registerResult && (
              <>
                <div className="flex mb-6 border-2 border-black">
                  <button
                    onClick={() => { setTab('register'); setError(''); }}
                    className={`flex-1 py-3 font-mono text-sm font-bold transition-all ${
                      tab === 'register'
                        ? 'bg-[#F5C518] text-black'
                        : 'bg-white text-black hover:bg-[#F5F5F5]'
                    }`}
                  >
                    REGISTER
                  </button>
                  <button
                    onClick={() => { setTab('login'); setError(''); }}
                    className={`flex-1 py-3 font-mono text-sm font-bold transition-all border-l-2 border-black ${
                      tab === 'login'
                        ? 'bg-[#F5C518] text-black'
                        : 'bg-white text-black hover:bg-[#F5F5F5]'
                    }`}
                  >
                    LOGIN
                  </button>
                </div>

                {/* Login form */}
                {tab === 'login' && (
                  <form onSubmit={handleLogin}>
                    <label className="block font-mono text-xs font-bold uppercase text-gray-500 mb-1">API Key</label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="dfai_k_..."
                      className="w-full p-3 border-2 border-black bg-white font-mono text-sm text-black mb-4 focus:outline-none focus:border-[#F5C518] placeholder-gray-400"
                    />

                    {error && (
                      <div className="border-2 border-black bg-black text-[#F5C518] font-mono text-xs p-3 mb-4">
                        ERROR: {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !apiKey}
                      className="w-full p-3 font-mono font-bold text-sm border-2 border-black bg-black text-[#F5C518] hover:bg-[#F5C518] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loading ? 'LOGGING IN...' : 'LOGIN →'}
                    </button>

                    <p className="font-mono text-xs text-gray-500 mt-4 text-center">
                      No API key? Switch to REGISTER tab.
                    </p>
                  </form>
                )}

                {/* Register form */}
                {tab === 'register' && (
                  <form onSubmit={handleRegister}>
                    <label className="block font-mono text-xs font-bold uppercase text-gray-500 mb-1">Private Key</label>
                    <input
                      type="password"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder="Enter your EOA private key (hex)"
                      className="w-full p-3 border-2 border-black bg-white font-mono text-sm text-black mb-4 focus:outline-none focus:border-[#F5C518] placeholder-gray-400"
                    />

                    <div className="border-l-4 border-[#F5C518] bg-[#F5F5F5] p-3 mb-4">
                      <p className="font-mono text-xs text-gray-600">
                        Your key is encrypted with AES-256-GCM. It is never stored in plaintext.
                        After registration, use your UUID for all future interactions.
                      </p>
                    </div>

                    {error && (
                      <div className="border-2 border-black bg-black text-[#F5C518] font-mono text-xs p-3 mb-4">
                        ERROR: {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !privateKey}
                      className="w-full p-3 font-mono font-bold text-sm border-2 border-black bg-black text-[#F5C518] hover:bg-[#F5C518] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loading ? 'REGISTERING...' : 'REGISTER →'}
                    </button>

                    <p className="font-mono text-xs text-gray-500 mt-4 text-center">
                      Already registered? Switch to LOGIN tab.
                    </p>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
