using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Attributes.JetBrains;
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

        public class OrderLoyaltyData
        {
            public string CustomerId { get; set; }
            public decimal DiscountAmount { get; set; }
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

                PluginContext.Log.Info("IikoBonusPlugin: Initialized successfully.");
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: FATAL init error: " + ex);
            }
        }

        public void Dispose()
        {
            try
            {
                _buttonSubscription?.Dispose();
                _orderSubscription?.Dispose();
            }
            catch { }
            PluginContext.Log.Info("IikoBonusPlugin: Disposed.");
        }
    }
}
