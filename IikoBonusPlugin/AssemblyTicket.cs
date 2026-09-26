using System;
using System.Linq;
using System.Xml.Linq;
using System.Net.Http;
using Resto.Front.Api.Data.Orders;
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
                OnlineReceiptSync.Action(os,"claim",id);
                OnlineReceiptSync.Action(os,"bind",id,order);
                if(job.AssemblyStatus=="pending") OnlineReceiptSync.Action(os,"assembly-claim",id,order);
                Print(os,printer,order,job.Number);
                OnlineReceiptSync.Action(os,"assembly-complete",id,order);
            }
            catch(Exception error) {vm.ShowErrorPopup(error.Message,"ОК");}
        }
        internal static IPrinterQueueRef Printer(IOperationService os,IOrder order)
        {
            var section=order.Tables.FirstOrDefault()?.RestaurantSection;
            return os.TryGetBillPrinter(section,true) ?? os.TryGetDocumentPrinter(section,true)
                ?? throw new InvalidOperationException("Настройте принтер пречеков или документов для сборочного чека.");
        }
        internal static void Print(IOperationService os,IPrinterQueueRef printer,IOrder order,long number)
        {
            var doc=new XElement("doc",
                new XElement("f2",new XElement("center","ЗАКАЗ № "+order.Number)),
                new XElement("center","СБОРОЧНЫЙ ЧЕК"),
                new XElement("left","Bulka № "+number),new XElement("line"));
            var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/receipt-draft",new ReceiptDraftRequest {Number=number});
            var draft=LoyaltyFlow.DeserializeJson<ReceiptDraft>(response.Body);
            if(!response.IsSuccessStatusCode || draft?.Items==null || draft.Items.Count==0)
                throw new InvalidOperationException("Не удалось загрузить состав для сборки. Проверьте заказ перед повторной печатью.");
            foreach(var item in draft.Items)
                doc.Add(new XElement("left",item.Quantity.ToString("0.###")+" × "+
                    (string.IsNullOrWhiteSpace(item.CustomName) ? item.Name : item.CustomName)));
            doc.Add(new XElement("line"),new XElement("center","Для сборки заказа. Не фискальный чек."));
            if(!os.Print(printer,(Document)doc,true))
                throw new InvalidOperationException("Принтер не подтвердил сборочный чек. Проверьте бумагу перед повторной печатью.");
        }
    }
}
