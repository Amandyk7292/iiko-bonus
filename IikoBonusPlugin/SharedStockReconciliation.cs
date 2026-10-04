using System;
using System.Linq;
using System.Threading;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed partial class SharedStockGuard
    {
        private void Authorize(GuardRequest request)
        {
            // This is an unconfirmed intent, not a binding. Preserve it across
            // network loss so the same receipt can safely recover its result.
            requests[request.ReceiptId]=request;
            receiptLinks[request.ReceiptId]=request.OnlineNumber.HasValue;
            Save();
            try
            {
                var result=Send("authorize",request);
                if(result.Status!="reserved")
                    throw new InvalidOperationException("Bulka не подтвердила резерв товара.");
                request.AuthorizationConfirmed=true;
                request.LastError=null;
                Save();
            }
            catch(Exception error)
            {
                RecordProblem(request,error);
                throw;
            }
        }

        private void ResolvePendingLink(string receipt)
        {
            if(!requests.TryGetValue(receipt,out var saved)
                || saved.AuthorizationConfirmed || saved.Acknowledged) return;
            var result=Send("receipt",new ReceiptLookup {TerminalId=saved.TerminalId,ReceiptId=receipt});
            if(result.Status=="absent")
            {
                requests.Remove(receipt);
                receiptLinks.TryRemove(receipt,out _);
                Save();
                return;
            }
            if(result.Status!="reserved" || result.OnlineNumber!=saved.OnlineNumber)
                throw new InvalidOperationException("Чек уже закреплён или завершён. Откройте «Сверка чеков Bulka».");
            saved.AuthorizationConfirmed=true;
            saved.LastError=null;
            Save();
        }

        private void RecordProblem(GuardRequest request,Exception error)
        {
            request.LastError=(error.Message ?? "Сверка не подтверждена").Substring(0,Math.Min(600,(error.Message ?? "Сверка не подтверждена").Length));
            try { Save(); }
            catch(Exception storageError)
            {
                storageHealthy=false;
                PluginContext.Log.Error("Bulka reconciliation ledger: "+storageError.Message);
            }
        }

        internal void Observe(IOrder order)
        {
            if(Volatile.Read(ref disposed)!=0 || !Enabled || order==null
                || (order.Status!=OrderStatus.Closed && order.Status!=OrderStatus.Deleted)
                || !receiptLinks.ContainsKey(order.Id.ToString())) return;
            // SDK order snapshots are immutable. Preserve the first terminal
            // outcome and keep notification callbacks off the network lock.
            observedOrders.TryAdd(order.Id.ToString(),order);
            StartObservationWorker();
        }

        private void StartObservationWorker()
        {
            if(Volatile.Read(ref disposed)!=0 || Interlocked.CompareExchange(ref observing,1,0)!=0) return;
            ThreadPool.QueueUserWorkItem(_ => {
                try
                {
                    while(Volatile.Read(ref disposed)==0 && !observedOrders.IsEmpty)
                        foreach(var key in observedOrders.Keys)
                        {
                            if(Volatile.Read(ref disposed)!=0) break;
                            if(!observedOrders.TryGetValue(key,out var order)) continue;
                            try { ReconcileOutcome(order); }
                            catch(Exception error) {PluginContext.Log.Warn("Bulka receipt "+order.Id+": "+error.Message);}
                        }
                }
                finally
                {
                    Interlocked.Exchange(ref observing,0);
                    if(Volatile.Read(ref disposed)==0 && !observedOrders.IsEmpty) StartObservationWorker();
                }
            });
        }

        private void ReconcileOutcome(IOrder order)
        {
            lock(gate)
            {
                if(Volatile.Read(ref disposed)!=0) return;
                // A periodic scan must not overtake an earlier queued close or
                // deletion snapshot while its notification waits for this gate.
                if(order!=null && observedOrders.TryRemove(order.Id.ToString(),out var first)) order=first;
                try { ObserveCore(order); }
                catch(Exception error)
                {
                    if(order!=null && requests.TryGetValue(order.Id.ToString(),out var saved))
                        RecordProblem(saved,error);
                    throw;
                }
            }
        }

        private bool RecoverUnconfirmedOutcome(GuardRequest saved,string outcome)
        {
            if(saved.AuthorizationConfirmed) return true;
            var result=Send("receipt",new ReceiptLookup {TerminalId=saved.TerminalId,ReceiptId=saved.ReceiptId});
            if(result.Status=="absent")
            {
                if(outcome=="closed")
                    throw new InvalidOperationException("Закрытый чек не имеет подтверждённого резерва Bulka. Требуется сверка с администратором.");
                saved.State="voided";
                saved.Acknowledged=true;
                saved.LastError=null;
                Save();
                return false;
            }
            if(result.OnlineNumber!=saved.OnlineNumber)
                throw new InvalidOperationException("Номер онлайн-заказа в журнале не совпал с сервером. Требуется сверка.");
            saved.AuthorizationConfirmed=true;
            Save();
            return true;
        }

        private void ObserveIndependently(IOperationService os)
        {
            foreach(var order in os.GetOrders(true,false))
            {
                try { ReconcileOutcome(order); }
                catch(Exception error)
                {
                    PluginContext.Log.Warn("Bulka receipt "+order.Id+": "+error.Message);
                }
            }
        }

        internal void ShowReconciliation(IOperationService os,IViewManager vm)
        {
            lock(gate)
            {
                while(true)
                {
                    var problems=requests.Values.Where(r=>!r.Acknowledged &&
                        (!r.AuthorizationConfirmed || r.LastError!=null || r.State!=null)).ToList();
                    var description=problems.Count==0 ? "Спорных операций нет." :
                        string.Join("\n\n",problems.Select(r=>
                            (r.OnlineNumber.HasValue ? "Заказ №"+r.OnlineNumber+"\n" : "")+
                            "Чек "+r.ReceiptId+"\n"+(r.LastError ?? "Ожидается подтверждение сервера")));
                    if(!vm.ShowOkCancelPopup("Сверка чеков Bulka",description,"Повторить сверку","Закрыть")) return;
                    ObserveIndependently(os);
                }
            }
        }
    }

    [System.Runtime.Serialization.DataContract]
    internal sealed class ReceiptLookup
    {
        [System.Runtime.Serialization.DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [System.Runtime.Serialization.DataMember(Name="receiptId")] public string ReceiptId {get;set;}
    }
}
