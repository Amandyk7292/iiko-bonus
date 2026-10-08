import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import SupportPage from './SupportPage';
const api=vi.hoisted(()=>({getSupportRequests:vi.fn(),getSupportRequest:vi.fn()}));
const feedback=vi.hoisted(()=>({toast:vi.fn(),confirm:vi.fn()}));
vi.mock('../lib/api',async(original)=>({...await original<any>(),api}));
vi.mock('../lib/admin-realtime',()=>({useAdminRealtimeEvents:vi.fn()}));
vi.mock('../components/Feedback',()=>({useFeedback:()=>feedback}));
function deferred<T>() {let resolve!:(x:T)=>void;const promise=new Promise<T>((r)=>{resolve=r;});return{promise,resolve};}
const row=(id:string,status:string)=>({id,customer:{name:id},category:'other',preview:`Question ${id}`,status,priority:'normal',lastMessageAt:'2026-10-08T00:00:00Z',dueAt:null});
afterEach(cleanup);
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();localStorage.setItem('adminLocale','ru');window.history.replaceState({},'','/support');feedback.confirm.mockResolvedValue(true);});
it('retains Closed queue rows when an earlier Mine request finishes late',async()=>{
  const old=deferred<any>();const user=userEvent.setup();
  api.getSupportRequests.mockImplementation((q)=>q.queue==='mine'?old.promise:Promise.resolve({requests:[row(q.queue==='closed'?'Closed customer':'Initial customer',q.queue==='closed'?'resolved':'new')],total:1}));
  render(<BrowserRouter><I18nProvider><SupportPage/></I18nProvider></BrowserRouter>);
  await screen.findByText('Initial customer');
  await user.click(screen.getByRole('tab',{name:'Мои'}));
  await user.click(screen.getByRole('tab',{name:'Закрытые'}));
  await screen.findByText('Closed customer');
  await act(async()=>old.resolve({requests:[row('Mine active customer','in_review')],total:1}));
  expect(screen.getByRole('tab',{name:'Закрытые'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Closed customer')).toBeTruthy();
  expect(screen.queryByText('Mine active customer')).toBeNull();
});
