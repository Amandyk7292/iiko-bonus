import { AlertCircle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadAdminApplication } from '../lib/chunk-recovery';

type Props = {
  children: ReactNode;
};

type State = {
  failed: boolean;
  supportCode: string;
};

const requestIdFromError = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const value = (error as { requestId?: unknown }).requestId;
  return typeof value === 'string' ? value.trim().slice(0, 128) : '';
};

export const adminSupportCode = (error?: unknown) =>
  requestIdFromError(error) ||
  `UI-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

export default class AdminErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, supportCode: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, supportCode: adminSupportCode(error) };
  }

  componentDidMount() {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.report('admin_ui_render_failed', error, info.componentStack || '');
  }

  private report = (event: string, error: unknown, componentStack = '') => {
    const supportCode = this.state.supportCode || adminSupportCode(error);
    console.error({
      event,
      supportCode,
      requestId: requestIdFromError(error) || undefined,
      errorName: error instanceof Error ? error.name : typeof error,
      componentStack: componentStack.slice(0, 4000) || undefined,
    });
    return supportCode;
  };

  private handleWindowError = (event: ErrorEvent) => {
    this.report('admin_ui_unhandled_error', event.error);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    this.report('admin_ui_unhandled_rejection', event.reason);
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="login-screen">
        <section className="card login-card" role="alert">
          <div className="login-mark" aria-hidden="true">
            <AlertCircle size={25} />
          </div>
          <h1>Не удалось загрузить интерфейс</h1>
          <p>
            Версия сайта могла обновиться. Обновите страницу — вход и выбранные настройки
            сохранятся.
          </p>
          <p className="table-secondary" aria-live="polite">
            Код для поддержки: <code>{this.state.supportCode}</code>
          </p>
          <button
            type="button"
            className="btn-classic login-submit inline-flex items-center justify-center gap-2"
            onClick={reloadAdminApplication}
          >
            <RefreshCw aria-hidden="true" size={18} /> Обновить страницу
          </button>
        </section>
      </main>
    );
  }
}
