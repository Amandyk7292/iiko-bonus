import React from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';

const routeTitles: Record<string, { title: string, subtitle: string }> = {
  '/analytics': { title: 'Аналитика', subtitle: 'Обзор продаж, клиентов и бонусов' },
  '/transactions': { title: 'Транзакции', subtitle: 'История бонусных операций' },
  '/iiko': { title: 'iiko Front', subtitle: 'Логи операций' },
  '/broadcast': { title: 'Рассылки', subtitle: 'Массовая отправка сообщений' },
  '/customers': { title: 'База клиентов', subtitle: 'Управление пользователями' },
  '/settings': { title: 'Общая информация', subtitle: 'Настройки заведения' },
  '/stories': { title: 'Сториз', subtitle: 'Управление сториз' },
  '/news': { title: 'Новости', subtitle: 'Лента новостей' },
  '/bonus': { title: 'Настройки бонусов', subtitle: 'Правила лояльности' },
  '/locations': { title: 'Локации', subtitle: 'Филиалы и адреса' },
};

export default function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const location = useLocation();
  const info = routeTitles[location.pathname] || { title: 'Панель', subtitle: '' };

  return (
    <div className="sagi-topbar">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div>
          <p className="sagi-page-title">{info.title}</p>
          <p className="sagi-page-subtitle">{info.subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => api.logout()} className="btn-outline px-4 py-2 text-sm">Выйти</button>
      </div>
    </div>
  );
}
