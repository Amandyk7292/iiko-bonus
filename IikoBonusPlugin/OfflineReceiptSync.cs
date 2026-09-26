using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Threading;
using Resto.Front.Api.Data.Orders;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class OfflineReceipt
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="receiptId")] public string ReceiptId {get;set;}
        [DataMember(Name="closedAt")] public string ClosedAt {get;set;}
        [DataMember(Name="items")] public List<GuardItem> Items {get;set;}
        [DataMember(Name="total")] public decimal Total {get;set;}
    }
    internal sealed class OfflineReceiptSync : IDisposable
    {
        private readonly object gate=new object();
        private readonly string path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaOfflineReceipts.json");
        private Dictionary<string,OfflineReceipt> pending=new Dictionary<string,OfflineReceipt>();
        private readonly HashSet<string> captured=new HashSet<string>();
        private readonly Dictionary<string,DateTime> attempted=new Dictionary<string,DateTime>();
        private readonly Timer timer;
        private readonly DateTime sessionStartedUtc=DateTime.UtcNow;
        private int busy;
        private bool disposed;
        private bool storageHealthy;
        private DateTime lastScan=DateTime.MinValue;
        internal string StatusText {get;private set;}="Продажи кассы: ожидание закрытых чеков";
        internal OfflineReceiptSync()
        {
            TryLoad();
            timer=new Timer(Tick,null,TimeSpan.FromSeconds(2),TimeSpan.FromSeconds(3));
        }
        private bool TryLoad()
        {
            try
            {
                pending=DurableJsonFile.ReadValidated<Dictionary<string,OfflineReceipt>>(path,
                    entries=>entries.All(p=>p.Value!=null && Guid.TryParse(p.Key,out _) && p.Key==p.Value.ReceiptId
                        && DateTimeOffset.TryParse(p.Value.ClosedAt,out _) && p.Value.Total>=0 && p.Value.Items!=null
                        && p.Value.Items.Count>0 && p.Value.Items.All(i=>i!=null && Guid.TryParse(i.ProductId,out _) && i.Quantity>0)),true);
                // A recovered backup can predate an in-memory capture. Re-scan
                // those closed orders instead of trusting the old seen set.
                captured.Clear();
                foreach(var id in pending.Keys) captured.Add(id);
                storageHealthy=true;
                lastScan=DateTime.MinValue;
                StatusText="Продажи кассы: журнал готов, проверяются закрытые чеки";
                return true;
            }
            catch(Exception error)
            {
                storageHealthy=false;
                StatusText="Продажи кассы: журнал повреждён; требуется восстановление и сверка";
                PluginContext.Log.Error("Bulka offline receipt journal: "+error.Message);
                return false;
            }
        }
        internal void EnsureHealthy()
        {
            lock(gate)
                if(!storageHealthy && !TryLoad())
                    throw new InvalidOperationException(StatusText);
        }
        internal void Observe(IOrder order)
        {
            if(PosPairing.Current==null || order?.Status!=OrderStatus.Closed || !order.CloseTime.HasValue
                || order.StornedOrderId.HasValue || OnlineReceiptSync.OrderId(order)!=null) return;
            var receipt=new OfflineReceipt {TerminalId=PluginContext.Operations.GetHostTerminal().Id.ToString(),
                ReceiptId=order.Id.ToString(),ClosedAt=order.CloseTime.Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                Items=OnlineReceiptSync.ReceiptItems(order),Total=order.ResultSum};
            if(receipt.Items.Count==0) return;
            lock(gate)
            {
                if(disposed || captured.Contains(receipt.ReceiptId)) return;
                if(!storageHealthy) throw new InvalidOperationException(StatusText);
                pending[receipt.ReceiptId]=receipt;
                try {DurableJsonFile.Write(path,pending);}
                catch {storageHealthy=false;StatusText="Продажи кассы: ошибка записи журнала; оплата приостановлена";throw;}
                captured.Add(receipt.ReceiptId);
            }
        }
        private void Tick(object state)
        {
            if(Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                lock(gate) {if(disposed || (!storageHealthy && !TryLoad())) return;}
                // Recover events missed in this session while storage was
                // unavailable. Do not import historical sales on installation:
                // they may already be included in the current stock count.
                if(DateTime.UtcNow-lastScan>=TimeSpan.FromSeconds(30))
                {
                    foreach(var order in PluginContext.Operations.GetOrders(true,false))
                    {
                        try
                        {
                            if(order?.CloseTime?.ToUniversalTime()>=sessionStartedUtc) Observe(order);
                        }
                        catch(Exception error)
                        {
                            StatusText="Продажи кассы: чек требует сверки — "+error.Message;
                            PluginContext.Log.Warn("Bulka offline receipt recovery: "+error.Message);
                        }
                    }
                    lastScan=DateTime.UtcNow;
                }
                List<OfflineReceipt> batch;
                lock(gate) {if(disposed || !storageHealthy) return;batch=pending.Values.OrderBy(x=>attempted.TryGetValue(x.ReceiptId,out var last) ? last : DateTime.MinValue).Take(25).ToList();}
                foreach(var receipt in batch)
                {
                    lock(gate) attempted[receipt.ReceiptId]=DateTime.UtcNow;
                    try
                    {
                        // The active device sends its own credentials, even if the
                        // same group mirrored the closed receipt on another POS.
                        receipt.TerminalId=PluginContext.Operations.GetHostTerminal().Id.ToString();
                        var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"inventory/offline-receipt",receipt);
                        var result=LoyaltyFlow.DeserializeJson<GuardResponse>(response.Body);
                        if(!response.IsSuccessStatusCode || result?.Status!="recorded")
                            throw new InvalidOperationException(result?.Error ?? "Не подтверждено списание витрины");
                        lock(gate)
                        {
                            pending.Remove(receipt.ReceiptId);
                            try {DurableJsonFile.Write(path,pending);attempted.Remove(receipt.ReceiptId);}
                            catch {pending[receipt.ReceiptId]=receipt;throw;}
                        }
                        StatusText="Продажи кассы: витрина обновлена";
                    }
                    catch(Exception error)
                    {
                        StatusText="Продажи кассы: ожидают сверки — "+error.Message;
                        PluginContext.Log.Warn("Bulka offline receipt "+receipt.ReceiptId+": "+error.Message);
                        // Move a disputed receipt behind the others. One failure
                        // must not prevent unrelated closed receipts from syncing.
                    }
                }
            }
            catch(Exception error)
            {
                StatusText="Продажи кассы: требуется связь или восстановление журнала — "+error.Message;
                PluginContext.Log.Warn("Bulka offline receipt worker: "+error.Message);
            }
            finally {Interlocked.Exchange(ref busy,0);}
        }
        public void Dispose() {lock(gate) disposed=true;timer.Dispose();}
    }
}
