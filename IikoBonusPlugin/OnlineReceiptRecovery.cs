using System;
using System.Linq;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Exceptions;
using Resto.Front.Api.Extensions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed partial class OnlineReceiptSync
    {
        private void ReportProblem(IOperationService os,AutomaticReceiptJob job,Exception error)
        {
            var message=FailureMessage(error);
            StatusText="Онлайн-чек №"+job.Number+": "+message;
            PluginContext.Log.Warn(StatusText+"\n"+error);
            try {Action(os,"problem",job.OrderId,error:message.Substring(0,Math.Min(400,message.Length)));} catch { }
        }

        internal static string FailureMessage(Exception error)
        {
            if(!(error is PaymentActionFailedException payment)) return error.Message;
            var reason=payment.Reason?.ToString() ?? "Unknown";
            string hint;
            switch(reason)
            {
                case "UserNotFound":
                case "UserPersonalSessionNotOpened":
                    hint="Разблокируйте iiko Front PIN-кодом и откройте личную смену кассира. Затем повторите закрытие чека.";break;
                case "PaymentTypeNotConfigured":
                    hint="В этой кассе не настроен тип оплаты «Bulka онлайн». Проверьте его привязку к кассе и обработчик BulkaOnline в iikoOffice, затем повторите закрытие.";break;
                case "CannotLockOrder":
                    hint="Чек занят в iiko Front. Выйдите из его редактирования или экрана оплаты и повторите закрытие.";break;
                case "CannotPrintOrder":
                case "ChequeTaskProcessorFailed":
                case "CashRegisterOperationFailed":
                    hint="iiko не подтвердил печать. Проверьте WebKassa, принтер и кассовую смену, затем повторите закрытие исходного чека.";break;
                default:
                    hint="iiko не подтвердил закрытие. Разблокируйте кассу, проверьте смену и повторите закрытие исходного чека.";break;
            }
            var details=string.IsNullOrWhiteSpace(payment.Details) ? payment.Message : payment.Details;
            return hint+" ["+reason+"] "+details;
        }

        internal string RecoverOrder(string orderId)
        {
            if(!Guid.TryParse(orderId,out _)) throw new InvalidOperationException("Чек не связан с онлайн-заказом Bulka.");
            if(disposed || InterlockedBusy()) return "Касса уже обрабатывает чеки. Дождитесь завершения и повторите проверку.";
            try
            {
                if(PosPairing.Current==null) throw new InvalidOperationException("Сначала привяжите кассу.");
                if(!storageHealthy && !TryLoad()) throw new InvalidOperationException(StatusText);
                var os=PluginContext.Operations;
                var response=Request<AutomaticReceiptJobs>("poll",new AutomaticReceiptPoll {
                    TerminalId=os.GetHostTerminal().Id.ToString(),OrderId=orderId,WorkOnly=true});
                if(response?.Jobs==null) throw new InvalidOperationException("Нет ответа об очереди чеков.");
                if(response.Jobs.Any(candidate=>candidate.OrderId!=orderId) || response.Jobs.Count>1)
                    throw new InvalidOperationException("Сервер вернул другой чек. Закрытие остановлено.");
                var job=response.Jobs.SingleOrDefault();
                if(job==null) return "Для этого заказа нет незавершённого чека на этой кассе. Обновите экран; если чек уже оформлен, повторная оплата не требуется.";
                if(!job.FiscalDue) throw new InvalidOperationException("Закрытие чека доступно после выдачи заказа.");
                try
                {
                    if(!Process(job,os)) return StatusText;
                    return StatusText="Чек №"+job.Number+" закрыт в iiko Front. Оплата клиента повторно не списывалась.";
                }
                catch(Exception error) {ReportProblem(os,job,error);throw new InvalidOperationException(StatusText,error);}
            }
            finally {ReleaseWorker();}
        }

        private bool InterlockedBusy() => System.Threading.Interlocked.CompareExchange(ref busy,1,0)!=0;

        internal static IOrder ClosePaidReceipt(IOperationService os,IOrder order)
        {
            if(order.Status==OrderStatus.Closed) return order;
            if(order.Status==OrderStatus.Deleted) throw new InvalidOperationException("Исходный чек удалён. Нужна сверка.");
            if(order.Payments.Count==0)
            {
                var paymentType=FindPaymentType(os);
                // This verifies the existing Bulka payment; it never calls acquiring.
                os.AddExternalPaymentItem(order.ResultSum,false,null,null,paymentType,order,os.GetDefaultCredentials());
                order=os.GetOrderById(order.Id);
            }
            // A retry keeps the ORIGINAL payment item, including Processed state.
            // Disabled/recreated types must not cause us to add or replace it.
            if(order.Payments.Count!=1 || order.Payments[0].Sum!=order.ResultSum ||
                order.Payments[0].Type.Kind!=PaymentTypeKind.External || order.Payments[0].Type.ProcessAsDiscount ||
                os.GetPaymentSystemKey(order.Payments[0].Type)!=OnlinePaymentProcessor.Key)
                throw new InvalidOperationException("В чеке другая оплата или сумма. Автозакрытие остановлено; внесённая оплата сохранена.");
            try {os.PayOrder(order,true,os.GetDefaultCredentials(),null);}
            catch(Exception)
            {
                // The fiscal operation may finish before an SDK response fails.
                // Reconcile the SAME receipt instead of attempting a second sale.
                var current=os.TryGetOrderById(order.Id);
                if(current?.Status==OrderStatus.Closed) return current;
                throw;
            }
            order=os.GetOrderById(order.Id);
            if(order.Status!=OrderStatus.Closed) throw new InvalidOperationException("iiko Front ещё не подтвердил закрытие. Исходная оплата сохранена; повторите проверку.");
            return order;
        }

        internal static void CompletePastReceipt(IOperationService os,string orderId,PastOrder past,Guid receiptId)
        {
            if(past.OrderId!=receiptId || past.Deleted || past.Storned || !string.IsNullOrEmpty(past.WriteoffReason) ||
                past.Items==null || past.Items.Count==0 || past.Payments==null || past.Payments.Count!=1 ||
                past.Items.Any(item=>!item.IsMainDish || item.Product==null || item.ProductSize!=null))
                throw new InvalidOperationException("Архивный чек удалён, возвращён или изменён. Требуется сверка; новый чек не создаётся.");
            var total=past.Items.Sum(item=>item.SumWithDiscounts);
            if(total<=0 || past.Payments[0].Sum!=total)
                throw new InvalidOperationException("Оплата архивного чека не совпадает с суммой. Требуется сверка.");
            var items=past.Items.GroupBy(item=>item.Product.Id).OrderBy(group=>group.Key.ToString())
                .Select(group=>new GuardItem {ProductId=group.Key.ToString(),Quantity=group.Sum(item=>item.Amount)}).ToList();
            var terminal=os.GetHostTerminal().Id.ToString();
            // The same atomic complete RPC checks owner, bound receipt UUID,
            // original items/total, successful payment and refund/delivery guards.
            var result=Request<AutomaticReceiptResult>("action",new AutomaticReceiptAction {
                TerminalId=terminal,OrderId=orderId,Action="complete",ReceiptId=receiptId.ToString(),Items=items,Total=total});
            if(result.Status!="completed") throw new InvalidOperationException("Сервер не подтвердил архивный чек.");
            PickupPhotoRoutes.ForgetCompletedOrder(LoyaltyFlow.BranchId,terminal,orderId,receiptId);
        }
    }
}
