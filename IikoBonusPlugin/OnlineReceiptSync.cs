using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Extensions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class OnlineReceiptSync : IDisposable
    {
        internal const string Prefix="Bulka:";
        internal const string OrderDataKey="bulka.onlineOrderId";
        private readonly string path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaAutomaticReceipts.json");
        private Dictionary<string,AutomaticReceiptJob> ledger=new Dictionary<string,AutomaticReceiptJob>();
        private bool storageHealthy;
        private readonly SharedStockGuard importer;
        private readonly Timer timer;
        private int busy;
        private volatile bool disposed;
        private volatile int pendingCount;
        internal string StatusText {get;private set;}="Онлайн-чеки: ожидание привязки кассы";
        internal int PendingCount => pendingCount;
        internal OnlineReceiptSync(SharedStockGuard guard)
        {
            importer=guard;
            TryLoad();
            timer=new Timer(Tick,null,TimeSpan.FromSeconds(8),TimeSpan.FromSeconds(5));
        }
        private bool TryLoad()
        {
            try
            {
                ledger=DurableJsonFile.ReadValidated<Dictionary<string,AutomaticReceiptJob>>(path,
                    entries=>entries.All(p=>p.Value!=null && p.Key==p.Value.OrderId && Guid.TryParse(p.Key,out _)
                        && (p.Value.ReceiptId==null || Guid.TryParse(p.Value.ReceiptId,out _))),false);
                storageHealthy=true;
                return true;
            }
            catch(Exception error)
            {
                storageHealthy=false;
                StatusText="Онлайн-чеки: журнал повреждён; требуется сверка исходных чеков, автосоздание остановлено";
                PluginContext.Log.Error("Bulka automatic receipt journal: "+error.Message);
                return false;
            }
        }
        internal static string OrderId(IOrder order)
        {
            if(order==null) return null;
            try
            {
                var stored=PluginContext.Operations.TryGetOrderExternalDataByKey(order,OrderDataKey);
                if(Guid.TryParse(stored,out var linked)) return linked.ToString();
            }
            catch { }
            var value=order?.ExternalNumber;
            return value!=null && value.StartsWith(Prefix,StringComparison.Ordinal) && Guid.TryParse(value.Substring(Prefix.Length),out var id)
                ? id.ToString() : null;
        }
        internal static T Request<T>(string endpoint,object body)
        {
            var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/receipts/"+endpoint,body);
            if(!response.IsSuccessStatusCode)
            {
                AutomaticReceiptResult error=null;
                try { error=LoyaltyFlow.DeserializeJson<AutomaticReceiptResult>(response.Body); } catch { }
                throw new InvalidOperationException(error?.Error ?? "Нет подтверждения Bulka для кассового чека");
            }
            return LoyaltyFlow.DeserializeJson<T>(response.Body);
        }
        internal static AutomaticReceiptResult Action(IOperationService os,string action,string id,IOrder order=null,string error=null)
        {
            var request=new AutomaticReceiptAction {TerminalId=os.GetHostTerminal().Id.ToString(),OrderId=id,Action=action,
                ReceiptId=order?.Id.ToString(),Error=error};
            if(action=="verify" || action=="complete" || action=="return")
            {
                request.Items=ReceiptItems(order);
                request.Total=order.ResultSum;
            }
            return Request<AutomaticReceiptResult>("action",request);
        }
        internal static List<GuardItem> ReceiptItems(IOrder order)
        {
            var items=new List<GuardItem>();
            foreach(var item in order.Items.Where(x=>!x.Deleted))
            {
                if(!(item is IOrderProductItem product) || product.Product==null || product.Size!=null || product.AssignedModifiers.Count>0)
                    throw new InvalidOperationException("Состав чека изменён. Требуется сверка онлайн-заказа.");
                items.Add(new GuardItem {ProductId=product.Product.Id.ToString(),Quantity=product.Amount});
            }
            return items.GroupBy(x=>x.ProductId).OrderBy(g=>g.Key)
                .Select(g=>new GuardItem {ProductId=g.Key,Quantity=g.Sum(x=>x.Quantity)}).ToList();
        }
        internal static IPaymentType FindPaymentType(IOperationService os)
        {
            var types=os.GetPaymentTypes().Where(p=>p.Kind==PaymentTypeKind.External && p.IsEnabled && !p.ProcessAsDiscount
                && os.GetPaymentSystemKey(p)==OnlinePaymentProcessor.Key).ToList();
            if(types.Count!=1) throw new InvalidOperationException("В iikoOffice создайте один внешний тип оплаты «Bulka онлайн» и выберите обработчик «Bulka онлайн».");
            return types[0];
        }
        private void Tick(object state)
        {
            if(disposed || PosPairing.Current==null || Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                if(!storageHealthy && !TryLoad()) return;
                var os=PluginContext.Operations;
                var jobs=Request<AutomaticReceiptJobs>("poll",new AutomaticReceiptPoll {TerminalId=os.GetHostTerminal().Id.ToString()});
                if(jobs?.Jobs==null) throw new InvalidOperationException("Не читается очередь онлайн-чеков");
                pendingCount=jobs.Jobs.Count;
                foreach(var job in jobs.Jobs)
                {
                    if(disposed) break;
                    try { Process(job,os); StatusText="Онлайн-чеки: переданы в iikoFront"; }
                    catch(Exception error)
                    {
                        StatusText="Онлайн-чек №"+job.Number+": "+error.Message;
                        PluginContext.Log.Warn(StatusText);
                        try { Action(os,"problem",job.OrderId,error:error.Message.Substring(0,Math.Min(400,error.Message.Length))); } catch { }
                    }
                }
            }
            catch(Exception error) {StatusText="Онлайн-чеки: "+error.Message;}
            finally {Interlocked.Exchange(ref busy,0);}
        }
        internal void RequestRetry() {ThreadPool.QueueUserWorkItem(Tick);}
        internal string CheckAndRecover()
        {
            if(disposed || Interlocked.CompareExchange(ref busy,1,0)!=0)
                return "Очередь уже обрабатывается. Повторите проверку после завершения текущей операции.";
            try {
                if(PosPairing.Current==null) return "Сначала привяжите кассу.";
                var os=PluginContext.Operations;
                var jobs=Request<AutomaticReceiptJobs>("poll",new AutomaticReceiptPoll {TerminalId=os.GetHostTerminal().Id.ToString()});
                if(jobs?.Jobs==null) throw new InvalidOperationException("Нет ответа об очереди чеков.");
                if(jobs.Jobs.Count==0) return "Сервер не сообщает незавершённых заданий для этой кассы.";
                var result=new List<string>();
                foreach(var job in jobs.Jobs) {
                    try { Process(job,os); result.Add("№"+job.Number+": обработан текущий доступный этап"); }
                    catch(Exception error) {
                        result.Add("№"+job.Number+": "+error.Message);
                        try {Action(os,"problem",job.OrderId,error:error.Message.Substring(0,Math.Min(400,error.Message.Length)));} catch {}
                    }
                }
                return string.Join("\n\n",result);
            } finally {Interlocked.Exchange(ref busy,0);}
        }
        private void Process(AutomaticReceiptJob job,IOperationService os)
        {
            var paymentType=job.FiscalDue ? FindPaymentType(os) : null;
            var terminal=os.GetHostTerminal();
            if(os.GetHostTerminalsGroup().MainTerminal?.Id!=terminal.Id && !os.IsConnectedToMainTerminal())
                throw new InvalidOperationException("Нет связи с главной кассой. Чек сохранён в очереди.");
            var claim=Action(os,"claim",job.OrderId);
            if(claim.Status=="completed") return;
            if(!ledger.TryGetValue(job.OrderId,out var saved))
            {saved=job;ledger.Add(job.OrderId,saved);DurableJsonFile.Write(path,ledger);}
            if(claim.ReceiptId!=null) saved.ReceiptId=claim.ReceiptId;
            IOrder order=null;
            if(Guid.TryParse(saved.ReceiptId,out var receiptId)) order=os.TryGetOrderById(receiptId);
            if(order==null) order=os.GetOrders(true,false).SingleOrDefault(o=>
                (o.ExternalNumber==Prefix+job.OrderId || o.ExternalNumber=="Bulka №"+job.Number) && OrderId(o)==job.OrderId);
            if(order==null)
            {
                if(saved.CreationStarted || saved.ReceiptId!=null)
                    throw new InvalidOperationException("После сбоя не найден исходный чек. Нужна сверка; второй чек автоматически не создаётся.");
                var sections=os.GetHostTerminalRestaurantSections().Select(s=>s.Id).ToArray();
                var table=os.GetTables(false).FirstOrDefault(t=>t.IsActive && sections.Contains(t.RestaurantSection.Id));
                if(table==null) throw new InvalidOperationException("На кассе не настроен зал со столом для онлайн-чеков.");
                var edit=os.CreateEditSession();
                var stub=edit.CreateOrder(new[]{table},true,false,null);
                edit.AddOrderGuest("Bulka",stub);
                edit.ChangeOrderExternalNumber("Bulka №"+job.Number,stub);
                edit.AddOrderExternalData(OrderDataKey,new ExternalDataItem(job.OrderId,false),stub);
                var credentials=os.GetDefaultCredentials();
                saved.CreationStarted=true;
                DurableJsonFile.Write(path,ledger); // Written before an uncertain create response.
                try { order=os.SubmitChanges(edit,credentials).Get(stub); }
                catch(Resto.Front.Api.Exceptions.ConstraintViolationException) {
                    // Validation rejected the edit session; no order was committed.
                    saved.CreationStarted=false;
                    DurableJsonFile.Write(path,ledger);
                    throw;
                }
                catch(Resto.Front.Api.Exceptions.CannotCreateEntityException) {
                    // iiko rejected CreateOrder itself. A later poll may retry;
                    // transport/unknown failures still retain CreationStarted.
                    saved.CreationStarted=false;
                    DurableJsonFile.Write(path,ledger);
                    throw new InvalidOperationException("iikoFront отказал в создании заказа. Проверьте связь с главной кассой; повтор будет выполнен автоматически.");
                }
                catch(Exception error) {
                    PluginContext.Log.Error("Bulka receipt creation failed for " + job.Number + ": " + error);
                    throw;
                }
            }
            saved.ReceiptId=order.Id.ToString();
            DurableJsonFile.Write(path,ledger);
            Action(os,"bind",job.OrderId,order);
            if(order.Status==OrderStatus.Deleted) throw new InvalidOperationException("Связанный чек удалён. Нужна сверка.");
            if(order.Status==OrderStatus.Closed) {Action(os,"complete",job.OrderId,order);return;}
            if(job.AssemblyStatus!="printed")
            {
                if(saved.AssemblyPrinted) Action(os,"assembly-complete",job.OrderId,order);
                else
                {
                    var printer=AssemblyTicket.Printer(os,order);
                    var printClaim=Action(os,"assembly-claim",job.OrderId,order);
                    if(printClaim.Status=="print")
                    {
                        AssemblyTicket.Print(os,printer,order,job.Number);
                        saved.AssemblyPrinted=true;
                        DurableJsonFile.Write(path,ledger);
                        Action(os,"assembly-complete",job.OrderId,order);
                    }
                }
            }
            if(!job.FiscalDue) return;
            order=importer.ImportReceipt(order,job.Number,os,false);
            if(Action(os,"verify",job.OrderId,order).Status!="verified") throw new InvalidOperationException("Оплата Bulka не подтверждена");
            if(order.Payments.Count==0)
            {
                // The processor verifies a prior online payment; it never calls an acquiring terminal.
                os.AddExternalPaymentItem(order.ResultSum,false,null,null,paymentType,order,os.GetDefaultCredentials());
                order=os.GetOrderById(order.Id);
            }
            if(order.Payments.Count!=1 || order.Payments[0].Type.Id!=paymentType.Id || order.Payments[0].Sum!=order.ResultSum)
                throw new InvalidOperationException("В чеке другая оплата или сумма. Автозакрытие остановлено.");
            os.PayOrder(order,true,os.GetDefaultCredentials(),null);
            order=os.GetOrderById(order.Id);
            if(order.Status!=OrderStatus.Closed) throw new InvalidOperationException("iikoFront ещё не подтвердил закрытие чека");
            Action(os,"complete",job.OrderId,order);
        }
        public void Dispose() {disposed=true;timer.Dispose();}
    }
}
