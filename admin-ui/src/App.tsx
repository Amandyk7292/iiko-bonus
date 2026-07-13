import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from './lib/api';
import { useI18n } from './lib/i18n';
import PageState from './components/PageState';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import LanguageSelect from './components/LanguageSelect';

const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const IikoPage = lazy(() => import('./pages/IikoPage'));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage'));
const StoriesPage = lazy(() => import('./pages/StoriesPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
const LocationsPage = lazy(() => import('./pages/LocationsPage'));
const BonusPage = lazy(() => import('./pages/BonusPage'));
const LoyaltyTiersPage = lazy(() => import('./pages/LoyaltyTiersPage'));
const MenuPage = lazy(() => import('./pages/MenuPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.login(username, password, code);
      onLogin();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'AUTH_INVALID') setError(t('auth.invalidPassword'));
      else if (caught instanceof ApiError && caught.code === 'AUTH_NO_SESSION') setError(t('auth.noSession'));
      else setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <div className="login-language"><LanguageSelect compact /></div>
      <form className="card login-card" onSubmit={handleLogin} aria-describedby={error ? 'login-error' : undefined}>
        <div className="login-mark" aria-hidden="true"><LockKeyhole size={25} /></div>
        <img src="/admin/bulka_logo.png" alt="Bulka" className="login-logo" width="160" height="58" />
        <h1>{t('auth.title')}</h1>
        <p>{t('auth.subtitle')}</p>
        <label className="field-label" htmlFor="admin-username">{t('auth.username')}</label>
        <input
          id="admin-username"
          name="username"
          type="text"
          value={username}
          onChange={event => setUsername(event.target.value)}
          autoComplete="username"
          spellCheck={false}
          required
          className="input-classic w-full"
        />
        <label className="field-label" htmlFor="admin-password">{t('auth.password')}</label>
        <div className="password-field">
          <input
            id="admin-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="input-classic w-full"
            aria-invalid={Boolean(error)}
          />
          <button
            type="button"
            className="icon-button password-toggle"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
          >
            {showPassword ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
          </button>
        </div>
        <label className="field-label" htmlFor="admin-code">{t('auth.code')}</label>
        <input
          id="admin-code"
          name="one-time-code"
          type="text"
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          autoComplete="one-time-code"
          inputMode="numeric"
          spellCheck={false}
          className="input-classic w-full"
          placeholder="123456"
        />
        {error && <p id="login-error" className="field-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading || !password} className="btn-classic login-submit">
          {loading && <LoaderCircle aria-hidden="true" className="spin" size={18} />}
          {loading ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </main>
  );
}
export default function App() {
  const { t } = useI18n();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleAuthError = () => {
      setIsAuthenticated(false);
      navigate('/', { replace: true });
    };
    window.addEventListener('unauthorized', handleAuthError);
    return () => window.removeEventListener('unauthorized', handleAuthError);
  }, [navigate]);

  useEffect(() => {
    let active = true;
    api.session().then(
      () => { if (active) setIsAuthenticated(true); },
      () => { if (active) setIsAuthenticated(false); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }, [location.pathname]);

  if (isAuthenticated === null) return <main className="login-screen"><PageState type="loading" /></main>;
  if (!isAuthenticated) return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="sagi-shell">
      <a className="skip-link" href="#main-content">{t('nav.main')}</a>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main id="main-content" className="sagi-main" tabIndex={-1}>
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <div className="sagi-page">
          <Suspense fallback={<PageState type="loading" />}>
            <Routes>
              <Route path="/" element={<Navigate to="/analytics" replace />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/iiko" element={<IikoPage />} />
              <Route path="/broadcast" element={<BroadcastPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/menu" element={<MenuPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/stories" element={<StoriesPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/bonus" element={<BonusPage />} />
              <Route path="/tiers" element={<LoyaltyTiersPage />} />
              <Route path="/locations" element={<LocationsPage />} />
              <Route path="*" element={<Navigate to="/analytics" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
