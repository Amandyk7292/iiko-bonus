import { AlertCircle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadAdminApplication } from '../lib/chunk-recovery';

type Props = {
  children: ReactNode;
};

type State = {
  failed: boolean;
};

export default class AdminErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Admin interface rendering failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="login-screen">
        <section className="card login-card" role="alert">
          <div className="login-mark" aria-hidden="true">
            <AlertCircle size={25} />
          </div>
          <h1>Не удалось загрузить интерфейс</h1>
          <p>Версия сайта могла обновиться. Обновите страницу — вход и выбранные настройки сохранятся.</p>
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
