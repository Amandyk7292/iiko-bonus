using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Text;
using System.Threading;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class InboxItem
    {
        [DataMember(Name="name")] public string Name { get; set; }
        [DataMember(Name="quantity")] public decimal Quantity { get; set; }
    }
    [DataContract] internal sealed class InboxOrder
    {
        [DataMember(Name="id")] public string Id { get; set; }
        [DataMember(Name="number")] public long Number { get; set; }
        [DataMember(Name="phone")] public string Phone { get; set; }
        [DataMember(Name="customer")] public string Customer { get; set; }
        [DataMember(Name="items")] public List<InboxItem> Items { get; set; }
        [DataMember(Name="orderType")] public string OrderType { get; set; }
        [DataMember(Name="preorderType")] public string PreorderType { get; set; }
        [DataMember(Name="scheduledAt")] public string ScheduledAt { get; set; }
        [DataMember(Name="amount")] public decimal Amount { get; set; }
        [DataMember(Name="deliveryFee")] public decimal DeliveryFee { get; set; }
        [DataMember(Name="comment")] public string Comment { get; set; }
        internal string TypeLabel => OrderType=="preorder" ? "Предзаказ · "+(PreorderType=="delivery" ? "Доставка" : "Самовывоз") : OrderType=="delivery" ? "Доставка" : "Самовывоз";
    }
    [DataContract] internal sealed class InboxResponse
    {
        [DataMember(Name="orders")] public List<InboxOrder> Orders { get; set; }
        [DataMember(Name="total")] public int Total { get; set; }
    }
    [DataContract] internal sealed class InboxDecision
    {
        [DataMember(Name="orderId")] public string OrderId { get; set; }
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="action")] public string Action { get; set; }
    }
    [DataContract] internal sealed class InboxPoll
    {
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
    }
    internal sealed class OnlineOrderInbox : IDisposable
    {
        private readonly Timer timer;
        private int busy;
        private DateTime lastNotification=DateTime.MinValue;
        private string lastKey="";
        private string lastDescription="";
        internal OnlineOrderInbox() { timer=new Timer(Poll,null,TimeSpan.FromSeconds(5),TimeSpan.FromSeconds(5)); }
        private static InboxResponse Load(int page,bool peek=false)
        {
            var response=peek
                ? LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/poll",new InboxPoll {TerminalId=PluginContext.Operations.GetHostTerminal().Id.ToString()})
                : LoyaltyFlow.SendApiRequest(HttpMethod.Get,"orders/inbox?page="+page);
            if(!response.IsSuccessStatusCode) throw new InvalidOperationException("Не удалось получить заказы Bulka. Проверьте связь и настройку филиала.");
            var result=LoyaltyFlow.DeserializeJson<InboxResponse>(response.Body);
            if(result?.Orders==null) throw new InvalidOperationException("Некорректный ответ списка заказов.");
            return result;
        }
        private void Poll(object state)
        {
            if(Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                var result=Load(1,true);
                if(result.Total==0) { lastKey=""; return; }
                var key=result.Orders.FirstOrDefault()?.Id+":"+result.Total;
                if(key==lastKey && DateTime.UtcNow-lastNotification<TimeSpan.FromSeconds(30)) return;
                if(key!=lastKey)
                {
                    var incoming=Load(1).Orders.FirstOrDefault();
                    if(incoming==null) return;
                    lastDescription="Новый заказ Bulka №"+incoming.Number+" · "+incoming.TypeLabel+"\n"+incoming.Phone+"\n"+
                        string.Join("; ",(incoming.Items ?? new List<InboxItem>()).Take(5).Select(item=>item.Name+" × "+item.Quantity));
                }
                PluginContext.Operations.AddNotificationMessage(lastDescription+
                    "\nОжидают принятия: "+result.Total+". Откройте «Заказы Bulka».","BulkaOnlineOrders",TimeSpan.FromSeconds(30));
                lastKey=key; lastNotification=DateTime.UtcNow;
            }
            catch(Exception error) { PluginContext.Log.Warn("Bulka inbox: "+error.Message); }
            finally { Interlocked.Exchange(ref busy,0); }
        }
        internal void Show(IViewManager vm)
        {
            int page=1;
            while(true)
            {
                try
                {
                    var result=Load(page);
                    var labels=result.Orders.Select(order=>"№"+order.Number+" · "+order.TypeLabel+" · "+order.Amount.ToString("0.##")+" ₸\n"+
                        string.Join(", ",(order.Items ?? new List<InboxItem>()).Take(3).Select(item=>item.Name+" × "+item.Quantity))).ToList();
                    int refresh=labels.Count; labels.Add("Обновить список");
                    int previous=labels.Count; if(page>1) labels.Add("Предыдущая страница"); else previous=-1;
                    int next=labels.Count; if(page*25<result.Total) labels.Add("Следующая страница"); else next=-1;
                    int choice=vm.ShowChooserPopup("Новые заказы Bulka · "+result.Total,labels,-1,ButtonWidth.Normal,"Закрыть");
                    if(choice<0) return;
                    if(choice==refresh) continue;
                    if(choice==previous) {page--;continue;}
                    if(choice==next) {page++;continue;}
                    var selected=result.Orders[choice];
                    var details=new StringBuilder(selected.TypeLabel+"\n"+selected.Customer+" · "+selected.Phone+"\n\n");
                    foreach(var item in selected.Items ?? new List<InboxItem>()) details.AppendLine(item.Name+" — "+item.Quantity+" шт.");
                    if(!string.IsNullOrWhiteSpace(selected.ScheduledAt) && DateTimeOffset.TryParse(selected.ScheduledAt,out var scheduled)) details.AppendLine("Ко времени: "+scheduled.ToLocalTime().ToString("dd.MM HH:mm"));
                    details.AppendLine("\nОплачено: "+selected.Amount.ToString("0.##")+" ₸");
                    if(selected.DeliveryFee>0) details.AppendLine("В том числе доставка: "+selected.DeliveryFee.ToString("0.##")+" ₸");
                    if(!string.IsNullOrWhiteSpace(selected.Comment)) details.AppendLine("Комментарий: "+selected.Comment);
                    var accept=vm.ShowYesNoCancelPopup("Заказ №"+selected.Number,details.ToString(),"Принять","Отклонить","Назад");
                    if(!accept.HasValue) continue;
                    if(!accept.Value && !vm.ShowOkCancelPopup("Отклонить заказ №"+selected.Number,
                        "Клиент увидит «Нет в наличии». Оплата будет возвращена на исходный способ оплаты.","Отклонить","Назад")) continue;
                    var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/decision",new InboxDecision {
                        OrderId=selected.Id,TerminalId=PluginContext.Operations.GetHostTerminal().Id.ToString(),Action=accept.Value ? "accept" : "reject" });
                    if(!response.IsSuccessStatusCode)
                    {
                        GuardResponse error=null;
                        try {error=LoyaltyFlow.DeserializeJson<GuardResponse>(response.Body);} catch { }
                        throw new InvalidOperationException(error?.Error ?? "Действие не подтверждено. Обновите заказ перед повтором.");
                    }
                    vm.ShowOkPopup("Заказ №"+selected.Number,accept.Value ? "Заказ принят. Статус обновлён у клиента." : "Отмена оформлена. Статус возврата доступен в Bulka.","ОК");
                    page=1;
                }
                catch(Exception error) {vm.ShowErrorPopup(error.Message,"ОК");return;}
            }
        }
        public void Dispose() { timer.Dispose(); }
    }
}
