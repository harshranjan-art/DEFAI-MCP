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

const FEATURES = [
  {
    icon: '\u26A1',
    title: 'MCP-NATIVE DEFI',
    desc: '19 MCP tools give AI agents full DeFi execution. Claude can scan, deposit, swap, and manage positions natively.',
  },
  {
    icon: '\u26FD',
    title: 'GASLESS VIA ERC-4337',
    desc: 'Zero gas management. Pimlico Paymaster sponsors all on-chain transactions through Account Abstraction.',
  },
  {
    icon: '\uD83D\uDCC8',
    title: 'YIELD OPTIMIZATION',
    desc: 'Auto-deposit & rotate across 60+ pools from Venus, Beefy, and DefiLlama. Always the best APY.',
  },
  {
    icon: '\uD83D\uDD04',
    title: 'CROSS-DEX ARBITRAGE',
    desc: 'Autonomous bot scans PancakeSwap, Thena, and BiSwap every 30 seconds for profitable spreads.',
  },
  {
    icon: '\uD83D\uDEE1\uFE0F',
    title: 'DELTA-NEUTRAL',
    desc: 'Hedged positions: real spot buy + virtual short. Earn funding yield with near-zero directional risk.',
  },
  {
    icon: '\uD83E\uDD16',
    title: 'AI TELEGRAM BOT',
    desc: 'Natural language DeFi commands via Groq Llama 3.3 70B agent router. Chat-based portfolio management.',
  },
  {
    icon: '\uD83D\uDD14',
    title: 'REAL-TIME ALERTS',
    desc: '5 background watchers monitor APY drops, arb opportunities, and position health around the clock.',
  },
  {
    icon: '\uD83D\uDD10',
    title: 'SECURE MULTI-USER',
    desc: 'AES-256-GCM encrypted keys. UUID-based identity shared across MCP, Telegram, API, and Dashboard.',
  },
];

const ARCH_LAYERS = [
  {
    label: 'TRANSPORT LAYER',
    headerBg: 'bg-[#F5C518]',
    headerText: 'text-black',
    items: [
      { name: 'Claude MCP', sub: 'stdio + SSE' },
      { name: 'Telegram Bot', sub: 'Groq LLM Agent' },
      { name: 'REST API', sub: 'Express + JWT' },
      { name: 'Dashboard', sub: 'React + Vite' },
    ],
  },
  {
    label: 'CORE ENGINE',
    headerBg: 'bg-black',
    headerText: 'text-[#F5C518]',
    items: [
      { name: 'Orchestrator', sub: 'engine.ts' },
      { name: 'Risk Manager', sub: 'Pre-exec checks' },
      { name: 'Wallet Manager', sub: 'Session cache' },
      { name: 'User Resolver', sub: 'Multi-auth' },
    ],
  },
  {
    label: 'STRATEGY LAYER',
    headerBg: 'bg-[#F5C518]',
    headerText: 'text-black',
    items: [
      { name: 'Yield Optimizer', sub: 'Deposit + Rotate' },
      { name: 'Arb Scanner', sub: 'Cross-DEX Spread' },
      { name: 'Delta-Neutral', sub: 'Spot + Short' },
    ],
  },
  {
    label: 'PROTOCOL ADAPTERS',
    headerBg: 'bg-white',
    headerText: 'text-black',
    items: [
      { name: 'Venus', sub: 'Real Testnet', badge: 'LIVE' },
      { name: 'PancakeSwap V2', sub: 'Real Testnet', badge: 'LIVE' },
      { name: 'Thena', sub: 'Real Prices', badge: 'SIM' },
      { name: 'BiSwap', sub: 'Real Prices', badge: 'SIM' },
    ],
  },
  {
    label: 'BSC TESTNET \u00B7 ERC-4337',
    headerBg: 'bg-black',
    headerText: 'text-[#F5C518]',
    items: [
      { name: 'Smart Account', sub: 'SimpleAccount v0.7' },
      { name: 'Pimlico Paymaster', sub: 'Gasless Sponsorship' },
      { name: 'EntryPoint v0.7', sub: 'UserOperations' },
    ],
  },
];

