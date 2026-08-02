import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from './lib/router';
import App from './App.tsx';
import { I18nProvider } from './lib/i18n.tsx';
import { FeedbackProvider } from './components/Feedback.tsx';
import AdminErrorBoundary from './components/AdminErrorBoundary.tsx';
import { installChunkRecovery } from './lib/chunk-recovery.ts';
import './index.css';
import './styles/commerce.css';
import './styles/operations.css';
import './styles/interaction.css';
import './styles/release.css';
import './styles/contacts.css';
import './styles/whatsapp.css';

installChunkRecovery();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminErrorBoundary>
      <BrowserRouter basename="/admin">
        <I18nProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </I18nProvider>
      </BrowserRouter>
    </AdminErrorBoundary>
  </React.StrictMode>,
);
