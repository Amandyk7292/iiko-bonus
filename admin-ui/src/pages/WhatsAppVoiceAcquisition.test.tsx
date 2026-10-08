import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import { useWhatsAppPageController } from './whatsapp/use-whatsapp-page-controller';
const api = vi.hoisted(() => ({ getWhatsAppConsoleStatus: vi.fn(), getWhatsAppConversations: vi.fn(), getWhatsAppConversation: vi.fn(), sendWhatsAppVoice: vi.fn() }));
const feedback=vi.hoisted(()=>({toast:vi.fn(),confirm:vi.fn()}));
vi.mock('../lib/api', async (original) => ({ ...(await original<any>()), api }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({ useFeedback: () => feedback }));
function deferred<T>() { let resolve!: (x:T)=>void; const promise=new Promise<T>((r)=>{resolve=r;});return{promise,resolve}; }
class FakeRecorder {
  static created=0;
  static delayStop=false;
  static pendingStops: Array<() => void> = [];
  static isTypeSupported() {return true;}
  state='inactive'; mimeType='audio/webm'; ondataavailable:any; onstop:any; onerror:any;
  constructor(_stream:any,_options:any) {FakeRecorder.created++;}
  start() {this.state='recording';}
  requestData() {this.ondataavailable?.({data:new Blob(['Audited microphone fixture; never sent externally.'],{type:this.mimeType})});}
  stop() {this.state='inactive';if(FakeRecorder.delayStop) FakeRecorder.pendingStops.push(()=>this.onstop?.());else this.onstop?.();}
}
const conversation=(id:string)=>({id,displayName:`Customer ${id}`,phone:id,status:'open',assistantEnabled:false,unreadCount:0});
const wrapper=({children}:any)=><BrowserRouter><I18nProvider>{children}</I18nProvider></BrowserRouter>;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();localStorage.setItem('adminLocale','ru');window.history.replaceState({},'','/whatsapp');
  feedback.confirm.mockResolvedValue(true);
  FakeRecorder.created=0;
  FakeRecorder.delayStop=false;FakeRecorder.pendingStops=[];
  api.getWhatsAppConsoleStatus.mockResolvedValue({connection:{connected:true},settings:null});
  api.getWhatsAppConversations.mockResolvedValue({conversations:[conversation('A'),conversation('B')],total:2,unread:0});
  api.getWhatsAppConversation.mockImplementation((id)=>Promise.resolve({conversation:conversation(id),messages:[],memories:[]}));
  api.sendWhatsAppVoice.mockImplementation((id)=>Promise.resolve({conversation:conversation(id),message:{id:'voice',conversationId:id},queued:false}));
  vi.stubGlobal('MediaRecorder',FakeRecorder);
});
it('ignores old recorder stop events after a new customer starts recording',async()=>{
  const stops=[vi.fn(),vi.fn()];let streamIndex=0;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockImplementation(async()=>{const stop=stops[streamIndex++];return{getTracks:()=>[{stop}]};})}});
  const{result}=renderHook(()=>useWhatsAppPageController({role:'whatsapp_operator'}),{wrapper});
  await waitFor(()=>expect(result.current.selectedConversation?.id).toBe('A'));
  await act(async()=>result.current.startVoiceRecording());
  FakeRecorder.delayStop=true;
  await act(async()=>result.current.selectConversation('B'));
  await waitFor(()=>expect(result.current.selectedConversation?.id).toBe('B'));
  await act(async()=>result.current.startVoiceRecording());
  expect(result.current.voiceMode).toBe('recording');
  await act(async()=>FakeRecorder.pendingStops.shift()?.());
  expect(result.current.voiceMode).toBe('recording');
  expect(stops[0]).toHaveBeenCalledOnce();expect(stops[1]).not.toHaveBeenCalled();
  expect(api.sendWhatsAppVoice).not.toHaveBeenCalled();
  FakeRecorder.delayStop=false;
  await act(async()=>result.current.stopVoiceRecording(true));
  expect(api.sendWhatsAppVoice.mock.calls[0][0]).toBe('B');
});
it('cancels pending microphone acquisition on a customer switch and can then record for B',async()=>{
  const permission=deferred<any>();
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockReturnValue(permission.promise)}});
  const{result}=renderHook(()=>useWhatsAppPageController({role:'whatsapp_operator'}),{wrapper});
  await waitFor(()=>expect(result.current.selectedConversation?.id).toBe('A'));
  let recording!:Promise<void>;
  act(()=>{recording=result.current.startVoiceRecording();});
  expect(result.current.voiceMode).toBe('acquiring');
  await act(async()=>result.current.selectConversation('B'));
  await waitFor(()=>expect(result.current.selectedConversation?.id).toBe('B'));
  const stop=vi.fn();
  await act(async()=>{permission.resolve({getTracks:()=>[{stop}]});await recording;});
  expect(result.current.selectedConversation?.id).toBe('B');expect(result.current.voiceMode).toBe('idle');
  expect(stop).toHaveBeenCalledOnce();expect(FakeRecorder.created).toBe(0);
  expect(api.sendWhatsAppVoice).not.toHaveBeenCalled();
  await act(async()=>result.current.startVoiceRecording());
  expect(result.current.voiceMode).toBe('recording');
  await act(async()=>result.current.stopVoiceRecording(true));
  expect(api.sendWhatsAppVoice).toHaveBeenCalledTimes(1);
  expect(api.sendWhatsAppVoice.mock.calls[0][0]).toBe('B');
});
it('preserves the page in a reloaded WhatsApp link without an initial search reset',async()=>{
  window.history.replaceState({},'','/whatsapp?page=2');
  const{result}=renderHook(()=>useWhatsAppPageController({role:'whatsapp_operator'}),{wrapper});
  await waitFor(()=>expect(api.getWhatsAppConversations).toHaveBeenCalledWith(expect.objectContaining({page:2}),expect.any(AbortSignal)));
  await act(async()=>new Promise((resolve)=>setTimeout(resolve,400)));
  expect(result.current.conversationPage).toBe(2);
  expect(window.location.search).toBe('?page=2');
  expect(api.getWhatsAppConversations).toHaveBeenCalledTimes(1);
});
it('releases microphone permission granted after leaving the workspace without starting capture',async()=>{
  const permission=deferred<any>();const stop=vi.fn();
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn().mockReturnValue(permission.promise)}});
  const{result,unmount}=renderHook(()=>useWhatsAppPageController({role:'whatsapp_operator'}),{wrapper});
  await waitFor(()=>expect(result.current.selectedConversation?.id).toBe('A'));
  let recording!:Promise<void>;act(()=>{recording=result.current.startVoiceRecording();});
  unmount();
  await act(async()=>{permission.resolve({getTracks:()=>[{stop}]});await recording;});
  expect(stop).toHaveBeenCalledOnce();expect(FakeRecorder.created).toBe(0);
  expect(api.sendWhatsAppVoice).not.toHaveBeenCalled();
});
