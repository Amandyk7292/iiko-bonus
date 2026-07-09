import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

// Pages
import AnalyticsPage from './pages/AnalyticsPage';
import CustomersPage from './pages/CustomersPage';
import TransactionsPage from './pages/TransactionsPage';
import IikoPage from './pages/IikoPage';
import BroadcastPage from './pages/BroadcastPage';
import StoriesPage from './pages/StoriesPage';
import NewsPage from './pages/NewsPage';
import LocationsPage from './pages/LocationsPage';
import BonusPage from './pages/BonusPage';
import SettingsPage from './pages/SettingsPage';

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await api.login(pwd);
      onLogin();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="card p-10 w-full max-w-sm text-center">
        <h2 className="text-3xl font-serif text-beige-800 mb-2">Управление</h2>
        <p className="text-gray-500 text-sm mb-8">Введите пароль для доступа к системе</p>
        <input 
          type="password" 
          value={pwd} 
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="Пароль" 
          className="input-classic w-full mb-6 text-center text-lg tracking-widest" 
        />
        <button onClick={handleLogin} disabled={loading} className="btn-classic w-full py-3 font-medium shadow-sm">
          {loading ? 'Вход...' : 'Войти в систему'}
        </button>
        {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
      </div>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('adminPwd'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthError = () => {
      setIsAuthenticated(false);
      navigate('/');
    };
    window.addEventListener('unauthorized', handleAuthError);
    return () => window.removeEventListener('unauthorized', handleAuthError);
  }, [navigate]);

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="sagi-shell">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="sagi-main">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <div className="sagi-page">
          <Routes>
            <Route path="/" element={<Navigate to="/analytics" replace />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/iiko" element={<IikoPage />} />
            <Route path="/broadcast" element={<BroadcastPage />} />
            
            <Route path="/customers" element={<CustomersPage />} />
            
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/stories" element={<StoriesPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/bonus" element={<BonusPage />} />
            <Route path="/locations" element={<LocationsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
