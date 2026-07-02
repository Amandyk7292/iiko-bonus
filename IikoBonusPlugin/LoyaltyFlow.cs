using System;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Collections.Generic;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [System.Runtime.Serialization.DataContract]
    public class CustomerBalance
    {
        [System.Runtime.Serialization.DataMember]
        public decimal balance { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class CustomerData
    {
        [System.Runtime.Serialization.DataMember]
        public string id { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string name { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string phone { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string createdAt { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal totalSpent { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal cashbackPercent { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal maxDiscountPercent { get; set; }
        [System.Runtime.Serialization.DataMember]
        public CustomerBalance[] balances { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class SearchResponse
    {
        [System.Runtime.Serialization.DataMember]
        public System.Collections.Generic.List<CustomerData> customers { get; set; }
    }

    public static class LoyaltyFlow
    {
        private static readonly HttpClient _httpClient = new HttpClient();
        private const string ApiBaseUrl = "https://iiko-bonus.onrender.com/api/loyalty";
        private const string ApiToken = "secret-token";

        public static void Run(IOrder order, IOperationService os, IViewManager vm)
        {
            try
            {
                // Шаг 1: Спрашиваем телефон (открываем цифровую/телефонную клавиатуру по умолчанию)
                var searchSettings = new Resto.Front.Api.UI.ExtendedInputDialogSettings
                {
                    EnablePhone = true,
                    NumericInputMode = Resto.Front.Api.UI.NumericInputMode.String,
                    TabTitlePhone = "По номеру",
                    TabTitleNumericString = "Последние цифры"
                };
                var searchRes = vm.ShowExtendedInputDialog("Поиск клиента", "Введите последние цифры или номер", searchSettings, "Найти", "Отмена");
                if (searchRes == null) return;
                string query = "";
                if (searchRes is Resto.Front.Api.Data.View.PhoneInputDialogResult phoneRes)
                {
                    query = phoneRes.PhoneNumber;
                }
                else if (searchRes is Resto.Front.Api.Data.View.StringInputDialogResult strRes)
                {
                    query = strRes.Result;
                }
                else if (searchRes is Resto.Front.Api.Data.View.NumberInputDialogResult numRes)
                {
                    query = numRes.Number.ToString();
                }
                else
                {
                    query = searchRes.ToString();
                }
                if (string.IsNullOrWhiteSpace(query)) return;

                vm.ChangeProgressBarMessage("Поиск клиента...");

                // Шаг 2: Ищем клиента
                var payloadStr = "{\"query\":\"" + query.Replace("\"", "\\\"") + "\"}";
                var content = new StringContent(payloadStr, Encoding.UTF8, "application/json");
                
                var request = new HttpRequestMessage(HttpMethod.Post, ApiBaseUrl + "/search")
                {
                    Content = content
                };
                request.Headers.Add("Authorization", "Bearer " + ApiToken);

                var responseTask = _httpClient.SendAsync(request);
                responseTask.Wait();
                var response = responseTask.Result;
                
                var responseStringTask = response.Content.ReadAsStringAsync();
                responseStringTask.Wait();
                var responseString = responseStringTask.Result;

                if (!response.IsSuccessStatusCode)
                {
                    vm.ShowErrorPopup("Ошибка сервера: " + response.StatusCode, "ОК");
                    return;
                }

                SearchResponse data = null;
                var serializer = new DataContractJsonSerializer(typeof(SearchResponse));
                using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(responseString)))
                {
                    data = (SearchResponse)serializer.ReadObject(ms);
                }

                var customers = data?.customers;
                if (customers == null || customers.Count == 0)
                {
                    vm.ShowOkPopup("Результат", "Клиенты не найдены.", "ОК");
                    return;
                }

                // Шаг 3: Выбор клиента
                CustomerData selectedCustomer = null;
                if (customers.Count == 1)
                {
                    selectedCustomer = customers[0];
                }
                else
                {
                    var names = customers.Select(c => FormatCustomerLabel(c)).ToList();
                    int selectedIndex = vm.ShowChooserPopup("Выберите клиента", names, 0, Resto.Front.Api.UI.ButtonWidth.Wider, "Отмена");
                    if (selectedIndex < 0) return;
                    selectedCustomer = customers[selectedIndex];
                }

                decimal balance = selectedCustomer.balances != null && selectedCustomer.balances.Length > 0 ? selectedCustomer.balances[0].balance : 0;
                string regDateInfo = "";
                if (!string.IsNullOrWhiteSpace(selectedCustomer.createdAt))
                {
                    if (DateTime.TryParse(selectedCustomer.createdAt, out var dt)) regDateInfo = "\nДата рег.: " + dt.ToString("dd.MM.yyyy");
                    else if (selectedCustomer.createdAt.Contains("T")) regDateInfo = "\nДата рег.: " + selectedCustomer.createdAt.Split('T')[0];
                    else regDateInfo = "\nДата рег.: " + selectedCustomer.createdAt;
                }

                string info = "Клиент: " + selectedCustomer.name + "\nНомер: " + selectedCustomer.phone + regDateInfo + "\nБаланс: " + balance + " бонусов\nКэшбек: " + selectedCustomer.cashbackPercent + "%";
                
                // Шаг 4: Спросить сколько списать (открываем цифровой NUMPAD, начальное значение 0)
                string prompt = info + "\n\nСколько бонусов списать?\n(0 = без списания, только начисление кэшбэка)";
                var amountRes = vm.ShowInputDialog(prompt, Resto.Front.Api.Data.View.InputDialogTypes.Number, 0, "Применить", "Отмена");
                if (amountRes == null) return;

                decimal discountAmount = 0;
                if (amountRes is Resto.Front.Api.Data.View.NumberInputDialogResult amountNumRes)
                {
                    discountAmount = amountNumRes.Number;
                }
                else if (amountRes is Resto.Front.Api.Data.View.DecimalInputDialogResult amountDecRes)
                {
                    discountAmount = amountDecRes.Decimal;
                }
                else if (amountRes is Resto.Front.Api.Data.View.StringInputDialogResult amountStrRes)
                {
                    if (!decimal.TryParse(amountStrRes.Result.Replace(',', '.'), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out discountAmount) || discountAmount < 0)
                    {
                        vm.ShowErrorPopup("Введите корректную сумму", "ОК");
                        return;
                    }
                }

                decimal maxAllowed = order.FullSum * (selectedCustomer.maxDiscountPercent / 100m);
                if (discountAmount > maxAllowed)
                {
                    vm.ShowErrorPopup("Максимум можно списать " + maxAllowed.ToString("0.00") + " (лимит " + selectedCustomer.maxDiscountPercent + "%)", "ОК");
                    return;
                }

                // Шаг 5: Применение скидки
                PluginEntry.ActiveOrders[order.Id] = new PluginEntry.OrderLoyaltyData
                {
                    CustomerId = selectedCustomer.id,
                    DiscountAmount = discountAmount
                };

                var discountType = os.GetDiscountTypes().FirstOrDefault(d =>
                    d.Name.ToLower().Contains("бонус") ||
                    d.Name.ToLower().Contains("списание") ||
                    d.Name.ToLower().Contains("лояльност"));

                if (discountType == null)
                {
                    if (discountAmount == 0)
                    {
                        vm.ShowOkPopup("Успех", "Клиент привязан к заказу.", "ОК");
                    }
                    else
                    {
                        vm.ShowErrorPopup("В iikoOffice не найдена скидка со словом 'Бонус', 'Списание' или 'Лояльность'.", "ОК");
                    }
                    return;
                }

                if (discountAmount > 0)
                {
                    var editSession = os.CreateEditSession();
                    editSession.AddFlexibleSumDiscount(discountAmount, discountType, order);
                    os.SubmitChanges(editSession, os.GetDefaultCredentials());
                    vm.ShowOkPopup("Успех", "Успешно списано " + discountAmount + " бонусов.", "ОК");
                }
                else
                {
                    vm.ShowOkPopup("Успех", "Клиент привязан к заказу.", "ОК");
                }
            }
            catch (Exception ex)
            {
                vm.ShowErrorPopup("Ошибка: " + ex.Message, "ОК");
                PluginContext.Log.Error("IikoBonusPlugin Error in LoyaltyFlow: " + ex);
            }
        }

        private static string FormatCustomerLabel(CustomerData c)
        {
            string dateStr = "";
            if (!string.IsNullOrWhiteSpace(c.createdAt))
            {
                if (DateTime.TryParse(c.createdAt, out var dt))
                {
                    dateStr = " (рег: " + dt.ToString("dd.MM.yyyy") + ")";
                }
                else if (c.createdAt.Contains("T"))
                {
                    dateStr = " (рег: " + c.createdAt.Split('T')[0] + ")";
                }
                else
                {
                    dateStr = " (рег: " + c.createdAt + ")";
                }
            }
            return c.name + " [" + c.phone + "]" + dateStr;
        }

        public static void OnOrderChanged(EntityChangedEventArgs<IOrder> args)
        {
            try
            {
                var order = args.Entity;
                if (order == null) return;

                if (order.Status == OrderStatus.Deleted)
                {
                    PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                    return;
                }

                if (order.Status == OrderStatus.Closed)
                {
                    if (PluginEntry.ActiveOrders.TryRemove(order.Id, out var loyaltyData))
                    {
                        PluginContext.Log.Info("IikoBonusPlugin: Order " + order.Number + " closed. Applying loyalty for customer " + loyaltyData.CustomerId + ", discount " + loyaltyData.DiscountAmount + ", fullSum " + order.FullSum + "...");
                        
                        Task.Run(() => SendApplyRequest(loyaltyData.CustomerId, order.Number.ToString(), loyaltyData.DiscountAmount, order.FullSum));
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Error in OnOrderChanged: " + ex);
            }
        }

        private static void SendApplyRequest(string customerId, string orderId, decimal discountAmount, decimal orderTotal)
        {
            try
            {
                var payloadStr = "{\"customerId\":\"" + customerId + "\",\"orderId\":\"" + orderId + "\",\"discountAmount\":" + discountAmount.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"orderTotal\":" + orderTotal.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
                var content = new StringContent(payloadStr, Encoding.UTF8, "application/json");
                
                var request = new HttpRequestMessage(HttpMethod.Post, ApiBaseUrl + "/apply")
                {
                    Content = content
                };
                request.Headers.Add("Authorization", "Bearer " + ApiToken);

                var responseTask = _httpClient.SendAsync(request);
                responseTask.Wait();
                var response = responseTask.Result;
                
                var responseStringTask = response.Content.ReadAsStringAsync();
                responseStringTask.Wait();
                var responseString = responseStringTask.Result;

                if (response.IsSuccessStatusCode)
                {
                    PluginContext.Log.Info("IikoBonusPlugin: Loyalty applied successfully for order " + orderId + ". Response: " + responseString);
                }
                else
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Failed to apply loyalty for order " + orderId + ". Status: " + response.StatusCode + ", Response: " + responseString);
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Exception sending apply request for order " + orderId + ": " + ex);
            }
        }
    }
}
