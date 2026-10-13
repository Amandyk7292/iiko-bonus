using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Extensions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class VirtualPosSync : IDisposable
    {
        internal const string OrderDataKey="bulka.virtualSaleId";
        internal const string Prefix="Bulka POS:";
        private readonly string path;
        private readonly Func<HttpMethod,string,object,VirtualPosResponse> transport;
        private readonly Timer timer;
        private readonly object ledgerGate=new object();
        private Dictionary<string,VirtualPosLedgerEntry> ledger;
        private bool storageHealthy;
        private volatile bool disposed;
        private int busy;
        internal string StatusText {get;private set;}="Касса Bulka: ожидает привязки";

        internal VirtualPosSync(bool startTimer=true,string ledgerPath=null,
            Func<HttpMethod,string,object,VirtualPosResponse> request=null)
        {
            path=ledgerPath ?? Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaVirtualPosSales.json");
            transport=request ?? Request;
            TryLoad();
            if(startTimer) timer=new Timer(Tick,null,TimeSpan.FromSeconds(10),TimeSpan.FromSeconds(3));
        }
        private bool TryLoad()
        {
            try
            {
                ledger=DurableJsonFile.ReadValidated<Dictionary<string,VirtualPosLedgerEntry>>(path,
                    entries=>entries.All(p=>p.Value!=null && p.Key==p.Value.SaleId && Guid.TryParse(p.Key,out _)
                        && Guid.TryParse(p.Value.TerminalId,out _) && Guid.TryParse(p.Value.BranchId,out _)
                        && !string.IsNullOrWhiteSpace(p.Value.Digest)
                        && p.Value.Quote!=null && p.Value.Quote.SaleId==p.Key && p.Value.Quote.Items!=null
                        && p.Value.Quote.Items.Count>0 && p.Value.Digest==Digest(p.Value.Quote)
                        && p.Value.Quote.TerminalId==p.Value.TerminalId && p.Value.Quote.CashShiftId==p.Value.CashShiftId
                        && p.Value.Quote.PaymentTypeId==p.Value.PaymentTypeId && p.Value.Quote.Total==p.Value.Total
                        && (p.Value.FrontOrderId==null || Guid.TryParse(p.Value.FrontOrderId,out _))
                        && new[]{"prepared","creating","created","payment_started","completed","rejected","needs_reconciliation"}.Contains(p.Value.Phase)),false);
                storageHealthy=true;return true;
            }
            catch(Exception error)
            {
                storageHealthy=false;StatusText="Касса Bulka: журнал требует сверки; продажи остановлены";
                PluginContext.Log.Error("Bulka virtual POS journal: "+error.Message);return false;
            }
        }
        private static VirtualPosResponse Request(HttpMethod method,string endpoint,object payload)
        {
            var response=LoyaltyFlow.SendApiRequest(method,"virtual-pos/"+endpoint,payload);
            VirtualPosResponse parsed=null;
            try {parsed=LoyaltyFlow.DeserializeJson<VirtualPosResponse>(response.Body);} catch { }
            if(!response.IsSuccessStatusCode || parsed?.Success!=true)
                throw new InvalidOperationException(parsed?.Error ?? "Сервер не подтвердил операцию кассы Bulka.");
            return parsed;
        }
        private void Save() {lock(ledgerGate) DurableJsonFile.Write(path,ledger);}
        private static VirtualPosCommand ImmutableQuote(VirtualPosCommand command)
        {
            return new VirtualPosCommand {
                SaleId=command.SaleId,TerminalId=command.TerminalId,CashShiftId=command.CashShiftId,
                PaymentTypeId=command.PaymentTypeId,SnapshotRevision=command.SnapshotRevision,
                Items=command.Items?.Select(i=>new VirtualPosItem {ProductId=i.ProductId,Quantity=i.Quantity,
                    Price=i.Price,Name=i.Name,LineTotal=i.LineTotal}).ToList(),Total=command.Total
            };
        }
        internal static string Digest(VirtualPosCommand command)
        {
            // Transport phase and lease are intentionally excluded. A restart
            // must resume the same immutable sale, never a changed payload.
            return VirtualPosCatalog.Hash(VirtualPosCatalog.Json(ImmutableQuote(command)));
        }
        private VirtualPosResponse Action(VirtualPosCommand command,string action,VirtualPosLedgerEntry entry=null,string error=null)
        {
            var result=transport(HttpMethod.Post,"action",new VirtualPosAction {
                TerminalId=command.TerminalId,SaleId=command.SaleId,LeaseToken=command.LeaseToken,Action=action,
                FrontOrderId=entry?.FrontOrderId,FrontOrderNumber=entry?.FrontOrderNumber,
                Error=error==null ? null : error.Substring(0,Math.Min(600,error.Length))
            });
            if(result?.Success!=true) throw new InvalidOperationException(result?.Error ?? "Нет подтверждения кассы Bulka.");
            return result;
        }
        private void Guard(VirtualPosCommand command,string action,VirtualPosLedgerEntry entry)
        {
            var result=Action(command,action,entry);
            if(!result.GuardAccepted || result.Sale?.Status!=action)
                throw new InvalidOperationException("Операция уже начата другим обработчиком или не подтверждена. Требуется сверка.");
        }
        private static IOrder FindOrder(IOperationService os,VirtualPosCommand command,VirtualPosLedgerEntry entry)
        {
            IOrder order=null;
            if(Guid.TryParse(entry?.FrontOrderId,out var id)) order=os.TryGetOrderById(id);
            if(order!=null) return order;
            var matches=os.GetOrders(true,false).Where(o=>o.ExternalNumber==Prefix+command.SaleId
                && os.TryGetOrderExternalDataByKey(o,OrderDataKey)==command.SaleId).ToList();
            if(matches.Count>1) throw new InvalidOperationException("Найдено несколько заказов iiko для продажи. Требуется сверка.");
            return matches.SingleOrDefault();
        }
        private static void VerifyOrder(IOrder order,VirtualPosCommand command,IOperationService os)
        {
            if(order.ExternalNumber!=Prefix+command.SaleId || os.TryGetOrderExternalDataByKey(order,OrderDataKey)!=command.SaleId)
                throw new InvalidOperationException("Исходный заказ iiko не связан с этой продажей.");
            if(order.Status==OrderStatus.Deleted || order.ResultSum!=command.Total || order.Discounts.Count!=0 || order.Combos.Count!=0)
                throw new InvalidOperationException("Исходный заказ, скидка или сумма iiko изменились. Требуется сверка.");
            var items=order.Items.Where(i=>!i.Deleted).ToList();
            if(items.Count!=command.Items.Count) throw new InvalidOperationException("Состав заказа iiko изменился. Требуется сверка.");
            foreach(var expected in command.Items)
            {
                var product=items.OfType<IOrderProductItem>().SingleOrDefault(i=>i.Product.Id.ToString()==expected.ProductId);
                if(product==null || product.Amount!=expected.Quantity || product.Size!=null || product.AssignedModifiers.Count!=0
                    || product.IsPricePredefined || product.ResultSum!=expected.LineTotal)
                    throw new InvalidOperationException("Товар или количество заказа iiko изменились. Требуется сверка.");
            }
            if(order.Payments.Count>1 || order.Payments.Any(p=>p.Id!=Guid.Parse(command.SaleId)
                || p.Type.Id.ToString()!=command.PaymentTypeId || p.Sum!=command.Total || p.Type.PrintCheque || p.Type.FiscalizeAsDiscount
                || p.IsExternal || p.IsProcessedExternally))
                throw new InvalidOperationException("В исходном заказе другая оплата. Требуется сверка.");
        }
        private static void VerifyRegister(IOperationService os,IOrder order,VirtualPosCommand command)
        {
            var point=VirtualPosCatalog.PointOfSale(os);var table=VirtualPosCatalog.Table(os);
            var reason=VirtualPosCatalog.NoPaperProblem(os,point,table);
            if(reason!=null) throw new InvalidOperationException(reason);
            var shift=os.TryGetCafeSessionByCashRegister(point.CashRegister);
            if(shift?.Id.ToString()!=command.CashShiftId) throw new InvalidOperationException("Кассовая смена iiko изменилась. Требуется сверка.");
            var split=os.NeedToSplitOrderBeforePayment(order);
            if(split.CheckSplitRequiredResult!=CheckSplitRequiredResult.Disabled || split.PointOfSale?.Id!=point.Id)
                throw new InvalidOperationException("Заказ относится к другой кассе или требует разделения. Завершите его в iiko.");
        }
        private void Finish(VirtualPosCommand command,VirtualPosLedgerEntry entry,IOrder order,IOperationService os)
        {
            VerifyOrder(order,command,os);
            if(order.Status!=OrderStatus.Closed || order.Payments.Count!=1)
                throw new InvalidOperationException("iiko не подтвердил закрытие исходного заказа.");
            VerifyPastOrder(os.GetPastOrder(order.Id),command,entry);
            entry.Phase="completed";entry.Error=null;Save();
            Action(command,"completed",entry);
            StatusText="Касса Bulka: продажа №"+entry.FrontOrderNumber+" зарегистрирована в iiko";
        }
        private static void VerifyPastOrder(PastOrder past,VirtualPosCommand command,VirtualPosLedgerEntry entry)
        {
            if(past==null || past.OrderId.ToString()!=entry.FrontOrderId || past.Deleted || past.Storned
                || past.CafeSessionId.ToString()!=command.CashShiftId || past.CashRegister?.Id.ToString()!=entry.CashRegisterId
                || past.ExternalNumber!=Prefix+command.SaleId || past.PublicExternalData==null
                || !past.PublicExternalData.TryGetValue(OrderDataKey,out var marker) || marker!=command.SaleId
                || past.FiscalChequeNumbers==null || past.FiscalChequeNumbers.Count!=0)
                throw new InvalidOperationException("Сервер iiko не подтвердил нефискальную продажу в исходной смене и кассе. Требуется сверка.");
            if(past.Payments==null || past.Payments.Count!=1 || past.Payments[0].PaymentType?.Id.ToString()!=command.PaymentTypeId
                || past.Payments[0].Sum!=command.Total || past.Payments[0].PaymentType.PrintCheque || past.Payments[0].PaymentType.FiscalizeAsDiscount
                || past.Payments[0].IsPrepay || past.Payments[0].IsDonation || past.Items==null || past.Items.Count!=command.Items.Count)
                throw new InvalidOperationException("Учтённая оплата или состав продажи iiko не совпали. Требуется сверка.");
            foreach(var item in command.Items)
            {
                var actual=past.Items.SingleOrDefault(i=>i.Product?.Id.ToString()==item.ProductId);
                if(actual==null || actual.Amount!=item.Quantity || actual.Price!=item.Price || actual.ProductSize!=null
                    || actual.SumWithDiscounts!=item.LineTotal)
                    throw new InvalidOperationException("Сервер iiko не подтвердил исходные товары и цены. Требуется сверка.");
            }
        }
        internal void BeforePayment(IOrder order,IOperationService os)
        {
            if(order?.ExternalNumber==null || !order.ExternalNumber.StartsWith(Prefix,StringComparison.Ordinal)) return;
            var saleId=os.TryGetOrderExternalDataByKey(order,OrderDataKey);
            VirtualPosLedgerEntry entry;
            lock(ledgerGate)
            {
                if(!storageHealthy || saleId==null || !ledger.TryGetValue(saleId,out entry))
                    throw new InvalidOperationException("Нет достоверного журнала продажи Bulka; оплата остановлена.");
            }
            if(entry.BranchId!=LoyaltyFlow.BranchId || entry.TerminalId!=os.GetHostTerminal().Id.ToString())
                throw new InvalidOperationException("Журнал продажи Bulka относится к другому филиалу или кассе.");
            VerifyOrder(order,entry.Quote,os);
            VerifyRegister(os,order,entry.Quote);
            var point=VirtualPosCatalog.PointOfSale(os);
            var problem=VirtualPosCatalog.NoPaperProblem(os,point,VirtualPosCatalog.Table(os));
            if(problem!=null) throw new InvalidOperationException(problem);
            if(!entry.PaymentStarted || order.Id.ToString()!=entry.FrontOrderId || order.ResultSum!=entry.Total
                || os.TryGetCafeSessionByCashRegister(point.CashRegister)?.Id.ToString()!=entry.CashShiftId
                || point.CashRegister.Id.ToString()!=entry.CashRegisterId || order.Payments.Count!=1)
                throw new InvalidOperationException("Касса, смена или подтверждение оплаты Bulka изменились.");
            var payment=order.Payments[0];
            var currentType=os.GetPaymentTypeById(payment.Type.Id);
            var reason=VirtualPosCatalog.PaymentProblem(os,currentType,
                new HashSet<Guid>(os.GetPaymentTypesToPayOutOnUser().Select(p=>p.Id)),VirtualPosCatalog.PaymentAllowlist());
            if(reason!=null || payment.Id.ToString()!=saleId || currentType.Id.ToString()!=entry.PaymentTypeId
                || payment.Sum!=entry.Total || payment.IsExternal || payment.IsProcessedExternally)
                throw new InvalidOperationException(reason ?? "Оплата Bulka не совпадает с исходной продажей.");
        }
        internal void Process(VirtualPosCommand command,IOperationService os,VirtualPosSnapshot snapshot)
        {
            if(!storageHealthy) throw new InvalidOperationException("Журнал продаж требует сверки; операции iiko остановлены.");
            if(command==null || !Guid.TryParse(command.SaleId,out var sale) || sale==Guid.Empty
                || !Guid.TryParse(command.LeaseToken,out var lease) || lease==Guid.Empty
                || command.TerminalId!=os.GetHostTerminal().Id.ToString())
                throw new InvalidOperationException("Недопустимая команда кассы Bulka.");
            var digest=Digest(command);
            VirtualPosLedgerEntry saved;
            lock(ledgerGate) ledger.TryGetValue(command.SaleId,out saved);
            if(saved!=null && (saved.BranchId!=LoyaltyFlow.BranchId || saved.TerminalId!=command.TerminalId || saved.Digest!=digest))
                throw new InvalidOperationException("Содержимое или филиал сохранённой продажи изменились. Требуется сверка.");
            if(saved==null)
            {
                saved=new VirtualPosLedgerEntry {SaleId=command.SaleId,BranchId=LoyaltyFlow.BranchId,
                    TerminalId=command.TerminalId,Digest=digest,Phase="prepared",CashShiftId=command.CashShiftId,
                    PaymentTypeId=command.PaymentTypeId,Total=command.Total,Quote=ImmutableQuote(command)};
                lock(ledgerGate) ledger.Add(command.SaleId,saved);
                Save();
            }
            IOrder order=null;
            try
            {
                order=FindOrder(os,command,saved);
                if(order==null && saved.PaymentStarted && Guid.TryParse(saved.FrontOrderId,out var archivedId))
                {
                    var archived=os.GetPastOrder(archivedId);
                    if(archived!=null)
                    {
                        VerifyPastOrder(archived,command,saved);
                        saved.Phase="completed";saved.Error=null;Save();Action(command,"completed",saved);return;
                    }
                }
                if(order!=null)
                {
                    saved.FrontOrderId=order.Id.ToString();saved.FrontOrderNumber=order.Number.ToString(CultureInfo.InvariantCulture);Save();
                    VerifyOrder(order,command,os);
                    if(order.Status==OrderStatus.Closed) {Finish(command,saved,order,os);return;}
                }
                if(saved.Phase=="completed" || saved.Phase=="needs_reconciliation" || saved.Phase=="rejected")
                {
                    Action(command,saved.Phase,saved,saved.Error);return;
                }
                if(saved.PaymentStarted || command.Phase=="payment_started" || command.Phase=="needs_reconciliation"
                    || (order==null && (saved.CreationStarted || saved.FrontOrderId!=null || command.Phase!="claimed")))
                    throw new InvalidOperationException("Результат прежней операции iiko не подтверждён. Повторная продажа и оплата остановлены.");
                // Validate current authority before any native mutation. A
                // resumed existing order keeps its original immutable quote.
                if(order==null)
                {
                    VirtualPosCatalog.ValidateCommand(command,snapshot);
                    VirtualPosCatalog.ValidateCommand(command,VirtualPosCatalog.Capture(os));
                    var stock=os.CheckStopListProductsSellingRestrictions(command.Items.ToDictionary(
                        i=>new ProductAndSize(os.GetProductById(Guid.Parse(i.ProductId)),null),i=>i.Quantity),os.GetDefaultCredentials());
                    if(stock.CheckResult!=ProductsSellingPossibility.Allowed)
                        throw new InvalidOperationException("В iiko недостаточно остатков для этого количества. Обновите продажу.");
                    saved.CashRegisterId=VirtualPosCatalog.PointOfSale(os).CashRegister.Id.ToString();
                    saved.Phase="creating";Save();
                    Guard(command,"creating",saved);
                    saved.CreationStarted=true;saved.Phase="creating";Save();
                    var table=VirtualPosCatalog.Table(os);
                    var edit=os.CreateEditSession();
                    var stub=edit.CreateOrder(new[]{table},true,false,null);
                    var guest=edit.AddOrderGuest("Bulka POS",stub);
                    edit.ChangeOrderExternalNumber(Prefix+command.SaleId,stub);
                    edit.AddOrderExternalData(OrderDataKey,new ExternalDataItem(command.SaleId,true),stub);
                    foreach(var item in command.Items)
                        edit.AddOrderProductItem(item.Quantity,os.GetProductById(Guid.Parse(item.ProductId)),stub,guest,null,OrderItemCourse.Default,null);
                    order=os.SubmitChanges(edit,os.GetDefaultCredentials()).Get(stub);
                    saved.FrontOrderId=order.Id.ToString();saved.FrontOrderNumber=order.Number.ToString(CultureInfo.InvariantCulture);
                    saved.Phase="created";Save();
                    var acknowledgement=Action(command,"created",saved);
                    if(acknowledgement.Sale?.Status!="created") throw new InvalidOperationException("Созданный заказ требует сверки с сервером.");
                }
                VerifyOrder(order,command,os);
                if(order.Payments.Count!=0) throw new InvalidOperationException("Оплата уже добавлена в заказ. Повтор остановлен; требуется сверка.");
                VerifyRegister(os,order,command);
                var current=VirtualPosCatalog.Capture(os);
                VirtualPosCatalog.ValidateCommand(command,current);
                var type=os.GetPaymentTypeById(Guid.Parse(command.PaymentTypeId));
                Guard(command,"payment_started",saved);
                saved.PaymentStarted=true;saved.Phase="payment_started";Save();
                // This is an ordinary native tender, not an already-paid web
                // order. Never call an external payment/fiscalization endpoint.
                var additional=type.Kind==PaymentTypeKind.Card ? new CardPaymentItemAdditionalData(null,null,null) : null;
                os.AddPaymentItem(sale,command.Total,additional,type,order,os.GetDefaultCredentials());
                order=os.GetOrderById(order.Id);
                VerifyOrder(order,command,os);VerifyRegister(os,order,command);
                BeforePayment(order,os);
                os.PayOrder(order,true,os.GetDefaultCredentials(),null);
                order=os.GetOrderById(order.Id);
                Finish(command,saved,order,os);
            }
            catch(Exception error)
            {
                // Even a failed guard ACK can have committed server-side. Do
                // not turn it into a retry that could race another worker.
                saved.Phase=order==null && !saved.CreationStarted && saved.Phase=="prepared" && command.Phase=="claimed" ? "rejected" : "needs_reconciliation";
                if(saved.PaymentStarted || saved.CreationStarted || saved.FrontOrderId!=null) saved.Phase="needs_reconciliation";
                saved.Error=error.Message;Save();
                StatusText="Касса Bulka: "+error.Message;
                try {Action(command,saved.Phase,saved,saved.Error);} catch { }
                throw;
            }
        }
        private void Tick(object state)
        {
            if(disposed || !PosPairing.IsPaired || Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                if(!storageHealthy && !TryLoad()) return;
                var os=PluginContext.Operations;var snapshot=VirtualPosCatalog.Capture(os);
                transport(HttpMethod.Post,"snapshot",snapshot);
                StatusText=snapshot.Profile.NonFiscalNoPaperVerified ? "Касса Bulka: готова к регистрации продаж" : "Касса Bulka: "+snapshot.Profile.Reason;
                var response=transport(HttpMethod.Get,"poll?terminalId="+Uri.EscapeDataString(snapshot.TerminalId),null);
                if(response?.Command!=null) Process(response.Command,os,snapshot);
            }
            catch(Exception error) {StatusText="Касса Bulka: "+error.Message;PluginContext.Log.Warn(StatusText);}
            finally {Interlocked.Exchange(ref busy,0);}
        }
        public void Dispose() {disposed=true;timer?.Dispose();}
    }
}
