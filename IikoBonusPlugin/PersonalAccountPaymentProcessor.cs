using System;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Security.Cryptography;
using System.Text;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.Exceptions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    internal sealed class PersonalPosRequest
    {
        [DataMember] public string branchId { get; set; }
        [DataMember] public string orderId { get; set; }
        [DataMember] public decimal amount { get; set; }
        [DataMember] public string fingerprint { get; set; }
        [DataMember(EmitDefaultValue=false)] public string requestId { get; set; }
        [DataMember(EmitDefaultValue=false)] public string customerCode { get; set; }
        [DataMember(EmitDefaultValue=false)] public string id { get; set; }
        [DataMember(EmitDefaultValue=false)] public string action { get; set; }
        [DataMember(EmitDefaultValue=false)] public string code { get; set; }
        [DataMember(EmitDefaultValue=false)] public string transactionId { get; set; }
    }
    [DataContract]
    internal sealed class PersonalPosResult
    {
        [DataMember] public string id { get; set; }
        [DataMember] public string status { get; set; }
        [DataMember] public decimal amount { get; set; }
    }
    [DataContract]
    internal sealed class PersonalPosResponse
    {
        [DataMember] public bool success { get; set; }
        [DataMember] public string error { get; set; }
        [DataMember] public PersonalPosResult payment { get; set; }
    }

    /// <summary>Prepaid customer money, recorded as a full non-cash payment.</summary>
    internal sealed class PersonalAccountPaymentProcessor : IPaymentProcessor
    {
        public string PaymentSystemKey => "BulkaPersonalAccount";
        public string PaymentSystemName => "Bulka личный счёт";
        private static PaymentActionFailedException Failure(string message) => new PaymentActionFailedException(message,true);
        private static string Serialize(PersonalPosRequest value)
        {
            using(var stream=new System.IO.MemoryStream())
            {
                new System.Runtime.Serialization.Json.DataContractJsonSerializer(typeof(PersonalPosRequest)).WriteObject(stream,value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        private static PersonalPosRequest Read(IPaymentDataContext context, bool rollback=false)
        {
            var raw=rollback ? context.GetRollbackData() : context.GetCustomData();
            return string.IsNullOrWhiteSpace(raw) ? null : LoyaltyFlow.DeserializeJson<PersonalPosRequest>(raw);
        }
        private static void Save(IPaymentDataContext context,PersonalPosRequest request)
        {
            request.code=null; request.customerCode=null; request.action=null;
            var raw=Serialize(request); context.SetCustomData(raw); context.SetRollbackData(raw);
        }
        private static string Fingerprint(IOrder order)
        {
            // Include individual item IDs, quantity and price. A changed cheque
            // cannot reuse consent, even when its final total is unchanged.
            var lines=order.Items.Where(x=>!x.Deleted).OrderBy(x=>x.Id).Select(x=>
            {
                var product=x as IOrderProductItem;
                if(product==null) throw Failure("Этот состав чека пока не поддерживается для личного счёта.");
                return product.Id+":"+product.Product.Id+":"+product.Amount.ToString(CultureInfo.InvariantCulture)+":"+
                    product.ResultSum.ToString(CultureInfo.InvariantCulture)+":"+product.Size?.Id+":"+
                    string.Join(",",product.AssignedModifiers.OrderBy(m=>m.Id).Select(m=>m.Id+":"+m.Product.Id+":"+m.Amount.ToString(CultureInfo.InvariantCulture)));
            });
            var raw=order.Id+"|"+order.ResultSum.ToString(CultureInfo.InvariantCulture)+"|"+string.Join("|",lines);
            using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(raw))).Replace("-","").ToLowerInvariant();
        }
        private static PersonalPosResult Send(PersonalPosRequest request,string action)
        {
            request.action=action=="start" ? null : action;
            try
            {
                var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"personal-account/"+(action=="start" ? "start" : "action"),request);
                var result=LoyaltyFlow.DeserializeJson<PersonalPosResponse>(response.Body);
                if(!response.IsSuccessStatusCode || result==null || !result.success || result.payment==null)
                    throw Failure(result?.error ?? "Сервер не подтвердил оплату. Проверьте связь и повторите эту же операцию.");
                return result.payment;
            }
            catch(PaymentActionFailedException) {throw;}
            catch(Exception) {throw Failure("Связь с Bulka потеряна. Результат неизвестен: повторите эту же оплату, не создавая новую.");}
            finally {request.code=null; request.customerCode=null; request.action=null;}
        }
        public void CollectData(Guid orderId,Guid paymentTypeId,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
        {
            var order=PluginContext.Operations.GetOrderById(orderId);
            if(order==null || order.ResultSum<=0 || order.Status==OrderStatus.Closed || order.Status==OrderStatus.Deleted)
                throw Failure("Выберите открытый чек с товарами.");
            var request=Read(context);
            if(request!=null && (request.orderId!=orderId.ToString() || request.fingerprint!=Fingerprint(order)))
                throw Failure("Чек изменился. Удалите прежнюю оплату и запросите новый код.");
            if(request==null) request=new PersonalPosRequest {branchId=LoyaltyFlow.BranchId,orderId=orderId.ToString(),
                amount=order.ResultSum,fingerprint=Fingerprint(order),requestId=Guid.NewGuid().ToString()};
            if(string.IsNullOrWhiteSpace(request.branchId)) throw Failure("Сначала привяжите кассу к филиалу Bulka.");
            Save(context,request);
            if(string.IsNullOrEmpty(request.id))
            {
                var input=vm.ShowExtendedInputDialog("Оплата личным счётом", "Сканируйте QR клиента. Сумма: "+request.amount+" ₸",
                    new ExtendedInputDialogSettings {EnableBarcode=true,TabTitleBarcode="QR клиента"},"Продолжить","Отмена");
                if(input==null) throw new PaymentActionCancelledException();
                var barcode=input as BarcodeInputDialogResult;
                if(barcode==null) throw Failure("Не удалось прочитать QR клиента.");
                request.customerCode=barcode.Barcode;
                var result=Send(request,"start"); request.id=result.id;
                Save(context,request);
            }
            // requestId belongs only to start; action requests have a strict schema.
            request.requestId=null;
            if(Send(request,"status").status=="authorized") {Save(context,request);return;}
            for(var attempt=0;attempt<5;attempt++)
            {
                var input=vm.ShowInputDialog("Клиенту отправлен код в приложение. Сумма "+request.amount+" ₸. Введите 6 цифр из уведомления.",
                    InputDialogTypes.Number,null,"Подтвердить","Отмена");
                if(input==null) {Send(request,"cancel");throw new PaymentActionCancelledException();}
                var number=input as NumberInputDialogResult;
                if(number==null || number.Number<100000 || number.Number>999999) {vm.ShowErrorPopup("Нужен код из 6 цифр.","ОК");continue;}
                request.code=number.Number.ToString(CultureInfo.InvariantCulture);
                try
                {
                    if(Send(request,"confirm").status!="authorized") throw Failure("Подтверждение оплаты не получено.");
                    Save(context,request);return;
                }
                catch(PaymentActionFailedException error) {if(attempt==4) throw;vm.ShowErrorPopup(error.Message,"Повторить");}
            }
            throw Failure("Оплата не подтверждена.");
        }
        private static void PayCore(decimal sum,IOrder order,IPaymentItem item,Guid transaction,IPaymentDataContext context)
        {
            var request=Read(context);
            if(request==null || string.IsNullOrEmpty(request.id) || sum!=order.ResultSum || sum!=request.amount ||
                request.orderId!=order.Id.ToString() || request.fingerprint!=Fingerprint(order) ||
                order.Payments.Any(p=>p.Id!=item.Id && p.Sum>0)) throw Failure("Оплатить можно только весь неизменённый чек. Запросите новый код.");
            request.requestId=null; request.transactionId=transaction.ToString(); Save(context,request);
            if(Send(request,"pay").status!="paid") throw Failure("Списание не подтверждено.");
            context.SetInfoForReports(request.id,"Личный счёт Bulka"); Save(context,request);
        }
        public void Pay(decimal sum,IOrder order,IPaymentItem item,Guid transaction,IPointOfSale pos,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>PayCore(sum,order,item,transaction,context);
        public void PaySilently(decimal sum,IOrder order,IPaymentItem item,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context)=>PayCore(sum,order,item,transaction,context);
        public bool CanPaySilently(decimal sum,Guid? orderId,Guid paymentTypeId,IPaymentDataContext context)=>Read(context)?.id!=null;
        public void OnPaymentAdded(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
        {
            var request=Read(context);
            if(request==null || request.id==null || item.Sum!=order.ResultSum || item.Sum!=request.amount || request.fingerprint!=Fingerprint(order)) throw Failure("Требуется подтверждение всей суммы чека.");
        }
        public bool OnPreliminaryPaymentEditing(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>false;
        public void OnPaymentDeleting(IOrder order,IPaymentItem item,IUser cashier,IOperationService os,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)
        {
            if(item.Status==PaymentStatus.Processed) throw Failure("Для оплаченного чека выполните возврат оплаты.");
            var request=Read(context);if(request?.id==null) return;request.requestId=null;Send(request,"cancel");
        }
        private static void Refund(decimal sum,Guid? orderId,IPaymentDataContext context,Guid? transaction=null)
        {
            var request=Read(context,true) ?? Read(context);
            if(request?.id==null) throw Failure("Не найдены данные исходной оплаты. Требуется сверка.");
            if(!orderId.HasValue || request.orderId!=orderId.Value.ToString() || sum!=request.amount) throw Failure("Доступен только полный возврат исходной оплаты.");
            request.requestId=null;
            if(string.IsNullOrEmpty(request.transactionId) && transaction.HasValue) request.transactionId=transaction.Value.ToString();
            var result=Send(request,"refund");
            if(result.status!="refunded" && result.status!="cancelled") throw Failure("Возврат ещё не подтверждён. Повторите операцию.");
        }
        public void ReturnPayment(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>Refund(sum,orderId,context);
        public void ReturnPaymentSilently(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context)=>Refund(sum,orderId,context);
        public void ReturnPaymentWithoutOrder(decimal sum,Guid? orderId,Guid paymentType,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm)=>throw Failure("Возврат возможен только по исходному чеку.");
        public void EmergencyCancelPayment(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IViewManager vm,IPaymentDataContext context)=>Refund(sum,orderId,context,transaction);
        public void EmergencyCancelPaymentSilently(decimal sum,Guid? orderId,Guid paymentType,Guid transaction,IPointOfSale pos,IUser cashier,IReceiptPrinter printer,IPaymentDataContext context)=>Refund(sum,orderId,context,transaction);
    }
}
