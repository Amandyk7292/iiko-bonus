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
        public CustomerBalance[] balances { get; set; }
    }

    public class LoyaltyResponse
    {
        public CustomerData customer { get; set; }
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

        public BonusWindow(IOrder order, IOperationService os)
        {
            InitializeComponent();
            _order = order;
            _os = os;
        }

        private async void SearchButton_Click(object sender, RoutedEventArgs e)
        {
            var phone = PhoneTextBox.Text.Trim();
            if (string.IsNullOrEmpty(phone))
            {
                StatusTextBlock.Text = "Введите номер телефона";
                return;
            }

            try
            {
                StatusTextBlock.Text = "Поиск...";
                StatusTextBlock.Foreground = System.Windows.Media.Brushes.Black;
                SearchButton.IsEnabled = false;

                var payload = new { phone = phone };
                var content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
                
                var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBaseUrl}/customer")
                {
                    Content = content
                };
                request.Headers.Add("Authorization", $"Bearer {ApiToken}");

                var response = await _httpClient.SendAsync(request);
                var responseString = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode)
                {
                    var data = JsonConvert.DeserializeObject<LoyaltyResponse>(responseString);
                    var customer = data.customer;

                    _currentCustomerId = customer.id;
                    CustomerNameTextBlock.Text = $"Клиент: {customer.name} ({customer.phone})";
                    CustomerBalanceTextBlock.Text = $"Баланс: {customer.balances[0].balance} бонусов";
                    
                    CustomerInfoBorder.Visibility = Visibility.Visible;
                    PaymentPanel.Visibility = Visibility.Visible;
                    StatusTextBlock.Text = "";
                }
                else
                {
                    StatusTextBlock.Foreground = System.Windows.Media.Brushes.Red;
                    StatusTextBlock.Text = "Клиент не найден или ошибка сервера.";
                    CustomerInfoBorder.Visibility = Visibility.Collapsed;
                    PaymentPanel.Visibility = Visibility.Collapsed;
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

        private void ApplyButton_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(_currentCustomerId)) return;

            if (!decimal.TryParse(AmountTextBox.Text, out decimal discountAmount) || discountAmount <= 0)
            {
                StatusTextBlock.Text = "Введите корректную сумму";
                return;
            }

            try
            {
                // TODO: В iiko V9 способ применения скидки отличается.
                // Вам нужно найти нужную скидку и применить её через IOperationService или EditSession.
                // Например:
                // _os.AddDiscountItem(discountAmount, discountType, ...);

                MessageBox.Show($"Симуляция: Успешно списано {discountAmount} бонусов", "Успех", MessageBoxButton.OK, MessageBoxImage.Information);
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
