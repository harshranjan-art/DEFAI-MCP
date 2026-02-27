import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { clearToken } from '../api/client';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/portfolio', label: 'Portfolio' },
  { path: '/trades', label: 'Trades' },
  { path: '/markets', label: 'Markets' },
  { path: '/settings', label: 'Settings' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('defai_userId');
    localStorage.removeItem('defai_smartAccount');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 w-56 h-full bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold">DeFAI</h1>
          <p className="text-xs text-gray-500">BSC Testnet Agent</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-3 py-2 rounded-lg text-sm transition ${
                location.pathname === item.path
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 p-8">
        <Outlet />
      </main>
    </div>
  );
}
