import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, LockKeyhole, MessageCircle, Phone } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from './lib/router';
import {
  ApiError,
  api,
  getAdminBranchScope,
  setAdminBranchScope,
  type AdminScopeLocation,
  type AdminUser,
} from './lib/api';
import { useI18n } from './lib/i18n';
import { AdminRealtimeProvider } from './lib/admin-realtime';
import { ADMIN_ALLOWED_PATHS } from './lib/admin-permissions';
import {
  adminCityScopeValue,
  getAdminCityScopes,
  parseAdminScopeSelection,
  primaryBranchIdForAdminScope,
} from './lib/admin-city-scope';
import { isEmbeddedAdminPortal } from './lib/embedded-admin';
import PageState from './components/PageState';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const IikoPage = lazy(() => import('./pages/IikoPage'));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage'));
const StoriesPage = lazy(() => import('./pages/StoriesPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
const TaplinkPage = lazy(() => import('./pages/TaplinkPage'));
const LocationsPage = lazy(() => import('./pages/LocationsPage'));
const BonusPage = lazy(() => import('./pages/BonusPage'));
const LoyaltyTiersPage = lazy(() => import('./pages/LoyaltyTiersPage'));
const MenuPage = lazy(() => import('./pages/MenuPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const CouriersPage = lazy(() => import('./pages/CouriersPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const KitchenPage = lazy(() => import('./pages/KitchenPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const ContactCenterPage = lazy(() => import('./pages/ContactCenterPage'));
const WhatsAppPage = lazy(() => import('./pages/WhatsAppPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));

export function normalizeNumberInputValue(value: string) {
  return value.replace(/^(-?)0+(?=\d)/, '$1');
}

function normalizeNumberInput(event: FormEvent<HTMLDivElement>) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;

  const normalized = normalizeNumberInputValue(input.value);
  if (normalized === input.value) return;

  // Bypass React's element-level value tracker so the same input event still
  // reaches the controlled component with the normalized value.
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeValueSetter?.call(input, normalized);
}

function LoginScreen({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const { t } = useI18n();
  const [loginMode, setLoginMode] = useState<'password' | 'phone'>('password');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeRequested, setPhoneCodeRequested] = useState(false);
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (loginMode === 'password' && !password) return;
    if (loginMode === 'phone' && (!phone.trim() || (phoneCodeRequested && phoneCode.length !== 6)))
      return;
    setLoading(true);
    setError('');
    try {
      if (loginMode === 'password') {
        const response = await api.login(username, password, code);
        onLogin(response.user);
      } else if (!phoneCodeRequested) {
        const response = await api.requestAdminPhoneLogin(phone);
        setWhatsappUrl(response.whatsappUrl || '');
        setPhoneCodeRequested(true);
        setPhoneCode('');
        if (response.whatsappUrl) {
          if (isEmbeddedAdminPortal(window.location.search))
            window.location.assign(response.whatsappUrl);
          else window.open(response.whatsappUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        const response = await api.verifyAdminPhoneLogin(phone, phoneCode);
        onLogin(response.user);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'AUTH_INVALID') {
        setError(t('auth.invalidPassword'));
      } else if (caught instanceof ApiError && caught.code === 'AUTH_NO_SESSION')
        setError(t('auth.noSession'));
      else setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (mode: 'password' | 'phone') => {
    if (loading) return;
    setLoginMode(mode);
    setError('');
  };

  const resetPhoneRequest = () => {
    setPhoneCodeRequested(false);
    setPhoneCode('');
    setWhatsappUrl('');
    setError('');
  };

  const submitDisabled =
    loading ||
    (loginMode === 'password'
      ? !password
      : !phone.trim() || (phoneCodeRequested && phoneCode.length !== 6));

  return (
    <main className="login-screen">
      <form
        className="card login-card"
        onSubmit={handleLogin}
        aria-describedby={error ? 'login-error' : undefined}
      >
        <div className="login-mark" aria-hidden="true">
          <LockKeyhole size={25} />
        </div>
        <img
          src="/admin/bulka_logo.png"
          alt="Bulka"
          className="login-logo"
          width="160"
          height="58"
        />
        <h1>{t('auth.title')}</h1>
        <p>{loginMode === 'phone' ? t('auth.phoneSubtitle') : t('auth.subtitle')}</p>

        <div
          className="segmented-control login-mode-tabs"
          role="group"
          aria-label={t('auth.loginMethod')}
        >
          <button
            type="button"
            className={loginMode === 'phone' ? 'is-active' : ''}
            onClick={() => changeMode('phone')}
            aria-pressed={loginMode === 'phone'}
          >
            <Phone aria-hidden="true" size={16} /> {t('auth.byPhone')}
          </button>
          <button
            type="button"
            className={loginMode === 'password' ? 'is-active' : ''}
            onClick={() => changeMode('password')}
            aria-pressed={loginMode === 'password'}
          >
            <LockKeyhole aria-hidden="true" size={16} /> {t('auth.byPassword')}
          </button>
        </div>

        {loginMode === 'password' ? (
          <>
            <label className="field-label" htmlFor="admin-username">
              {t('auth.username')}
            </label>
            <input
              id="admin-username"
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              required
              className="input-classic w-full"
            />
            <label className="field-label" htmlFor="admin-password">
              {t('auth.password')}
            </label>
            <div className="password-field">
              <input
                id="admin-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="input-classic w-full"
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                className="icon-button password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" size={19} />
                ) : (
                  <Eye aria-hidden="true" size={19} />
                )}
              </button>
            </div>
            <label className="field-label" htmlFor="admin-code">
              {t('auth.code')}
            </label>
            <input
              id="admin-code"
              name="one-time-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              spellCheck={false}
              className="input-classic w-full"
              placeholder="123456"
            />
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="admin-phone">
              {t('auth.phone')}
            </label>
            <input
              id="admin-phone"
              name="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              readOnly={phoneCodeRequested}
              required
              className="input-classic w-full"
              placeholder="+7 700 000 00 00"
              aria-invalid={Boolean(error)}
            />
            {phoneCodeRequested && (
              <>
                <div className="login-phone-status">
                  <MessageCircle aria-hidden="true" size={17} />
                  <span>{t('auth.whatsappInstruction')}</span>
                </div>
                {whatsappUrl && (
                  <a
                    className="btn-outline login-whatsapp-link"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle aria-hidden="true" size={17} /> {t('auth.openWhatsApp')}
                  </a>
                )}
                <label className="field-label" htmlFor="admin-phone-code">
                  {t('auth.phoneCode')}
                </label>
                <input
                  id="admin-phone-code"
                  name="phone-code"
                  type="text"
                  value={phoneCode}
                  onChange={(event) =>
                    setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  spellCheck={false}
                  className="input-classic w-full"
                  placeholder="123456"
                />
                <button type="button" className="login-change-phone" onClick={resetPhoneRequest}>
                  {t('auth.changePhone')}
                </button>
              </>
            )}
          </>
        )}
        {error && (
          <p id="login-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitDisabled} className="btn-classic login-submit">
          {loading && <LoaderCircle aria-hidden="true" className="spin" size={18} />}
          {loading
            ? t('auth.signingIn')
            : loginMode === 'phone'
              ? phoneCodeRequested
                ? t('auth.verifyCode')
                : t('auth.requestWhatsAppCode')
              : t('auth.signIn')}
        </button>
      </form>
    </main>
  );
}

function WhatsAppAccessScreen({ error = '' }: { error?: string }) {
  return (
    <main className="login-screen">
      <section className="card login-card" role={error ? 'alert' : 'status'}>
        <div className="login-mark" aria-hidden="true">
          {error ? <LockKeyhole size={25} /> : <LoaderCircle className="spin" size={25} />}
        </div>
        <img
          src="/admin/bulka_logo.png"
          alt="Bulka"
          className="login-logo"
          width="160"
          height="58"
        />
        <h1>{error ? 'Ссылка недействительна' : 'Открываем WhatsApp'}</h1>
        <p>
          {error || 'Безопасно проверяем доступ оператора. Секрет уже удалён из адресной строки.'}
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const { t } = useI18n();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [scopeLocations, setScopeLocations] = useState<AdminScopeLocation[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState(getAdminBranchScope);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('adminSidebarCollapsed') === 'true',
  );
  const navigate = useNavigate();
  const location = useLocation();
  const operatorAccessExchange = useRef<Promise<{ user: AdminUser }> | null>(null);
  const [operatorAccessError, setOperatorAccessError] = useState('');
  const isOperatorAccessRoute = location.pathname === '/whatsapp-access';

  useEffect(() => {
    const handleAuthError = () => {
      setIsAuthenticated(false);
      setAdminUser(null);
      navigate('/', { replace: true });
    };
    window.addEventListener('unauthorized', handleAuthError);
    return () => window.removeEventListener('unauthorized', handleAuthError);
  }, [navigate]);

  useEffect(() => {
    let active = true;
    if (isOperatorAccessRoute) {
      let token = '';
      try {
        token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
      } catch {
        token = '';
      }
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
      if (!token) {
        setOperatorAccessError('Попросите владельца прислать новую защищённую ссылку.');
        setIsAuthenticated(false);
        return () => {
          active = false;
        };
      }
      operatorAccessExchange.current ??= api.exchangeWhatsAppOperatorAccess(token);
      operatorAccessExchange.current.then(
        (response) => {
          if (!active) return;
          setAdminUser(response.user);
          setIsAuthenticated(true);
          navigate('/whatsapp', { replace: true });
        },
        () => {
          if (!active) return;
          setOperatorAccessError('Попросите владельца прислать новую защищённую ссылку.');
          setIsAuthenticated(false);
        },
      );
    } else {
      api.session().then(
        (response) => {
          if (active) {
            setAdminUser(response.user);
            setIsAuthenticated(true);
          }
        },
        () => {
          if (active) setIsAuthenticated(false);
        },
      );
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem('adminSidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (isAuthenticated !== true || adminUser?.role === 'whatsapp_operator') return;
    let active = true;
    api.getAdminScope().then(
      (response) => {
        if (!active) return;
        setScopeLocations(response.locations);
        const stored = getAdminBranchScope();
        const selection = parseAdminScopeSelection(stored);
        if (selection.kind === 'city') {
          const city = getAdminCityScopes(response.locations).find(
            (candidate) => candidate.key === selection.cityKey,
          );
          if (!city) {
            setAdminBranchScope('');
            setSelectedBranchIdState('');
            return;
          }
          const refreshedScope = adminCityScopeValue(city);
          if (refreshedScope !== stored) {
            setAdminBranchScope(refreshedScope);
            setSelectedBranchIdState(refreshedScope);
          }
          return;
        }
        if (
          selection.kind === 'branch' &&
          !response.locations.some((location) => location.id === selection.branchId)
        ) {
          setAdminBranchScope('');
          setSelectedBranchIdState('');
        }
      },
      () => {
        if (active) setScopeLocations([]);
      },
    );
    return () => {
      active = false;
    };
  }, [adminUser?.role, isAuthenticated]);

  if (isOperatorAccessRoute && isAuthenticated !== true) {
    return <WhatsAppAccessScreen error={operatorAccessError} />;
  }
  if (isAuthenticated === null)
    return (
      <main className="login-screen">
        <PageState type="loading" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginScreen
        onLogin={(user) => {
          setAdminUser(user);
          setIsAuthenticated(true);
        }}
      />
    );

  const role = adminUser?.role || 'viewer';
  const canOpen = (path: string) =>
    !ADMIN_ALLOWED_PATHS[role] || ADMIN_ALLOWED_PATHS[role].includes(path);
  const firstPath = ADMIN_ALLOWED_PATHS[role]?.[0] || '/operations';
  const guard = (path: string, element: React.ReactNode) =>
    canOpen(path) ? element : <Navigate to={firstPath} replace />;

  const isWhatsAppOperator = role === 'whatsapp_operator';
  const handleBranchChange = (branchId: string) => {
    setAdminBranchScope(branchId);
    setSelectedBranchIdState(branchId);
  };
  const menuSelectedBranchId = primaryBranchIdForAdminScope(selectedBranchId);

  return (
    <AdminRealtimeProvider branchId={selectedBranchId} role={role}>
      <div
        className={`sagi-shell ${sidebarCollapsed || isWhatsAppOperator ? 'sidebar-is-collapsed' : ''} ${isWhatsAppOperator ? 'whatsapp-operator-shell' : ''}`}
        onInputCapture={normalizeNumberInput}
      >
        <a className="skip-link" href="#main-content">
          {t('nav.main')}
        </a>
        {!isWhatsAppOperator && (
          <Sidebar
            role={role}
            isOpen={sidebarOpen}
            collapsed={sidebarCollapsed}
            onClose={() => setSidebarOpen(false)}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}
        <main id="main-content" className="sagi-main" tabIndex={-1}>
          <Topbar
            operatorMode={isWhatsAppOperator}
            cashierMode={role === 'cashier'}
            scopeLocations={scopeLocations}
            selectedBranchId={selectedBranchId}
            onBranchChange={handleBranchChange}
            onMenuClick={
              isWhatsAppOperator
                ? undefined
                : () => {
                    setSidebarCollapsed(false);
                    setSidebarOpen(true);
                  }
            }
          />
          <div className="sagi-page" key={selectedBranchId || 'all-branches'}>
            <Suspense fallback={<PageState type="loading" />}>
              <Routes>
                <Route path="/" element={<Navigate to={firstPath} replace />} />
                <Route path="/operations" element={guard('/operations', <OperationsPage />)} />
                <Route path="/analytics" element={guard('/analytics', <AnalyticsPage />)} />
                <Route
                  path="/transactions"
                  element={guard('/transactions', <TransactionsPage />)}
                />
                <Route path="/iiko" element={guard('/iiko', <IikoPage />)} />
                <Route path="/broadcast" element={guard('/broadcast', <BroadcastPage />)} />
                <Route path="/contacts" element={guard('/contacts', <ContactCenterPage />)} />
                <Route
                  path="/whatsapp"
                  element={guard('/whatsapp', <WhatsAppPage role={role} />)}
                />
                <Route
                  path="/customers"
                  element={guard('/customers', <CustomersPage user={adminUser} />)}
                />
                <Route path="/orders" element={guard('/orders', <OrdersPage role={role} />)} />
                <Route
                  path="/menu"
                  element={guard(
                    '/menu',
                    <MenuPage
                      scopeLocations={scopeLocations}
                      selectedBranchId={menuSelectedBranchId}
                      onBranchChange={handleBranchChange}
                    />,
                  )}
                />
                <Route path="/settings" element={guard('/settings', <SettingsPage />)} />
                <Route path="/stories" element={guard('/stories', <StoriesPage />)} />
                <Route path="/news" element={guard('/news', <NewsPage />)} />
                <Route
                  path="/taplink"
                  element={guard(
                    '/taplink',
                    <TaplinkPage canPublish={['admin', 'owner'].includes(role)} />,
                  )}
                />
                <Route path="/bonus" element={guard('/bonus', <BonusPage />)} />
                <Route path="/tiers" element={guard('/tiers', <LoyaltyTiersPage />)} />
                <Route
                  path="/locations"
                  element={guard('/locations', <LocationsPage user={adminUser} />)}
                />
                <Route
                  path="/inventory"
                  element={guard('/inventory', <InventoryPage role={role} />)}
                />
                <Route path="/couriers" element={guard('/couriers', <CouriersPage />)} />
                <Route path="/dispatch" element={guard('/dispatch', <DispatchPage />)} />
                <Route path="/kitchen" element={guard('/kitchen', <KitchenPage />)} />
                <Route path="/marketing" element={guard('/marketing', <MarketingPage />)} />
                <Route path="/reviews" element={guard('/reviews', <ReviewsPage />)} />
                <Route path="/support" element={guard('/support', <SupportPage />)} />
                <Route
                  path="/integrations"
                  element={guard('/integrations', <IntegrationsPage />)}
                />
                <Route path="/access" element={guard('/access', <AccessPage />)} />
                <Route path="/security" element={guard('/security', <SecurityPage />)} />
                <Route path="*" element={<Navigate to={firstPath} replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </AdminRealtimeProvider>
  );
}
