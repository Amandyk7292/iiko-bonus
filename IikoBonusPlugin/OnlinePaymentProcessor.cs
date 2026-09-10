using System;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Exceptions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    // Records the payment already received by Bulka. There is deliberately no
    // acquiring/charge API in this processor, including silent retries.
    internal sealed class OnlinePaymentProcessor : IPaymentProcessor
    {
        internal const string Key="BulkaOnline";
        public string PaymentSystemKey=>Key;
        public string PaymentSystemName=>"Bulka онлайн";
        private static PaymentActionFailedException Failure(string message)=>new PaymentActionFailedException(message,false);
        private static string RequireOrder(IOrder order)
        {
            var id=OnlineReceiptSync.OrderId(order);
            if(id==null) throw Failure("Этот способ оплаты доступен только для связанного оплаченного заказа Bulka.");
            return id;
        }
        private static void Verify(decimal sum,IOrder order,IOperationService os,IPaymentDataContext context)
        {
            try
            {
                var id=RequireOrder(order);
                if(sum!=order.ResultSum) throw Failure("Сумма внешней оплаты не совпадает с заказом Bulka.");
                var result=OnlineReceiptSync.Action(os,"verify",id,order);
                if(result.Status!="verified") throw Failure("Оплата Bulka не подтверждена.");
                context.SetCustomData(id);
                context.SetRollbackData(id);
                context.SetInfoForReports("Bulka №"+result.Number,"Оплачено онлайн в Bulka");
            }
            catch(PaymentActionFailedException) {throw;}
            catch(Exception error) {throw Failure(error.Message);}
        }
        public void CollectData(Guid orderId,Guid paymentTypeId,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context) { }
        public void Pay(decimal sum,IOrder order,IPaymentItem item,Guid transaction,IPointOfSale pos,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
            =>Verify(sum,order,os,context);
        public void PaySilently(decimal sum,IOrder order,IPaymentItem item,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context)
            =>Verify(sum,order,PluginContext.Operations,context);
        public bool CanPaySilently(decimal sum,Guid? orderId,Guid paymentTypeId,IPaymentDataContext context)=>orderId.HasValue;
        public void OnPaymentAdded(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
            =>Verify(item.Sum,order,os,context);
        public bool OnPreliminaryPaymentEditing(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>false;
        public void OnPaymentDeleting(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
        {
            if(item.Status==PaymentStatus.Processed) throw Failure("Оплата уже учтена. Для возврата используйте заказ в Bulka.");
        }
        private static void Return(decimal sum,Guid? orderId)
        {
            if(!orderId.HasValue) throw Failure("Возврат без исходного заказа Bulka недоступен.");
            var os=PluginContext.Operations;
            var order=os.GetOrderById(orderId.Value);
            var id=RequireOrder(order);
            if(sum!=order.ResultSum) throw Failure("Возврат чека Bulka должен соответствовать полной сумме исходного чека.");
            try
            {
                if(OnlineReceiptSync.Action(os,"return",id,order).Status!="refunded")
                    throw Failure("Возврат в Bulka ещё не подтверждён.");
            }
            catch(Exception error) {throw Failure(error.Message);}
        }
        public void ReturnPayment(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>Return(sum,orderId);
        public void ReturnPaymentSilently(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context)=>Return(sum,orderId);
        public void ReturnPaymentWithoutOrder(decimal sum,Guid? orderId,Guid paymentType,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm)
            =>throw Failure("Возврат оформляется по исходному заказу в Bulka.");
        // Cancelling a failed local receipt does not cancel/refund a real online
        // payment. That original payment remains available for the same receipt.
        public void EmergencyCancelPayment(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context) { }
        public void EmergencyCancelPaymentSilently(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context) { }
    }
}
