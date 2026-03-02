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

interface GuideSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

function CautionBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-2 border-black bg-[#F5C518] p-3 my-3">
      <div className="flex gap-2 items-start">
        <span className="font-mono font-bold text-black text-sm shrink-0">!!</span>
        <p className="font-mono text-xs text-black leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative border-2 border-black bg-black p-3 my-2">
      <pre className="font-mono text-xs text-[#F5C518] whitespace-pre-wrap break-all">{children}</pre>
      <button
        onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 px-2 py-0.5 font-mono text-xs font-bold border border-[#F5C518] text-[#F5C518] hover:bg-[#F5C518] hover:text-black transition-all"
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-4 border-[#F5C518] bg-[#F5F5F5] p-3 my-3">
      <p className="font-mono text-xs text-gray-700 leading-relaxed">{children}</p>
    </div>
  );
}

function buildGuide(userId?: string, apiKey?: string): GuideSection[] {
  return [
    {
      id: 'what-is-defai',
      title: 'WHAT IS DEFAI?',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            DeFAI is an <strong>autonomous DeFi agent</strong> on BNB Chain (BSC Testnet). It lets you manage DeFi positions using AI assistants like Claude, a Telegram bot, or this dashboard.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {[
              { label: 'Yield Farming', desc: 'Auto-deposit into the highest APY across 60+ pools' },
              { label: 'Token Swaps', desc: 'Swap BNB, USDT, and other tokens via PancakeSwap' },
              { label: 'Arbitrage', desc: 'Detect and execute cross-DEX price differences' },
              { label: 'Delta-Neutral', desc: 'Hedged positions that earn funding yield' },
              { label: 'Gasless Transactions', desc: 'Zero gas fees via ERC-4337 Account Abstraction' },
              { label: 'Portfolio Tracking', desc: 'Real-time PnL, positions, and trade history' },
            ].map(f => (
              <div key={f.label} className="border border-black p-2">
                <p className="font-mono text-xs font-bold text-black">{f.label}</p>
                <p className="font-mono text-xs text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
          <InfoBox>
            This runs on <strong>BSC Testnet</strong> (Chain 97). All tokens are testnet tokens with no real value. Perfect for trying out DeFi strategies risk-free.
          </InfoBox>
        </div>
      ),
    },
    {
      id: 'generate-key',
      title: 'GENERATE A PRIVATE KEY',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            You need an Ethereum-compatible private key to create your Smart Account. If you already have one for testing, skip to the next step.
          </p>
          <p className="font-mono text-xs font-bold text-black mt-3">Option A: Using your terminal</p>
          <CodeBlock>openssl rand -hex 32</CodeBlock>
          <p className="font-mono text-xs text-gray-500">This outputs 64 hex characters — that is your private key.</p>

          <p className="font-mono text-xs font-bold text-black mt-3">Option B: Using Node.js</p>
          <CodeBlock>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</CodeBlock>

          <p className="font-mono text-xs font-bold text-black mt-3">Option C: Using Python</p>
          <CodeBlock>python3 -c "import secrets; print(secrets.token_hex(32))"</CodeBlock>

          <CautionBox>
            NEVER use a wallet that holds real mainnet funds. Generate a fresh key for this testnet agent. This key controls your BSC Testnet Smart Account only.
          </CautionBox>
          <CautionBox>
            Save your private key somewhere safe. You will paste it once during registration, after which it is encrypted with AES-256-GCM and never stored in plaintext. You cannot recover it from the server.
          </CautionBox>
        </div>
      ),
    },
    {
      id: 'register',
      title: 'REGISTER ON THE DASHBOARD',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            Scroll down to the <strong>REGISTER</strong> tab on this page. Paste your private key and click Register.
          </p>
          <p className="font-mono text-xs text-gray-700 leading-relaxed">
            After registration you will receive three things:
          </p>
          <div className="border-2 border-black divide-y-2 divide-black">
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-black">Smart Account Address</p>
              <p className="font-mono text-xs text-gray-500">Your gasless wallet on BSC Testnet (ERC-4337). This is where you send testnet BNB.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-black">User ID (UUID)</p>
              <p className="font-mono text-xs text-gray-500">Your identity across all platforms — used in Claude config and Telegram /connect.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-black">API Key (dfai_k_...)</p>
              <p className="font-mono text-xs text-gray-500">Used to log in to this dashboard and authenticate MCP SSE connections.</p>
            </div>
          </div>
          <CautionBox>
            Copy and save your User ID and API Key immediately. The API Key is shown only once during registration.
          </CautionBox>
        </div>
      ),
    },
    {
      id: 'fund',
      title: 'FUND YOUR SMART ACCOUNT',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            Your Smart Account needs testnet BNB to execute on-chain transactions (deposits, swaps, etc.). Gas is sponsored by Pimlico, but you still need BNB as the token you trade with.
          </p>
          <div className="border-2 border-black p-3 space-y-2">
            <p className="font-mono text-xs font-bold text-black">Steps:</p>
            <p className="font-mono text-xs text-gray-700">1. Copy your Smart Account address from the registration result above</p>
            <p className="font-mono text-xs text-gray-700">2. Go to the BSC Testnet Faucet</p>
            <p className="font-mono text-xs text-gray-700">3. Paste your address and request testnet BNB</p>
            <p className="font-mono text-xs text-gray-700">4. Verify on BSCScan that the balance arrived</p>
          </div>
          <div className="flex gap-2 mt-2">
            <a
              href="https://testnet.bnbchain.org/faucet-smart"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-bold bg-[#F5C518] text-black border-2 border-black px-3 py-1.5 hover:bg-black hover:text-[#F5C518] transition-all"
            >
              BSC FAUCET
            </a>
            <a
              href="https://testnet.bscscan.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-bold bg-white text-black border-2 border-black px-3 py-1.5 hover:bg-black hover:text-[#F5C518] transition-all"
            >
              BSCSCAN
            </a>
          </div>
          <InfoBox>Testnet BNB is free and has no real value. You can request more from the faucet at any time.</InfoBox>
        </div>
      ),
    },
    {
      id: 'connect-claude',
      title: 'CONNECT CLAUDE DESKTOP',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            Connect Claude Desktop to DeFAI so you can control your DeFi positions using natural language. <strong>No local setup required</strong> — Claude connects directly to the hosted server.
          </p>
          <p className="font-mono text-xs font-bold text-black">1. Open your Claude Desktop config file:</p>
          <div className="border-2 border-black divide-y divide-black">
            <div className="p-2 flex justify-between">
              <span className="font-mono text-xs text-gray-500">macOS</span>
              <span className="font-mono text-xs text-black">~/Library/Application Support/Claude/claude_desktop_config.json</span>
            </div>
            <div className="p-2 flex justify-between">
              <span className="font-mono text-xs text-gray-500">Windows</span>
              <span className="font-mono text-xs text-black">%APPDATA%\Claude\claude_desktop_config.json</span>
            </div>
          </div>
          <p className="font-mono text-xs font-bold text-black mt-3">2. Add the DeFAI MCP server block:</p>
          <CodeBlock>{`{
  "mcpServers": {
    "defai": {
      "url": "https://defai-mcp-production.up.railway.app/sse"${apiKey ? `,
      "headers": {
        "Authorization": "Bearer ${apiKey}"
      }` : `,
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }`}
    }
  }
}`}</CodeBlock>
          <p className="font-mono text-xs font-bold text-black mt-3">3. Restart Claude Desktop completely (Cmd+Q / Alt+F4, then reopen)</p>
          <InfoBox>
            Claude will automatically discover all 16 DeFi tools. Try saying: "ping the defai server" or "scan all markets".
          </InfoBox>
        </div>
      ),
    },
    {
      id: 'connect-telegram',
      title: 'CONNECT TELEGRAM (OPTIONAL)',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            Link your Telegram account for natural language DeFi commands and real-time alerts (APY drops, arb opportunities, position health).
          </p>
          <div className="border-2 border-black p-3 space-y-2">
            <p className="font-mono text-xs text-gray-700">1. (https://t.me/defai_mcp_tele_bot) — or search `@defai_mcp_tele_bot` in Telegram.</p>
            <p className="font-mono text-xs text-gray-700">2. Send <strong>/start</strong></p>
            <p className="font-mono text-xs text-gray-700">3. Send <strong>/connect {userId || '<your-user-id>'}</strong></p>
            <p className="font-mono text-xs text-gray-700">4. Send <strong>/portfolio</strong> to verify it works</p>
          </div>
          {userId && (
            <div className="border-2 border-black bg-[#F5F5F5] px-3 py-2 flex items-center mt-2">
              <code className="font-mono text-xs break-all flex-1">/connect {userId}</code>
            </div>
          )}
          <a
            href="https://t.me/defai_mcp_tele_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex font-mono text-xs font-bold bg-black text-[#F5C518] border-2 border-black px-3 py-1.5 hover:bg-[#F5C518] hover:text-black transition-all mt-2"
          >
            OPEN TELEGRAM BOT
          </a>
          <InfoBox>
            The Telegram bot uses Groq Llama 3.3 70B as an AI agent router. You can send natural language like "deposit 0.05 BNB" or "how's my portfolio?".
          </InfoBox>
        </div>
      ),
    },
    {
      id: 'make-trades',
      title: 'MAKING YOUR FIRST TRADES',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            Once funded, here are some things to try from Claude or Telegram:
          </p>
          <div className="border-2 border-black divide-y-2 divide-black">
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-[#F5C518] bg-black inline-block px-2 py-0.5 mb-1">SCAN MARKETS</p>
              <p className="font-mono text-xs text-gray-600">"Scan all markets" — see live APYs, DEX prices, funding rates, and arb opportunities across 60+ pools.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-[#F5C518] bg-black inline-block px-2 py-0.5 mb-1">YIELD DEPOSIT</p>
              <p className="font-mono text-xs text-gray-600">"Deposit 0.01 BNB to best yield" — auto-selects Venus, Beefy, or DefiLlama for the highest APY.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-[#F5C518] bg-black inline-block px-2 py-0.5 mb-1">SWAP TOKENS</p>
              <p className="font-mono text-xs text-gray-600">"Swap 0.01 BNB to USDT" — executes a real PancakeSwap V2 swap on testnet.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-[#F5C518] bg-black inline-block px-2 py-0.5 mb-1">ARBITRAGE</p>
              <p className="font-mono text-xs text-gray-600">"Run arbitrage for 1 hour, stop at $5 loss" — autonomous bot scans every 30s across DEXes.</p>
            </div>
            <div className="p-3">
              <p className="font-mono text-xs font-bold text-[#F5C518] bg-black inline-block px-2 py-0.5 mb-1">PORTFOLIO</p>
              <p className="font-mono text-xs text-gray-600">"Show my portfolio" — view all positions, PnL, yield earned, and smart account balance.</p>
            </div>
          </div>
          <CautionBox>
            All transactions run on BSC Testnet with testnet tokens. There is no real money at risk. However, treat your private key with the same care as a real key — good security habits matter.
          </CautionBox>
          <InfoBox>
            Everything you do from Claude, Telegram, or the API shows up on this dashboard in real-time. All transports share the same database.
          </InfoBox>
        </div>
      ),
    },
    {
      id: 'how-it-works',
      title: 'HOW IT ALL WORKS',
      content: (
        <div className="space-y-3">
          <p className="font-mono text-sm text-gray-700 leading-relaxed">
            DeFAI uses <strong>ERC-4337 Account Abstraction</strong> to give every user a Smart Account on BSC Testnet. All transactions are gasless — Pimlico's Paymaster sponsors the gas fees.
          </p>
          <div className="border-2 border-black p-4 bg-[#F5F5F5]">
            <pre className="font-mono text-xs text-black whitespace-pre leading-relaxed">{`You (Claude / Telegram / Dashboard)
   |
   v
Core Engine (risk checks, routing)
   |
   v
Strategy Layer (yield, arb, delta-neutral)
   |
   v
Protocol Adapters (Venus, PancakeSwap)
   |
   v
BSC Testnet (Smart Account + Pimlico Paymaster)`}</pre>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            <div className="border border-black p-2">
              <p className="font-mono text-xs font-bold text-black">Venus</p>
              <p className="font-mono text-xs text-gray-500">Real testnet lending/borrowing (LIVE)</p>
            </div>
            <div className="border border-black p-2">
              <p className="font-mono text-xs font-bold text-black">PancakeSwap V2</p>
              <p className="font-mono text-xs text-gray-500">Real testnet token swaps (LIVE)</p>
            </div>
            <div className="border border-black p-2">
              <p className="font-mono text-xs font-bold text-black">Thena / BiSwap</p>
              <p className="font-mono text-xs text-gray-500">Real mainnet prices, simulated trades</p>
            </div>
            <div className="border border-black p-2">
              <p className="font-mono text-xs font-bold text-black">Beefy / DefiLlama</p>
              <p className="font-mono text-xs text-gray-500">Real mainnet APYs, simulated deposits</p>
            </div>
          </div>
          <InfoBox>
            Your private key is encrypted at rest with AES-256-GCM. It never appears in chat, config files, or API responses. Only the server can decrypt it at runtime to sign transactions.
          </InfoBox>
        </div>
      ),
    },
  ];
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
  const [showGuide, setShowGuide] = useState(false);
  const [guideSection, setGuideSection] = useState(0);

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
              <button
                onClick={() => { setGuideSection(0); setShowGuide(true); }}
                className="font-display text-lg px-10 py-4 border-2 border-black bg-[#F5C518] text-black hover:bg-black hover:text-[#F5C518] transition-all"
              >
                QUICK SETUP GUIDE
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
                  onClick={() => { setGuideSection(0); setShowGuide(true); }}
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
      {showGuide && (() => {
        const guide = buildGuide(registerResult?.userId, registerResult?.apiKey);
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setShowGuide(false)}
            />

            {/* Modal */}
            <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col border-2 border-black bg-white shadow-[8px_8px_0px_0px_#F5C518]">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b-2 border-black bg-black shrink-0">
                <div>
                  <p className="font-display text-lg text-[#F5C518] tracking-wide">QUICK SETUP GUIDE</p>
                  <p className="font-mono text-xs text-gray-400 mt-0.5">
                    {guide[guideSection].title} &middot; {guideSection + 1} of {guide.length}
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
              <div className="h-1 bg-[#F5F5F5] shrink-0">
                <div
                  className="h-full bg-[#F5C518] transition-all duration-300"
                  style={{ width: `${((guideSection + 1) / guide.length) * 100}%` }}
                />
              </div>

              {/* Sidebar + Content */}
              <div className="flex flex-1 min-h-0">
                {/* Section nav sidebar */}
                <div className="hidden md:block w-48 border-r-2 border-black bg-[#F5F5F5] overflow-y-auto shrink-0">
                  {guide.map((section, i) => (
                    <button
                      key={section.id}
                      onClick={() => setGuideSection(i)}
                      className={`w-full text-left px-3 py-2.5 font-mono text-xs border-b border-black/10 transition-all ${
                        i === guideSection
                          ? 'bg-[#F5C518] text-black font-bold'
                          : 'text-gray-600 hover:bg-white'
                      }`}
                    >
                      <span className="font-bold mr-1.5">{i + 1}.</span>
                      {section.title}
                    </button>
                  ))}
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="shrink-0 w-8 h-8 bg-[#F5C518] border-2 border-black flex items-center justify-center">
                      <span className="font-mono font-bold text-sm text-black">{guideSection + 1}</span>
                    </div>
                    <h3 className="font-mono text-sm font-bold text-black">{guide[guideSection].title}</h3>
                  </div>
                  {guide[guideSection].content}
                </div>
              </div>

              {/* Footer nav */}
              <div className="flex items-center justify-between px-6 py-3 border-t-2 border-black shrink-0">
                <button
                  onClick={() => setGuideSection((s) => s - 1)}
                  disabled={guideSection === 0}
                  className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-white text-black hover:bg-[#F5F5F5] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  &larr; BACK
                </button>

                {/* Section dots */}
                <div className="flex gap-1.5">
                  {guide.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setGuideSection(i)}
                      className={`w-2.5 h-2.5 border border-black transition-all ${
                        i === guideSection ? 'bg-[#F5C518]' : i < guideSection ? 'bg-black' : 'bg-white'
                      }`}
                    />
                  ))}
                </div>

                {guideSection < guide.length - 1 ? (
                  <button
                    onClick={() => setGuideSection((s) => s + 1)}
                    className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-black text-[#F5C518] hover:bg-[#F5C518] hover:text-black transition-all"
                  >
                    NEXT &rarr;
                  </button>
                ) : (
                  <button
                    onClick={() => setShowGuide(false)}
                    className="px-4 py-2 font-mono text-xs font-bold border-2 border-black bg-[#F5C518] text-black hover:bg-black hover:text-[#F5C518] transition-all"
                  >
                    DONE
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
