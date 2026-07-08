import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  const getNavClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'sagi-nav-link-active' : 'sagi-nav-link';

  return (
    <aside className="sagi-sidebar">
      <div className="sagi-brand">
        <div className="sagi-brand-mark">B</div>
        <div>
          <div className="font-bold text-gray-900">Bulka Business</div>
          <div className="text-xs text-gray-500">Bonus admin</div>
        </div>
      </div>
      
      <div className="sagi-nav-title">Главное</div>
      <NavLink to="/analytics" className={getNavClass}>Аналитика</NavLink>
      <NavLink to="/transactions" className={getNavClass}>Транзакции</NavLink>
      <NavLink to="/iiko" className={getNavClass}>iiko Front</NavLink>
      <NavLink to="/broadcast" className={getNavClass}>WhatsApp / Рассылки</NavLink>

      <div className="sagi-nav-title">Клиенты</div>
      <NavLink to="/customers" className={getNavClass}>База клиентов</NavLink>

      <div className="sagi-nav-title">Профиль</div>
      <NavLink to="/settings" className={getNavClass}>Общая информация</NavLink>
      <NavLink to="/stories" className={getNavClass}>Фотографии / Сториз</NavLink>
      <NavLink to="/news" className={getNavClass}>Новости</NavLink>
      <NavLink to="/bonus" className={getNavClass}>Бонусы</NavLink>
      <NavLink to="/locations" className={getNavClass}>Локации</NavLink>
    </aside>
  );
}
