using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.Data.Common;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    public class GiftCardPosData
    {
        [DataMember]
        public string id { get; set; }

        [DataMember]
        public string last4 { get; set; }

        [DataMember]
        public decimal balance { get; set; }

        [DataMember]
        public decimal availableBalance { get; set; }

        [DataMember]
        public string currency { get; set; }

        [DataMember]
        public string expiresAt { get; set; }
    }

    [DataContract]
    public class GiftCardValidateRequest
    {
        [DataMember]
        public string code { get; set; }

        [DataMember]
        public string branchId { get; set; }
    }

    [DataContract]
    public class GiftCardValidateResponse
    {
        [DataMember]
        public bool success { get; set; }

        [DataMember]
        public GiftCardPosData card { get; set; }
    }

    [DataContract]
    public class GiftCardReserveRequest
    {
        [DataMember]
        public string code { get; set; }

        [DataMember]
        public string branchId { get; set; }

        [DataMember]
        public string iikoOrderId { get; set; }

        [DataMember]
        public string idempotencyKey { get; set; }

        [DataMember]
        public decimal amount { get; set; }

        [DataMember]
        public int ttlMinutes { get; set; }
    }

    [DataContract]
    public class GiftCardReservationData
    {
        [DataMember]
        public string id { get; set; }

        [DataMember]
        public string status { get; set; }

        [DataMember]
        public bool duplicate { get; set; }

        [DataMember]
        public string giftCardId { get; set; }

        [DataMember]
        public decimal amount { get; set; }

        [DataMember]
        public decimal availableBalance { get; set; }

        [DataMember]
        public decimal balanceAfter { get; set; }

        [DataMember]
        public string expiresAt { get; set; }

        [DataMember]
        public string committedAt { get; set; }

        [DataMember]
        public string cancelledAt { get; set; }

        [DataMember]
        public string branchId { get; set; }

        [DataMember]
        public string iikoOrderId { get; set; }
    }

    [DataContract]
    public class GiftCardReservationResponse
    {
        [DataMember]
        public bool success { get; set; }

        [DataMember]
        public GiftCardReservationData reservation { get; set; }
    }

    [DataContract]
    public class GiftCardReservationMutationRequest
    {
        [DataMember]
        public string reservationId { get; set; }

        [DataMember]
        public string idempotencyKey { get; set; }
    }

    [DataContract]
    public class GiftReservationState
    {
        [DataMember]
        public string ReservationId { get; set; }

        [DataMember]
        public string GiftCardId { get; set; }

        [DataMember]
        public string Last4 { get; set; }

        [DataMember]
        public decimal Amount { get; set; }

        [DataMember]
        public string ExpiresAtUtc { get; set; }

        [DataMember]
        public string ReserveKey { get; set; }

        [DataMember]
        public string CommitKey { get; set; }

        [DataMember]
        public string CancelKey { get; set; }
    }

    [DataContract]
    public class GiftReservationQueueItem
    {
        [DataMember]
        public string Operation { get; set; }

        [DataMember]
        public string OrderId { get; set; }

        [DataMember]
        public string ReservationId { get; set; }

        [DataMember]
        public string IdempotencyKey { get; set; }

        [DataMember]
        public int Attempts { get; set; }

        [DataMember]
        public string LastAttemptAtUtc { get; set; }

        [DataMember]
        public string LastError { get; set; }

        [DataMember]
        public bool Terminal { get; set; }
    }

    /// <summary>
    /// Applies gift certificates to iiko orders using a server-side reservation.
    /// The raw certificate code is used only for the initial HTTPS request and is
    /// never written to disk or logs. The balance is committed only after iiko
    /// reports the order as Closed.
    /// </summary>
    public static class GiftCertificateFlow
    {
        private static readonly string DiscountTypeId =
            LoyaltyFlow.ReadPluginSetting("IIKO_GIFT_DISCOUNT_TYPE_ID");

        private static readonly string DiscountTypeName =
            LoyaltyFlow.ReadPluginSetting("IIKO_GIFT_DISCOUNT_TYPE_NAME") ??
            "Bulka Gift Certificate";

        private static readonly string BranchId =
            LoyaltyFlow.ReadPluginSetting("IIKO_BRANCH_ID");

        private static readonly int ReservationTtlMinutes = Clamp(
            ReadIntSetting("IIKO_GIFT_RESERVATION_TTL_MIN", 120),
            5,
            120);

        private static readonly int RetryIntervalSeconds = Clamp(
            ReadIntSetting("IIKO_LOYALTY_RETRY_INTERVAL_SEC", 60),
            10,
            3600);

        private static readonly string ActivePath =
            Path.Combine(LoyaltyFlow.DataDirectoryPath, "BulkaGiftActiveOrders.json");

        private static readonly string QueuePath =
            Path.Combine(LoyaltyFlow.DataDirectoryPath, "BulkaGiftPendingOperations.json");

        private static readonly object StateLock = new object();
        private static readonly ConcurrentDictionary<Guid, GiftReservationState> ActiveOrders =
            new ConcurrentDictionary<Guid, GiftReservationState>();

        private static Timer _retryTimer;
        private static int _flushInProgress;

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        private static int ReadIntSetting(string key, int fallback)
        {
            int parsed;
            return int.TryParse(LoyaltyFlow.ReadPluginSetting(key), out parsed) && parsed >= 0
                ? parsed
                : fallback;
        }

        public static void StartBackgroundRetry()
        {
            if (_retryTimer != null) return;
            _retryTimer = new Timer(
                _ => FlushPendingOperations(),
                null,
                TimeSpan.FromSeconds(7),
                TimeSpan.FromSeconds(RetryIntervalSeconds));
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
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Failed to stop gift retry timer: " + ex.Message);
            }
        }

        public static void RestoreActiveOrders()
        {
            lock (StateLock)
            {
                try
                {
                    var saved = ReadFile<Dictionary<Guid, GiftReservationState>>(ActivePath);
                    if (saved == null) return;
                    foreach (var pair in saved) ActiveOrders[pair.Key] = pair.Value;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error(
                        "IikoBonusPlugin: Failed to restore gift reservations: " + ex);
                }
            }
        }

        public static void ReconcileRestoredOrders(IOperationService operationService)
        {
            try
            {
                if (ActiveOrders.IsEmpty) return;
                var orders = operationService.GetOrders(true, false)
                    .ToDictionary(order => order.Id, order => order);

                foreach (var pair in ActiveOrders.ToArray())
                {
                    IOrder order;
                    if (!orders.TryGetValue(pair.Key, out order) ||
                        order.Status == OrderStatus.Deleted)
                    {
                        QueueTerminalOperation(
                            "cancel",
                            pair.Key,
                            pair.Value,
                            pair.Value.CancelKey);
                    }
                    else if (order.Status == OrderStatus.Closed)
                    {
                        QueueTerminalOperation(
                            "commit",
                            pair.Key,
                            pair.Value,
                            pair.Value.CommitKey);
                    }
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Failed to reconcile gift reservations: " + ex);
            }
        }

        public static string GetStatusText()
        {
            lock (StateLock)
            {
                try
                {
                    var queue = ReadFile<List<GiftReservationQueueItem>>(QueuePath) ??
                                new List<GiftReservationQueueItem>();
                    return "Подарочные сертификаты" +
                           "\nАктивно в чеках: " + ActiveOrders.Count +
                           "\nОжидают синхронизации: " + queue.Count(item => !item.Terminal) +
                           "\nТребуют внимания: " + queue.Count(item => item.Terminal);
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error(
                        "IikoBonusPlugin: Failed to read gift queue status: " + ex);
                    return "Подарочные сертификаты\nОшибка чтения локальной очереди.";
                }
            }
        }

        public static void Run(IOrder order, IOperationService operationService, IViewManager viewManager)
        {
            if (order == null || operationService == null || viewManager == null) return;

            GiftReservationState existing;
            if (ActiveOrders.TryGetValue(order.Id, out existing))
            {
                ShowExistingReservation(order, operationService, viewManager, existing);
                return;
            }

            var code = viewManager.ShowKeyboard(
                "Введите или отсканируйте код сертификата",
                "",
                false,
                80,
                false,
                true,
                "Проверить",
                "Отмена");
            if (string.IsNullOrWhiteSpace(code)) return;
            RunWithCode(order, operationService, viewManager, code);
        }

        public static bool TryHandleBarcode(
            ValueTuple<string, IOrder, IOperationService, IViewManager> args)
        {
            var normalized = NormalizeCode(args.Item1);
            if (!normalized.StartsWith("BLK-", StringComparison.OrdinalIgnoreCase)) return false;

            RunWithCode(args.Item2, args.Item3, args.Item4, normalized);
            return true;
        }

        public static void RunWithCode(
            IOrder order,
            IOperationService operationService,
            IViewManager viewManager,
            string code)
        {
            try
            {
                if (order == null || operationService == null || viewManager == null) return;
                if (order.Status == OrderStatus.Closed || order.Status == OrderStatus.Deleted)
                {
                    viewManager.ShowErrorPopup(
                        "Сертификат можно применить только к открытому заказу.",
                        "ОК");
                    return;
                }

                if (ActiveOrders.ContainsKey(order.Id))
                {
                    viewManager.ShowErrorPopup(
                        "К заказу уже применён сертификат. Сначала удалите его кнопкой «Сертификат».",
                        "ОК");
                    return;
                }

                if (!EnsureConfiguration(viewManager)) return;
                if (FindDiscountType(operationService) == null)
                {
                    viewManager.ShowErrorPopup(GetDiscountConfigurationMessage(), "ОК");
                    return;
                }

                var normalizedCode = NormalizeCode(code);
                if (!IsValidCode(normalizedCode))
                {
                    viewManager.ShowErrorPopup("Код сертификата имеет неверный формат.", "ОК");
                    return;
                }

                var card = ValidateCard(normalizedCode, viewManager);
                if (card == null) return;

                var maxAmount = Math.Round(
                    Math.Min(Math.Max(0m, card.availableBalance), Math.Max(0m, order.ResultSum)),
                    2,
                    MidpointRounding.AwayFromZero);
                if (maxAmount <= 0)
                {
                    viewManager.ShowErrorPopup(
                        card.availableBalance <= 0
                            ? "На сертификате нет доступного остатка."
                            : "Сумма заказа уже равна нулю.",
                        "ОК");
                    return;
                }

                var amountResult = viewManager.ShowInputDialog(
                    "Доступно по сертификату •••• " + card.last4 +
                    ": " + card.availableBalance.ToString("0.##") +
                    " ₸\nСколько списать? Максимум " + maxAmount.ToString("0.##") + " ₸",
                    Resto.Front.Api.Data.View.InputDialogTypes.Number,
                    Convert.ToInt32(Math.Floor(maxAmount)),
                    "Применить",
                    "Отмена");
                if (amountResult == null) return;

                decimal requestedAmount;
                if (!TryReadAmount(amountResult, out requestedAmount) ||
                    requestedAmount <= 0 ||
                    requestedAmount > maxAmount)
                {
                    viewManager.ShowErrorPopup(
                        "Введите сумму от 1 до " + maxAmount.ToString("0.##") + " ₸.",
                        "ОК");
                    return;
                }

                requestedAmount = Math.Round(
                    requestedAmount,
                    2,
                    MidpointRounding.AwayFromZero);
                var reserveKey = Guid.NewGuid().ToString();
                var reservation = ReserveCard(
                    normalizedCode,
                    order.Id.ToString(),
                    requestedAmount,
                    reserveKey,
                    viewManager);
                if (reservation == null) return;

                var state = new GiftReservationState
                {
                    ReservationId = reservation.id,
                    GiftCardId = reservation.giftCardId,
                    Last4 = card.last4,
                    Amount = reservation.amount,
                    ExpiresAtUtc = reservation.expiresAt,
                    ReserveKey = reserveKey,
                    CommitKey = Guid.NewGuid().ToString(),
                    CancelKey = Guid.NewGuid().ToString()
                };

                if (!ReplaceGiftDiscount(
                        order,
                        operationService,
                        viewManager,
                        state.Amount))
                {
                    EnqueueOperation(
                        "cancel",
                        order.Id.ToString(),
                        state.ReservationId,
                        state.CancelKey);
                    Task.Run(() => FlushPendingOperations());
                    return;
                }

                ActiveOrders[order.Id] = state;
                if (!PersistActiveOrders())
                {
                    ReplaceGiftDiscount(order, operationService, viewManager, 0m);
                    EnqueueOperation(
                        "cancel",
                        order.Id.ToString(),
                        state.ReservationId,
                        state.CancelKey);
                    ActiveOrders.TryRemove(order.Id, out _);
                    viewManager.ShowErrorPopup(
                        "Не удалось безопасно сохранить резервацию на кассе. " +
                        "Скидка отменена; проверьте диск и права папки данных.",
                        "ОК");
                    Task.Run(() => FlushPendingOperations());
                    return;
                }

                viewManager.ShowOkPopup(
                    "Сертификат применён",
                    "Списываем " + state.Amount.ToString("0.##") +
                    " ₸ с сертификата •••• " + state.Last4 +
                    ". Баланс окончательно изменится после закрытия чека.",
                    "ОК");
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Gift certificate flow failed: " + ex);
                try
                {
                    viewManager.ShowErrorPopup(
                        "Не удалось применить сертификат. Повторите попытку.",
                        "ОК");
                }
                catch
                {
                    // The UI may already be closing.
                }
            }
        }

        public static void BeforeProceedOrderPayment(
            ValueTuple<IOrder, IViewManager, IOperationService> args)
        {
            var order = args.Item1;
            var viewManager = args.Item2;
            var operationService = args.Item3;
            if (order == null || operationService == null) return;

            var appliedAmount = GetAppliedGiftDiscountAmount(order, operationService);
            GiftReservationState state;
            if (!ActiveOrders.TryGetValue(order.Id, out state))
            {
                if (appliedAmount > 0.01m)
                {
                    viewManager.ShowErrorPopup(
                        "В заказе есть скидка сертификата без активной резервации. " +
                        "Удалите скидку и примените сертификат заново.",
                        "ОК");
                    throw new OperationCanceledException(
                        "Untracked Bulka gift certificate discount.");
                }
                return;
            }

            if (Math.Abs(appliedAmount - state.Amount) > 0.01m)
            {
                viewManager.ShowErrorPopup(
                    "Сумма скидки сертификата изменилась после резервирования. " +
                    "Оплата заблокирована: удалите сертификат и примените его заново.",
                    "ОК");
                throw new OperationCanceledException(
                    "Bulka gift certificate amount mismatch.");
            }

            DateTime expiresAt;
            if (!DateTime.TryParse(state.ExpiresAtUtc, out expiresAt) ||
                expiresAt.ToUniversalTime() <= DateTime.UtcNow.AddSeconds(30))
            {
                viewManager.ShowErrorPopup(
                    "Резерв сертификата истёк. Удалите сертификат из заказа и примените его заново.",
                    "ОК");
                throw new OperationCanceledException(
                    "Bulka gift certificate reservation expired.");
            }
        }

        public static void OnOrderChanged(EntityChangedEventArgs<IOrder> args)
        {
            try
            {
                var order = args.Entity;
                if (order == null) return;

                GiftReservationState state;
                if (!ActiveOrders.TryGetValue(order.Id, out state)) return;

                if (order.Status == OrderStatus.Closed)
                {
                    QueueTerminalOperation("commit", order.Id, state, state.CommitKey);
                }
                else if (order.Status == OrderStatus.Deleted)
                {
                    QueueTerminalOperation("cancel", order.Id, state, state.CancelKey);
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Gift order state handling failed: " + ex);
            }
        }

        private static void ShowExistingReservation(
            IOrder order,
            IOperationService operationService,
            IViewManager viewManager,
            GiftReservationState state)
        {
            var options = new List<string>
            {
                "Удалить сертификат из заказа",
                "Назад"
            };
            var action = viewManager.ShowChooserPopup(
                "Сертификат •••• " + state.Last4 +
                "\nЗарезервировано: " + state.Amount.ToString("0.##") +
                " ₸\nБаланс изменится после закрытия чека.",
                options,
                0,
                ButtonWidth.Wider,
                "Назад");
            if (action != 0) return;

            if (!ReplaceGiftDiscount(order, operationService, viewManager, 0m)) return;
            if (!EnqueueOperation(
                    "cancel",
                    order.Id.ToString(),
                    state.ReservationId,
                    state.CancelKey))
            {
                ReplaceGiftDiscount(order, operationService, viewManager, state.Amount);
                viewManager.ShowErrorPopup(
                    "Не удалось сохранить отмену резерва. Скидка оставлена в заказе.",
                    "ОК");
                return;
            }

            ActiveOrders.TryRemove(order.Id, out _);
            PersistActiveOrders();
            Task.Run(() => FlushPendingOperations());
            viewManager.ShowOkPopup(
                "Сертификат удалён",
                "Скидка удалена. Резерв суммы освобождается автоматически.",
                "ОК");
        }

        private static bool EnsureConfiguration(IViewManager viewManager)
        {
            if (!LoyaltyFlow.EnsureBranchPosConfiguration(viewManager)) return false;
            Guid branchGuid;
            if (!Guid.TryParse(BranchId, out branchGuid))
            {
                viewManager.ShowErrorPopup(
                    "Для сертификатов задайте корректный IIKO_BRANCH_ID в конфигурации плагина.",
                    "ОК");
                return false;
            }
            return true;
        }

        private static GiftCardPosData ValidateCard(string code, IViewManager viewManager)
        {
            var response = LoyaltyFlow.SendApiRequest(
                HttpMethod.Post,
                "gift-cards/validate",
                new GiftCardValidateRequest
                {
                    code = code,
                    branchId = BranchId
                });
            if (!response.IsSuccessStatusCode)
            {
                ShowApiError(
                    viewManager,
                    response,
                    "Сертификат не найден, использован или недоступен.");
                return null;
            }

            var payload = LoyaltyFlow.DeserializeJson<GiftCardValidateResponse>(response.Body);
            if (payload == null ||
                payload.success != true ||
                payload.card == null ||
                string.IsNullOrWhiteSpace(payload.card.id))
            {
                viewManager.ShowErrorPopup(
                    "Сервис вернул неполные данные сертификата.",
                    "ОК");
                return null;
            }
            return payload.card;
        }

        private static GiftCardReservationData ReserveCard(
            string code,
            string orderId,
            decimal amount,
            string idempotencyKey,
            IViewManager viewManager)
        {
            var request = new GiftCardReserveRequest
            {
                code = code,
                branchId = BranchId,
                iikoOrderId = orderId,
                idempotencyKey = idempotencyKey,
                amount = amount,
                ttlMinutes = ReservationTtlMinutes
            };

            LoyaltyFlow.ApiResponse response = null;
            for (var attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    response = LoyaltyFlow.SendApiRequest(
                        HttpMethod.Post,
                        "gift-cards/reserve",
                        request);
                    if (response.IsSuccessStatusCode) break;
                    if (!LoyaltyFlow.IsRetryableStatus(response.StatusCode)) break;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error(
                        "IikoBonusPlugin: Gift reservation transport error: " +
                        ex.GetType().Name);
                    if (attempt == 1)
                    {
                        viewManager.ShowErrorPopup(
                            "Нет связи с сервисом сертификатов. Скидка не применена.",
                            "ОК");
                        return null;
                    }
                }
            }

            if (response == null || !response.IsSuccessStatusCode)
            {
                if (response != null)
                {
                    ShowApiError(
                        viewManager,
                        response,
                        "Не удалось зарезервировать сумму сертификата.");
                }
                return null;
            }

            var payload =
                LoyaltyFlow.DeserializeJson<GiftCardReservationResponse>(response.Body);
            if (payload == null ||
                payload.success != true ||
                payload.reservation == null ||
                string.IsNullOrWhiteSpace(payload.reservation.id) ||
                Math.Abs(payload.reservation.amount - amount) > 0.01m)
            {
                viewManager.ShowErrorPopup(
                    "Сервис вернул некорректную резервацию сертификата.",
                    "ОК");
                return null;
            }
            return payload.reservation;
        }

        private static void ShowApiError(
            IViewManager viewManager,
            LoyaltyFlow.ApiResponse response,
            string fallback)
        {
            var message = LoyaltyFlow.GetApiErrorMessage(response.Body, fallback);
            if (response.StatusCode == HttpStatusCode.Unauthorized ||
                response.StatusCode == HttpStatusCode.Forbidden)
            {
                message = "Касса не авторизована в сервисе сертификатов. Проверьте API-токен.";
            }
            else if ((int)response.StatusCode >= 500)
            {
                message = "Сервис сертификатов временно недоступен. Повторите попытку.";
            }
            viewManager.ShowErrorPopup(message, "ОК");
        }

        private static string NormalizeCode(string code)
        {
            return (code ?? "").Trim().ToUpperInvariant();
        }

        private static bool IsValidCode(string code)
        {
            if (code.Length < 8 || code.Length > 80) return false;
            return code.All(character =>
                char.IsLetterOrDigit(character) ||
                character == '-' ||
                character == '_');
        }

        private static bool TryReadAmount(object result, out decimal amount)
        {
            amount = 0m;
            var number = result as Resto.Front.Api.Data.View.NumberInputDialogResult;
            if (number != null)
            {
                amount = number.Number;
                return true;
            }

            var decimalResult =
                result as Resto.Front.Api.Data.View.DecimalInputDialogResult;
            if (decimalResult != null)
            {
                amount = decimalResult.Decimal;
                return true;
            }

            var stringResult =
                result as Resto.Front.Api.Data.View.StringInputDialogResult;
            return stringResult != null &&
                   decimal.TryParse(
                       stringResult.Result.Replace(',', '.'),
                       System.Globalization.NumberStyles.Any,
                       System.Globalization.CultureInfo.InvariantCulture,
                       out amount);
        }

        private static IDiscountType FindDiscountType(IOperationService operationService)
        {
            var types = operationService.GetDiscountTypes()
                .Where(type => type != null)
                .ToList();
            Guid configuredId;
            if (!string.IsNullOrWhiteSpace(DiscountTypeId))
            {
                if (!Guid.TryParse(DiscountTypeId, out configuredId)) return null;
                return types.FirstOrDefault(type => type.Id == configuredId);
            }
            return types.FirstOrDefault(type =>
                string.Equals(
                    type.Name,
                    DiscountTypeName,
                    StringComparison.OrdinalIgnoreCase));
        }

        private static string GetDiscountConfigurationMessage()
        {
            return !string.IsNullOrWhiteSpace(DiscountTypeId)
                ? "В iikoOffice не найден тип скидки сертификата с ID " +
                  DiscountTypeId + "."
                : "Создайте в iikoOffice отдельную гибкую скидку «" +
                  DiscountTypeName +
                  "» либо задайте IIKO_GIFT_DISCOUNT_TYPE_ID.";
        }

        private static decimal GetAppliedGiftDiscountAmount(
            IOrder order,
            IOperationService operationService)
        {
            if (order == null || order.AppliedDiscounts == null) return 0m;
            var configuredType = FindDiscountType(operationService);
            Guid configuredId;
            var hasConfiguredId = Guid.TryParse(DiscountTypeId, out configuredId);
            return Math.Max(
                0m,
                order.AppliedDiscounts
                    .Where(item =>
                    {
                        var type = item.Discount?.DiscountType;
                        if (type == null) return false;
                        if (configuredType != null && type.Id == configuredType.Id)
                            return true;
                        if (hasConfiguredId && type.Id == configuredId) return true;
                        return string.Equals(
                            type.Name,
                            DiscountTypeName,
                            StringComparison.OrdinalIgnoreCase);
                    })
                    .Sum(item => item.DiscountSum));
        }

        private static bool ReplaceGiftDiscount(
            IOrder order,
            IOperationService operationService,
            IViewManager viewManager,
            decimal amount)
        {
            try
            {
                var type = FindDiscountType(operationService);
                if (type == null)
                {
                    viewManager.ShowErrorPopup(GetDiscountConfigurationMessage(), "ОК");
                    return false;
                }

                var existing = order.Discounts == null
                    ? new List<IDiscountItem>()
                    : order.Discounts
                        .Where(discount =>
                            discount.DiscountType != null &&
                            discount.DiscountType.Id == type.Id)
                        .ToList();
                var session = operationService.CreateEditSession();
                foreach (var discount in existing)
                    session.DeleteDiscount(discount, order);
                if (amount > 0m)
                    session.AddFlexibleSumDiscount(amount, type, order);
                if (existing.Count > 0 || amount > 0m)
                    operationService.SubmitChanges(
                        session,
                        operationService.GetDefaultCredentials());
                return true;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Failed to change gift discount: " + ex);
                viewManager.ShowErrorPopup(
                    "Не удалось изменить скидку сертификата в iiko. Заказ оставлен без изменений.",
                    "ОК");
                return false;
            }
        }

        private static void QueueTerminalOperation(
            string operation,
            Guid orderId,
            GiftReservationState state,
            string idempotencyKey)
        {
            if (!EnqueueOperation(
                    operation,
                    orderId.ToString(),
                    state.ReservationId,
                    idempotencyKey))
            {
                return;
            }

            ActiveOrders.TryRemove(orderId, out _);
            PersistActiveOrders();
            Task.Run(() => FlushPendingOperations());
        }

        private static bool EnqueueOperation(
            string operation,
            string orderId,
            string reservationId,
            string idempotencyKey)
        {
            lock (StateLock)
            {
                try
                {
                    var queue = ReadFile<List<GiftReservationQueueItem>>(QueuePath) ??
                                new List<GiftReservationQueueItem>();
                    var existing = queue.FirstOrDefault(item =>
                        string.Equals(
                            item.Operation,
                            operation,
                            StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(
                            item.ReservationId,
                            reservationId,
                            StringComparison.OrdinalIgnoreCase));
                    if (existing == null)
                    {
                        queue.Add(new GiftReservationQueueItem
                        {
                            Operation = operation,
                            OrderId = orderId,
                            ReservationId = reservationId,
                            IdempotencyKey = idempotencyKey,
                            Attempts = 0,
                            LastAttemptAtUtc = "",
                            LastError = "",
                            Terminal = false
                        });
                    }
                    WriteFile(QueuePath, queue);
                    return true;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error(
                        "IikoBonusPlugin: Failed to persist gift operation: " + ex);
                    return false;
                }
            }
        }

        private static void FlushPendingOperations()
        {
            if (Interlocked.CompareExchange(ref _flushInProgress, 1, 0) != 0) return;
            try
            {
                List<GiftReservationQueueItem> queue;
                lock (StateLock)
                {
                    queue = ReadFile<List<GiftReservationQueueItem>>(QueuePath) ??
                            new List<GiftReservationQueueItem>();
                }
                if (queue.Count == 0) return;

                var results =
                    new Dictionary<string, Tuple<GiftReservationQueueItem, bool>>(
                        StringComparer.OrdinalIgnoreCase);
                foreach (var item in queue)
                {
                    var key = QueueKey(item);
                    if (item.Terminal)
                    {
                        results[key] = Tuple.Create(item, false);
                        continue;
                    }

                    item.Attempts += 1;
                    item.LastAttemptAtUtc = DateTime.UtcNow.ToString("o");
                    string error;
                    bool retryable;
                    if (SendPendingOperation(item, out error, out retryable))
                    {
                        results[key] = Tuple.Create(item, true);
                    }
                    else
                    {
                        item.LastError = error;
                        item.Terminal = !retryable;
                        results[key] = Tuple.Create(item, false);
                    }
                }

                lock (StateLock)
                {
                    var current =
                        ReadFile<List<GiftReservationQueueItem>>(QueuePath) ??
                        new List<GiftReservationQueueItem>();
                    var merged = new List<GiftReservationQueueItem>();
                    foreach (var currentItem in current)
                    {
                        Tuple<GiftReservationQueueItem, bool> result;
                        if (!results.TryGetValue(QueueKey(currentItem), out result))
                        {
                            merged.Add(currentItem);
                            continue;
                        }

                        var attempted = result.Item1;
                        if (!string.Equals(
                                currentItem.IdempotencyKey,
                                attempted.IdempotencyKey,
                                StringComparison.OrdinalIgnoreCase))
                        {
                            // A newer operation replaced this snapshot while HTTP was in flight.
                            merged.Add(currentItem);
                        }
                        else if (!result.Item2)
                        {
                            merged.Add(attempted);
                        }
                    }
                    WriteFile(QueuePath, merged);
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error(
                    "IikoBonusPlugin: Gift queue flush failed: " + ex);
            }
            finally
            {
                Interlocked.Exchange(ref _flushInProgress, 0);
            }
        }

        private static string QueueKey(GiftReservationQueueItem item)
        {
            return (item.Operation ?? "").Trim().ToLowerInvariant() +
                   "|" +
                   (item.ReservationId ?? "").Trim().ToLowerInvariant();
        }

        private static bool SendPendingOperation(
            GiftReservationQueueItem item,
            out string error,
            out bool retryable)
        {
            error = "";
            retryable = true;
            try
            {
                var response = LoyaltyFlow.SendApiRequest(
                    HttpMethod.Post,
                    "gift-cards/" + item.Operation.ToLowerInvariant(),
                    new GiftCardReservationMutationRequest
                    {
                        reservationId = item.ReservationId,
                        idempotencyKey = item.IdempotencyKey
                    });
                if (!response.IsSuccessStatusCode)
                {
                    error = LoyaltyFlow.GetApiErrorMessage(
                        response.Body,
                        "HTTP " + (int)response.StatusCode);
                    retryable =
                        LoyaltyFlow.IsRetryableStatus(response.StatusCode);
                    return false;
                }

                var payload =
                    LoyaltyFlow.DeserializeJson<GiftCardReservationResponse>(response.Body);
                if (payload == null ||
                    payload.success != true ||
                    payload.reservation == null ||
                    string.IsNullOrWhiteSpace(payload.reservation.id))
                {
                    error = "Incomplete gift reservation response";
                    retryable = true;
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                error = ex.GetType().Name + ": " + ex.Message;
                retryable = true;
                return false;
            }
        }

        private static bool PersistActiveOrders()
        {
            lock (StateLock)
            {
                try
                {
                    WriteFile(
                        ActivePath,
                        ActiveOrders.ToDictionary(pair => pair.Key, pair => pair.Value));
                    return true;
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error(
                        "IikoBonusPlugin: Failed to persist gift reservations: " + ex);
                    return false;
                }
            }
        }

        private static T ReadFile<T>(string path) where T : class
        {
            if (!File.Exists(path)) return null;
            try
            {
                var serializer = new DataContractJsonSerializer(typeof(T));
                using (var stream =
                       File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    return (T)serializer.ReadObject(stream);
                }
            }
            catch (Exception primary)
            {
                var backup = path + ".bak";
                if (!File.Exists(backup)) throw;
                try
                {
                    var serializer = new DataContractJsonSerializer(typeof(T));
                    using (var stream =
                           File.Open(
                               backup,
                               FileMode.Open,
                               FileAccess.Read,
                               FileShare.Read))
                    {
                        var value = (T)serializer.ReadObject(stream);
                        PluginContext.Log.Error(
                            "IikoBonusPlugin: Recovered gift state from backup: " +
                            primary.Message);
                        return value;
                    }
                }
                catch (Exception backupError)
                {
                    throw new IOException(
                        "Cannot read gift state or backup.",
                        new AggregateException(primary, backupError));
                }
            }
        }

        private static void WriteFile<T>(string path, T value)
        {
            Directory.CreateDirectory(
                Path.GetDirectoryName(path) ?? LoyaltyFlow.DataDirectoryPath);
            var temporary = path + ".tmp";
            var backup = path + ".bak";
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream =
                   File.Open(
                       temporary,
                       FileMode.Create,
                       FileAccess.Write,
                       FileShare.None))
            {
                serializer.WriteObject(stream, value);
                stream.Flush();
            }

            if (File.Exists(path))
                File.Replace(temporary, path, backup, true);
            else
                File.Move(temporary, path);
        }
    }
}
