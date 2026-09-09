using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Threading;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    internal sealed class StockSnapshot
    {
        [DataMember(Name = "terminalId")] public string TerminalId { get; set; }
        [DataMember(Name = "terminalGroupId")] public string TerminalGroupId { get; set; }
        [DataMember(Name = "sessionId")] public string SessionId { get; set; }
        [DataMember(Name = "sequence")] public long Sequence { get; set; }
        [DataMember(Name = "capturedAt")] public string CapturedAt { get; set; }
        [DataMember(Name = "items")] public List<StockSnapshotItem> Items { get; set; }
    }

    [DataContract]
    internal sealed class StockSnapshotItem
    {
        [DataMember(Name = "productId")] public string ProductId { get; set; }
        [DataMember(Name = "productName")] public string ProductName { get; set; }
        [DataMember(Name = "quantity")] public int Quantity { get; set; }
    }

    internal sealed class StockSync : IDisposable, IObserver<VoidValue>
    {
        private readonly string sessionId = Guid.NewGuid().ToString();
        private readonly IDisposable subscription;
        private readonly Timer timer;
        private long sequence;
        private int dirty = 1, busy, disposed;
        private DateTime lastAttempt = DateTime.MinValue;
        private string status = "Остатки: подключение к Bulka…";

        internal StockSync()
        {
            subscription = PluginContext.Notifications.StopListProductsRemainingAmountsChanged.Subscribe(this);
            timer = new Timer(Tick, null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
        }

        internal string StatusText => status;
        internal void RequestSync() { Interlocked.Exchange(ref dirty, 1); }
        public void OnNext(VoidValue value) { RequestSync(); }
        public void OnCompleted() { }
        public void OnError(Exception error)
        {
            PluginContext.Log.Warn("Bulka stock event failed; periodic snapshots remain enabled: " + error.Message);
            RequestSync();
        }

        private void Tick(object state)
        {
            if (Volatile.Read(ref disposed) != 0 ||
                (Volatile.Read(ref dirty) == 0 && DateTime.UtcNow - lastAttempt < TimeSpan.FromSeconds(15)) ||
                Interlocked.CompareExchange(ref busy, 1, 0) != 0) return;
            try
            {
                Interlocked.Exchange(ref dirty, 0);
                lastAttempt = DateTime.UtcNow;
                var operations = PluginContext.Operations;
                var terminal = operations.GetHostTerminal();
                var group = operations.GetHostTerminalsGroup();
                // One writer per branch. Other registers report their sales to the main register.
                if (group.MainTerminal == null || group.MainTerminal.Id != terminal.Id)
                {
                    status = "Остатки: обмен выполняется на главной кассе филиала";
                    return;
                }
                var remaining = operations.GetStopListProductsRemainingAmounts();
                var items = remaining.GroupBy(entry => entry.Key.Product.Id).Select(entries =>
                {
                    var first = entries.First();
                    var quantity = entries.Min(entry => entry.Value.Item1);
                    var name = first.Key.Product.Name ?? "Товар";
                    return new StockSnapshotItem
                    {
                        ProductId = entries.Key.ToString(),
                        ProductName = name.Length > 160 ? name.Substring(0, 160) : name,
                        Quantity = (int)Math.Min(100000m, Math.Max(0m, decimal.Floor(quantity)))
                    };
                }).OrderBy(item => item.ProductId).ToList();
                // Never truncate a full snapshot: omission means unlimited stock.
                if (items.Count > 450) throw new InvalidOperationException("В стоп-листе больше 450 позиций. Требуется увеличить лимит интеграции.");
                var snapshot = new StockSnapshot
                {
                    TerminalId = terminal.Id.ToString(), TerminalGroupId = group.Id.ToString(),
                    SessionId = sessionId, Sequence = Interlocked.Increment(ref sequence),
                    CapturedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), Items = items
                };
                var response = LoyaltyFlow.SendApiRequest(HttpMethod.Post, "inventory/snapshot", snapshot);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException("Сервер вернул HTTP " + (int)response.StatusCode);
                status = "Остатки: синхронизированы в " + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception error)
            {
                status = "Остатки: нет связи с Bulka. Доступно ручное управление в приложении.";
                PluginContext.Log.Warn("Bulka stock sync: " + error.Message);
                // Next attempt takes a new snapshot, never replays stale quantities.
            }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        public void Dispose()
        {
            Interlocked.Exchange(ref disposed, 1);
            timer.Dispose();
            subscription.Dispose();
        }
    }
}
