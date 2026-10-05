import { useState } from 'react';
import { Trophy, Wallet } from '../components/BulkaIcons';
import { useI18n } from '../lib/i18n';
import CashierSignupRace from './CashierSignupRace';
import CashierPayroll from './CashierPayroll';
import CashierSyncStatus from './CashierSyncStatus';
import '../styles/cashier-payroll.css';

export default function CashierWorkspace({ active }: { active: boolean }) {
  const { locale } = useI18n();
  const text = locale === 'kk' ? { tabs: 'Кассир бөлімдері', race: 'Рейтинг', payroll: 'Ведомость' }
    : { tabs: 'Разделы кассиров', race: 'Рейтинг', payroll: 'Ведомость' };
  const [view, setView] = useState<'race' | 'payroll'>('race');
  const [payrollVisited, setPayrollVisited] = useState(false);
  const select = (next: 'race' | 'payroll') => {
    setView(next);
    if (next === 'payroll') setPayrollVisited(true);
  };
  return <div className="cashier-workspace">
    <CashierSyncStatus active={active} />
    <div className="cashier-workspace-tabs" role="tablist" aria-label={text.tabs}>
      {(['race', 'payroll'] as const).map((key) => {
        const Icon = key === 'race' ? Trophy : Wallet;
        return <button key={key} type="button" role="tab" id={`cashier-tab-${key}`}
          aria-controls={`cashier-panel-${key}`} aria-selected={view === key} tabIndex={view === key ? 0 : -1}
          onClick={() => select(key)} onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 'race' : event.key === 'End' ? 'payroll' : key === 'race' ? 'payroll' : 'race';
              select(next);
              document.getElementById(`cashier-tab-${next}`)?.focus();
            }
          }}><Icon size={18} aria-hidden="true" />{text[key]}</button>;
      })}
    </div>
    <div role="tabpanel" id="cashier-panel-race" aria-labelledby="cashier-tab-race" hidden={view !== 'race'}>
      <CashierSignupRace active={active && view === 'race'} />
    </div>
    <div role="tabpanel" id="cashier-panel-payroll" aria-labelledby="cashier-tab-payroll" hidden={view !== 'payroll'}>
      {payrollVisited && <CashierPayroll active={active && view === 'payroll'} scope="" />}
    </div>
  </div>;
}
