import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { clearToken, alerts } from '../api/client';
import logo from '../assets/image.png';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/portfolio', label: 'Portfolio' },
  { path: '/trades', label: 'Trades' },
  { path: '/markets', label: 'Markets' },
  { path: '/alerts', label: 'Alerts' },
  { path: '/arb', label: 'Arb Executions' },
  { path: '/settings', label: 'Settings' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const alertsQuery = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: alerts.unread,
    refetchInterval: 30_000,
  });

  const unreadCount = Array.isArray(alertsQuery.data?.notifications)
    ? alertsQuery.data.notifications.length
    : 0;

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('defai_userId');
    localStorage.removeItem('defai_smartAccount');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-white text-black flex">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 w-64 h-full bg-white border-r-2 border-black flex flex-col z-50">
        {/* Logo */}
        <div className="border-b-2 border-black">
          <img src={logo} alt="DeFAI" className="w-full h-auto object-contain block" />
        </div>

        {/* Network badge */}
        <div className="px-5 py-3 border-b-2 border-black">
          <span className="inline-flex items-center gap-1.5 bg-black text-[#F5C518] text-xs font-mono font-bold px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F5C518] animate-pulse"></span>
            BNB CHAIN · TESTNET
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            const hasUnread = item.path === '/alerts' && unreadCount > 0;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center justify-between px-4 py-3 font-mono text-sm font-bold transition-all border-2 ${
                  isActive
                    ? 'bg-[#F5C518] text-black border-black'
                    : 'bg-white text-black border-transparent hover:border-black hover:bg-[#F5C518]'
                }`}
              >
                <span>{item.label.toUpperCase()}</span>
                {hasUnread && (
                  <span className="ml-auto bg-black text-[#F5C518] text-xs font-bold px-1.5 py-0.5">
                    {unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t-2 border-black">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-3 text-sm font-mono font-bold border-2 border-black bg-white text-black hover:bg-black hover:text-[#F5C518] transition-all"
          >
            LOGOUT
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 min-h-screen bg-white">
        <Outlet />
      </main>
    </div>
  );
}
