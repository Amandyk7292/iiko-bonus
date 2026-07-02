using System;
using System.Runtime.Remoting;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Resto.Front.Api;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Data.Orders;
using IikoBonusPlugin.UI;

namespace IikoBonusPlugin
{
    [PluginLicenseModuleId(0)]
    public sealed class PluginEntry : IFrontPlugin
    {
        private IDisposable _subscription;
        private IDisposable _orderSubscription;

        public class OrderLoyaltyData
        {
            public string CustomerId { get; set; }
            public decimal DiscountAmount { get; set; }
        }

        public static ConcurrentDictionary<Guid, OrderLoyaltyData> ActiveOrders = new ConcurrentDictionary<Guid, OrderLoyaltyData>();

        public PluginEntry()
        {
            PluginContext.Log.Info("IikoBonusPlugin is initializing...");
            
            // Register a button on the order edit screen
            _subscription = PluginContext.Operations.AddButtonToOrderEditScreen(
                "Программа Лояльности",
                args =>
                {
                    try
                    {
                        var window = new BonusWindow(args.order, args.os);
                        window.ShowDialog();
                    }
                    catch (Exception ex)
                    {
                        PluginContext.Log.Error("Error opening BonusWindow", ex);
                    }
                }
            );

            // Подписываемся на изменения заказов для автоматического начисления бонусов при закрытии
            _orderSubscription = PluginContext.Notifications.OrderChanged.Subscribe(new OrderChangedObserver(e =>
            {
                Task.Run(async () => 
                {
                    try
                    {
                        var order = e.Entity;
                        if (order.Status == OrderStatus.Closed && ActiveOrders.TryGetValue(order.Id, out var loyaltyData))
                        {
                            PluginContext.Log.Info($"Order {order.Id} closed. Processing loyalty for {loyaltyData.CustomerId}.");
                            ActiveOrders.TryRemove(order.Id, out _);
                            await ProcessLoyaltyAccrual(loyaltyData, order);
                        }
                    }
                    catch (Exception ex)
                    {
                        PluginContext.Log.Error("Error processing OrderChanged", ex);
                    }
                });
            }));

            PluginContext.Log.Info("IikoBonusPlugin initialized successfully.");
        }

        private async Task ProcessLoyaltyAccrual(OrderLoyaltyData data, IOrder order)
        {
            try
            {
                using (var client = new HttpClient())
                {
                    var payload = new
                    {
                        customerId = data.CustomerId,
                        orderId = order.Id.ToString(),
                        discountAmount = data.DiscountAmount,
                        orderTotal = order.FullSum
                    };

                    var content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
                    var request = new HttpRequestMessage(HttpMethod.Post, "https://iiko-bonus.onrender.com/api/loyalty/apply")
                    {
                        Content = content
                    };
                    request.Headers.Add("Authorization", "Bearer secret-token");

                    var response = await client.SendAsync(request);
                    var responseString = await response.Content.ReadAsStringAsync();
                    PluginContext.Log.Info($"Loyalty Apply Response: {responseString}");
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Error in ProcessLoyaltyAccrual", ex);
            }
        }

        public void Dispose()
        {
            _subscription?.Dispose();
            _orderSubscription?.Dispose();
            PluginContext.Log.Info("IikoBonusPlugin disposed.");
        }
    }
}
