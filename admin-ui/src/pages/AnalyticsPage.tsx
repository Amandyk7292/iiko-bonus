import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut, Pie } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading || !stats) {
    return <div className="p-8 text-center text-gray-500">Загрузка аналитики...</div>;
  }

  const bonusData = {
    labels: ['Выдано бонусов', 'Потрачено бонусов'],
    datasets: [
      {
        data: [stats.totalEarned || 0, stats.totalBurned || 0],
        backgroundColor: ['#b88c5a', '#7e5d40'],
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4,
      },
    ],
  };

  const revenueData = {
    labels: ['Живые деньги (тнг)', 'Оплачено бонусами'],
    datasets: [
      {
        data: [stats.totalSales || 0, stats.totalBurned || 0],
        backgroundColor: ['#4ade80', '#f87171'],
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          padding: 15,
          font: { family: 'Inter', size: 12 },
        },
      },
    },
  };

  return (
    <div className="space-y-8">
      <div className="sagi-filter">
        <div className="sagi-field">
          <label>Период с</label>
          <input type="date" className="input-classic" />
        </div>
        <div className="sagi-field">
          <label>Период до</label>
          <input type="date" className="input-classic" />
        </div>
        <button onClick={fetchStats} className="btn-classic px-5 py-2">Фильтр</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 border-l-4 border-l-beige-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm font-medium mb-1">Всего клиентов</p>
              <p className="text-3xl font-serif text-beige-900">{stats.totalCustomers || 0}</p>
            </div>
            <span className="bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-semibold">
              +{stats.newCustomersLast30Days || 0} за 30 дн.
            </span>
          </div>
        </div>
        <div className="card p-6 border-l-4 border-l-green-500">
          <p className="text-gray-500 text-sm font-medium mb-1">Общий оборот (тнг)</p>
          <p className="text-3xl font-serif text-gray-800">{(stats.totalSales || 0).toLocaleString()}</p>
        </div>
        <div className="card p-6 border-l-4 border-l-purple-500">
          <p className="text-gray-500 text-sm font-medium mb-1">Оплачено бонусами (%)</p>
          <p className="text-3xl font-serif text-purple-700">{stats.bonusPaymentPercent || 0}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Начислено бонусов</p>
          <p className="text-2xl font-bold text-gray-800">{(stats.totalEarned || 0).toLocaleString()}</p>
          <p className="text-xs text-green-600 mt-2 font-medium">+{stats.earnedLast30Days || 0} за 30 дн.</p>
        </div>
        <div className="card p-6">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Списано бонусов</p>
          <p className="text-2xl font-bold text-gray-800">{(stats.totalBurned || 0).toLocaleString()}</p>
          <p className="text-xs text-red-600 mt-2 font-medium">+{stats.burnedLast30Days || 0} за 30 дн.</p>
        </div>
        <div className="card p-6">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Текущие обязательства</p>
          <p className="text-2xl font-bold text-blue-600">{(stats.currentLiabilities || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-2">бонусы на счетах клиентов</p>
        </div>
        <div className="card p-6 bg-gradient-to-br from-beige-800 to-beige-900 text-white border-0">
          <p className="text-beige-200 text-xs font-semibold uppercase tracking-wider mb-2">Отчет iiko</p>
          <p className="text-lg font-medium leading-tight mb-4">Детальный отчет по продажам доступен в iikoOffice</p>
          <button className="text-xs bg-white text-beige-900 px-3 py-1.5 rounded font-bold hover:bg-beige-100 transition">Открыть iiko</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="text-lg font-serif text-gray-800 mb-6">Оборот бонусов</h3>
          <div className="relative h-64">
            <Doughnut data={bonusData} options={{ ...chartOptions, cutout: '65%' }} />
          </div>
        </div>
        <div className="card p-6">
          <h3 className="text-lg font-serif text-gray-800 mb-6">Оплата счетов</h3>
          <div className="relative h-64">
            <Pie data={revenueData} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
}
