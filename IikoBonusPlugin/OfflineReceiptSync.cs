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
        private readonly Dictionary<string,OfflineReceipt> pending;
        private readonly Dictionary<string,DateTime> attempted=new Dictionary<string,DateTime>();
        private readonly Timer timer;
        private int busy;
        private bool disposed;
        internal string StatusText {get;private set;}="Продажи кассы: ожидание закрытых чеков";
        internal OfflineReceiptSync()
        {
            pending=DurableJsonFile.Read<Dictionary<string,OfflineReceipt>>(path);
            timer=new Timer(Tick,null,TimeSpan.FromSeconds(2),TimeSpan.FromSeconds(3));
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
                if(disposed) return;
                pending[receipt.ReceiptId]=receipt;
                DurableJsonFile.Write(path,pending);
            }
        }
        private void Tick(object state)
        {
            if(Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                List<OfflineReceipt> batch;
                lock(gate) {if(disposed) return;batch=pending.Values.OrderBy(x=>attempted.TryGetValue(x.ReceiptId,out var last) ? last : DateTime.MinValue).Take(25).ToList();}
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
            finally {Interlocked.Exchange(ref busy,0);}
        }
        public void Dispose() {lock(gate) disposed=true;timer.Dispose();}
    }
}
