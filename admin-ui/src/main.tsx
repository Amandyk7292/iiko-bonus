import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { I18nProvider } from './lib/i18n.tsx'
import { FeedbackProvider } from './components/Feedback.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
