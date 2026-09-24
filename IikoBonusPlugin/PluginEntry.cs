using System;
using System.Linq;
using System.Collections.Concurrent;
using System.Xml.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Attributes.JetBrains;
using Resto.Front.Api.Data.Cheques;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [PluginLicenseModuleId(21016318)]
    [UsedImplicitly]
    public sealed class PluginEntry : IFrontPlugin
    {
        private IDisposable _deliveryButton;
        private readonly System.Collections.Generic.List<Tuple<string,Action<ValueTuple<IOrder,IOperationService,IViewManager>>>> _orderActions =
            new System.Collections.Generic.List<Tuple<string,Action<ValueTuple<IOrder,IOperationService,IViewManager>>>>();
        private IDisposable RegisterOrderAction(string name,Action<ValueTuple<IOrder,IOperationService,IViewManager>> action,string icon=null)
        {
            _orderActions.Add(Tuple.Create(name,action));
            return null;
        }
        private IDisposable _buttonSubscription;
        private IDisposable _statusButtonSubscription;
        private IDisposable _giftButtonSubscription;
        private IDisposable _orderSubscription;
        private IDisposable _billPrintSubscription;
        private IDisposable _cashPrintSubscription;
        private IDisposable _barcodeSubscription;
        private IDisposable _beforePaymentSubscription;
        private static StockSync _stockSync;
        private static SharedStockGuard _sharedStock;
        private IDisposable _beforeServiceSubscription;
        private OnlineOrderInbox _inbox;
        private IDisposable _inboxMenu;
        private IDisposable _inboxOrderButton;
        private IDisposable _recountButton;
        private IDisposable _reconciliationButton;
        private IDisposable _pairingMenu;
        private IDisposable _pairingOrderButton;
        private IDisposable _onlinePaymentRegistration;
        private IDisposable _personalAccountPaymentRegistration;
        private IDisposable _assemblyReprintButton;
        private OnlineReceiptSync _automaticReceipts;
        private static OfflineReceiptSync _offlineReceipts;
        private PosHealthSync _posHealth;

        public class OrderLoyaltyData
        {
            public string CustomerId { get; set; }
            public string CustomerName { get; set; }
            public string CustomerPhone { get; set; }
            public decimal CurrentBalance { get; set; }
            public decimal CashbackPercent { get; set; }
            public decimal MaxDiscountPercent { get; set; }
            public decimal DiscountAmount { get; set; }
            public decimal OrderFullSum { get; set; }
            public decimal PayableAmount { get; set; }
            public string ReservationId { get; set; }
            public string PendingCustomerCode { get; set; }
            public string ScannedAtUtc { get; set; }
        }

        public static ConcurrentDictionary<Guid, OrderLoyaltyData> ActiveOrders =
            new ConcurrentDictionary<Guid, OrderLoyaltyData>();

        public PluginEntry()
        {
            try
            {
                PluginContext.Log.Info("IikoBonusPlugin: Initializing...");
                LoyaltyFlow.RestoreActiveOrders();
                GiftCertificateFlow.RestoreActiveOrders();
                try { _personalAccountPaymentRegistration = PluginContext.Operations.RegisterPaymentSystem(
                    new PersonalAccountPaymentProcessor(), false,
                    Resto.Front.Api.Data.Payments.FiscalPaymentTypeGroup.NonCash); }
                catch(Exception error) { PluginContext.Log.Error("Bulka personal account registration: " + error.Message); }
                _sharedStock = new SharedStockGuard();
                try { _offlineReceipts=new OfflineReceiptSync(); }
                catch(Exception error) {PluginContext.Log.Error("Bulka offline receipt journal: "+error.Message);}
                try
                {
                    _onlinePaymentRegistration = PluginContext.Operations.RegisterPaymentSystem(new OnlinePaymentProcessor(),false,
                        Resto.Front.Api.Data.Payments.FiscalPaymentTypeGroup.NonCash);
                    _automaticReceipts = new OnlineReceiptSync(_sharedStock);
                }
                catch(Exception error) { PluginContext.Log.Error("Bulka online payment registration: " + error.Message); }
                _assemblyReprintButton = RegisterOrderAction("Сборочный чек Bulka",
                    (ValueTuple<IOrder,IOperationService,IViewManager> args) => AssemblyTicket.Reprint(args.Item1,args.Item2,args.Item3));
                _inbox = new OnlineOrderInbox();
                _pairingMenu = PluginContext.Operations.AddButtonToPluginsMenu("Привязать кассу", args => PosPairing.Show(args.Item1));
                _pairingOrderButton = RegisterOrderAction("Привязать кассу",
                    (ValueTuple<IOrder,IOperationService,IViewManager> args) => PosPairing.Show(args.Item3));
                _inboxMenu = PluginContext.Operations.AddButtonToPluginsMenu("Доставка · Заказы Bulka", args => _inbox.Show(args.Item1));
                _inboxOrderButton = RegisterOrderAction("Доставка · Заказы Bulka",
                    (ValueTuple<IOrder,IOperationService,IViewManager> args) => {
                        var selected = _inbox.Show(args.Item3, true);
                        if (selected.HasValue) _sharedStock.LinkOnline(args.Item1,args.Item2,args.Item3,selected.Value);
                    }, "M 2,5 L 15,5 15,17 2,17 Z M 15,9 L 20,9 24,13 24,17 15,17 Z M 5,17 A 3,3 0 1 0 11,17 A 3,3 0 1 0 5,17 M 17,17 A 3,3 0 1 0 23,17 A 3,3 0 1 0 17,17");
                _recountButton = PluginContext.Operations.AddButtonToPluginsMenu("Сверить витрину", args =>
                    _sharedStock.Recount(PluginContext.Operations,args.Item1));
                _reconciliationButton = PluginContext.Operations.AddButtonToPluginsMenu("Сверка чеков Bulka", args =>
                    _sharedStock.ShowReconciliation(PluginContext.Operations,args.Item1));

                _buttonSubscription = RegisterOrderAction(
                    "Бонусы",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        try
                        {
                            var order = args.Item1;
                            var os = args.Item2;
                            var vm = args.Item3;

                            if (_sharedStock.IsLinked(order)) vm.ShowErrorPopup("Бонусы онлайн-заказа уже учтены в Bulka.", "ОК");
                            else LoyaltyFlow.Run(order, os, vm);
                        }
                        catch (Exception ex)
                        {
                            PluginContext.Log.Error("IikoBonusPlugin: Error running LoyaltyFlow: " + ex);
                        }
                    }
                );

                _statusButtonSubscription = RegisterOrderAction(
                    "Статус бонусов",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        try
                        {
                            args.Item3.ShowOkPopup(
                                "Статус Bulka",
                                LoyaltyFlow.GetQueueStatusText() + "\n\n" +
                                GiftCertificateFlow.GetStatusText() + "\n\n" + (_stockSync?.StatusText ?? "Остатки: обмен выключен") + "\n\n" + _sharedStock.StatusText
                                + "\n\n" + (_automaticReceipts?.StatusText ?? "Внешняя оплата Bulka: обработчик не зарегистрирован. Проверьте журнал плагина.")
                                + "\n\n" + (_offlineReceipts?.StatusText ?? "Продажи кассы: журнал недоступен, нужна сверка")
                                + "\n\n" + (_posHealth?.StatusText ?? "Мониторинг кассы: недоступен"),
                                "ОК");
                        }
                        catch (Exception ex)
                        {
                            PluginContext.Log.Error("IikoBonusPlugin: Error showing status: " + ex);
                        }
                    }
                );

                _giftButtonSubscription = RegisterOrderAction(
                    "Сертификат",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        if (_sharedStock.IsLinked(args.Item1)) args.Item3.ShowErrorPopup("Онлайн-заказ уже оплачен в Bulka.", "ОК");
                        else GiftCertificateFlow.Run(args.Item1, args.Item2, args.Item3);
                    }
                );

                _deliveryButton = PluginContext.Operations.AddButtonToOrderEditScreen("Доставка", args => {
                    var selected = args.Item3.ShowChooserPopup("Доставка и действия Bulka",
                        _orderActions.Select(a=>a.Item1).ToArray(),0,ButtonWidth.Wider,"Закрыть");
                    if(selected>=0 && selected<_orderActions.Count) _orderActions[selected].Item2(args);
                }, "M2,5 L15,5 15,9 20,9 24,14 24,19 21,19 A3,3 0 0 1 15,19 L10,19 A3,3 0 0 1 4,19 L2,19 Z");
                _orderSubscription = PluginContext.Notifications.OrderChanged.Subscribe(
                    new OrderChangedObserver(OnOrderChanged)
                );
                LoyaltyFlow.ReconcileRestoredOrders(PluginContext.Operations);
                GiftCertificateFlow.ReconcileRestoredOrders(PluginContext.Operations);

                _billPrintSubscription = PluginContext.Notifications.BillChequePrinting.Subscribe(OnBillChequePrinting);
                _cashPrintSubscription = PluginContext.Notifications.CashChequePrinting.Subscribe(OnCashChequePrinting);

                _barcodeSubscription = PluginContext.Notifications.OrderEditBarcodeScanned.Subscribe(OnBarcodeScanned);
                _beforePaymentSubscription = PluginContext.Notifications.BeforeProceedOrderPayment.Subscribe(BeforeProceedOrderPayment);
                _beforeServiceSubscription = PluginContext.Notifications.BeforeServiceCheque.Subscribe(args =>
                    _sharedStock.BeforeOperation(args.Item1,args.Item3,args.Item4,false));
                LoyaltyFlow.StartBackgroundRetry();
                GiftCertificateFlow.StartBackgroundRetry();
                if (!string.Equals(LoyaltyFlow.ReadPluginSetting("IIKO_STOCK_SYNC_ENABLED"), "false", StringComparison.OrdinalIgnoreCase))
                    _stockSync = new StockSync();
                _posHealth = new PosHealthSync(_sharedStock, _automaticReceipts, _offlineReceipts);

                PluginContext.Log.Info("IikoBonusPlugin: Initialized successfully.");
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: FATAL init error: " + ex);
                DisposeSubscriptions();
                throw;
            }
        }

        private static void TryDispose(IDisposable subscription)
        {
            try { subscription?.Dispose(); }
            catch (Exception ex) { PluginContext.Log.Error("IikoBonusPlugin: Subscription dispose failed: " + ex.Message); }
        }

        private void DisposeSubscriptions()
        {
            TryDispose(_deliveryButton);
            TryDispose(_buttonSubscription);
            TryDispose(_statusButtonSubscription);
            TryDispose(_giftButtonSubscription);
            TryDispose(_orderSubscription);
            TryDispose(_billPrintSubscription);
            TryDispose(_cashPrintSubscription);
            TryDispose(_barcodeSubscription);
            TryDispose(_beforePaymentSubscription);
            TryDispose(_beforeServiceSubscription);
            TryDispose(_sharedStock);
            TryDispose(_inbox);
            TryDispose(_inboxMenu);
            TryDispose(_inboxOrderButton);
            TryDispose(_recountButton);
            TryDispose(_reconciliationButton);
            TryDispose(_pairingMenu);
            TryDispose(_pairingOrderButton);
            TryDispose(_automaticReceipts);
            TryDispose(_offlineReceipts);
            TryDispose(_onlinePaymentRegistration);
            TryDispose(_personalAccountPaymentRegistration);
            TryDispose(_assemblyReprintButton);
            TryDispose(_posHealth);
            LoyaltyFlow.StopBackgroundRetry();
            GiftCertificateFlow.StopBackgroundRetry();
            TryDispose(_stockSync);
            _stockSync = null;
        }

        private static bool OnBarcodeScanned(
            ValueTuple<string, IOrder, IOperationService, IViewManager> args)
        {
            if (_sharedStock.IsLinked(args.Item2)) return false;
            if (GiftCertificateFlow.TryHandleBarcode(args)) return true;
            return LoyaltyFlow.OnBarcodeScanned(args);
        }

        private static void BeforeProceedOrderPayment(
            ValueTuple<IOrder, IViewManager, IOperationService> args)
        {
            if (!_sharedStock.IsLinked(args.Item1))
            {
                GiftCertificateFlow.BeforeProceedOrderPayment(args);
                LoyaltyFlow.BeforeProceedOrderPayment(args);
            }
            _sharedStock.BeforeOperation(args.Item1,args.Item3,args.Item2,true);
        }

        private static void OnOrderChanged(
            Resto.Front.Api.Data.Common.EntityChangedEventArgs<IOrder> args)
        {
            _stockSync?.RequestSync();
            try { _offlineReceipts?.Observe(args.Entity); }
            catch(Exception error) {PluginContext.Log.Error("Bulka offline receipt capture: "+error.Message);}
            try { _sharedStock?.Observe(args.Entity); }
            catch (Exception error) { PluginContext.Log.Warn("Bulka stock receipt reconciliation pending: " + error.Message); }
            try { PersonalAccountLocalLedger.Observe(args.Entity); }
            catch (Exception error) { PluginContext.Log.Warn("Bulka personal account reconciliation pending: " + error.Message); }
            if (_sharedStock.IsLinked(args.Entity)) return;
            GiftCertificateFlow.OnOrderChanged(args);
            LoyaltyFlow.OnOrderChanged(args);
        }

        private static ChequeExtensions OnBillChequePrinting(Guid orderId)
        {
            var extensions = new ChequeExtensions();
            try
            {
                if (!ActiveOrders.TryGetValue(orderId, out var data)) return extensions;
                if (!string.IsNullOrWhiteSpace(data.PendingCustomerCode))
                {
                    extensions.AfterFooter = XElement.Parse("<doc><line /><center>Bulka: QR сохранён</center><center>Начисление бонусов после восстановления связи</center><line /></doc>");
                    return extensions;
                }

                decimal realMoneyPaid = data.PayableAmount > 0
                    ? data.PayableAmount
                    : Math.Max(0, data.OrderFullSum - data.DiscountAmount);
                decimal earnedBonus = Math.Round(realMoneyPaid * (data.CashbackPercent / 100m), 2);
                decimal displayBalance = Math.Max(0, data.CurrentBalance - data.DiscountAmount);
                string nameStr = string.IsNullOrWhiteSpace(data.CustomerName) ? "Гость" : data.CustomerName;

                string xml = "<doc>" +
                             "<line />" +
                             "<center>Система лояльности Bulka Bonus</center>" +
                             "<pair left=\"Гость:\" right=\"" + nameStr.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;") + "\" />";

                if (data.DiscountAmount > 0)
                {
                    xml += "<pair left=\"Списано бонусов:\" right=\"-" + data.DiscountAmount.ToString("0.##") + " бон.\" />";
                }

                xml += "<pair left=\"Текущий баланс:\" right=\"" + displayBalance.ToString("0.##") + " бон.\" />" +
                       "<pair left=\"Ожидается к начислению:\" right=\"+" + earnedBonus.ToString("0.##") + " бон.\" />" +
                       "<line />" +
                       "</doc>";

                var xElement = XElement.Parse(xml);
                extensions.AfterFooter = xElement;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin Error in OnBillChequePrinting: " + ex);
            }
            return extensions;
        }

        private static ShortenedChequeExtensions OnCashChequePrinting(Guid orderId)
        {
            var extensions = new ShortenedChequeExtensions();
            try
            {
                if (!ActiveOrders.TryGetValue(orderId, out var data)) return extensions;
                if (!string.IsNullOrWhiteSpace(data.PendingCustomerCode))
                {
                    extensions.AfterCheque = XElement.Parse("<doc><line /><center>Bulka: QR сохранён</center><center>Начисление бонусов после восстановления связи</center><line /></doc>");
                    return extensions;
                }

                decimal realMoneyPaid = data.PayableAmount > 0
                    ? data.PayableAmount
                    : Math.Max(0, data.OrderFullSum - data.DiscountAmount);
                decimal earnedBonus = Math.Round(realMoneyPaid * (data.CashbackPercent / 100m), 2);
                decimal displayBalance = Math.Max(0, data.CurrentBalance - data.DiscountAmount);
                string nameStr = string.IsNullOrWhiteSpace(data.CustomerName) ? "Гость" : data.CustomerName;

                string xml = "<doc>" +
                             "<line />" +
                             "<center>Система лояльности Bulka Bonus</center>" +
                             "<pair left=\"Гость:\" right=\"" + nameStr.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;") + "\" />";

                if (data.DiscountAmount > 0)
                {
                    xml += "<pair left=\"Списано бонусов:\" right=\"-" + data.DiscountAmount.ToString("0.##") + " бон.\" />";
                }

                xml += "<pair left=\"Текущий баланс:\" right=\"" + displayBalance.ToString("0.##") + " бон.\" />" +
                       "<pair left=\"Ожидается к начислению:\" right=\"+" + earnedBonus.ToString("0.##") + " бон.\" />" +
                       "<line />" +
                       "</doc>";

                var xElement = XElement.Parse(xml);
                extensions.AfterCheque = xElement;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin Error in OnCashChequePrinting: " + ex);
            }
            return extensions;
        }

        public void Dispose()
        {
            DisposeSubscriptions();
            PluginContext.Log.Info("IikoBonusPlugin: Disposed.");
        }
    }
}
