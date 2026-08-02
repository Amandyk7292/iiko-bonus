using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization.Json;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Threading;
using System.Xml.Linq;
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

    [System.Runtime.Serialization.DataContract]
    public class ApiErrorResponse
    {
        [System.Runtime.Serialization.DataMember]
        public string error { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class PickupHandoffRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string branchId { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public string token { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public int orderNumber { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public string pin { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public string iikoOrderId { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class PickupHandoffData
    {
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public int orderNumber { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderStatus { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string verifiedAt { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class PickupHandoffResponse
    {
        [System.Runtime.Serialization.DataMember]
        public bool success { get; set; }
        [System.Runtime.Serialization.DataMember]
        public PickupHandoffData handoff { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class SearchRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string query { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class CustomerCreateRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string phone { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string name { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class ReservationRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string customerId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal orderTotal { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal discountAmount { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class ReservationResponse
    {
        [System.Runtime.Serialization.DataMember]
        public bool success { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string reservationId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string customerId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal discountAmount { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal availableBalance { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal maxDiscountPercent { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string expiresAt { get; set; }
        [System.Runtime.Serialization.DataMember]
        public bool duplicate { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class ReservationCommitRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string customerId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string reservationId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal orderTotal { get; set; }
        [System.Runtime.Serialization.DataMember]
        public OrderItemData[] items { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class ReservationCancelRequest
    {
        [System.Runtime.Serialization.DataMember]
        public string customerId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string reservationId { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class OrderItemData
    {
        [System.Runtime.Serialization.DataMember]
        public string productId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string productName { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal amount { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal price { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal total { get; set; }
    }

    [System.Runtime.Serialization.DataContract]
    public class LoyaltyApplyQueueItem
    {
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public string operation { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string orderId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string customerId { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public string reservationId { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal discountAmount { get; set; }
        [System.Runtime.Serialization.DataMember]
        public decimal orderTotal { get; set; }
        [System.Runtime.Serialization.DataMember]
        public int attempts { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string createdAtUtc { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string updatedAtUtc { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string lastAttemptAtUtc { get; set; }
        [System.Runtime.Serialization.DataMember]
        public string lastError { get; set; }
        [System.Runtime.Serialization.DataMember]
        public OrderItemData[] items { get; set; }
        [System.Runtime.Serialization.DataMember(EmitDefaultValue = false)]
        public bool terminal { get; set; }
    }

    public static class LoyaltyFlow
    {
        private static readonly HttpClient _httpClient = new HttpClient();
        private static readonly string ApiBaseUrl = ReadPluginSetting("IIKO_LOYALTY_API_BASE_URL") ?? "https://bulka.com.kz/api/loyalty";
        private static readonly string ApiToken = ReadPluginSetting("IIKO_LOYALTY_API_TOKEN") ?? ReadPluginSetting("API_TOKEN");
        private static readonly string DiscountTypeId = ReadPluginSetting("IIKO_LOYALTY_DISCOUNT_TYPE_ID");
        private static readonly string DiscountTypeName = ReadPluginSetting("IIKO_LOYALTY_DISCOUNT_TYPE_NAME") ?? "Bulka Bonus";
        private static readonly string BranchId = ReadPluginSetting("IIKO_BRANCH_ID");
        private static readonly string BranchPosToken = ReadPluginSetting("IIKO_BRANCH_POS_TOKEN");
        private static readonly int RetryIntervalSec = Clamp(ReadIntSetting("IIKO_LOYALTY_RETRY_INTERVAL_SEC", 60), 10, 3600);
        private static readonly int MaxAttempts = Clamp(ReadIntSetting("IIKO_LOYALTY_MAX_ATTEMPTS", 0), 0, 1000);
        private static readonly string AssemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? AppDomain.CurrentDomain.BaseDirectory;
        private static readonly string DataDirectory = ResolveDataDirectory();
        internal static string DataDirectoryPath => DataDirectory;
        private static readonly string QueuePath = Path.Combine(DataDirectory, "BulkaBonusPendingApplies.json");
        private static readonly string ActiveOrdersPath = Path.Combine(DataDirectory, "BulkaBonusActiveOrders.json");
        private static readonly object QueueLock = new object();
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, object> OrderOperationLocks =
            new System.Collections.Concurrent.ConcurrentDictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        private static Timer _retryTimer;
        private static int _flushInProgress;
        private static string _lastConnectionStatus = "не проверено";
        private static DateTime? _lastConnectionCheckUtc;

        static LoyaltyFlow()
        {
            _httpClient.Timeout = TimeSpan.FromSeconds(Clamp(ReadIntSetting("IIKO_LOYALTY_TIMEOUT_SEC", 8), 2, 30));
            TryMigrateLegacyFile("BulkaBonusPendingApplies.json", QueuePath);
            TryMigrateLegacyFile("BulkaBonusActiveOrders.json", ActiveOrdersPath);
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        private static string ResolveDataDirectory()
        {
            var configuredPath = ReadPluginSetting("IIKO_LOYALTY_DATA_DIR");
            var preferredPath = string.IsNullOrWhiteSpace(configuredPath)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Bulka", "IikoBonusPlugin")
                : Environment.ExpandEnvironmentVariables(configuredPath.Trim());

            try
            {
                Directory.CreateDirectory(preferredPath);
                return preferredPath;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Cannot use data directory " + preferredPath + ": " + ex.Message);
                Directory.CreateDirectory(AssemblyDirectory);
                return AssemblyDirectory;
            }
        }

        private static void TryMigrateLegacyFile(string fileName, string destinationPath)
        {
            try
            {
                var sourcePath = Path.Combine(AssemblyDirectory, fileName);
                if (!File.Exists(destinationPath) && File.Exists(sourcePath) && !string.Equals(sourcePath, destinationPath, StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(sourcePath, destinationPath, false);
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to migrate " + fileName + ": " + ex.Message);
            }
        }

        internal static string ReadPluginSetting(string key)
        {
            var envValue = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrWhiteSpace(envValue)) return envValue.Trim();

            try
            {
                var assemblyPath = Assembly.GetExecutingAssembly().Location;
                var configPath = assemblyPath + ".config";
                if (!File.Exists(configPath)) return null;

                var doc = XDocument.Load(configPath);
                foreach (var add in doc.Descendants("add"))
                {
                    var addKey = add.Attribute("key")?.Value;
                    if (string.Equals(addKey, key, StringComparison.OrdinalIgnoreCase))
                    {
                        var value = add.Attribute("value")?.Value;
                        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to read config setting " + key + ": " + ex);
            }

            return null;
        }

        private static int ReadIntSetting(string key, int fallback)
        {
            var raw = ReadPluginSetting(key);
            if (int.TryParse(raw, out var value) && value >= 0) return value;
            return fallback;
        }

        public static void StartBackgroundRetry()
        {
            if (_retryTimer != null) return;
            _retryTimer = new Timer(_ => RunBackgroundTick(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(RetryIntervalSec));
        }

        private static void RunBackgroundTick()
        {
            try
            {
                FlushPendingApplyRequests();
                CheckServerStatus();
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Background tick failed: " + ex);
            }
        }

        public static void RestoreActiveOrders()
        {
            lock (QueueLock)
            {
                try
                {
                    if (!File.Exists(ActiveOrdersPath)) return;
                    var saved = ReadSerializedFile<Dictionary<Guid, PluginEntry.OrderLoyaltyData>>(ActiveOrdersPath);
                    if (saved == null) return;
                    foreach (var pair in saved) PluginEntry.ActiveOrders[pair.Key] = pair.Value;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Failed to restore active orders: " + ex);
                }
            }
        }

        public static bool PersistActiveOrders()
        {
            lock (QueueLock)
            {
                try
                {
                    WriteSerializedFileAtomically(
                        ActiveOrdersPath,
                        PluginEntry.ActiveOrders.ToDictionary(x => x.Key, x => x.Value));
                    return true;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Failed to persist active orders: " + ex);
                    return false;
                }
            }
        }

        public static void StopBackgroundRetry()
        {
            try
            {
                _retryTimer?.Dispose();
                _retryTimer = null;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to stop background retry: " + ex.Message);
            }
        }

        public static string GetQueueStatusText()
        {
            List<LoyaltyApplyQueueItem> pending;
            try
            {
                pending = LoadQueue();
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Cannot read pending queue for status: " + ex);
                return "Bulka Bonus\nAPI: " + ApiBaseUrl + "\nОшибка чтения локальной очереди. Проверьте журнал плагина.";
            }
            var tokenStatus = IsTokenConfigured() ? "токен задан" : "токен НЕ задан";
            var waitingCount = pending.Count(x => !x.terminal);
            var failedCount = pending.Count(x => x.terminal);
            var checkedAt = _lastConnectionCheckUtc.HasValue
                ? _lastConnectionCheckUtc.Value.ToLocalTime().ToString("dd.MM.yyyy HH:mm:ss")
                : "не проверялось";
            var failedDetails = failedCount == 0
                ? ""
                : "\n\nОшибки:\n" + string.Join("\n", pending.Where(x => x.terminal).Take(5).Select(x =>
                    NormalizeOperation(x.operation) + " / " + x.orderId + ": " + GetSafeErrorBody(x.lastError)));
            return "Bulka Bonus\nAPI: " + ApiBaseUrl + "\n" + tokenStatus +
                   "\nСвязь: " + _lastConnectionStatus + "\nПоследняя проверка: " + checkedAt +
                   "\nОжидают отправки: " + waitingCount + "\nТребуют внимания: " + failedCount +
                   "\nДанные: " + DataDirectory + failedDetails;
        }

        private static bool IsTokenConfigured()
        {
            if (string.IsNullOrWhiteSpace(ApiToken) || ApiToken.Length < 32) return false;
            var normalized = ApiToken.Trim().ToLowerInvariant();
            return !normalized.Contains("replace") && !normalized.Contains("change-me") && !normalized.Contains("secret-here");
        }

        private static bool IsApiUrlConfigured()
        {
            Uri uri;
            return Uri.TryCreate(ApiBaseUrl, UriKind.Absolute, out uri) &&
                   string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
                   string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);
        }

        internal static bool EnsureApiConfiguration(IViewManager vm)
        {
            if (!IsApiUrlConfigured())
            {
                const string message = "IIKO_LOYALTY_API_BASE_URL должен быть корректным HTTPS-адресом.";
                PluginContext.Log.Error("IikoBonusPlugin: " + message);
                try { vm.ShowErrorPopup(message, "ОК"); } catch { }
                return false;
            }
            return EnsureApiToken(vm);
        }

        internal static bool EnsureBranchPosConfiguration(IViewManager vm)
        {
            if (!EnsureApiConfiguration(vm)) return false;
            Guid branchId;
            if (!Guid.TryParse(BranchId, out branchId) ||
                string.IsNullOrWhiteSpace(BranchPosToken) ||
                BranchPosToken.Trim().Length < 40)
            {
                const string message =
                    "Для защищённых операций задайте IIKO_BRANCH_ID и IIKO_BRANCH_POS_TOKEN этой кассы.";
                PluginContext.Log.Error("IikoBonusPlugin: Branch POS credentials are not configured.");
                try { vm.ShowErrorPopup(message, "ОК"); } catch { }
                return false;
            }
            return true;
        }

        private static bool EnsureApiConfiguration()
        {
            if (!IsApiUrlConfigured())
            {
                PluginContext.Log.Error("IikoBonusPlugin: IIKO_LOYALTY_API_BASE_URL must be a valid HTTPS URL.");
                return false;
            }
            return EnsureApiToken();
        }

        private static bool EnsureApiToken(IViewManager vm)
        {
            if (IsTokenConfigured()) return true;
            const string message = "Не задан IIKO_LOYALTY_API_TOKEN для бонусной системы.";
            PluginContext.Log.Error("IikoBonusPlugin: " + message);
            try { vm.ShowErrorPopup(message, "ОК"); } catch { }
            return false;
        }

        private static bool EnsureApiToken()
        {
            if (IsTokenConfigured()) return true;
            PluginContext.Log.Error("IikoBonusPlugin: Не задан IIKO_LOYALTY_API_TOKEN для бонусной системы.");
            return false;
        }

        internal sealed class ApiResponse
        {
            public HttpStatusCode StatusCode { get; set; }
            public string Body { get; set; }
            public bool IsSuccessStatusCode { get; set; }
        }

        internal static ApiResponse SendApiRequest(HttpMethod method, string relativePath, object payload = null)
        {
            if (!EnsureApiConfiguration()) throw new InvalidOperationException("Конфигурация API лояльности не заполнена.");

            var baseUri = new Uri(ApiBaseUrl.TrimEnd('/') + "/", UriKind.Absolute);
            var requestUri = new Uri(baseUri, relativePath.TrimStart('/'));
            using (var request = new HttpRequestMessage(method, requestUri))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiToken);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                if (!string.IsNullOrWhiteSpace(BranchId) &&
                    !string.IsNullOrWhiteSpace(BranchPosToken))
                {
                    request.Headers.TryAddWithoutValidation("X-Bulka-Branch-Id", BranchId);
                    request.Headers.TryAddWithoutValidation(
                        "X-Bulka-Pos-Token",
                        BranchPosToken);
                }
                if (payload != null)
                {
                    request.Content = new StringContent(SerializeJson(payload), Encoding.UTF8, "application/json");
                }

                using (var response = _httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead).GetAwaiter().GetResult())
                {
                    var body = response.Content == null
                        ? ""
                        : response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    return new ApiResponse
                    {
                        StatusCode = response.StatusCode,
                        IsSuccessStatusCode = response.IsSuccessStatusCode,
                        Body = body ?? ""
                    };
                }
            }
        }

        private static string SerializeJson(object value)
        {
            if (value == null) return "null";
            var serializer = new DataContractJsonSerializer(value.GetType());
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        internal static T DeserializeJson<T>(string json)
        {
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(json ?? "")))
            {
                return (T)serializer.ReadObject(stream);
            }
        }

        private static string GetSafeErrorBody(string body)
        {
            var normalized = (body ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return normalized.Length <= 500 ? normalized : normalized.Substring(0, 500);
        }

        internal static string GetApiErrorMessage(string body, string fallback)
        {
            try
            {
                var error = DeserializeJson<ApiErrorResponse>(body);
                var message = (error?.error ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
                if (!string.IsNullOrWhiteSpace(message))
                {
                    return message.Length <= 300 ? message : message.Substring(0, 300);
                }
            }
            catch { }
            return fallback;
        }

        internal static bool IsRetryableStatus(HttpStatusCode statusCode)
        {
            var code = (int)statusCode;
            return statusCode == HttpStatusCode.RequestTimeout || code == 429 || code >= 500;
        }

        private static bool IsRetryableApiFailure(HttpStatusCode statusCode, string body)
        {
            if (IsRetryableStatus(statusCode) || statusCode == HttpStatusCode.Unauthorized ||
                statusCode == HttpStatusCode.Forbidden) return true;
            if (statusCode != HttpStatusCode.NotFound) return false;

            var message = GetApiErrorMessage(body, "").ToLowerInvariant();
            return !message.Contains("reservation not found") &&
                   !message.Contains("customer not found") &&
                   !message.Contains("резервац") &&
                   !message.Contains("клиент");
        }

        private static decimal GetLocallyAvailableBalance(string customerId, decimal serverBalance, Guid currentOrderId)
        {
            var reservedByOtherOrders = PluginEntry.ActiveOrders
                .Where(pair => pair.Key != currentOrderId &&
                               string.Equals(pair.Value.CustomerId, customerId, StringComparison.OrdinalIgnoreCase))
                .Sum(pair => Math.Max(0m, pair.Value.DiscountAmount));
            decimal queuedWriteOffs;
            try
            {
                queuedWriteOffs = LoadQueue()
                    .Where(item => string.Equals(item.customerId, customerId, StringComparison.OrdinalIgnoreCase))
                    .Sum(item => Math.Max(0m, item.discountAmount));
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Cannot calculate local reservations: " + ex.Message);
                return 0;
            }
            return Math.Max(0m, serverBalance - reservedByOtherOrders - queuedWriteOffs);
        }

        private static bool TryReserveDiscount(
            string customerId,
            string orderId,
            decimal orderTotal,
            decimal discountAmount,
            IViewManager vm,
            out ReservationResponse reservation)
        {
            reservation = null;
            try
            {
                if (discountAmount <= 0) return true;
                lock (GetOrderOperationLock(orderId))
                {
                    var response = SendApiRequest(HttpMethod.Post, "reserve", new ReservationRequest
                    {
                        customerId = customerId,
                        orderId = orderId,
                        orderTotal = Math.Max(0m, orderTotal),
                        discountAmount = Math.Round(discountAmount, 2, MidpointRounding.AwayFromZero)
                    });
                    if (!response.IsSuccessStatusCode)
                    {
                        PluginContext.Log.Error("IikoBonusPlugin: Reservation failed: " + response.StatusCode + " - " + GetSafeErrorBody(response.Body));
                        if (vm != null)
                        {
                            var message = response.StatusCode == HttpStatusCode.NotFound
                                ? "Клиент или резервация не найдены. Обновите данные гостя."
                                : response.StatusCode == HttpStatusCode.Conflict
                                    ? "Доступный баланс изменился на другом терминале. Выберите сумму списания заново."
                                    : GetApiErrorMessage(response.Body,
                                        "Не удалось зарезервировать бонусы. Списание не применено. Код: " + (int)response.StatusCode);
                            vm.ShowErrorPopup(message, "ОК");
                        }
                        return false;
                    }

                    reservation = DeserializeJson<ReservationResponse>(response.Body);
                    if (reservation == null || !reservation.success || string.IsNullOrWhiteSpace(reservation.reservationId) ||
                        Math.Abs(reservation.discountAmount - discountAmount) > 0.001m)
                    {
                        PluginContext.Log.Error("IikoBonusPlugin: Reservation response is incomplete or amount does not match.");
                        if (vm != null) vm.ShowErrorPopup("Сервис вернул некорректную резервацию. Списание не применено.", "ОК");
                        return false;
                    }

                    RemoveQueuedOperation("cancel", orderId);
                    return true;
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Reservation request failed: " + ex);
                if (vm != null) vm.ShowErrorPopup("Нет связи с сервисом лояльности. Списание без резерва запрещено.", "ОК");
                return false;
            }
        }

        private static bool TryCancelReservation(
            string customerId,
            string orderId,
            string reservationId,
            out string error,
            out bool retryable)
        {
            error = "";
            retryable = true;
            if (string.IsNullOrWhiteSpace(reservationId)) return true;
            try
            {
                var response = SendApiRequest(HttpMethod.Post, "cancel", new ReservationCancelRequest
                {
                    customerId = customerId,
                    orderId = orderId,
                    reservationId = reservationId
                });
                if (response.IsSuccessStatusCode)
                {
                    RemoveQueuedOperation("cancel", orderId);
                    return true;
                }
                retryable = IsRetryableApiFailure(response.StatusCode, response.Body);
                error = "Status: " + response.StatusCode + ", Response: " + GetSafeErrorBody(response.Body);
                return false;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                retryable = true;
                return false;
            }
        }

        private static bool CancelReservationOrQueue(
            string customerId,
            string orderId,
            string reservationId,
            IViewManager vm = null)
        {
            if (string.IsNullOrWhiteSpace(reservationId)) return true;
            lock (GetOrderOperationLock(orderId))
            {
                string error;
                bool retryable;
                if (TryCancelReservation(customerId, orderId, reservationId, out error, out retryable)) return true;

                EnqueueOperation("cancel", orderId, customerId, reservationId, 0, 0, null, !retryable, error);
                PluginContext.Log.Error("IikoBonusPlugin: Reservation cancellation queued for order " + orderId + ": " + error);
                if (vm != null)
                {
                    vm.ShowOkPopup("Резервация", "Скидка удалена. Освобождение бонусов поставлено в очередь и выполнится после восстановления связи.", "ОК");
                }
                return false;
            }
        }

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

                        newDiscount = Math.Round(newDiscount, 2, MidpointRounding.AwayFromZero);
                        var safePercent = Math.Max(0m, Math.Min(100m, existingData.MaxDiscountPercent));
                        // CurrentBalance is the server-reported amount available before this
                        // order's own reservation. Other server-side reservations are already excluded.
                        var locallyAvailableBalance = Math.Max(0m, existingData.CurrentBalance);
                        var appliedOldDiscount = GetAppliedLoyaltyDiscountAmount(order, os);
                        var eligibleOrderTotal = Math.Max(0m, order.ResultSum + appliedOldDiscount);
                        decimal editMaxAllowed = Math.Min(
                            locallyAvailableBalance,
                            Math.Min(eligibleOrderTotal, eligibleOrderTotal * (safePercent / 100m)));
                        if (newDiscount < 0)
                        {
                            vm.ShowErrorPopup("Сумма списания не может быть отрицательной.", "ОК");
                            return;
                        }
                        if (newDiscount > editMaxAllowed)
                        {
                            vm.ShowErrorPopup("Максимум можно списать " + editMaxAllowed.ToString("0.00") + " (лимит " + existingData.MaxDiscountPercent + "%)", "ОК");
                            return;
                        }

                        var oldDiscount = existingData.DiscountAmount;
                        var oldReservationId = existingData.ReservationId;
                        ReservationResponse newReservation = null;
                        if (newDiscount > 0 && !TryReserveDiscount(
                                existingData.CustomerId,
                                order.Id.ToString(),
                                eligibleOrderTotal,
                                newDiscount,
                                vm,
                                out newReservation)) return;

                        if ((oldDiscount > 0 || newDiscount > 0) &&
                            !ReplaceLoyaltyDiscountInOrder(order, os, vm, newDiscount))
                        {
                            if (oldDiscount > 0)
                            {
                                ReservationResponse rollbackReservation;
                                TryReserveDiscount(existingData.CustomerId, order.Id.ToString(), eligibleOrderTotal,
                                    oldDiscount, null, out rollbackReservation);
                            }
                            else if (newReservation != null)
                            {
                                CancelReservationOrQueue(existingData.CustomerId, order.Id.ToString(), newReservation.reservationId);
                            }
                            return;
                        }

                        if (newDiscount > 0)
                        {
                            existingData.ReservationId = newReservation.reservationId;
                            existingData.CurrentBalance = Math.Max(0m, newReservation.availableBalance + newReservation.discountAmount);
                        }
                        else
                        {
                            CancelReservationOrQueue(existingData.CustomerId, order.Id.ToString(), oldReservationId);
                            existingData.ReservationId = null;
                        }
                        existingData.DiscountAmount = newDiscount;
                        existingData.OrderFullSum = eligibleOrderTotal;
                        existingData.PayableAmount = Math.Max(0m, eligibleOrderTotal - newDiscount);
                        PluginEntry.ActiveOrders[order.Id] = existingData;
                        PersistActiveOrders();
                        vm.ShowOkPopup("Успех", newDiscount > 0
                            ? "Сумма списания обновлена: " + newDiscount.ToString("0.##") + " бонусов."
                            : "Списание отключено. Клиент останется привязан для начисления.", "ОК");
                        return;
                    }
                    else if (action == 1) // Выбрать другого клиента
                    {
                        if (existingData.DiscountAmount > 0 && !RemoveLoyaltyDiscountFromOrder(order, os, vm)) return;
                        CancelReservationOrQueue(existingData.CustomerId, order.Id.ToString(), existingData.ReservationId, vm);
                        PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                        PersistActiveOrders();
                        // Continuing below to search for a new customer
                    }
                    else if (action == 2) // Открепить клиента от чека
                    {
                        if (existingData.DiscountAmount > 0 && !RemoveLoyaltyDiscountFromOrder(order, os, vm)) return;
                        var reservationReleased = CancelReservationOrQueue(
                            existingData.CustomerId, order.Id.ToString(), existingData.ReservationId);
                        PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                        PersistActiveOrders();
                        vm.ShowOkPopup("Успех", reservationReleased
                            ? "Клиент успешно откреплён от заказа."
                            : "Клиент откреплён. Освобождение бонусов выполнится в фоне после восстановления связи.", "ОК");
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

                RunSearchAndApply(order, os, vm, query);
            }
            catch (Exception ex)
            {
                vm.ShowErrorPopup("Ошибка: " + ex.Message, "ОК");
                PluginContext.Log.Error("IikoBonusPlugin Error in LoyaltyFlow: " + ex);
            }
        }

        public static bool OnBarcodeScanned(ValueTuple<string, IOrder, IOperationService, IViewManager> args)
        {
            var barcode = args.Item1;
            var order = args.Item2;
            var os = args.Item3;
            var vm = args.Item4;

            if (string.IsNullOrWhiteSpace(barcode)) return false;

            // Обычные EAN-штрихкоды товаров часто состоят из 10-15 цифр. Их нельзя перехватывать.
            // Телефон принимается только с явным знаком "+", карта и QR — только с префиксом Bulka.
            var normalizedBarcode = barcode.Trim();
            if (normalizedBarcode.StartsWith("bulka:pickup:", StringComparison.OrdinalIgnoreCase))
            {
                VerifyPickupHandoff(
                    new PickupHandoffRequest
                    {
                        branchId = BranchId,
                        token = normalizedBarcode,
                        iikoOrderId = order?.Id.ToString()
                    },
                    vm);
                return true;
            }
            string digitsOnly = new string(normalizedBarcode.Where(char.IsDigit).ToArray());
            var isExplicitPhone = normalizedBarcode.StartsWith("+") && digitsOnly.Length >= 10 && digitsOnly.Length <= 15;
            var isLoyaltyCode = normalizedBarcode.StartsWith("BULKA-OTP-", StringComparison.OrdinalIgnoreCase) ||
                                normalizedBarcode.StartsWith("CARD-", StringComparison.OrdinalIgnoreCase);
            if (isExplicitPhone || isLoyaltyCode)
            {
                try
                {
                    if (normalizedBarcode.StartsWith("BULKA-OTP-", StringComparison.OrdinalIgnoreCase))
                    {
                        normalizedBarcode = "BULKA-OTP-" + normalizedBarcode.Substring("BULKA-OTP-".Length);
                    }
                    else if (normalizedBarcode.StartsWith("CARD-", StringComparison.OrdinalIgnoreCase))
                    {
                        normalizedBarcode = "CARD-" + normalizedBarcode.Substring("CARD-".Length);
                    }
                    RunSearchAndApply(order, os, vm, normalizedBarcode);
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("IikoBonusPlugin Error processing barcode: " + ex);
                    try { vm.ShowErrorPopup("Ошибка сканирования: " + ex.Message, "ОК"); } catch { }
                }
                return true;
            }

            return false;
        }

        public static void RunPickupHandoffByPin(IOrder order, IViewManager vm)
        {
            try
            {
                var orderResult = vm.ShowInputDialog(
                    "Введите номер онлайн-заказа",
                    Resto.Front.Api.Data.View.InputDialogTypes.Number,
                    null,
                    "Далее",
                    "Отмена");
                if (orderResult == null) return;
                int orderNumber;
                if (orderResult is Resto.Front.Api.Data.View.NumberInputDialogResult numberResult)
                {
                    orderNumber = numberResult.Number;
                }
                else if (orderResult is Resto.Front.Api.Data.View.DecimalInputDialogResult decimalResult)
                {
                    orderNumber = Convert.ToInt32(decimalResult.Decimal);
                }
                else
                {
                    vm.ShowErrorPopup("Не удалось прочитать номер заказа.", "ОК");
                    return;
                }
                if (orderNumber <= 0)
                {
                    vm.ShowErrorPopup("Введите корректный номер заказа.", "ОК");
                    return;
                }

                var pinResult = vm.ShowInputDialog(
                    "Введите 6-значный код клиента",
                    Resto.Front.Api.Data.View.InputDialogTypes.Number,
                    null,
                    "Выдать",
                    "Отмена");
                if (pinResult == null) return;
                int pinNumber;
                if (pinResult is Resto.Front.Api.Data.View.NumberInputDialogResult pinInput)
                {
                    pinNumber = pinInput.Number;
                }
                else if (pinResult is Resto.Front.Api.Data.View.DecimalInputDialogResult decimalPin)
                {
                    pinNumber = Convert.ToInt32(decimalPin.Decimal);
                }
                else
                {
                    vm.ShowErrorPopup("Не удалось прочитать код выдачи.", "ОК");
                    return;
                }
                if (pinNumber < 0 || pinNumber > 999999)
                {
                    vm.ShowErrorPopup("Код выдачи должен содержать 6 цифр.", "ОК");
                    return;
                }
                VerifyPickupHandoff(
                    new PickupHandoffRequest
                    {
                        branchId = BranchId,
                        orderNumber = orderNumber,
                        pin = pinNumber.ToString("D6"),
                        iikoOrderId = order?.Id.ToString()
                    },
                    vm);
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Pickup PIN verification failed: " + ex);
                try { vm.ShowErrorPopup("Не удалось проверить код выдачи.", "ОК"); } catch { }
            }
        }

        private static void VerifyPickupHandoff(PickupHandoffRequest request, IViewManager vm)
        {
            if (!EnsureBranchPosConfiguration(vm)) return;
            Guid branchId;
            if (!Guid.TryParse(request?.branchId, out branchId))
            {
                vm.ShowErrorPopup(
                    "Для выдачи онлайн-заказов задайте IIKO_BRANCH_ID этого филиала в конфигурации плагина.",
                    "ОК");
                return;
            }
            try
            {
                vm.ChangeProgressBarMessage("Проверяем код выдачи...");
                var response = SendApiRequest(HttpMethod.Post, "pickup-handoff/verify", request);
                if (!response.IsSuccessStatusCode)
                {
                    var message = GetApiErrorMessage(
                        response.Body,
                        "Код выдачи не подтверждён. Код: " + (int)response.StatusCode);
                    vm.ShowErrorPopup(message, "ОК");
                    return;
                }
                var result = DeserializeJson<PickupHandoffResponse>(response.Body);
                if (result?.success != true || result.handoff == null)
                {
                    vm.ShowErrorPopup("Сервис не подтвердил выдачу заказа.", "ОК");
                    return;
                }
                vm.ShowOkPopup(
                    "Заказ выдан",
                    "Онлайн-заказ №" + result.handoff.orderNumber +
                    " отмечен как выданный. Повторно использовать код нельзя.",
                    "ОК");
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Pickup QR verification failed: " + ex);
                vm.ShowErrorPopup("Нет связи с Bulka. Заказ не отмечен как выданный.", "ОК");
            }
        }

        private static void RunSearchAndApply(IOrder order, IOperationService os, IViewManager vm, string query)
        {
            try
            {
                if (!EnsureApiConfiguration(vm)) return;
                if (PluginEntry.ActiveOrders.ContainsKey(order.Id))
                {
                    vm.ShowErrorPopup("К этому заказу уже привязан клиент. Используйте кнопку «Бонусы», чтобы изменить привязку или сумму.", "ОК");
                    return;
                }

                var orphanDiscount = GetAppliedLoyaltyDiscountAmount(order, os);
                if (orphanDiscount > 0.01m)
                {
                    if (!RemoveLoyaltyDiscountFromOrder(order, os, vm)) return;
                    PluginContext.Log.Error("IikoBonusPlugin: Removed an untracked Bulka Bonus discount from order " + order.Id + ".");
                    try
                    {
                        var refreshedOrder = os.GetOrderById(order.Id);
                        if (refreshedOrder != null) order = refreshedOrder;
                    }
                    catch (Exception ex)
                    {
                        PluginContext.Log.Error("IikoBonusPlugin: Could not reload order after orphan discount removal: " + ex.Message);
                    }
                }
                vm.ChangeProgressBarMessage("Поиск клиента...");

                // Шаг 2: Ищем клиента
                var response = SendApiRequest(HttpMethod.Post, "search", new SearchRequest { query = query.Trim() });

                if (!response.IsSuccessStatusCode)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Customer search failed: " + response.StatusCode + " - " + GetSafeErrorBody(response.Body));
                    var fallback = IsRetryableStatus(response.StatusCode)
                        ? "Сервис лояльности временно недоступен. Код: " + (int)response.StatusCode
                        : "Поиск отклонён сервисом. Код: " + (int)response.StatusCode;
                    vm.ShowErrorPopup(GetApiErrorMessage(response.Body, fallback), "ОК");
                    return;
                }

                var data = DeserializeJson<SearchResponse>(response.Body);

                var customers = data?.customers;
                if (customers == null || customers.Count == 0)
                {
                    int choice = vm.ShowChooserPopup("Клиент не найден", new List<string> { "Зарегистрировать «" + query + "»", "Отмена" }, 0, Resto.Front.Api.UI.ButtonWidth.Wider, "Отмена");
                    if (choice != 0) return;

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
                    newPhone = NormalizePhone(newPhone);
                    if (!IsValidPhone(newPhone))
                    {
                        vm.ShowErrorPopup("Введите полный номер телефона: от 10 до 15 цифр.", "ОК");
                        return;
                    }

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

                if (selectedCustomer == null || string.IsNullOrWhiteSpace(selectedCustomer.id))
                {
                    vm.ShowErrorPopup("Сервис вернул некорректные данные клиента.", "ОК");
                    return;
                }
                decimal serverBalance = selectedCustomer.balances != null && selectedCustomer.balances.Length > 0
                    ? Math.Max(0m, selectedCustomer.balances[0].balance)
                    : 0;
                decimal balance = GetLocallyAvailableBalance(selectedCustomer.id, serverBalance, order.Id);
                string regDateInfo = "";
                if (!string.IsNullOrWhiteSpace(selectedCustomer.createdAt))
                {
                    if (DateTime.TryParse(selectedCustomer.createdAt, out var dt)) regDateInfo = "\nДата рег.: " + dt.ToString("dd.MM.yyyy");
                    else if (selectedCustomer.createdAt.Contains("T")) regDateInfo = "\nДата рег.: " + selectedCustomer.createdAt.Split('T')[0];
                    else regDateInfo = "\nДата рег.: " + selectedCustomer.createdAt;
                }

                var maxDiscountPercent = Math.Max(0m, Math.Min(100m, selectedCustomer.maxDiscountPercent));
                var eligibleOrderTotal = Math.Max(0m, order.ResultSum);
                decimal maxAllowed = eligibleOrderTotal * (maxDiscountPercent / 100m);
                decimal autoDiscount = Math.Min(balance, maxAllowed);
                autoDiscount = Math.Round(autoDiscount, 2);

                string info = "Клиент: " + selectedCustomer.name + "\nНомер: " + selectedCustomer.phone + regDateInfo + "\nДоступно: " + balance + " бонусов\nКэшбэк: " + selectedCustomer.cashbackPercent + "%";
                
                decimal discountAmount = 0;
                
                if (autoDiscount > 0)
                {
                    var options = new List<string>
                    {
                        $"Списать ({autoDiscount.ToString("0.##")} бон.)",
                        "Только накопить"
                    };
                    
                    int choice = vm.ShowChooserPopup(info + "\n\nВыберите действие:", options, 0, Resto.Front.Api.UI.ButtonWidth.Wider, "Отмена");
                    if (choice < 0) return; // Cancel
                    
                    if (choice == 0) discountAmount = autoDiscount;
                    else discountAmount = 0;
                }
                else
                {
                    vm.ShowOkPopup("Система лояльности", info + "\n\nДоступно бонусов для списания: 0\nБудет начислен только кэшбэк.", "ОК");
                    discountAmount = 0;
                }

                ReservationResponse reservation = null;
                if (discountAmount > 0 && !TryReserveDiscount(
                        selectedCustomer.id,
                        order.Id.ToString(),
                        eligibleOrderTotal,
                        discountAmount,
                        vm,
                        out reservation)) return;

                // Сначала применяем скидку в iiko. Состояние сохраняем только после успешной операции.
                if (!ApplyLoyaltyDiscountToOrder(order, os, vm, discountAmount))
                {
                    if (reservation != null)
                    {
                        CancelReservationOrQueue(selectedCustomer.id, order.Id.ToString(), reservation.reservationId);
                    }
                    return;
                }

                var appliedOrder = order;
                var refreshedAfterApply = false;
                try
                {
                    var refreshedOrder = os.GetOrderById(order.Id);
                    if (refreshedOrder != null)
                    {
                        appliedOrder = refreshedOrder;
                        refreshedAfterApply = true;
                    }
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Could not reload order after discount apply: " + ex.Message);
                }
                if (refreshedAfterApply)
                {
                    var actualDiscount = GetAppliedLoyaltyDiscountAmount(appliedOrder, os);
                    if (Math.Abs(actualDiscount - discountAmount) > 0.01m)
                    {
                        if (actualDiscount > 0) RemoveLoyaltyDiscountFromOrder(appliedOrder, os, vm);
                        if (reservation != null)
                        {
                            CancelReservationOrQueue(selectedCustomer.id, order.Id.ToString(), reservation.reservationId);
                        }
                        vm.ShowErrorPopup("iiko применил другую сумму скидки. Привязка отменена; проверьте настройки гибкой скидки Bulka Bonus.", "ОК");
                        return;
                    }
                }

                PluginEntry.ActiveOrders[order.Id] = new PluginEntry.OrderLoyaltyData
                {
                    CustomerId = selectedCustomer.id,
                    CustomerName = selectedCustomer.name,
                    CustomerPhone = selectedCustomer.phone,
                    CurrentBalance = reservation == null
                        ? serverBalance
                        : Math.Max(0m, reservation.availableBalance + reservation.discountAmount),
                    CashbackPercent = Math.Max(0m, Math.Min(100m, selectedCustomer.cashbackPercent)),
                    MaxDiscountPercent = maxDiscountPercent,
                    DiscountAmount = discountAmount,
                    OrderFullSum = eligibleOrderTotal,
                    PayableAmount = refreshedAfterApply
                        ? Math.Max(0m, appliedOrder.ResultSum)
                        : Math.Max(0m, eligibleOrderTotal - discountAmount),
                    ReservationId = reservation?.reservationId
                };
                if (!PersistActiveOrders())
                {
                    if (discountAmount > 0) RemoveLoyaltyDiscountFromOrder(appliedOrder, os, vm);
                    if (reservation != null)
                    {
                        CancelReservationOrQueue(selectedCustomer.id, order.Id.ToString(), reservation.reservationId);
                    }
                    PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
                    vm.ShowErrorPopup("Не удалось сохранить состояние лояльности на кассе. Привязка отменена.", "ОК");
                    return;
                }
                vm.ShowOkPopup("Успех", discountAmount > 0
                    ? "К заказу применено " + discountAmount.ToString("0.##") + " бонусов."
                    : "Клиент привязан к заказу. После оплаты будет начислен кэшбэк.", "ОК");
            }
            catch (Exception ex)
            {
                vm.ShowErrorPopup("Ошибка: " + ex.Message, "ОК");
                PluginContext.Log.Error("IikoBonusPlugin Error in RunSearchAndApply: " + ex);
            }
        }

        private static IDiscountType FindLoyaltyDiscountType(IOperationService os)
        {
            var discountTypes = os.GetDiscountTypes().Where(d => d != null).ToList();
            Guid configuredId;
            if (!string.IsNullOrWhiteSpace(DiscountTypeId))
            {
                if (!Guid.TryParse(DiscountTypeId, out configuredId)) return null;
                return discountTypes.FirstOrDefault(d => d.Id == configuredId);
            }

            var exactMatch = discountTypes.FirstOrDefault(d =>
                string.Equals(d.Name, DiscountTypeName, StringComparison.OrdinalIgnoreCase));
            if (exactMatch != null) return exactMatch;

            // Совместимость с уже настроенными кассами: использовать только один однозначный тип.
            var legacyMatches = discountTypes.Where(d =>
            {
                var name = d.Name ?? "";
                return name.IndexOf("бонус", StringComparison.OrdinalIgnoreCase) >= 0 ||
                       name.IndexOf("списание", StringComparison.OrdinalIgnoreCase) >= 0 ||
                       name.IndexOf("лояльност", StringComparison.OrdinalIgnoreCase) >= 0;
            }).ToList();
            return legacyMatches.Count == 1 ? legacyMatches[0] : null;
        }

        private static string GetDiscountTypeConfigurationMessage()
        {
            if (!string.IsNullOrWhiteSpace(DiscountTypeId))
            {
                return "В iikoOffice не найден тип скидки с ID " + DiscountTypeId + ". Проверьте IIKO_LOYALTY_DISCOUNT_TYPE_ID.";
            }
            return "Создайте в iikoOffice скидку «" + DiscountTypeName + "» или задайте IIKO_LOYALTY_DISCOUNT_TYPE_ID в конфигурации плагина.";
        }

        private static bool ApplyLoyaltyDiscountToOrder(IOrder order, IOperationService os, IViewManager vm, decimal discountAmount)
        {
            if (discountAmount <= 0)
            {
                return true;
            }

            var discountType = FindLoyaltyDiscountType(os);

            if (discountType == null)
            {
                vm.ShowErrorPopup(GetDiscountTypeConfigurationMessage(), "ОК");
                return false;
            }

            try
            {
                var editSession = os.CreateEditSession();
                editSession.AddFlexibleSumDiscount(discountAmount, discountType, order);
                os.SubmitChanges(editSession, os.GetDefaultCredentials());
                return true;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to apply loyalty discount: " + ex);
                vm.ShowErrorPopup("Не удалось применить бонусную скидку в iiko. Проверьте права кассира и настройку типа скидки.", "ОК");
                return false;
            }
        }

        private static decimal GetAppliedLoyaltyDiscountAmount(IOrder order, IOperationService os)
        {
            if (order == null || order.AppliedDiscounts == null) return 0m;
            var discountType = FindLoyaltyDiscountType(os);
            Guid configuredId;
            var hasConfiguredId = Guid.TryParse(DiscountTypeId, out configuredId);
            return Math.Max(0m, order.AppliedDiscounts
                .Where(item =>
                {
                    var itemType = item.Discount?.DiscountType;
                    if (itemType == null) return false;
                    if (discountType != null && itemType.Id == discountType.Id) return true;
                    if (hasConfiguredId && itemType.Id == configuredId) return true;
                    return string.Equals(itemType.Name, DiscountTypeName, StringComparison.OrdinalIgnoreCase);
                })
                .Sum(item => item.DiscountSum));
        }

        private static bool ReplaceLoyaltyDiscountInOrder(IOrder order, IOperationService os, IViewManager vm, decimal newDiscountAmount)
        {
            try
            {
                var discountType = FindLoyaltyDiscountType(os);
                if (discountType == null)
                {
                    vm.ShowErrorPopup(GetDiscountTypeConfigurationMessage(), "ОК");
                    return false;
                }

                var existingDiscounts = order.Discounts == null
                    ? new List<IDiscountItem>()
                    : order.Discounts.Where(d => d.DiscountType != null && d.DiscountType.Id == discountType.Id).ToList();
                var editSession = os.CreateEditSession();
                foreach (var discount in existingDiscounts) editSession.DeleteDiscount(discount, order);
                if (newDiscountAmount > 0) editSession.AddFlexibleSumDiscount(newDiscountAmount, discountType, order);
                if (existingDiscounts.Count > 0 || newDiscountAmount > 0)
                {
                    os.SubmitChanges(editSession, os.GetDefaultCredentials());
                }
                return true;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to replace loyalty discount: " + ex);
                vm.ShowErrorPopup("Не удалось изменить бонусную скидку в iiko. Заказ оставлен без изменений.", "ОК");
                return false;
            }
        }

        private static bool RemoveLoyaltyDiscountFromOrder(IOrder order, IOperationService os, IViewManager vm)
        {
            return ReplaceLoyaltyDiscountInOrder(order, os, vm, 0);
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

        public static void ReconcileRestoredOrders(IOperationService operationService)
        {
            try
            {
                if (PluginEntry.ActiveOrders.IsEmpty) return;
                var orders = operationService.GetOrders(true, false).ToDictionary(order => order.Id, order => order);
                foreach (var pair in PluginEntry.ActiveOrders.ToArray())
                {
                    IOrder order;
                    if (!orders.TryGetValue(pair.Key, out order))
                    {
                        if (!string.IsNullOrWhiteSpace(pair.Value.ReservationId))
                        {
                            EnqueueOperation("cancel", pair.Key.ToString(), pair.Value.CustomerId,
                                pair.Value.ReservationId, 0, 0);
                        }
                        PluginEntry.ActiveOrders.TryRemove(pair.Key, out _);
                        PersistActiveOrders();
                        continue;
                    }
                    if (order.Status == OrderStatus.Closed)
                    {
                        ProcessClosedOrder(order, pair.Value);
                    }
                    else if (order.Status == OrderStatus.Deleted)
                    {
                        if (!string.IsNullOrWhiteSpace(pair.Value.ReservationId))
                        {
                            EnqueueOperation("cancel", pair.Key.ToString(), pair.Value.CustomerId,
                                pair.Value.ReservationId, 0, 0);
                        }
                        PluginEntry.ActiveOrders.TryRemove(pair.Key, out _);
                        PersistActiveOrders();
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to reconcile restored orders: " + ex);
            }
        }

        public static void BeforeProceedOrderPayment(ValueTuple<IOrder, IViewManager, IOperationService> args)
        {
            var order = args.Item1;
            var vm = args.Item2;
            var operationService = args.Item3;
            if (order == null) return;

            var appliedAmount = GetAppliedLoyaltyDiscountAmount(order, operationService);
            PluginEntry.OrderLoyaltyData loyaltyData;
            if (!PluginEntry.ActiveOrders.TryGetValue(order.Id, out loyaltyData))
            {
                if (appliedAmount > 0.01m)
                {
                    vm.ShowErrorPopup("В заказе найдена скидка Bulka Bonus без активной резервации. Откройте кнопку «Бонусы» и примените клиента заново.", "ОК");
                    throw new OperationCanceledException("Untracked Bulka Bonus discount.");
                }
                return;
            }
            if (loyaltyData.DiscountAmount <= 0)
            {
                if (appliedAmount > 0.01m)
                {
                    vm.ShowErrorPopup("В заказе есть незарегистрированная скидка Bulka Bonus. Удалите её через кнопку «Бонусы».", "ОК");
                    throw new OperationCanceledException("Unexpected Bulka Bonus discount.");
                }
                return;
            }
            if (Math.Abs(appliedAmount - loyaltyData.DiscountAmount) > 0.01m)
            {
                vm.ShowErrorPopup("Бонусная скидка в заказе не совпадает с выбранной суммой. Откройте кнопку «Бонусы» и примените списание заново.", "ОК");
                throw new OperationCanceledException("Bulka Bonus discount mismatch.");
            }

            ReservationResponse reservation;
            var eligibleOrderTotal = Math.Max(0m, order.ResultSum + appliedAmount);
            if (!TryReserveDiscount(
                    loyaltyData.CustomerId,
                    order.Id.ToString(),
                    eligibleOrderTotal,
                    loyaltyData.DiscountAmount,
                    vm,
                    out reservation))
            {
                throw new OperationCanceledException("Bulka Bonus reservation is required before payment.");
            }

            loyaltyData.ReservationId = reservation.reservationId;
            loyaltyData.CurrentBalance = Math.Max(0m, reservation.availableBalance + reservation.discountAmount);
            loyaltyData.OrderFullSum = eligibleOrderTotal;
            loyaltyData.PayableAmount = Math.Max(0m, order.ResultSum);
            PluginEntry.ActiveOrders[order.Id] = loyaltyData;
            if (!PersistActiveOrders())
            {
                vm.ShowErrorPopup("Не удалось сохранить резервацию на кассе. Оплата заблокирована до устранения ошибки диска.", "ОК");
                throw new OperationCanceledException("Bulka Bonus reservation state could not be persisted.");
            }
        }

        public static void OnOrderChanged(EntityChangedEventArgs<IOrder> args)
        {
            try
            {
                var order = args.Entity;
                if (order == null) return;

                if (order.Status == OrderStatus.Deleted)
                {
                    if (PluginEntry.ActiveOrders.TryRemove(order.Id, out var deletedData) &&
                        !string.IsNullOrWhiteSpace(deletedData.ReservationId))
                    {
                        EnqueueOperation("cancel", order.Id.ToString(), deletedData.CustomerId,
                            deletedData.ReservationId, 0, 0);
                        Task.Run(() => FlushPendingApplyRequests());
                    }
                    PersistActiveOrders();
                    return;
                }

                if (order.Status == OrderStatus.Closed)
                {
                    if (PluginEntry.ActiveOrders.TryGetValue(order.Id, out var loyaltyData))
                    {
                        ProcessClosedOrder(order, loyaltyData);
                    }
                }
                else
                {
                    if (PluginEntry.ActiveOrders.TryGetValue(order.Id, out var activeData))
                    {
                        activeData.OrderFullSum = Math.Max(0m, order.ResultSum + activeData.DiscountAmount);
                        activeData.PayableAmount = Math.Max(0m, order.ResultSum);
                        PluginEntry.ActiveOrders[order.Id] = activeData;
                        PersistActiveOrders();
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Error in OnOrderChanged: " + ex);
            }
        }

        private static void ProcessClosedOrder(IOrder order, PluginEntry.OrderLoyaltyData loyaltyData)
        {
            PluginContext.Log.Info("IikoBonusPlugin: Order " + order.Number + " closed. Queuing loyalty for customer " + loyaltyData.CustomerId + ".");

            var itemsList = new List<OrderItemData>();
            if (order.Items != null)
            {
                foreach (var item in order.Items)
                {
                    var productItem = item as IOrderProductItem;
                    if (productItem == null || productItem.Product == null) continue;
                    var lineTotal = Math.Max(0m, productItem.ResultSum);
                    itemsList.Add(new OrderItemData
                    {
                        productId = productItem.Product.Id.ToString(),
                        productName = productItem.ProductCustomName ?? productItem.Product.Name,
                        amount = productItem.Amount,
                        price = productItem.Amount > 0 ? Math.Round(lineTotal / productItem.Amount, 2) : 0,
                        total = lineTotal
                    });
                }
            }

            // Очередь сначала надежно сохраняется на диск. Только затем заказ удаляется
            // из активных, чтобы сбой записи не потерял начисление.
            if (loyaltyData.DiscountAmount > 0)
            {
                var missingReservation = string.IsNullOrWhiteSpace(loyaltyData.ReservationId);
                EnqueueOperation("commit", order.Id.ToString(), loyaltyData.CustomerId,
                    loyaltyData.ReservationId, loyaltyData.DiscountAmount,
                    Math.Max(0m, order.ResultSum + loyaltyData.DiscountAmount), itemsList.ToArray(),
                    missingReservation,
                    missingReservation ? "Заказ закрыт без reservationId; требуется ручная сверка." : "");
            }
            else
            {
                EnqueueOperation("apply", order.Id.ToString(), loyaltyData.CustomerId,
                    null, 0, Math.Max(0m, order.ResultSum), itemsList.ToArray());
            }
            PluginEntry.ActiveOrders.TryRemove(order.Id, out _);
            PersistActiveOrders();
            Task.Run(() => FlushPendingApplyRequests());
        }

        private static CustomerData SendCreateCustomerRequest(string phone, string name)
        {
            try
            {
                if (!EnsureApiConfiguration()) return null;
                var normalizedPhone = NormalizePhone(phone);
                if (!IsValidPhone(normalizedPhone)) return null;
                var safeName = string.IsNullOrWhiteSpace(name) ? "Новый Гость" : name.Trim();
                if (safeName.Length > 160) safeName = safeName.Substring(0, 160);
                var response = SendApiRequest(HttpMethod.Post, "customer", new CustomerCreateRequest
                {
                    phone = normalizedPhone,
                    name = safeName
                });

                if (!response.IsSuccessStatusCode)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Create customer failed: " + response.StatusCode + " - " + GetSafeErrorBody(response.Body));
                    return null;
                }

                var data = DeserializeJson<CustomerResponse>(response.Body);
                return data?.customer;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin Error in SendCreateCustomerRequest: " + ex);
                return null;
            }
        }

        private static string NormalizePhone(string value)
        {
            var raw = (value ?? "").Trim();
            var digits = new string(raw.Where(char.IsDigit).ToArray());
            return string.IsNullOrEmpty(digits) ? "" : "+" + digits;
        }

        private static bool IsValidPhone(string value)
        {
            var digits = new string((value ?? "").Where(char.IsDigit).ToArray());
            return digits.Length >= 10 && digits.Length <= 15;
        }

        private static string NormalizeOperation(string operation)
        {
            return string.IsNullOrWhiteSpace(operation) ? "apply" : operation.Trim().ToLowerInvariant();
        }

        private static object GetOrderOperationLock(string orderId)
        {
            return OrderOperationLocks.GetOrAdd(orderId ?? "", _ => new object());
        }

        private static string GetQueueRevision(LoyaltyApplyQueueItem item)
        {
            return string.IsNullOrWhiteSpace(item.updatedAtUtc) ? item.createdAtUtc : item.updatedAtUtc;
        }

        private static bool IsQueuedRevisionCurrent(LoyaltyApplyQueueItem item)
        {
            lock (QueueLock)
            {
                if (!File.Exists(QueuePath)) return false;
                var operation = NormalizeOperation(item.operation);
                var current = LoadQueueUnsafe().FirstOrDefault(candidate =>
                    string.Equals(NormalizeOperation(candidate.operation), operation, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(candidate.orderId, item.orderId, StringComparison.OrdinalIgnoreCase));
                return current != null && string.Equals(
                    GetQueueRevision(current), GetQueueRevision(item), StringComparison.Ordinal);
            }
        }

        private static void EnqueueOperation(
            string operation,
            string orderId,
            string customerId,
            string reservationId,
            decimal discountAmount,
            decimal orderTotal,
            OrderItemData[] items = null,
            bool terminal = false,
            string lastError = "")
        {
            lock (QueueLock)
            {
                operation = NormalizeOperation(operation);
                var queue = LoadQueueUnsafe();
                var existing = queue.FirstOrDefault(x =>
                    string.Equals(NormalizeOperation(x.operation), operation, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(x.orderId, orderId, StringComparison.OrdinalIgnoreCase));
                var now = DateTime.UtcNow.ToString("o");
                if (existing != null)
                {
                    var payloadChanged =
                        !string.Equals(existing.customerId, customerId, StringComparison.OrdinalIgnoreCase) ||
                        !string.Equals(existing.reservationId ?? "", reservationId ?? "", StringComparison.OrdinalIgnoreCase) ||
                        existing.discountAmount != discountAmount ||
                        existing.orderTotal != orderTotal;
                    existing.customerId = customerId;
                    existing.reservationId = reservationId;
                    existing.discountAmount = discountAmount;
                    existing.orderTotal = orderTotal;
                    existing.items = items;
                    existing.updatedAtUtc = now;
                    if (payloadChanged)
                    {
                        existing.attempts = 0;
                        existing.lastAttemptAtUtc = "";
                        existing.terminal = terminal;
                        existing.lastError = lastError ?? "";
                    }
                    else
                    {
                        existing.terminal = existing.terminal || terminal;
                        if (!string.IsNullOrWhiteSpace(lastError)) existing.lastError = lastError;
                    }
                    SaveQueueUnsafe(queue);
                    return;
                }

                queue.Add(new LoyaltyApplyQueueItem
                {
                    operation = operation,
                    orderId = orderId,
                    customerId = customerId,
                    reservationId = reservationId,
                    discountAmount = discountAmount,
                    orderTotal = orderTotal,
                    items = items,
                    attempts = 0,
                    createdAtUtc = now,
                    updatedAtUtc = now,
                    lastAttemptAtUtc = "",
                    lastError = lastError ?? "",
                    terminal = terminal
                });
                SaveQueueUnsafe(queue);
            }
        }

        private static void RemoveQueuedOperation(string operation, string orderId)
        {
            lock (QueueLock)
            {
                try
                {
                    if (!File.Exists(QueuePath)) return;
                    operation = NormalizeOperation(operation);
                    var queue = LoadQueueUnsafe();
                    var removed = queue.RemoveAll(item =>
                        string.Equals(NormalizeOperation(item.operation), operation, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(item.orderId, orderId, StringComparison.OrdinalIgnoreCase));
                    if (removed > 0) SaveQueueUnsafe(queue);
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("IikoBonusPlugin: Failed to remove queued operation " + operation + " for " + orderId + ": " + ex);
                }
            }
        }

        private static List<LoyaltyApplyQueueItem> LoadQueue()
        {
            lock (QueueLock)
            {
                return LoadQueueUnsafe();
            }
        }

        private static List<LoyaltyApplyQueueItem> LoadQueueUnsafe()
        {
            try
            {
                if (!File.Exists(QueuePath)) return new List<LoyaltyApplyQueueItem>();
                return ReadSerializedFile<List<LoyaltyApplyQueueItem>>(QueuePath) ?? new List<LoyaltyApplyQueueItem>();
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Failed to load queue: " + ex);
                throw new IOException("Не удалось прочитать очередь начислений.", ex);
            }
        }

        private static void SaveQueueUnsafe(List<LoyaltyApplyQueueItem> queue)
        {
            WriteSerializedFileAtomically(QueuePath, queue);
        }

        private static T ReadSerializedFile<T>(string path) where T : class
        {
            try
            {
                var serializer = new DataContractJsonSerializer(typeof(T));
                using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    return (T)serializer.ReadObject(stream);
                }
            }
            catch (Exception primaryError)
            {
                var backupPath = path + ".bak";
                if (File.Exists(backupPath))
                {
                    try
                    {
                        var serializer = new DataContractJsonSerializer(typeof(T));
                        using (var backupStream = File.Open(backupPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                        {
                            var recovered = (T)serializer.ReadObject(backupStream);
                            PluginContext.Log.Error("IikoBonusPlugin: Recovered state from backup after read failure: " + primaryError.Message);
                            return recovered;
                        }
                    }
                    catch (Exception backupError)
                    {
                        throw new IOException("Cannot read state or its backup.", new AggregateException(primaryError, backupError));
                    }
                }
                throw;
            }
        }

        private static void WriteSerializedFileAtomically<T>(string path, T value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? DataDirectory);
            var tempPath = path + ".tmp";
            var backupPath = path + ".bak";
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = File.Open(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                serializer.WriteObject(stream, value);
                stream.Flush();
            }

            if (File.Exists(path))
            {
                File.Replace(tempPath, path, backupPath, true);
            }
            else
            {
                File.Move(tempPath, path);
            }
        }

        private static void FlushPendingApplyRequests()
        {
            if (Interlocked.CompareExchange(ref _flushInProgress, 1, 0) != 0) return;
            try
            {
                if (!EnsureApiConfiguration()) return;

                List<LoyaltyApplyQueueItem> queue;
                lock (QueueLock)
                {
                    queue = LoadQueueUnsafe();
                }

                if (queue.Count == 0) return;
                var attemptResults = new Dictionary<string, Tuple<LoyaltyApplyQueueItem, bool>>(
                    StringComparer.OrdinalIgnoreCase);

                foreach (var item in queue)
                {
                    var itemKey = NormalizeOperation(item.operation) + "|" + item.orderId;
                    if (item.terminal)
                    {
                        attemptResults[itemKey] = Tuple.Create(item, false);
                        continue;
                    }
                    if (MaxAttempts > 0 && item.attempts >= MaxAttempts)
                    {
                        item.terminal = true;
                        item.lastError = "Достигнут лимит попыток (" + MaxAttempts + "). " + item.lastError;
                        attemptResults[itemKey] = Tuple.Create(item, false);
                        continue;
                    }

                    item.attempts += 1;
                    item.lastAttemptAtUtc = DateTime.UtcNow.ToString("o");
                    string error;
                    bool retryable;
                    if (SendApplyRequest(item, out error, out retryable))
                    {
                        attemptResults[itemKey] = Tuple.Create(item, true);
                        PluginContext.Log.Info("IikoBonusPlugin: Loyalty apply delivered for order " + item.orderId + " after " + item.attempts + " attempt(s).");
                    }
                    else
                    {
                        item.lastError = error;
                        item.terminal = !retryable;
                        attemptResults[itemKey] = Tuple.Create(item, false);
                        PluginContext.Log.Error("IikoBonusPlugin: Loyalty apply " +
                            (item.terminal ? "requires attention" : "is still pending") +
                            " for order " + item.orderId + ": " + error);
                    }
                }

                lock (QueueLock)
                {
                    var currentQueue = LoadQueueUnsafe();
                    var merged = new List<LoyaltyApplyQueueItem>();
                    foreach (var currentItem in currentQueue
                        .GroupBy(x => NormalizeOperation(x.operation) + "|" + x.orderId, StringComparer.OrdinalIgnoreCase)
                        .Select(group => group.Last()))
                    {
                        var key = NormalizeOperation(currentItem.operation) + "|" + currentItem.orderId;
                        Tuple<LoyaltyApplyQueueItem, bool> result;
                        if (!attemptResults.TryGetValue(key, out result))
                        {
                            merged.Add(currentItem);
                            continue;
                        }

                        var attemptedItem = result.Item1;
                        var currentRevision = GetQueueRevision(currentItem);
                        var attemptedRevision = GetQueueRevision(attemptedItem);
                        if (!string.Equals(currentRevision, attemptedRevision, StringComparison.Ordinal))
                        {
                            // The same logical operation was changed while the HTTP request was in flight.
                            // Preserve the newer payload instead of deleting or overwriting it.
                            merged.Add(currentItem);
                        }
                        else if (!result.Item2)
                        {
                            merged.Add(attemptedItem);
                        }
                    }
                    SaveQueueUnsafe(merged);
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("IikoBonusPlugin: Flush queue failed: " + ex);
            }
            finally
            {
                Interlocked.Exchange(ref _flushInProgress, 0);
            }
        }

        private static bool SendApplyRequest(LoyaltyApplyQueueItem item, out string errorMessage, out bool retryable)
        {
            errorMessage = "";
            retryable = true;
            try
            {
                if (!EnsureApiConfiguration())
                {
                    errorMessage = "API configuration is invalid";
                    return false;
                }
                var operation = NormalizeOperation(item.operation);
                string relativePath;
                object payload;
                if (operation == "commit")
                {
                    if (string.IsNullOrWhiteSpace(item.reservationId))
                    {
                        retryable = false;
                        errorMessage = "reservationId is required for commit";
                        return false;
                    }
                    relativePath = "commit";
                    payload = new ReservationCommitRequest
                    {
                        customerId = item.customerId,
                        orderId = item.orderId,
                        reservationId = item.reservationId,
                        orderTotal = item.orderTotal,
                        items = item.items
                    };
                }
                else if (operation == "cancel")
                {
                    if (string.IsNullOrWhiteSpace(item.reservationId))
                    {
                        retryable = false;
                        errorMessage = "reservationId is required for cancel";
                        return false;
                    }
                    relativePath = "cancel";
                    payload = new ReservationCancelRequest
                    {
                        customerId = item.customerId,
                        orderId = item.orderId,
                        reservationId = item.reservationId
                    };
                }
                else if (operation == "apply")
                {
                    relativePath = "apply";
                    payload = item;
                }
                else
                {
                    retryable = false;
                    errorMessage = "Unknown queue operation: " + operation;
                    return false;
                }

                ApiResponse response;
                lock (GetOrderOperationLock(item.orderId))
                {
                    if (!IsQueuedRevisionCurrent(item))
                    {
                        PluginContext.Log.Info("IikoBonusPlugin: Skipped stale queued operation " + operation +
                            " for order " + item.orderId + ".");
                        return true;
                    }
                    response = SendApiRequest(HttpMethod.Post, relativePath, payload);
                }

                if (response.IsSuccessStatusCode)
                {
                    PluginContext.Log.Info("IikoBonusPlugin: Loyalty operation " + operation + " succeeded for order " + item.orderId + ".");
                    return true;
                }
                else
                {
                    retryable = IsRetryableApiFailure(response.StatusCode, response.Body);
                    errorMessage = "Status: " + response.StatusCode + ", Response: " + GetSafeErrorBody(response.Body);
                    PluginContext.Log.Error("IikoBonusPlugin: Loyalty operation " + operation + " failed for order " + item.orderId + ". " + errorMessage);
                    return false;
                }
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                retryable = true;
                PluginContext.Log.Error("IikoBonusPlugin: Exception sending queued request for order " + item.orderId + ": " + ex);
                return false;
            }
        }

        private static void CheckServerStatus()
        {
            try
            {
                _lastConnectionCheckUtc = DateTime.UtcNow;
                if (!EnsureApiConfiguration())
                {
                    _lastConnectionStatus = "ошибка конфигурации";
                    return;
                }
                var response = SendApiRequest(HttpMethod.Get, "config-check");
                _lastConnectionStatus = response.IsSuccessStatusCode
                    ? "сервер доступен"
                    : "ошибка HTTP " + (int)response.StatusCode;
                PluginContext.Log.Info("IikoBonusPlugin: config-check status " + response.StatusCode);
            }
            catch (Exception ex)
            {
                _lastConnectionCheckUtc = DateTime.UtcNow;
                _lastConnectionStatus = "нет связи: " + ex.GetType().Name;
                PluginContext.Log.Error("IikoBonusPlugin: config-check failed: " + ex.Message);
            }
        }
    }
}
