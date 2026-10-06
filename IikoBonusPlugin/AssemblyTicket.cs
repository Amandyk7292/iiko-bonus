using System;
using System.Linq;
using System.Xml.Linq;
using System.Net.Http;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization.Sections;
using Resto.Front.Api.Data.Print;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class AssemblyTicket
    {
        internal static void Reprint(IOrder order,IOperationService os,IViewManager vm)
        {
            try
            {
                var id=OnlineReceiptSync.OrderId(order);
                if(id==null) throw new InvalidOperationException("Выберите онлайн-заказ Bulka.");
                if(!vm.ShowOkCancelPopup("Сборочный чек", "Проверьте ленту принтера. Напечатать ещё один экземпляр для сборки заказа № "+order.Number+"?", "Печатать", "Отмена")) return;
                var printer=Printer(os,order);
                var jobs=OnlineReceiptSync.Request<AutomaticReceiptJobs>("poll",new AutomaticReceiptPoll {TerminalId=os.GetHostTerminal().Id.ToString()});
                var job=jobs.Jobs.SingleOrDefault(j=>j.OrderId==id);
                if(job==null) throw new InvalidOperationException("Задание завершено или закреплено за другой кассой.");
                using(var lease=PickupPhotoRoutes.TryReservePrint())
                {
                    if(lease==null) throw new InvalidOperationException("Принтер занят. Дождитесь завершения печати.");
                    OnlineReceiptSync.Action(os,"claim",id);
                    OnlineReceiptSync.Action(os,"bind",id,order);
                    if(job.AssemblyStatus=="pending") OnlineReceiptSync.Action(os,"assembly-claim",id,order);
                    Print(os,printer,order,job.Number,id,true);
                    OnlineReceiptSync.Action(os,"assembly-complete",id,order);
                }
            }
            catch(Exception error) {vm.ShowErrorPopup(error.Message,"ОК");}
        }
        internal static IPrinterQueueRef Printer(IOperationService os,IOrder order)
        {
            return PrinterForSection(os,order.Tables.FirstOrDefault()?.RestaurantSection);
        }
        internal static IPrinterQueueRef PrinterForSection(IOperationService os,IRestaurantSection section)
        {
            var printer=os.TryGetBillPrinter(section,true);var kind="bill";
            if(printer==null) {printer=os.TryGetDocumentPrinter(section,true);kind="document";}
            if(printer==null) throw new InvalidOperationException("Настройте принтер пречеков или документов для сборочного чека.");
            PickupPhotoRoutes.BindQueue(os,printer,section?.Id,kind);return printer;
        }
        internal static void Print(IOperationService os,IPrinterQueueRef printer,IOrder order,long number,
            string serverOrderId=null,bool printGateHeld=false)
        {
            var doc=new XElement("doc",
                new XElement("f2",new XElement("center","ЗАКАЗ № "+order.Number)),
                new XElement("center","СБОРОЧНЫЙ ЧЕК"),
                new XElement("left","Bulka № "+number),new XElement("line"));
            var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/receipt-draft",new ReceiptDraftRequest {Number=number});
            var draft=LoyaltyFlow.DeserializeJson<ReceiptDraft>(response.Body);
            if(!response.IsSuccessStatusCode || draft?.Items==null || draft.Items.Count==0)
                throw new InvalidOperationException("Не удалось загрузить состав для сборки. Проверьте заказ перед повторной печатью.");
            if(serverOrderId!=null && (!Guid.TryParse(serverOrderId,out var expectedOrder)
                || !Guid.TryParse(draft.Id,out var actualOrder) || expectedOrder!=actualOrder))
                throw new InvalidOperationException("Состав относится к другому заказу. Печать остановлена для сверки.");
            if(draft.DeliveryResolution?.Unresolved == true)
                throw new InvalidOperationException("Замена доставки ожидает подтверждения. Печать пока недоступна.");
            if(draft.DeliveryResolution?.Status == "pickup_accepted")
            {
                doc.Add(new XElement("center", "Замена доставки"), new XElement("center", "Самовывоз"));
                if(DateTimeOffset.TryParse(draft.DeliveryResolution.PickupTime, out var pickup))
                    doc.Add(new XElement("left", "Получение: " + pickup.ToLocalTime().ToString("dd.MM HH:mm")));
            }
            foreach(var item in draft.Items)
                doc.Add(new XElement("left",item.Quantity.ToString("0.###")+" × "+
                    (string.IsNullOrWhiteSpace(item.CustomName) ? item.Name : item.CustomName)));
            doc.Add(new XElement("line"),new XElement("center","Для сборки заказа. Не фискальный чек."));
            using(var lease=printGateHeld ? null : PickupPhotoRoutes.TryReservePrint())
            {
                if(!printGateHeld && lease==null) throw new InvalidOperationException("Принтер занят. Дождитесь завершения печати.");
                var observation=PickupPhotoRoutes.Attach(printer,doc);var success=false;
                try
                {
                    success=os.Print(printer,(Document)doc,true);
                    if(!success) throw new InvalidOperationException("Принтер не подтвердил сборочный чек. Проверьте бумагу перед повторной печатью.");
                }
                finally {PickupPhotoRoutes.Complete(observation,success,serverOrderId,order.Id,number,draft.PickupPhotoId);}
            }
        }
    }
}
