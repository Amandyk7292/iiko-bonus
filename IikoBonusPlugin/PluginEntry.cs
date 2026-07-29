using System;
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
        private IDisposable _buttonSubscription;
        private IDisposable _statusButtonSubscription;
        private IDisposable _pickupButtonSubscription;
        private IDisposable _giftButtonSubscription;
        private IDisposable _orderSubscription;
        private IDisposable _billPrintSubscription;
        private IDisposable _cashPrintSubscription;
        private IDisposable _barcodeSubscription;
        private IDisposable _beforePaymentSubscription;

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

                _buttonSubscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                    "Бонусы",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        try
                        {
                            var order = args.Item1;
                            var os = args.Item2;
                            var vm = args.Item3;

                            LoyaltyFlow.Run(order, os, vm);
                        }
                        catch (Exception ex)
                        {
                            PluginContext.Log.Error("IikoBonusPlugin: Error running LoyaltyFlow: " + ex);
                        }
                    }
                );

                _statusButtonSubscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                    "Статус бонусов",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        try
                        {
                            args.Item3.ShowOkPopup(
                                "Статус Bulka",
                                LoyaltyFlow.GetQueueStatusText() + "\n\n" +
                                GiftCertificateFlow.GetStatusText(),
                                "ОК");
                        }
                        catch (Exception ex)
                        {
                            PluginContext.Log.Error("IikoBonusPlugin: Error showing status: " + ex);
                        }
                    }
                );

                _pickupButtonSubscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                    "Выдать онлайн-заказ",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        LoyaltyFlow.RunPickupHandoffByPin(args.Item1, args.Item3);
                    }
                );

                _giftButtonSubscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                    "Сертификат",
                    (ValueTuple<IOrder, IOperationService, IViewManager> args) =>
                    {
                        GiftCertificateFlow.Run(args.Item1, args.Item2, args.Item3);
                    }
                );

                _orderSubscription = PluginContext.Notifications.OrderChanged.Subscribe(
                    new OrderChangedObserver(OnOrderChanged)
                );
                LoyaltyFlow.ReconcileRestoredOrders(PluginContext.Operations);
                GiftCertificateFlow.ReconcileRestoredOrders(PluginContext.Operations);

                _billPrintSubscription = PluginContext.Notifications.BillChequePrinting.Subscribe(OnBillChequePrinting);
                _cashPrintSubscription = PluginContext.Notifications.CashChequePrinting.Subscribe(OnCashChequePrinting);

                _barcodeSubscription = PluginContext.Notifications.OrderEditBarcodeScanned.Subscribe(OnBarcodeScanned);
                _beforePaymentSubscription = PluginContext.Notifications.BeforeProceedOrderPayment.Subscribe(BeforeProceedOrderPayment);
                LoyaltyFlow.StartBackgroundRetry();
                GiftCertificateFlow.StartBackgroundRetry();

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
            TryDispose(_buttonSubscription);
            TryDispose(_statusButtonSubscription);
            TryDispose(_pickupButtonSubscription);
            TryDispose(_giftButtonSubscription);
            TryDispose(_orderSubscription);
            TryDispose(_billPrintSubscription);
            TryDispose(_cashPrintSubscription);
            TryDispose(_barcodeSubscription);
            TryDispose(_beforePaymentSubscription);
            LoyaltyFlow.StopBackgroundRetry();
            GiftCertificateFlow.StopBackgroundRetry();
        }

        private static bool OnBarcodeScanned(
            ValueTuple<string, IOrder, IOperationService, IViewManager> args)
        {
            if (GiftCertificateFlow.TryHandleBarcode(args)) return true;
            return LoyaltyFlow.OnBarcodeScanned(args);
        }

        private static void BeforeProceedOrderPayment(
            ValueTuple<IOrder, IViewManager, IOperationService> args)
        {
            GiftCertificateFlow.BeforeProceedOrderPayment(args);
            LoyaltyFlow.BeforeProceedOrderPayment(args);
        }

        private static void OnOrderChanged(
            Resto.Front.Api.Data.Common.EntityChangedEventArgs<IOrder> args)
        {
            GiftCertificateFlow.OnOrderChanged(args);
            LoyaltyFlow.OnOrderChanged(args);
        }

        private static ChequeExtensions OnBillChequePrinting(Guid orderId)
        {
            var extensions = new ChequeExtensions();
            try
            {
                if (!ActiveOrders.TryGetValue(orderId, out var data)) return extensions;

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
