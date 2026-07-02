using System;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using Newtonsoft.Json;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;

namespace IikoBonusPlugin.UI
{
    public class CustomerBalance
    {
        public decimal balance { get; set; }
    }

    public class CustomerData
    {
        public string id { get; set; }
        public string name { get; set; }
        public string phone { get; set; }
        public decimal totalSpent { get; set; }
        public decimal cashbackPercent { get; set; }
        public decimal maxDiscountPercent { get; set; }
        public CustomerBalance[] balances { get; set; }
    }

    public class LoyaltyResponse
    {
        public CustomerData customer { get; set; }
    }

    public class SearchResponse
    {
        public System.Collections.Generic.List<CustomerData> customers { get; set; }
    }

    public partial class BonusWindow : Window
    {
        private readonly IOrder _order;
        private readonly IOperationService _os;
        private static readonly HttpClient _httpClient = new HttpClient();
        
        // ВНИМАНИЕ: Замените на адрес вашего сервера!
        private const string ApiBaseUrl = "https://iiko-bonus.onrender.com/api/loyalty";
        private const string ApiToken = "secret-token"; // ваш API_TOKEN

        private string _currentCustomerId;
        private decimal _maxDiscountPercent;

        public BonusWindow(IOrder order, IOperationService os)
        {
            InitializeComponent();
            _order = order;
            _os = os;
        }

        private async void SearchButton_Click(object sender, RoutedEventArgs e)
        {
            var query = PhoneTextBox.Text.Trim();
            if (string.IsNullOrEmpty(query))
            {
                StatusTextBlock.Text = "Введите номер телефона или имя";
                return;
            }

            try
            {
                StatusTextBlock.Text = "Поиск...";
                StatusTextBlock.Foreground = System.Windows.Media.Brushes.Black;
                SearchButton.IsEnabled = false;
                SearchResultsListBox.Visibility = Visibility.Collapsed;
                CustomerInfoBorder.Visibility = Visibility.Collapsed;
                PaymentPanel.Visibility = Visibility.Collapsed;

                var payload = new { query = query };
                var content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
                
                var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBaseUrl}/search")
                {
                    Content = content
                };
                request.Headers.Add("Authorization", $"Bearer {ApiToken}");

                var response = await _httpClient.SendAsync(request);
                var responseString = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode)
                {
                    var data = JsonConvert.DeserializeObject<SearchResponse>(responseString);
                    var customers = data.customers;

                    if (customers == null || customers.Count == 0)
                    {
                        StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                        StatusTextBlock.Text = "Клиенты не найдены.";
                    }
                    else if (customers.Count == 1)
                    {
                        // Если найден только 1, сразу показываем его
                        SelectCustomer(customers[0]);
                    }
                    else
                    {
                        // Показываем список для выбора
                        StatusTextBlock.Text = $"Найдено клиентов: {customers.Count}. Выберите нужного.";
                        SearchResultsListBox.ItemsSource = customers;
                        SearchResultsListBox.Visibility = Visibility.Visible;
                    }
                }
                else
                {
                    StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                    StatusTextBlock.Text = "Ошибка сервера: " + response.StatusCode;
                }
            }
            catch (Exception ex)
            {
                StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                StatusTextBlock.Text = "Ошибка соединения: " + ex.Message;
            }
            finally
            {
                SearchButton.IsEnabled = true;
            }
        }

        private void SearchResultsListBox_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
        {
            if (SearchResultsListBox.SelectedItem is CustomerData selectedCustomer)
            {
                SelectCustomer(selectedCustomer);
                SearchResultsListBox.Visibility = Visibility.Collapsed;
            }
        }

        private void SelectCustomer(CustomerData customer)
        {
            _currentCustomerId = customer.id;
            _maxDiscountPercent = customer.maxDiscountPercent;

            string vipStatus = customer.cashbackPercent > 3 ? " (VIP)" : "";
            CustomerNameTextBlock.Text = $"Клиент: {customer.name}{vipStatus}";
            decimal balance = customer.balances != null && customer.balances.Length > 0 ? customer.balances[0].balance : 0;
            CustomerBalanceTextBlock.Text = $"Баланс: {balance} бонусов (Кэшбек: {customer.cashbackPercent}%)";
            
            CustomerInfoBorder.Visibility = Visibility.Visible;
            PaymentPanel.Visibility = Visibility.Visible;
            StatusTextBlock.Text = $"Максимальная оплата бонусами: {customer.maxDiscountPercent}% от чека";
        }

        private void ApplyButton_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(_currentCustomerId)) return;

            if (!decimal.TryParse(AmountTextBox.Text, out decimal discountAmount) || discountAmount < 0)
            {
                StatusTextBlock.Text = "Введите корректную сумму";
                return;
            }

            // Проверяем лимит
            decimal maxAllowed = _order.FullSum * (_maxDiscountPercent / 100);
            if (discountAmount > maxAllowed)
            {
                StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                StatusTextBlock.Text = $"Максимум можно списать {maxAllowed:0.00} (лимит {_maxDiscountPercent}%)";
                return;
            }

            // Сохраняем привязку заказа для начисления бонусов при его закрытии
            PluginEntry.ActiveOrders[_order.Id] = new PluginEntry.OrderLoyaltyData
            {
                CustomerId = _currentCustomerId,
                DiscountAmount = discountAmount
            };

            try
            {
                // TODO: В iiko V9 способ применения скидки отличается.
                // Вам нужно найти нужную скидку и применить её через IOperationService или EditSession.
                // Например:
                // _os.AddDiscountItem(discountAmount, discountType, ...);

                MessageBox.Show($"Симуляция: Успешно списано {discountAmount} бонусов. Ожидаем закрытия заказа для финального расчета.", "Успех", MessageBoxButton.OK, MessageBoxImage.Information);
                this.Close();
            }
            catch (Exception ex)
            {
                StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                StatusTextBlock.Text = "Ошибка при применении скидки: " + ex.Message;
            }
        }
    }
}
