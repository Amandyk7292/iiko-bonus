using System;
using System.Collections.Generic;
using System.Linq;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Editors.Stubs;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class OnlineReceiptDiscounts
    {
        // The existing evening discount from Bulka 19A's iiko catalogue. Match by UUID,
        // not by a percentage/name that could belong to a different promotion.
        internal const string DefaultExcludedIds = "6476ee33-cc09-4e6b-8573-bc3fa231ebb1";

        internal static HashSet<Guid> ExcludedIds(string configured)
        {
            var result = new HashSet<Guid>();
            foreach (var value in (configured ?? DefaultExcludedIds).Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (!Guid.TryParse(value, out var id) || id == Guid.Empty)
                    throw new InvalidOperationException("Неверный UUID в IIKO_ONLINE_EXCLUDED_DISCOUNT_IDS.");
                result.Add(id);
            }
            return result;
        }

        internal static void Validate(IOrder order, string onlineId, IOperationService os)
        {
            if (!Guid.TryParse(onlineId, out var expected) || expected == Guid.Empty
                || !Guid.TryParse(OnlineReceiptSync.OrderId(order), out var actual) || expected != actual)
                throw new InvalidOperationException("Чек не связан с этим онлайн-заказом Bulka. Требуется сверка.");
            if (order.Status != OrderStatus.New || order.Payments.Count != 0)
                throw new InvalidOperationException("Скидки можно подготовить только в открытом онлайн-чеке без оплаты.");
        }

        internal static IOrder Prepare(IOrder order, string onlineId, IOperationService os,
            IDiscountType onlineDiscount, HashSet<Guid> excludedIds)
        {
            Validate(order, onlineId, os);
            if (onlineDiscount != null && excludedIds.Contains(onlineDiscount.Id))
                throw new InvalidOperationException("Скидку бонусов Bulka нельзя включать в список исключённых вечерних скидок.");

            // A scheduled automatic discount can remain IsActive in the catalogue
            // even outside its daily time window. iiko rejects an attempt to add it
            // explicitly with "discountType ... is not active". Only touch an
            // excluded discount after iiko has actually applied it to this receipt.
            // A retry after the window begins will see it here and exclude it before
            // payment and printing.
            var appliedExcludedIds = new HashSet<Guid>(order.AppliedDiscounts
                .Where(d => d?.Discount?.DiscountType != null && d.DiscountSum != 0
                    && excludedIds.Contains(d.Discount.DiscountType.Id))
                .Select(d => d.Discount.DiscountType.Id));
            var types = os.GetDiscountTypes().Where(d => d != null && !d.Deleted && d.IsActive
                && appliedExcludedIds.Contains(d.Id)).ToList();
            var change = new List<IDiscountType>();
            foreach (var type in types)
            {
                if (!type.IsAutomatic || type.DiscountByFlexibleSum)
                    throw new InvalidOperationException("Исключение онлайн-чека настроено на другой тип скидки: «" + type.Name + "».");
                if (!type.CanApplyManually || !type.CanApplySelectively)
                    throw new InvalidOperationException("Для скидки «" + type.Name
                        + "» в iikoOffice включите «Можно назначать вручную» и «Выбор блюд на усмотрение официанта»."
                        + " «Устанавливать автоматически» оставьте включённым, сохраните и синхронизируйте кассу.");
                var item = order.Discounts.SingleOrDefault(d => d.DiscountType.Id == type.Id);
                var settings = item != null && item.IsSelectivelyApplied
                    ? os.TryGetSelectiveDiscountItemSettings(order, item) : null;
                if (!IsEmptySelection(settings)) change.Add(type);
            }

            if (change.Count != 0)
            {
                var edit = os.CreateEditSession();
                foreach (var type in change)
                {
                    // Automatic discounts are normally implicit, absent from Discounts.
                    // Add an explicit per-order selection, then exclude every line in the
                    // SAME edit. Null lists would restore the discount for the whole order.
                    if (!order.Discounts.Any(d => d.DiscountType.Id == type.Id)) edit.AddDiscount(type, order);
                    edit.ChangeSelectiveDiscount(order, type, new IOrderProductItemStub[0],
                        new IOrderModifierItemStub[0], new IOrderCompoundItemComponentStub[0]);
                }
                os.SubmitChanges(edit, os.GetDefaultCredentials());
                order = os.GetOrderById(order.Id);
            }
            Validate(order, onlineId, os);
            foreach (var type in types)
            {
                var item = order.Discounts.SingleOrDefault(d => d.DiscountType.Id == type.Id);
                if (item == null || !item.IsSelectivelyApplied
                    || !IsEmptySelection(os.TryGetSelectiveDiscountItemSettings(order, item)))
                    throw new InvalidOperationException("iikoFront не сохранил исключение вечерней скидки."
                        + " Чек сохранён для повторной попытки.");
            }
            if (order.AppliedDiscounts.Any(d => d.Discount != null
                && excludedIds.Contains(d.Discount.DiscountType.Id) && d.DiscountSum != 0))
                throw new InvalidOperationException("iikoFront ещё применяет вечернюю скидку к онлайн-чеку."
                    + " Оплата и закрытие остановлены; чек сохранён для повторной попытки.");
            return order;
        }

        private static bool IsEmptySelection(ISelectiveDiscountItemSettings settings) => settings != null
            && (settings.Products?.Count ?? 0) == 0 && (settings.Modifiers?.Count ?? 0) == 0
            && (settings.CompoundItemComponents?.Count ?? 0) == 0;
    }
}
