import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar({ isOpen, onClose }: { isOpen?: boolean, onClose?: () => void }) {
  const getNavClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'sagi-nav-link-active' : 'sagi-nav-link';

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}
      
      <aside className={`sagi-sidebar ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex justify-between items-center mb-4">
          <div className="sagi-brand flex items-center gap-3 !mb-0 !border-b-0 !pb-0">
            <img
              src="/admin/bulka_logo.png"
              alt="Bulka Logo"
              className="h-10 w-auto object-contain"
            />
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      
      <div className="sagi-nav-title">Главное</div>
      <NavLink to="/analytics" className={getNavClass}>Аналитика</NavLink>
      <NavLink to="/transactions" className={getNavClass}>Транзакции</NavLink>
      <NavLink to="/iiko" className={getNavClass}>iiko Front</NavLink>
      <NavLink to="/broadcast" className={getNavClass}>Рассылки (Push / WA)</NavLink>

      <div className="sagi-nav-title">Клиенты</div>
      <NavLink to="/customers" className={getNavClass}>База клиентов</NavLink>

      <div className="sagi-nav-title">Профиль</div>
      <NavLink to="/settings" className={getNavClass}>Общая информация</NavLink>
      <NavLink to="/stories" className={getNavClass}>Акции / Баннеры</NavLink>
      <NavLink to="/news" className={getNavClass}>Новости</NavLink>
      <NavLink to="/bonus" className={getNavClass}>Бонусы</NavLink>
      <NavLink to="/locations" className={getNavClass}>Локации</NavLink>
    </aside>
    </>
  );
}
