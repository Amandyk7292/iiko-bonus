using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
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
        private IDisposable _orderSubscription;
        private IDisposable _billPrintSubscription;
        private IDisposable _cashPrintSubscription;

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
        }

        public static ConcurrentDictionary<Guid, OrderLoyaltyData> ActiveOrders =
            new ConcurrentDictionary<Guid, OrderLoyaltyData>();

        public PluginEntry()
        {
            try
            {
                PluginContext.Log.Info("IikoBonusPlugin: Initializing...");

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

                _orderSubscription = PluginContext.Notifications.OrderChanged.Subscribe(
                    new OrderChangedObserver(LoyaltyFlow.OnOrderChanged)
                );

                _billPrintSubscription = PluginContext.Notifications.BillChequePrinting.Subscribe(OnBillChequePrinting);
                _cashPrintSubscription = PluginContext.Notifications.CashChequePrinting.Subscribe(OnCashChequePrinting);

                PluginContext.Log.Info("IikoBonusPlugin: Initialized successfully.");
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: FATAL init error: " + ex);
            }
        }

        private static ChequeExtensions OnBillChequePrinting(Guid orderId)
        {
            var extensions = new ChequeExtensions();
            try
            {
                if (!ActiveOrders.TryGetValue(orderId, out var data)) return extensions;

                decimal realMoneyPaid = Math.Max(0, data.OrderFullSum - data.DiscountAmount);
                decimal earnedBonus = Math.Floor(realMoneyPaid * (data.CashbackPercent / 100m));
                decimal displayBalance = Math.Max(0, data.CurrentBalance - data.DiscountAmount);
                string nameStr = string.IsNullOrWhiteSpace(data.CustomerName) ? "Гость" : data.CustomerName;

                string xml = "<doc>" +
                             "<line />" +
                             "<center>Система лояльности Bonus CRM</center>" +
                             "<pair left=\"Гость:\" right=\"" + nameStr.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;") + "\" />";

                if (data.DiscountAmount > 0)
                {
                    xml += "<pair left=\"Списано бонусов:\" right=\"-" + data.DiscountAmount.ToString("0") + " бон.\" />";
                }

                xml += "<pair left=\"Текущий баланс:\" right=\"" + displayBalance.ToString("0") + " бон.\" />" +
                       "<pair left=\"За этот заказ начислено:\" right=\"+" + earnedBonus.ToString("0") + " бон.\" />" +
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

                decimal realMoneyPaid = Math.Max(0, data.OrderFullSum - data.DiscountAmount);
                decimal earnedBonus = Math.Floor(realMoneyPaid * (data.CashbackPercent / 100m));
                decimal displayBalance = Math.Max(0, data.CurrentBalance - data.DiscountAmount);
                string nameStr = string.IsNullOrWhiteSpace(data.CustomerName) ? "Гость" : data.CustomerName;

                string xml = "<doc>" +
                             "<line />" +
                             "<center>Система лояльности Bonus CRM</center>" +
                             "<pair left=\"Гость:\" right=\"" + nameStr.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;") + "\" />";

                if (data.DiscountAmount > 0)
                {
                    xml += "<pair left=\"Списано бонусов:\" right=\"-" + data.DiscountAmount.ToString("0") + " бон.\" />";
                }

                xml += "<pair left=\"Текущий баланс:\" right=\"" + displayBalance.ToString("0") + " бон.\" />" +
                       "<pair left=\"За этот заказ начислено:\" right=\"+" + earnedBonus.ToString("0") + " бон.\" />" +
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
            try
            {
                _buttonSubscription?.Dispose();
                _orderSubscription?.Dispose();
                _billPrintSubscription?.Dispose();
                _cashPrintSubscription?.Dispose();
            }
            catch { }
            PluginContext.Log.Info("IikoBonusPlugin: Disposed.");
        }
    }
}

