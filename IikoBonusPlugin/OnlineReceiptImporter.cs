using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Security.Cryptography;
using System.Text;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Editors.Stubs;
using Resto.Front.Api.Extensions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class ReceiptDraftRequest
    {
        [DataMember(Name="number")] public long Number {get;set;}
    }
    [DataContract] internal sealed class ReceiptDraftItem
    {
        [DataMember(Name="key")] public string Key {get;set;}
        [DataMember(Name="productId")] public string ProductId {get;set;}
        [DataMember(Name="name")] public string Name {get;set;}
        [DataMember(Name="quantity")] public decimal Quantity {get;set;}
        [DataMember(Name="price")] public decimal Price {get;set;}
        [DataMember(Name="lineTotal")] public decimal LineTotal {get;set;}
    }
    [DataContract] internal sealed class ReceiptDraft
    {
        [DataMember(Name="id")] public string Id {get;set;}
        [DataMember(Name="items")] public List<ReceiptDraftItem> Items {get;set;}
        [DataMember(Name="merchandiseTotal")] public decimal MerchandiseTotal {get;set;}
        [DataMember(Name="error")] public string Error {get;set;}
    }
    internal sealed partial class SharedStockGuard
    {
        private static Guid ImportedLineId(Guid receipt,string order,string key)
        {
            using(var hash=SHA256.Create())
                return new Guid(hash.ComputeHash(Encoding.UTF8.GetBytes("bulka:"+receipt+":"+order+":"+key)).Take(16).ToArray());
        }
        private IOrder ImportReceipt(IOrder order,long number,IOperationService os)
        {
            var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"orders/receipt-draft",new ReceiptDraftRequest { Number=number });
            var draft=LoyaltyFlow.DeserializeJson<ReceiptDraft>(response.Body);
            if(!response.IsSuccessStatusCode || draft?.Items==null || draft.Items.Count==0)
                throw new InvalidOperationException(draft?.Error ?? "Не удалось получить онлайн-заказ. Исправьте номер и повторите.");
            var lineIds=draft.Items.ToDictionary(i=>ImportedLineId(order.Id,draft.Id,i.Key));
            var existing=order.Items.Where(i=>!i.Deleted).ToList();
            // Never rewrite items that the cashier entered independently.
            if(existing.Any(i=>!lineIds.ContainsKey(i.Id))) return order;
            if(order.Payments.Count>0) return order;
            var products=draft.Items.ToDictionary(i=>i.Key,i=>os.TryGetProductById(Guid.Parse(i.ProductId)));
            if(products.Any(pair=>pair.Value==null))
                throw new InvalidOperationException("В этой кассе не найден товар онлайн-заказа. Проверьте сопоставление ID.");
            var pending=new GuardRequest {
                TerminalId=os.GetHostTerminal().Id.ToString(),ReceiptId=order.Id.ToString(),
                OnlineNumber=number,Total=draft.MerchandiseTotal,
                Items=draft.Items.GroupBy(i=>i.ProductId).Select(g=>new GuardItem {ProductId=g.Key,Quantity=g.Sum(i=>i.Quantity)})
                    .OrderBy(i=>i.ProductId).ToList()
            };
            requests[pending.ReceiptId]=pending;
            Save();
            if(existing.Count<draft.Items.Count)
            {
                var edit=os.CreateEditSession();
                IOrderGuestItemStub guest=order.Guests.FirstOrDefault();
                if(guest==null) guest=edit.AddOrderGuest("Bulka",order);
                foreach(var item in draft.Items)
                {
                    var id=ImportedLineId(order.Id,draft.Id,item.Key);
                    if(existing.Any(i=>i.Id==id)) continue;
                    // Preserve whole-tenge online line rounding without a second
                    // customer payment; the exact difference is discounted below.
                    var unitPrice=Math.Max(item.Price,decimal.Ceiling(item.LineTotal/item.Quantity*100m)/100m);
                    edit.AddOrderProductItem(id,item.Quantity,products[item.Key],order,guest,null,OrderItemCourse.Default,unitPrice);
                }
                os.SubmitChanges(edit,os.GetDefaultCredentials());
                order=os.GetOrderById(order.Id);
            }
            var discountType=LoyaltyFlow.FindLoyaltyDiscountType(os);
            var ownDiscounts=order.Discounts.Where(d=>discountType!=null && d.DiscountType.Id==discountType.Id).ToList();
            var appliedOwn=order.AppliedDiscounts.Where(d=>discountType!=null && d.Discount?.DiscountType?.Id==discountType.Id).Sum(d=>d.DiscountSum);
            var discount=order.ResultSum+appliedOwn-draft.MerchandiseTotal;
            if(discount<0) throw new InvalidOperationException("В кассе применена дополнительная скидка. Уберите её и повторите перенос заказа.");
            if(discount>0 && discountType==null)
                throw new InvalidOperationException("Настройте суммовую скидку Bulka для переноса промокода и бонусов.");
            if(discount>0 || ownDiscounts.Count>0)
            {
                var edit=os.CreateEditSession();
                foreach(var item in ownDiscounts) edit.DeleteDiscount(item,order);
                if(discount>0) edit.AddFlexibleSumDiscount(discount,discountType,order);
                os.SubmitChanges(edit,os.GetDefaultCredentials());
                order=os.GetOrderById(order.Id);
            }
            if(order.ResultSum!=draft.MerchandiseTotal)
                throw new InvalidOperationException("Итог кассы не совпал с оплаченными товарами. Печать и повторная оплата заблокированы.");
            return order;
        }
    }
}
