using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Threading;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.Extensions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    internal sealed class GuardItem
    {
        [DataMember(Name="productId")] public string ProductId { get; set; }
        [DataMember(Name="quantity")] public decimal Quantity { get; set; }
    }
    [DataContract]
    internal sealed class GuardRequest
    {
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="receiptId")] public string ReceiptId { get; set; }
        [DataMember(Name="items")] public List<GuardItem> Items { get; set; }
        [DataMember(Name="total")] public decimal Total { get; set; }
        [DataMember(Name="onlineNumber",EmitDefaultValue=false)] public long? OnlineNumber { get; set; }
        [DataMember(Name="state",EmitDefaultValue=false)] public string State { get; set; }
        [DataMember(Name="acknowledged",EmitDefaultValue=false)] public bool Acknowledged { get; set; }
        [DataMember(Name="authorizationConfirmed",EmitDefaultValue=false)] public bool AuthorizationConfirmed { get; set; }
        [DataMember(Name="lastError",EmitDefaultValue=false)] public string LastError { get; set; }
    }
    [DataContract]
    internal sealed class GuardHeartbeat
    {
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="connected")] public bool Connected { get; set; }
    }
    [DataContract]
    internal sealed class GuardRecount
    {
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="recountId")] public string RecountId { get; set; }
        [DataMember(Name="items",EmitDefaultValue=false)] public List<StockSnapshotItem> Items { get; set; }
    }
    [DataContract]
    internal sealed class GuardResponse
    {
        [DataMember(Name="enabled")] public bool Enabled { get; set; }
        [DataMember(Name="registered")] public bool Registered { get; set; }
        [DataMember(Name="ready")] public bool Ready { get; set; }
        [DataMember(Name="status")] public string Status { get; set; }
        [DataMember(Name="onlineNumber")] public long? OnlineNumber { get; set; }
        [DataMember(Name="error")] public string Error { get; set; }
        [DataMember(Name="recountId")] public string RecountId { get; set; }
    }

    internal sealed partial class SharedStockGuard : IDisposable
    {
        private readonly object gate = new object();
        private readonly string path = Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaSharedStock.json");
        private readonly Dictionary<string,GuardRequest> requests;
        private readonly Timer timer;
        private bool storageHealthy = true;
        private int busy;
        private string status = "Общий учёт: ожидает настройки филиала";
        private readonly bool enabledAtStartup;
        internal bool Enabled => enabledAtStartup || (PosPairing.Current?.SharedStockEnabled ?? false);
        internal string StatusText => status;

        internal SharedStockGuard()
        {
            // The persisted ledger also acts as an arming marker: flipping the
            // config off cannot silently remove protection from existing holds.
            enabledAtStartup = File.Exists(path) || File.Exists(Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaSharedStock.enabled")) || string.Equals(LoyaltyFlow.ReadPluginSetting("IIKO_SHARED_STOCK_ENABLED"),"true",StringComparison.OrdinalIgnoreCase);
            requests = new Dictionary<string,GuardRequest>();
            if (File.Exists(path))
            {
                try
                {
                    using(var stream=File.OpenRead(path)) requests=(Dictionary<string,GuardRequest>)new DataContractJsonSerializer(requests.GetType()).ReadObject(stream);
                    if(requests==null || requests.Any(pair=>pair.Value==null || pair.Key!=pair.Value.ReceiptId || pair.Value.Items==null))
                        throw new InvalidDataException("Invalid stock ledger");
                }
                catch(Exception error) { requests=new Dictionary<string,GuardRequest>(); storageHealthy=false; PluginContext.Log.Error("Bulka shared stock ledger unreadable: "+error.Message); }
            }
            else if(Enabled)
            {
                try { Save(); }
                catch(Exception error) {storageHealthy=false; PluginContext.Log.Error("Bulka shared stock ledger could not be created: "+error.Message);}
            }
            timer=new Timer(Tick,null,TimeSpan.FromSeconds(3),TimeSpan.FromSeconds(10));
        }
        internal bool IsLinked(IOrder order)
        {
            lock(gate) return order!=null && requests.TryGetValue(order.Id.ToString(),out var request) && request.OnlineNumber.HasValue;
        }
        private void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var temporary=path+".tmp";
            using(var stream=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None))
            {
                new DataContractJsonSerializer(requests.GetType()).WriteObject(stream,requests);
                stream.Flush(true);
            }
            if(File.Exists(path)) File.Replace(temporary,path,path+".bak"); else File.Move(temporary,path);
        }
        private static GuardResponse Send(string endpoint,object request)
        {
            var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"inventory/"+endpoint,request);
            GuardResponse parsed=null;
            try { parsed=LoyaltyFlow.DeserializeJson<GuardResponse>(response.Body); } catch { }
            if(!response.IsSuccessStatusCode) throw new InvalidOperationException(parsed?.Error ?? "Нет подтверждения Bulka. Проверьте связь и повторите тот же чек.");
            if(parsed==null) throw new InvalidOperationException("Не удалось проверить ответ Bulka.");
            return parsed;
        }
        private void Heartbeat(IOperationService os,bool requireReady)
        {
            if(!storageHealthy) throw new InvalidOperationException("Не читается журнал резервов. Нужна сверка с администратором; оплата заблокирована.");
            var terminal=os.GetHostTerminal();
            var group=os.GetHostTerminalsGroup();
            var connected=group.MainTerminal!=null && (group.MainTerminal.Id==terminal.Id || os.IsConnectedToMainTerminal());
            var result=Send("heartbeat",new GuardHeartbeat { TerminalId=terminal.Id.ToString(),Connected=connected });
            if(requireReady && (!result.Enabled || !result.Registered || !result.Ready || !connected))
                throw new InvalidOperationException("Эта касса не готова к продаже: проверьте связь, регистрацию кассы и режим учёта филиала.");
            status=result.Enabled && result.Ready ? "Общий учёт: кассы подключены" : "Общий учёт: продажи требуют настройки или восстановления связи";
        }
        private static GuardRequest Build(IOrder order,IOperationService os,long? number)
        {
            var items=new List<GuardItem>();
            foreach(var root in order.Items.Where(item=>!item.Deleted))
            {
                var product=root as IOrderProductItem;
                if(product==null || product.Product==null || product.Size!=null || product.AssignedModifiers.Count>0
                    || product.Amount<=0 || product.Amount!=decimal.Round(product.Amount,3) || product.Amount>9999
                    || (!product.Product.UseBalanceForSell && product.Amount!=decimal.Floor(product.Amount)))
                    throw new InvalidOperationException("Проверьте количество товара. Вес учитывается до 0,001 единицы; размеры и модификаторы требуют отдельной настройки.");
                items.Add(new GuardItem { ProductId=product.Product.Id.ToString(),Quantity=product.Amount });
            }
            return new GuardRequest { TerminalId=os.GetHostTerminal().Id.ToString(),ReceiptId=order.Id.ToString(),
                Items=items.GroupBy(x=>x.ProductId).OrderBy(x=>x.Key).Select(x=>new GuardItem {ProductId=x.Key,Quantity=x.Sum(v=>v.Quantity)}).ToList(),
                Total=order.ResultSum,OnlineNumber=number };
        }
        internal void BeforeOperation(IOrder order,IOperationService os,IViewManager vm,bool payment)
        {
            if(!Enabled || order==null) return;
            try
            {
                lock(gate)
                {
                    Heartbeat(os,true);
                    if(requests.TryGetValue(order.Id.ToString(),out var unresolved) && !unresolved.AuthorizationConfirmed)
                    {
                        if(unresolved.OnlineNumber.HasValue)
                            throw new InvalidOperationException("Завершите привязку через кнопку «Онлайн-заказ». Повторная оплата клиентом запрещена.");
                        ResolvePendingLink(order.Id.ToString());
                    }
                    requests.TryGetValue(order.Id.ToString(),out var saved);
                    var request=Build(order,os,saved?.OnlineNumber);
                    if(saved!=null && (saved.TerminalId!=request.TerminalId || saved.State!=null
                        || !SameItems(saved.Items,request.Items)))
                        throw new InvalidOperationException("Состав или касса закреплённого чека изменились. Закройте исходный чек либо отмените его и выполните сверку остатков.");
                    if(request.OnlineNumber.HasValue)
                    {
                        if(PluginEntry.ActiveOrders.ContainsKey(order.Id) || GiftCertificateFlow.HasActiveOrder(order.Id))
                            throw new InvalidOperationException("В онлайн-заказе нельзя повторно применять бонусы или сертификат.");
                        if(payment && (order.Payments.Count!=1 || !order.Payments.All(p=>p.IsProcessedExternally && p.IsExternal)
                            || order.Payments.Sum(p=>p.Sum)!=order.ResultSum))
                            throw new InvalidOperationException("Онлайн-заказ уже оплачен. Используйте кнопку «Онлайн-заказ» для учёта внешней оплаты.");
                    }
                    Authorize(request);
                }
            }
            catch(Exception error)
            {
                vm.ShowErrorPopup(error.Message,"ОК");
                throw new OperationCanceledException("Bulka shared stock is not confirmed.",error);
            }
        }
        private static bool SameItems(List<GuardItem> a,List<GuardItem> b) =>
            a.Count==b.Count && a.Zip(b,(x,y)=>x.ProductId==y.ProductId && x.Quantity==y.Quantity).All(x=>x);

        internal void LinkOnline(IOrder order,IOperationService os,IViewManager vm,long selectedNumber)
        {
            if(!Enabled) { vm.ShowErrorPopup("Сначала настройте общий учёт на всех кассах филиала.","ОК"); return; }
            try
            {
                lock(gate)
                {
                    Heartbeat(os,true);
                    if(order==null || order.Status==OrderStatus.Closed || order.Status==OrderStatus.Deleted) return;
                    if(PluginEntry.ActiveOrders.ContainsKey(order.Id) || GiftCertificateFlow.HasActiveOrder(order.Id))
                        throw new InvalidOperationException("Сначала уберите отдельные бонусы или сертификат из этого чека.");
                    if(!Guid.TryParse(LoyaltyFlow.ReadPluginSetting("IIKO_ONLINE_PAYMENT_TYPE_ID"),out var paymentTypeId))
                        throw new InvalidOperationException("Настройте отдельный тип оплаты «Bulka онлайн» с разрешённой внешней оплатой.");
                    var type=os.GetPaymentTypes().SingleOrDefault(p=>p.Id==paymentTypeId && p.CanBeExternalProcessed && p.IsEnabled && !p.ProcessAsDiscount);
                    if(type==null) throw new InvalidOperationException("Тип «Bulka онлайн» недоступен для внешней оплаты.");
                    ResolvePendingLink(order.Id.ToString());
                    requests.TryGetValue(order.Id.ToString(),out var saved);
                    if(saved!=null && !saved.OnlineNumber.HasValue) throw new InvalidOperationException("Этот чек уже закреплён как продажа с витрины. Для онлайн-заказа создайте отдельный чек.");
                    if(saved?.OnlineNumber != null && saved.OnlineNumber != selectedNumber)
                        throw new InvalidOperationException("Чек уже связан с другим заказом Bulka. Откройте пустой чек.");
                    long? number=selectedNumber;
                    if(number<=0) throw new InvalidOperationException("Введите номер заказа Bulka.");
                    if(order.Payments.Any(p=>!p.IsExternal || !p.IsProcessedExternally || p.Type.Id!=paymentTypeId))
                        throw new InvalidOperationException("Уберите обычную оплату из чека: онлайн-заказ уже оплачен клиентом.");
                    order=ImportReceipt(order,number.Value,os);
                    var request=Build(order,os,number);
                    Authorize(request);
                    if(order.Payments.Count==0)
                        os.AddExternalPaymentItem(request.Total,true,null,null,type,order,os.GetDefaultCredentials());
                    vm.ShowOkPopup("Онлайн-заказ","Заказ №"+number+" связан с чеком. Оплата уже проведена в Bulka; повторное списание не требуется.","ОК");
                }
            }
            catch(Exception error) {
                lock(gate)
                    if(order!=null && requests.TryGetValue(order.Id.ToString(),out var saved)) RecordProblem(saved,error);
                vm.ShowErrorPopup(error.Message,"ОК");
            }
        }
        internal void Recount(IOperationService os,IViewManager vm)
        {
            if(!Enabled) {vm.ShowErrorPopup("Общий учёт пока не настроен.","ОК");return;}
            try
            {
                lock(gate)
                {
                    if(os.GetHostTerminalsGroup().MainTerminal?.Id!=os.GetHostTerminal().Id)
                        throw new InvalidOperationException("Сверка витрины выполняется на главной кассе.");
                    if(!vm.ShowOkCancelPopup("Сверить витрину",
                        "Убедитесь, что в остатках iikoFront указано фактическое количество готовых изделий, включая отложенные оплаченные онлайн-заказы. На время сверки продажи будут приостановлены.","Сверить","Отмена")) return;
                    Heartbeat(os,false);
                    // Flush known results first. Unknown/absent receipts remain held on the server.
                    ObserveIndependently(os);
                    var request=new GuardRecount {TerminalId=os.GetHostTerminal().Id.ToString(),RecountId=Guid.NewGuid().ToString()};
                    var begin=Send("recount",request);
                    if(begin.Status!="paused" || !Guid.TryParse(begin.RecountId,out var recountId))
                        throw new InvalidOperationException("Не удалось начать сверку.");
                    request.RecountId=recountId.ToString();
                    request.Items=os.GetStopListProductsRemainingAmounts().GroupBy(entry=>entry.Key.Product.Id)
                        .Select(entries=>new StockSnapshotItem {ProductId=entries.Key.ToString(),
                            ProductName=(entries.First().Key.Product.Name ?? "Товар").Substring(0,Math.Min(160,(entries.First().Key.Product.Name ?? "Товар").Length)),
                            Quantity=decimal.Truncate(Math.Min(100000m,Math.Max(0m,entries.Min(entry=>entry.Value.Item1)))*1000m)/1000m,
                            QuantityStep=entries.First().Key.Product.UseBalanceForSell ? 0.001m : 1m,
                            Unit=entries.First().Key.Product.UseBalanceForSell ? (entries.First().Key.Product.MeasuringUnit?.Name ?? "кг") : "шт."})
                        .OrderBy(item=>item.ProductId).ToList();
                    if(request.Items.Count==0 || request.Items.Count>450) throw new InvalidOperationException("Задайте численные остатки витрины в iikoFront. Продажи остаются приостановлены до повторной сверки.");
                    if(Send("recount",request).Status!="completed") throw new InvalidOperationException("Сверка не подтверждена. Повторите её после восстановления связи.");
                    vm.ShowOkPopup("Витрина","Количество обновлено. Резервы оплаченных заказов сохранены.","ОК");
                }
            }
            catch(Exception error) {vm.ShowErrorPopup(error.Message,"ОК");}
        }
        private void Tick(object state)
        {
            if(!Enabled || Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                lock(gate)
                {
                    Heartbeat(PluginContext.Operations,false);
                    ObserveIndependently(PluginContext.Operations);
                }
            }
            catch(Exception error) { status="Общий учёт: требуется связь или сверка"; PluginContext.Log.Warn("Bulka shared stock: "+error.Message); }
            finally { Interlocked.Exchange(ref busy,0); }
        }
        private void ObserveCore(IOrder order)
        {
            if(!Enabled || order==null) return;
            lock(gate)
            {
                if(!requests.TryGetValue(order.Id.ToString(),out var saved)) return;
                if(saved.Acknowledged) return;
                if(order.Status!=OrderStatus.Closed && order.Status!=OrderStatus.Deleted) return;
                // Keep tombstones indefinitely. An absent local order is NOT proof of cancellation.
                var outcome=order.Status==OrderStatus.Closed ? "closed" : "voided";
                if(!RecoverUnconfirmedOutcome(saved,outcome)) return;
                var finish=new GuardRequest {TerminalId=saved.TerminalId,ReceiptId=saved.ReceiptId,Items=saved.Items,Total=saved.Total,State=outcome};
                if(outcome=="closed")
                {
                    var actual=Build(order,PluginContext.Operations,saved.OnlineNumber);
                    if(actual.Total!=saved.Total || !SameItems(actual.Items,saved.Items))
                        throw new InvalidOperationException("Закрытый чек отличается от резерва. Нужна ручная сверка; товар остаётся закреплённым.");
                }
                saved.State=outcome;
                Save();
                var result=Send("finish",finish);
                if(result.Status!=outcome) throw new InvalidOperationException("Итог чека ещё не подтверждён Bulka.");
                saved.Acknowledged=true;
                saved.LastError=null;
                Save();
            }
        }
        public void Dispose() { timer.Dispose(); }
    }
}
