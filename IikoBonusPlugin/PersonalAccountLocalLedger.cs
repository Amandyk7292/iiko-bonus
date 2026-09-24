using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using Resto.Front.Api.Data.Orders;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    internal sealed class PersonalAccountLocalPayment
    {
        [DataMember] public string OrderId {get;set;}
        [DataMember] public string PaymentId {get;set;}
        [DataMember] public string TransactionId {get;set;}
        [DataMember] public string Fingerprint {get;set;}
        [DataMember] public decimal Amount {get;set;}
        [DataMember] public string Status {get;set;}
        [DataMember] public string LastError {get;set;}
        [DataMember] public string UpdatedAt {get;set;}
    }

    internal static class PersonalAccountLocalLedger
    {
        private static readonly object Gate=new object();
        private static readonly string PathName=Path.Combine(
            LoyaltyFlow.DataDirectoryPath,"BulkaPersonalAccountPayments.json");
        private static readonly Dictionary<string,PersonalAccountLocalPayment> Items=Load();

        private static Dictionary<string,PersonalAccountLocalPayment> Load()
        {
            try {return DurableJsonFile.Read<Dictionary<string,PersonalAccountLocalPayment>>(PathName);}
            catch(Exception error)
            {
                PluginContext.Log.Error("Bulka personal account ledger unreadable: "+error.Message);
                return new Dictionary<string,PersonalAccountLocalPayment>();
            }
        }

        private static void Save() {DurableJsonFile.Write(PathName,Items);}

        internal static int PendingCount {get {lock(Gate) return Items.Count;}}
        internal static string StatusText
        {
            get
            {
                lock(Gate)
                {
                    if(Items.Count==0) return "Личный счёт: незавершённых оплат нет";
                    return "Личный счёт: требуют сверки — "+Items.Count+"\n"+
                        string.Join("\n",Items.Values.Take(5).Select(item =>
                            item.OrderId+": "+item.Status+(string.IsNullOrWhiteSpace(item.LastError) ? "" : " — "+item.LastError)));
                }
            }
        }

        internal static List<PersonalAccountLocalPayment> Snapshot()
        {
            lock(Gate) return Items.Values.Select(item => new PersonalAccountLocalPayment {
                OrderId=item.OrderId,PaymentId=item.PaymentId,TransactionId=item.TransactionId,
                Fingerprint=item.Fingerprint,Amount=item.Amount,Status=item.Status,
                LastError=item.LastError,UpdatedAt=item.UpdatedAt
            }).ToList();
        }

        internal static void Begin(PersonalPosRequest request)
        {
            lock(Gate)
            {
                Items[request.orderId]=new PersonalAccountLocalPayment {
                    OrderId=request.orderId,PaymentId=request.id,TransactionId=request.transactionId,
                    Fingerprint=request.fingerprint,Amount=request.amount,Status="processing",
                    UpdatedAt=DateTime.UtcNow.ToString("o")
                };
                Save();
            }
        }

        internal static void MarkPaid(string orderId)
        {
            lock(Gate)
            {
                if(!Items.TryGetValue(orderId,out var item)) return;
                item.Status="paid_waiting_for_receipt";
                item.LastError=null;
                item.UpdatedAt=DateTime.UtcNow.ToString("o");
                Save();
            }
        }

        internal static void MarkError(string orderId,string error)
        {
            lock(Gate)
            {
                if(!Items.TryGetValue(orderId,out var item)) return;
                item.LastError=(error ?? "Неизвестный результат").Substring(0,Math.Min(500,(error ?? "Неизвестный результат").Length));
                item.UpdatedAt=DateTime.UtcNow.ToString("o");
                Save();
            }
        }

        internal static void Remove(string orderId)
        {
            lock(Gate) if(Items.Remove(orderId)) Save();
        }

        internal static void RequestRetry()
        {
            foreach(var item in Snapshot().Take(10))
            {
                try
                {
                    var status=PersonalAccountPaymentProcessor.CheckStatus(item);
                    if(status=="paid") MarkPaid(item.OrderId);
                    else if(status=="refunded" || status=="cancelled") Remove(item.OrderId);
                    else MarkError(item.OrderId,"Сервер: "+status+". Завершите исходный чек на кассе.");
                }
                catch(Exception error) {MarkError(item.OrderId,error.Message);}
            }
        }

        internal static void Observe(IOrder order)
        {
            if(order==null) return;
            lock(Gate)
            {
                if(!Items.TryGetValue(order.Id.ToString(),out var item)) return;
                if(order.Status==OrderStatus.Closed)
                {
                    Items.Remove(order.Id.ToString());
                    Save();
                }
                else if(order.Status==OrderStatus.Deleted)
                {
                    item.LastError="Чек удалён после запроса списания. Требуется ручная сверка.";
                    item.UpdatedAt=DateTime.UtcNow.ToString("o");
                    Save();
                }
            }
        }
    }
}
