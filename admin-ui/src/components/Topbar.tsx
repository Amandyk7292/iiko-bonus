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

export default function Topbar() {
  const location = useLocation();
  const info = routeTitles[location.pathname] || { title: 'Панель', subtitle: '' };

  return (
    <div className="sagi-topbar">
      <div>
        <p className="sagi-page-title">{info.title}</p>
        <p className="sagi-page-subtitle">{info.subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-outline px-3 py-2 text-sm">RU</button>
        <button onClick={() => api.logout()} className="btn-outline px-4 py-2 text-sm">Выйти</button>
      </div>
    </div>
  );
}
