import {
  Bot,
  BookOpenText,
  Check,
  Cpu,
  Eye,
  EyeOff,
  LoaderCircle,
  KeyRound,
  MessageCircle,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { type WhatsAppAssistantSettings } from '../../lib/api';
import {
  formatDateTime,
  providerDescriptions,
  providerLabels,
  providerModels,
  toneLabels,
} from '../whatsapp-page.helpers';
import type { WhatsAppPageController } from './use-whatsapp-page-controller';

export default function WhatsAppSettingsPanel({
  controller,
}: {
  controller: WhatsAppPageController;
}) {
  const {
    locale,
    canConfigure,
    view,
    connection,
    settings,
    settingsDraft,
    setSettingsDraft,
    providerApiKey,
    setProviderApiKey,
    showProviderApiKey,
    setShowProviderApiKey,
    busy,
    selectedProvider,
    activeProviderKeyConfigured,
    saveSettings,
    changeProvider,
    toggleLanguage,
  } = controller;

  return (
    <>
      {view === 'settings' && settingsDraft && (
        <form className="whatsapp-settings-view" onSubmit={saveSettings}>
          {!canConfigure && (
            <div className="whatsapp-permission-note">
              <ShieldCheck aria-hidden="true" size={20} />
              <span>
                Просмотр настроек доступен. Изменять их может только владелец или администратор.
              </span>
            </div>
          )}
          <div className="whatsapp-settings-main">
            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Bot aria-hidden="true" size={21} />
                <div>
                  <h2>Режим работы</h2>
                  <p>Управление автоматическими ответами и памятью.</p>
                </div>
              </div>
              <div className="whatsapp-toggle-list">
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>ИИ-ассистент включён</strong>
                    <small>Главный выключатель автоматических консультаций.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.assistantEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, assistantEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>Автоматически отвечать</strong>
                    <small>Если выключить, новые сообщения останутся оператору.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoReplyEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, autoReplyEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>Использовать память</strong>
                    <small>Подключает заметки и недавнюю переписку к ответу.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.memoryEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, memoryEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Cpu aria-hidden="true" size={21} />
                <div>
                  <h2>ИИ-провайдер и модель</h2>
                  <p>Переключение сервиса и безопасная замена API-ключа.</p>
                </div>
              </div>
              <div className="form-grid form-grid-2">
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-ai-provider">
                    Провайдер
                  </label>
                  <select
                    id="whatsapp-ai-provider"
                    className="input-classic"
                    value={selectedProvider}
                    onChange={(event) =>
                      changeProvider(event.target.value as WhatsAppAssistantSettings['provider'])
                    }
                    disabled={!canConfigure}
                  >
                    {(Object.keys(providerLabels) as WhatsAppAssistantSettings['provider'][]).map(
                      (provider) => (
                        <option key={provider} value={provider}>
                          {providerLabels[provider]}
                          {settingsDraft.providerKeys?.[provider] ? ' (ключ установлен)' : ''}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-ai-model">
                    Модель
                  </label>
                  <input
                    id="whatsapp-ai-model"
                    className="input-classic"
                    list={`whatsapp-${selectedProvider}-models`}
                    value={settingsDraft.model}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, model: event.target.value })
                    }
                    maxLength={120}
                    spellCheck={false}
                    disabled={!canConfigure}
                  />
                  <datalist id={`whatsapp-${selectedProvider}-models`}>
                    {providerModels[selectedProvider].map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-provider-key">
                  Новый API-ключ {providerLabels[selectedProvider]}
                </label>
                <div className="whatsapp-secret-input">
                  <KeyRound aria-hidden="true" size={18} />
                  <input
                    id="whatsapp-provider-key"
                    className="input-classic"
                    type={showProviderApiKey ? 'text' : 'password'}
                    value={providerApiKey}
                    onChange={(event) => setProviderApiKey(event.target.value)}
                    placeholder={
                      settingsDraft.providerKeys?.[selectedProvider]
                        ? 'Оставьте пустым, чтобы сохранить текущий ключ'
                        : 'Вставьте API-ключ'
                    }
                    autoComplete="new-password"
                    maxLength={512}
                    spellCheck={false}
                    disabled={!canConfigure}
                  />
                  <button
                    type="button"
                    onClick={() => setShowProviderApiKey((current) => !current)}
                    aria-label={showProviderApiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'}
                    title={showProviderApiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'}
                    disabled={!canConfigure || !providerApiKey}
                  >
                    {showProviderApiKey ? (
                      <EyeOff aria-hidden="true" size={18} />
                    ) : (
                      <Eye aria-hidden="true" size={18} />
                    )}
                  </button>
                </div>
                <p
                  className={`whatsapp-key-status ${activeProviderKeyConfigured ? 'is-ready' : 'is-missing'}`}
                  aria-live="polite"
                >
                  {providerApiKey.trim()
                    ? 'Новый ключ будет зашифрован при сохранении.'
                    : activeProviderKeyConfigured
                      ? 'Ключ установлен. Его значение не показывается и не передаётся обратно в браузер.'
                      : 'Для выбранного провайдера ключ ещё не установлен.'}
                </p>
                <p className="field-hint">{providerDescriptions[selectedProvider]}</p>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Sparkles aria-hidden="true" size={21} />
                <div>
                  <h2>Личность ассистента</h2>
                  <p>Имя, тон и языки общения.</p>
                </div>
              </div>
              <div className="form-grid form-grid-2">
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-bot-name">
                    Имя ассистента
                  </label>
                  <input
                    id="whatsapp-bot-name"
                    className="input-classic"
                    value={settingsDraft.botName}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, botName: event.target.value })
                    }
                    maxLength={80}
                    disabled={!canConfigure}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-tone">
                    Тон общения
                  </label>
                  <select
                    id="whatsapp-tone"
                    className="input-classic"
                    value={settingsDraft.tone}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tone: event.target.value as WhatsAppAssistantSettings['tone'],
                      })
                    }
                    disabled={!canConfigure}
                  >
                    {Object.entries(toneLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="whatsapp-language-fieldset" disabled={!canConfigure}>
                <legend>Языки ответов</legend>
                <div>
                  {(['ru', 'kk', 'en'] as const).map((language) => (
                    <label
                      key={language}
                      className={
                        settingsDraft.supportedLanguages.includes(language) ? 'is-active' : ''
                      }
                    >
                      <input
                        type="checkbox"
                        checked={settingsDraft.supportedLanguages.includes(language)}
                        onChange={() => toggleLanguage(language)}
                      />
                      <span className="whatsapp-language-check" aria-hidden="true">
                        <Check size={14} strokeWidth={3} />
                      </span>
                      <span>
                        {language === 'ru' ? 'Русский' : language === 'kk' ? 'Қазақша' : 'English'}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-history">
                  Сообщений в контексте: {settingsDraft.historyMessages}
                </label>
                <input
                  id="whatsapp-history"
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={settingsDraft.historyMessages}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      historyMessages: Number(event.target.value),
                    })
                  }
                  disabled={!canConfigure}
                />
                <p className="field-hint">
                  Чем больше контекст, тем точнее продолжение диалога и выше расход лимита.
                </p>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <BookOpenText aria-hidden="true" size={21} />
                <div>
                  <h2>Контекст бизнеса</h2>
                  <p>Главные сведения и правила поведения.</p>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-business-description">
                  Описание Bulka
                </label>
                <textarea
                  id="whatsapp-business-description"
                  className="input-classic"
                  rows={5}
                  value={settingsDraft.businessDescription}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, businessDescription: event.target.value })
                  }
                  maxLength={4000}
                  placeholder="Чем занимается Bulka, чем отличается, какие услуги доступны"
                  disabled={!canConfigure}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-custom-instructions">
                  Дополнительные инструкции
                </label>
                <textarea
                  id="whatsapp-custom-instructions"
                  className="input-classic"
                  rows={6}
                  value={settingsDraft.customInstructions}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, customInstructions: event.target.value })
                  }
                  maxLength={6000}
                  placeholder="Например: не обещать наличие без проверки, при жалобе передавать оператору"
                  disabled={!canConfigure}
                />
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <MessageCircle aria-hidden="true" size={21} />
                <div>
                  <h2>Служебные сообщения</h2>
                  <p>Приветствие и ответ при временной ошибке.</p>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-welcome">
                  Приветствие
                </label>
                <textarea
                  id="whatsapp-welcome"
                  className="input-classic"
                  rows={3}
                  value={settingsDraft.welcomeMessage}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, welcomeMessage: event.target.value })
                  }
                  maxLength={500}
                  disabled={!canConfigure}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-fallback">
                  Если ИИ недоступен
                </label>
                <textarea
                  id="whatsapp-fallback"
                  className="input-classic"
                  rows={3}
                  value={settingsDraft.fallbackMessage}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, fallbackMessage: event.target.value })
                  }
                  maxLength={500}
                  disabled={!canConfigure}
                />
              </div>
            </section>
          </div>

          <aside className="whatsapp-settings-aside">
            <section className="whatsapp-runtime-card">
              <h2>Состояние сервера</h2>
              <dl>
                <div>
                  <dt>WhatsApp</dt>
                  <dd>{connection?.connected ? 'Подключён' : 'Не подключён'}</dd>
                </div>
                <div>
                  <dt>Провайдер</dt>
                  <dd>{providerLabels[selectedProvider]}</dd>
                </div>
                <div>
                  <dt>API-ключ</dt>
                  <dd>{activeProviderKeyConfigured ? 'Установлен' : 'Нет ключа'}</dd>
                </div>
                <div>
                  <dt>Модель</dt>
                  <dd>{settingsDraft.model}</dd>
                </div>
                <div>
                  <dt>Хранилище</dt>
                  <dd>{settingsDraft.storageReady ? 'Готово' : 'Нужна миграция'}</dd>
                </div>
                <div>
                  <dt>Обновлено</dt>
                  <dd>{formatDateTime(settings?.updatedAt || null, locale)}</dd>
                </div>
              </dl>
            </section>
            <section className="whatsapp-guardrail-card">
              <ShieldCheck aria-hidden="true" size={22} />
              <h2>Защита уже включена</h2>
              <p>
                Ассистент не получает OTP, пароли, полные номера карт и скрывает типовые
                персональные данные перед запросом к выбранному ИИ.
              </p>
            </section>
            {canConfigure && (
              <button
                type="submit"
                className="btn-classic whatsapp-settings-save"
                disabled={
                  busy === 'settings' ||
                  (settingsDraft.assistantEnabled && !activeProviderKeyConfigured)
                }
              >
                {busy === 'settings' ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Save aria-hidden="true" size={18} />
                )}{' '}
                Сохранить настройки
              </button>
            )}
          </aside>
        </form>
      )}
    </>
  );
}