const SETUP_STEPS = [
  {
    num: 1,
    title: 'FUND YOUR SMART ACCOUNT',
    desc: 'Copy your Smart Account address above. Go to the BSC Testnet Faucet and request free testnet BNB. You need a small amount for on-chain transactions.',
    link: { label: 'BSC Testnet Faucet', url: 'https://testnet.bnbchain.org/faucet-smart' },
  },
  {
    num: 2,
    title: 'SET UP CLAUDE DESKTOP',
    desc: 'Build the project with "npm run build". Then add the DeFAI MCP config to your Claude Desktop config file with your User ID in the DEFAI_USER_ID field. Restart Claude completely.',
  },
  {
    num: 3,
    title: 'TEST MCP TOOLS IN CLAUDE',
    desc: 'Open a new Claude conversation and try: "ping the defai server", "show my portfolio", "scan all markets". All 19 DeFi tools should appear automatically.',
  },
  {
    num: 4,
    title: 'CONNECT TELEGRAM',
    desc: 'Open the DeFAI Telegram bot and send /connect followed by your User ID. You\'ll get AI-powered natural language DeFi commands.',
    link: { label: 'Open Telegram Bot', url: 'https://t.me/defai_mcp_tele_bot' },
  },
  {
    num: 5,
    title: 'LOG IN TO DASHBOARD',
    desc: 'Use your API Key above to log in. View your portfolio, trades, markets, and alerts \u2014 all synced across every transport in real-time.',
  },
  {
    num: 6,
    title: 'START USING DEFI',
    desc: 'Try depositing into yield, scanning for arbitrage, or opening a delta-neutral position. Works identically from Claude, Telegram, or the dashboard.',
  },
];

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
  const [showGuide, setShowGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);

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
      {/* ─── ABOVE-FOLD: HERO ─── */}
      <div className="min-h-screen flex flex-col">
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
              &darr;
            </button>
          </div>
        </header>

        <section className="flex-1 flex items-center justify-center px-8">
          <div className="max-w-5xl w-full">
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-none tracking-wide uppercase text-center">
              <span className="text-black">&ldquo;DEFI IS </span>
              <span className="text-[#F5C518]">BROKEN</span>
              <span className="text-black"> FOR HUMANS,</span>
              <br />
              <span className="text-black">AND </span>
              <span className="text-[#F5C518]">AI</span>
              <span className="text-black"> CAN&rsquo;T ACCESS IT</span>
              <br />
              <span className="text-black">EITHER&rdquo;</span>
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

      {/* ─── AUTH SECTION ─── */}
      <section id="auth-section" className="border-t-2 border-black bg-[#F5F5F5] py-16 px-8">
        <div className="max-w-lg mx-auto">
          <div className="border-2 border-black bg-white p-8">
            <h2 className="font-display text-2xl mb-1 tracking-wide">ACCESS DASHBOARD</h2>
            <p className="font-mono text-sm text-gray-600 mb-8">BSC Testnet DeFi Agent</p>

            {/* Registration result + setup guide */}
            {registerResult && (
              <div>
                <div className="bg-[#F5C518] border-2 border-black p-4 mb-6">
                  <p className="font-mono font-bold text-black text-sm">REGISTRATION SUCCESSFUL</p>
                  <p className="font-mono text-xs text-black mt-1">
                    Save these credentials &mdash; you&rsquo;ll need them to connect from other platforms.
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

                {/* Quick copy for other platforms */}
                <div className="border-2 border-black p-4 mb-6 space-y-4 bg-white">
                  <p className="font-mono text-xs font-bold uppercase text-black">Quick Copy for Other Platforms</p>

                  <div>
                    <p className="font-mono text-xs font-bold text-gray-500 mb-1">CLAUDE DESKTOP (MCP)</p>
                    <div className="border-2 border-black bg-[#F5F5F5] px-3 py-2 flex items-center">
                      <code className="font-mono text-xs break-all flex-1">DEFAI_USER_ID={registerResult.userId}</code>
                      <CopyButton text={`DEFAI_USER_ID=${registerResult.userId}`} />
                    </div>
                    <p className="font-mono text-xs text-gray-500 mt-1">Add to &ldquo;env&rdquo; section in Claude Desktop MCP config</p>
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

                {/* Setup guide trigger */}
                <button
                  onClick={() => { setGuideStep(0); setShowGuide(true); }}
                  className="w-full p-3 font-mono font-bold text-sm border-2 border-black bg-black text-[#F5C518] hover:bg-[#F5C518] hover:text-black transition-all mb-6"
                >
                  VIEW SETUP GUIDE &rarr;
                </button>

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
                    DASHBOARD &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* Tab switcher + forms */}
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
                      {loading ? 'LOGGING IN...' : 'LOGIN \u2192'}
                    </button>

                    <p className="font-mono text-xs text-gray-500 mt-4 text-center">
                      No API key? Switch to REGISTER tab.
                    </p>
                  </form>
                )}

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
                      {loading ? 'REGISTERING...' : 'REGISTER \u2192'}
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

      {/* ─── FEATURES SECTION ─── */}
      <section className="border-t-2 border-black py-16 px-8 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-4xl md:text-5xl tracking-wide uppercase text-black">FEATURES</h2>
            <p className="font-mono text-sm text-gray-600 mt-3 max-w-2xl mx-auto">
              The first MCP server that gives AI agents real DeFi execution on BNB Chain.
              19 tools for yield farming, arbitrage, transfers, and hedging &mdash; all gasless.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="border-2 border-black p-6 -mt-0.5 -ml-0.5 hover:bg-[#F5C518] transition-colors group"
              >
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-display text-sm tracking-wide text-black mb-2">{f.title}</h3>
                <p className="font-mono text-xs text-gray-600 leading-relaxed group-hover:text-black transition-colors">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Highlight bar */}
          <div className="mt-12 border-2 border-black bg-black p-8 text-center">
            <p className="font-display text-2xl md:text-3xl text-[#F5C518] tracking-wide">
              19 MCP TOOLS &middot; 4 TRANSPORTS &middot; 5 WATCHERS
            </p>
            <p className="font-mono text-xs text-gray-400 mt-3">
              Claude Desktop &middot; Telegram Bot &middot; REST API &middot; React Dashboard
            </p>
          </div>
        </div>
      </section>

      {/* ─── SYSTEM ARCHITECTURE SECTION ─── */}
      <section className="border-t-2 border-black py-16 px-8 bg-[#F5F5F5]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-4xl md:text-5xl tracking-wide uppercase text-black">ARCHITECTURE</h2>
            <p className="font-mono text-sm text-gray-600 mt-3 max-w-2xl mx-auto">
              All transports call the same core engine. Every trade, deposit, and alert flows
              through a single orchestrator with risk checks at every step.
            </p>
          </div>

          {/* Architecture layers */}
          <div className="space-y-0">
            {ARCH_LAYERS.map((layer, layerIdx) => (
              <div key={layer.label}>
                {/* Connector arrow */}
                {layerIdx > 0 && (
                  <div className="flex justify-center py-2">
                    <div className="flex flex-col items-center">
                      <div className="w-0.5 h-4 bg-black"></div>
                      <div className="w-3 h-3 border-r-2 border-b-2 border-black rotate-45 -mt-2"></div>
                    </div>
                  </div>
                )}

                {/* Layer box */}
                <div className="border-2 border-black">
                  <div className={`px-4 py-2 border-b-2 border-black ${layer.headerBg} ${layer.headerText}`}>
                    <p className="font-mono text-xs font-bold tracking-widest">{layer.label}</p>
                  </div>

                  <div className={`grid bg-white ${
                    layer.items.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-4'
                  }`}>
                    {layer.items.map((item, itemIdx) => (
                      <div
                        key={item.name}
                        className={`p-4 ${itemIdx > 0 ? 'border-l-2 border-black' : ''}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-mono text-xs font-bold text-black">{item.name}</p>
                          {'badge' in item && item.badge && (
                            <span className={`font-mono text-xs font-bold px-1.5 py-0.5 ${
                              item.badge === 'LIVE'
                                ? 'bg-[#F5C518] text-black border border-black'
                                : 'bg-black text-[#F5C518]'
                            }`}>
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-xs text-gray-500">{item.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Monitoring + Persistence */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-0">
            <div className="border-2 border-black">
              <div className="px-4 py-2 border-b-2 border-black bg-[#F5C518]">
                <p className="font-mono text-xs font-bold tracking-widest text-black">BACKGROUND MONITORING</p>
              </div>
              <div className="p-4 bg-white">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: 'Yield Watcher', freq: 'Every 5 min' },
                    { name: 'Arb Watcher', freq: 'Every 2 min' },
                    { name: 'Position Health', freq: 'Every 5 min' },
                    { name: 'Snapshot Logger', freq: 'Every 5 min' },
                    { name: 'Auto-Arb Executor', freq: 'Every 30 sec' },
                    { name: 'Alert Dispatcher', freq: 'On trigger' },
                  ].map((w) => (
                    <div key={w.name} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F5C518] animate-pulse shrink-0"></span>
                      <div>
                        <p className="font-mono text-xs font-bold text-black">{w.name}</p>
                        <p className="font-mono text-xs text-gray-500">{w.freq}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-2 border-black md:-ml-0.5">
              <div className="px-4 py-2 border-b-2 border-black bg-black">
                <p className="font-mono text-xs font-bold tracking-widest text-[#F5C518]">PERSISTENCE &amp; SECURITY</p>
              </div>
              <div className="p-4 bg-white space-y-3">
                {[
                  { label: 'Database', value: 'SQLite WAL mode' },
                  { label: 'Tables', value: 'Users, Positions, Trades, Alerts, Snapshots' },
                  { label: 'Encryption', value: 'AES-256-GCM + scrypt key derivation' },
                  { label: 'Auth', value: 'JWT (7-day) + API Keys (dfai_k_*)' },
                  { label: 'Risk Engine', value: 'Position size, exposure, slippage limits' },
                ].map((row) => (
                  <div key={row.label} className="flex gap-3">
                    <span className="font-mono text-xs font-bold text-gray-500 w-20 shrink-0">{row.label}</span>
                    <span className="font-mono text-xs text-black">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Data flow */}
          <div className="mt-6 border-2 border-black bg-white p-6">
            <p className="font-display text-sm tracking-wide text-black mb-4">DATA FLOW</p>
            <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-xs">
              <span className="bg-[#F5C518] text-black font-bold px-3 py-1.5 border-2 border-black">USER REQUEST</span>
              <span className="text-black font-bold">&rarr;</span>
              <span className="bg-white text-black font-bold px-3 py-1.5 border-2 border-black">TRANSPORT</span>
              <span className="text-black font-bold">&rarr;</span>
              <span className="bg-black text-[#F5C518] font-bold px-3 py-1.5 border-2 border-black">ENGINE + RISK</span>
              <span className="text-black font-bold">&rarr;</span>
              <span className="bg-[#F5C518] text-black font-bold px-3 py-1.5 border-2 border-black">STRATEGY</span>
              <span className="text-black font-bold">&rarr;</span>
              <span className="bg-white text-black font-bold px-3 py-1.5 border-2 border-black">ADAPTER</span>
              <span className="text-black font-bold">&rarr;</span>
              <span className="bg-black text-[#F5C518] font-bold px-3 py-1.5 border-2 border-black">BSC TESTNET</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t-2 border-black bg-black py-8 px-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-display text-sm text-[#F5C518] tracking-wide">DEFAI MCP</p>
          <p className="font-mono text-xs text-gray-500">
            Built for the BNBChain Hackathon &middot; BSC Testnet &middot; ERC-4337 Gasless
          </p>
          <div className="flex gap-4">
            <a
              href="https://t.me/defai_mcp_tele_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-bold text-[#F5C518] hover:text-white transition-colors"
            >
              TELEGRAM
            </a>
          </div>
        </div>
      </footer>

      {/* ─── SETUP GUIDE MODAL ─── */}
      {showGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowGuide(false)}
          />

          {/* Modal */}
          <div className="relative w-full max-w-lg mx-4 border-2 border-black bg-white shadow-[8px_8px_0px_0px_#F5C518]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b-2 border-black bg-black">
              <div>
                <p className="font-display text-lg text-[#F5C518] tracking-wide">SETUP GUIDE</p>
                <p className="font-mono text-xs text-gray-400 mt-0.5">
                  Step {guideStep + 1} of {SETUP_STEPS.length}
                </p>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="w-8 h-8 flex items-center justify-center border-2 border-[#F5C518] text-[#F5C518] hover:bg-[#F5C518] hover:text-black transition-all font-mono font-bold text-sm"
              >
                &times;
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-[#F5F5F5]">
              <div
                className="h-full bg-[#F5C518] transition-all duration-300"
                style={{ width: `${((guideStep + 1) / SETUP_STEPS.length) * 100}%` }}
              />
            </div>

            {/* Step content */}
            <div className="p-6">
              <div className="flex gap-4 items-start">
                <div className="shrink-0 w-10 h-10 bg-[#F5C518] border-2 border-black flex items-center justify-center">
                  <span className="font-mono font-bold text-lg text-black">{SETUP_STEPS[guideStep].num}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-bold text-black mb-2">{SETUP_STEPS[guideStep].title}</p>
                  <p className="font-mono text-sm text-gray-600 leading-relaxed">{SETUP_STEPS[guideStep].desc}</p>
                  {SETUP_STEPS[guideStep].link && (
                    <a
                      href={SETUP_STEPS[guideStep].link!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-3 font-mono text-xs font-bold bg-[#F5C518] text-black border-2 border-black px-3 py-1.5 hover:bg-black hover:text-[#F5C518] transition-all"
                    >
                      {SETUP_STEPS[guideStep].link!.label} &rarr;
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between px-6 py-4 border-t-2 border-black">
              <button
                onClick={() => setGuideStep((s) => s - 1)}
                disabled={guideStep === 0}
                className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-white text-black hover:bg-[#F5F5F5] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                &larr; BACK
              </button>

              {/* Step dots */}
              <div className="flex gap-1.5">
                {SETUP_STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setGuideStep(i)}
                    className={`w-2.5 h-2.5 border border-black transition-all ${
                      i === guideStep ? 'bg-[#F5C518]' : i < guideStep ? 'bg-black' : 'bg-white'
                    }`}
                  />
                ))}
              </div>

              {guideStep < SETUP_STEPS.length - 1 ? (
                <button
                  onClick={() => setGuideStep((s) => s + 1)}
                  className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-black text-[#F5C518] hover:bg-[#F5C518] hover:text-black transition-all"
                >
                  NEXT &rarr;
                </button>
              ) : (
                <button
                  onClick={() => setShowGuide(false)}
                  className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-[#F5C518] text-black hover:bg-black hover:text-[#F5C518] transition-all"
                >
                  FINISH
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
