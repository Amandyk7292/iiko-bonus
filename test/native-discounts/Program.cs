using System;
using System.Collections.Generic;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Remoting.Proxies;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Editors;
using Resto.Front.Api.IikoBonusPlugin;

namespace Resto.Front.Api.IikoBonusPlugin {
    internal static class OnlineReceiptSync {
        internal static string LinkedId;
        internal static string OrderId(IOrder order) => LinkedId;
    }
}
class Proxy<T> : RealProxy {
    readonly Func<IMethodCallMessage, object> call;
    Proxy(Func<IMethodCallMessage,object> call) : base(typeof(T)) { this.call=call; }
    public static T Make(Func<IMethodCallMessage,object> call) => (T)new Proxy<T>(call).GetTransparentProxy();
    public override IMessage Invoke(IMessage msg) {
        var method=(IMethodCallMessage)msg;
        try {return new ReturnMessage(call(method),null,0,method.LogicalCallContext,method);}
        catch(Exception e) {return new ReturnMessage(e,method);}
    }
}
class Program {
    static void Check(bool ok,string name) {if(!ok) throw new Exception(name);}
    static void Main() {
        var id=Guid.NewGuid(); var discountId=Guid.NewGuid(); bool selected=false, active=true, paid=false;
        int adds=0, exclusions=0, commits=0;
        var type=Proxy<IDiscountType>.Make(m=> {
            switch(m.MethodName) {
                case "get_Id": return discountId;
                case "get_IsActive": case "get_IsAutomatic": case "get_CanApplyManually": case "get_CanApplySelectively": return true;
                case "get_Deleted": case "get_DiscountByFlexibleSum": return false;
                case "get_Name": return "Evening";
                default: throw new Exception(m.MethodName);
            }
        });
        var item=Proxy<IDiscountItem>.Make(m=>m.MethodName=="get_DiscountType" ? (object)type : selected);
        var applied=Proxy<IAppliedDiscountItem>.Make(m=>m.MethodName=="get_Discount" ? (object)item : selected || !active ? 0m : 36m);
        var settings=Proxy<ISelectiveDiscountItemSettings>.Make(m=>null);
        var order=Proxy<IOrder>.Make(m=> {
            switch(m.MethodName) {
                case "get_Id": return id;
                case "get_Status": return OrderStatus.New;
                case "get_Payments": return paid ? new IPaymentItem[]{null} : new IPaymentItem[0];
                case "get_Discounts": return selected ? new[]{item} : new IDiscountItem[0];
                case "get_AppliedDiscounts": return new[]{applied};
                default: throw new Exception(m.MethodName);
            }
        });
        var edit=Proxy<IEditSession>.Make(m=> {
            if(m.MethodName=="AddDiscount") adds++;
            else if(m.MethodName=="ChangeSelectiveDiscount") {
                for(int i=2;i<5;i++) Check(m.Args[i] is Array a && a.Length==0,"Empty selection, never null");
                exclusions++;
            } else throw new Exception(m.MethodName);
            return null;
        });
        var os=Proxy<IOperationService>.Make(m=> {
            switch(m.MethodName) {
                case "GetDiscountTypes": return new[]{type};
                case "CreateEditSession": return edit;
                case "GetDefaultCredentials": return null;
                case "SubmitChanges": selected=true; commits++; return null;
                case "GetOrderById": return order;
                case "TryGetSelectiveDiscountItemSettings": return settings;
                default: throw new Exception(m.MethodName);
            }
        });
        OnlineReceiptSync.LinkedId=id.ToString(); var excluded=new HashSet<Guid>{discountId};
        OnlineReceiptDiscounts.Prepare(order,id.ToString(),os,null,excluded);
        Check(adds==1 && exclusions==1 && commits==1,"Exclude automatic discount atomically");
        OnlineReceiptDiscounts.Prepare(order,id.ToString(),os,null,excluded);
        Check(commits==1,"Retry must not duplicate edits");
        selected=false; active=false;
        OnlineReceiptDiscounts.Prepare(order,id.ToString(),os,null,excluded);
        Check(commits==1,"Inactive time window must not add discount");
        paid=true;
        try {OnlineReceiptDiscounts.Prepare(order,id.ToString(),os,null,excluded); throw new Exception("Paid receipt allowed");}
        catch(InvalidOperationException) {}
        paid=false; OnlineReceiptSync.LinkedId=Guid.NewGuid().ToString();
        try {OnlineReceiptDiscounts.Prepare(order,id.ToString(),os,null,excluded); throw new Exception("Foreign receipt allowed");}
        catch(InvalidOperationException) {}
        Console.WriteLine("PASS: automatic exclusion, repeat, inactive window, paid and foreign receipt guards.");
    }
}
