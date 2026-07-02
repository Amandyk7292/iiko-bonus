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

    [System.Runtime.Serialization.DataContract]
    public class CustomerResponse
    {
        [System.Runtime.Serialization.DataMember]
        public CustomerData customer { get; set; }
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
                if (PluginEntry.ActiveOrders.TryGetValue(order.Id, out var existingData))
                {
                    string title = "Управление лояльностью чека";
                    string menuInfo = "Привязан: " + (string.IsNullOrWhiteSpace(existingData.CustomerName) ? "Гость" : existingData.CustomerName) + " [" + existingData.CustomerPhone + "]\nСписано бонусов: " + existingData.DiscountAmount;
                    
                    var options = new List<string>
                    {
                        "Изменить сумму списания",
                        "Выбрать другого клиента",
                        "Открепить клиента от чека",
                        "Назад"
                    };

                    int action = vm.ShowChooserPopup(title + "\n\n" + menuInfo, options, 0, Resto.Front.Api.UI.ButtonWidth.Wider, "Назад");
                    
                    if (action == 0) // Изменить сумму списания
                    {
                        string editPrompt = (string.IsNullOrWhiteSpace(existingData.CustomerName) ? "Гость" : existingData.CustomerName) + " [" + existingData.CustomerPhone + "]\n\nСколько бонусов списать?\n(0 = без списания, только начисление кэшбэка)";
                        var editAmountRes = vm.ShowInputDialog(editPrompt, Resto.Front.Api.Data.View.InputDialogTypes.Number, (int)existingData.DiscountAmount, "Применить", "Отмена");
                        if (editAmountRes == null) return;

                        decimal newDiscount = 0;
                        if (editAmountRes is Resto.Front.Api.Data.View.NumberInputDialogResult numRes) newDiscount = numRes.Number;
                        else if (editAmountRes is Resto.Front.Api.Data.View.DecimalInputDialogResult decRes) newDiscount = decRes.Decimal;
                        else if (editAmountRes is Resto.Front.Api.Data.View.StringInputDialogResult strRes) decimal.TryParse(strRes.Result.Replace(',', '.'), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out newDiscount);

                        decimal editMaxAllowed = order.FullSum * (existingData.MaxDiscountPercent / 100m);
                        if (newDiscount > editMaxAllowed)
                        {
                            vm.ShowErrorPopup("Максимум можно списать " + editMaxAllowed.ToString("0.00") + " (лимит " + existingData.MaxDiscountPercent + "%)", "ОК");
                            return;
                        }

                        RemoveLoyaltyDiscountFromOrder(order, os);
                        existingData.DiscountAmount = newDiscount;
                        existingData.OrderFullSum = order.FullSum;
                        PluginEntry.ActiveOrders[order.Id] = existingData;

                        ApplyLoyaltyDiscountToOrder(order, os, vm, newDiscount);
                        return;
                    }
                    else if (action == 1) // Выбрать другого клиента
                    {
                        RemoveLoyaltyDiscountFromOrder(order, os);
                        PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                        // Continuing below to search for a new customer
                    }
                    else if (action == 2) // Открепить клиента от чека
                    {
                        RemoveLoyaltyDiscountFromOrder(order, os);
                        PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                        vm.ShowOkPopup("Успех", "Клиент успешно откреплён от заказа.", "ОК");
                        return;
                    }
                    else
                    {
                        return; // Назад / Отмена
                    }
                }

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
                    int choice = vm.ShowChooserPopup("Клиент не найден", new List<string> { "✅ Зарегистрировать «" + query + "»", "❌ Отмена" }, 0, Resto.Front.Api.UI.ButtonWidth.Wider, "Отмена");
                    if (choice != 0) return;

                    string defaultPhone = query.StartsWith("+") || query.Length >= 10 ? query : "+7";
                    var phoneSettings = new Resto.Front.Api.UI.ExtendedInputDialogSettings
                    {
                        EnablePhone = true,
                        NumericInputMode = Resto.Front.Api.UI.NumericInputMode.String,
                        TabTitlePhone = "Новый телефон"
                    };
                    var newPhoneRes = vm.ShowExtendedInputDialog("Регистрация клиента", "Введите полный номер телефона", phoneSettings, "Далее", "Отмена");
                    if (newPhoneRes == null) return;
                    string newPhone = "";
                    if (newPhoneRes is Resto.Front.Api.Data.View.PhoneInputDialogResult newPhRes) newPhone = newPhRes.PhoneNumber;
                    else if (newPhoneRes is Resto.Front.Api.Data.View.StringInputDialogResult newStRes) newPhone = newStRes.Result;
                    else newPhone = newPhoneRes.ToString();
                    if (string.IsNullOrWhiteSpace(newPhone)) return;

                    var nameSettings = new Resto.Front.Api.UI.ExtendedInputDialogSettings
                    {
                        NumericInputMode = Resto.Front.Api.UI.NumericInputMode.String,
                        TabTitleNumericString = "Имя гостя"
                    };
                    var nameRes = vm.ShowExtendedInputDialog("Имя клиента", "Введите имя гостя (или нажмите Пропустить)", nameSettings, "Применить", "Пропустить");
                    string newName = "Новый Гость";
                    if (nameRes != null)
                    {
                        if (nameRes is Resto.Front.Api.Data.View.StringInputDialogResult strName && !string.IsNullOrWhiteSpace(strName.Result))
                        {
                            newName = strName.Result.Trim();
                        }
                        else if (!string.IsNullOrWhiteSpace(nameRes.ToString()))
                        {
                            newName = nameRes.ToString().Trim();
                        }
                    }

                    vm.ChangeProgressBarMessage("Регистрация гостя...");
                    var createdCustomer = SendCreateCustomerRequest(newPhone, newName);
                    if (createdCustomer == null)
                    {
                        vm.ShowErrorPopup("Не удалось зарегистрировать клиента на сервере.", "ОК");
                        return;
                    }
                    customers = new List<CustomerData> { createdCustomer };
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
                    CustomerName = selectedCustomer.name,
                    CustomerPhone = selectedCustomer.phone,
                    CurrentBalance = balance,
                    CashbackPercent = selectedCustomer.cashbackPercent,
                    MaxDiscountPercent = selectedCustomer.maxDiscountPercent,
                    DiscountAmount = discountAmount,
                    OrderFullSum = order.FullSum
                };

                ApplyLoyaltyDiscountToOrder(order, os, vm, discountAmount);
            }
            catch (Exception ex)
            {
                vm.ShowErrorPopup("Ошибка: " + ex.Message, "ОК");
                PluginContext.Log.Error("IikoBonusPlugin Error in LoyaltyFlow: " + ex);
            }
        }

        private static void ApplyLoyaltyDiscountToOrder(IOrder order, IOperationService os, IViewManager vm, decimal discountAmount)
        {
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

        private static void RemoveLoyaltyDiscountFromOrder(IOrder order, IOperationService os)
        {
            try
            {
                if (order.Discounts != null && order.Discounts.Count > 0)
                {
                    var editSession = os.CreateEditSession();
                    bool removed = false;
                    foreach (var d in order.Discounts)
                    {
                        if (d.DiscountType == null || d.DiscountType.Name.ToLower().Contains("бонус") || d.DiscountType.Name.ToLower().Contains("списание") || d.DiscountType.Name.ToLower().Contains("лояльност"))
                        {
                            editSession.DeleteDiscount(d, order);
                            removed = true;
                        }
                    }
                    if (removed)
                    {
                        os.SubmitChanges(editSession, os.GetDefaultCredentials());
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin Error removing loyalty discount: " + ex);
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
                else
                {
                    if (PluginEntry.ActiveOrders.TryGetValue(order.Id, out var activeData))
                    {
                        activeData.OrderFullSum = order.FullSum;
                        PluginEntry.ActiveOrders[order.Id] = activeData;
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Error in OnOrderChanged: " + ex);
            }
        }

        private static CustomerData SendCreateCustomerRequest(string phone, string name)
        {
            try
            {
                var payloadStr = "{\"phone\":\"" + phone.Replace("\"", "\\\"") + "\",\"name\":\"" + name.Replace("\"", "\\\"") + "\"}";
                var content = new StringContent(payloadStr, Encoding.UTF8, "application/json");
                
                var request = new HttpRequestMessage(HttpMethod.Post, ApiBaseUrl + "/customer")
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
                    PluginContext.Log.Error("IikoBonusPlugin: Create customer failed: " + response.StatusCode + " - " + responseString);
                    return null;
                }

                var serializer = new DataContractJsonSerializer(typeof(CustomerResponse));
                using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(responseString)))
                {
                    var data = (CustomerResponse)serializer.ReadObject(ms);
                    return data?.customer;
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin Error in SendCreateCustomerRequest: " + ex);
                return null;
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
