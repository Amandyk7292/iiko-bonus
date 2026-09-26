using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Remoting.Proxies;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.IikoBonusPlugin;
using Resto.Front.Api.UI;

internal sealed class Proxy : RealProxy
{
    private readonly Func<IMethodCallMessage,object> call;
    private Proxy(Type type,Func<IMethodCallMessage,object> call):base(type){this.call=call;}
    internal static T Make<T>(Func<IMethodCallMessage,object> call) where T:class => (T)Make(typeof(T),call);
    internal static object Make(Type type,Func<IMethodCallMessage,object> call) => new Proxy(type,call).GetTransparentProxy();
    internal static object Props(Type type,Dictionary<string,object> values) => Make(type,call=>{
        if(values.TryGetValue(call.MethodName.Replace("get_",""),out var value)) return value;
        var result=((MethodInfo)call.MethodBase).ReturnType;
        if(result.IsGenericType && result.GetGenericArguments().Length==1) return Array.CreateInstance(result.GetGenericArguments()[0],0);
        return result.IsValueType ? Activator.CreateInstance(result) : null;
    });
    public override IMessage Invoke(IMessage message)
    {
        var invocation=(IMethodCallMessage)message;
        try{return new ReturnMessage(call(invocation),null,0,invocation.LogicalCallContext,invocation);}
        catch(Exception error){return new ReturnMessage(error,invocation);}
    }
}
internal sealed class Services:IServiceProvider
{
    internal IOperationService Operations;
    public object GetService(Type type)=>type==typeof(IOperationService)?Operations:null;
}
internal sealed class FakeHttp:HttpMessageHandler
{
    internal Func<HttpRequestMessage,HttpResponseMessage> Reply;
    internal int Calls;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
    {
        Interlocked.Increment(ref Calls);
        try{return Task.FromResult(Reply(request));} catch(Exception error){return Task.FromException<HttpResponseMessage>(error);}
    }
}
internal static class Program
{
    private const BindingFlags Static=BindingFlags.NonPublic|BindingFlags.Static;
    private const BindingFlags Instance=BindingFlags.NonPublic|BindingFlags.Instance;
    private static readonly Assembly Plugin=typeof(LoyaltyFlow).Assembly;
    private static string data;
    private static FakeHttp http;
    private static Services services;
    private static readonly IViewManager View=Proxy.Make<IViewManager>(call=>null);
    private static int assertions;
    private static void Check(bool value,string label){if(!value)throw new Exception(label);assertions++;Console.WriteLine("PASS: "+label);}
    private static object Call(Type type,string name,params object[] args)=>type.GetMethod(name,Static).Invoke(null,args);
    private static void Write<T>(string name,T value){using(var file=File.Create(Path.Combine(data,name)))new DataContractJsonSerializer(typeof(T)).WriteObject(file,value);}
    private static T Read<T>(string name){using(var file=File.OpenRead(Path.Combine(data,name)))return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(file);}
    private static HttpResponseMessage Response(HttpStatusCode status,string body)=>new HttpResponseMessage(status){Content=new StringContent(body)};
    private static HttpResponseMessage GiftSuccess(HttpRequestMessage request,string status="committed")
    {
        GiftCardReservationMutationRequest body;
        using(var stream=request.Content.ReadAsStreamAsync().Result) body=(GiftCardReservationMutationRequest)new DataContractJsonSerializer(typeof(GiftCardReservationMutationRequest)).ReadObject(stream);
        return Response(HttpStatusCode.OK,"{\"success\":true,\"reservation\":{\"id\":\""+body.reservationId+"\",\"status\":\""+status+"\"}}");
    }
    private static void Main()
    {
        data=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"state-"+Guid.NewGuid());Directory.CreateDirectory(data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR",data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_API_BASE_URL","https://audit.invalid/api/loyalty");
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_API_TOKEN",new string('a',48));
        Environment.SetEnvironmentVariable("IIKO_BRANCH_ID",Guid.NewGuid().ToString());
        Environment.SetEnvironmentVariable("IIKO_BRANCH_POS_TOKEN",new string('b',48));
        services=new Services{Operations=Proxy.Make<IOperationService>(call=>{
            if(call.MethodName=="GetOrders")return new IOrder[0];
            throw new InvalidOperationException("Unexpected SDK call: "+call.MethodName);
        })};
        PluginContext.Initialize(services,()=>{},Proxy.Make<ILog>(call=>null));
        http=new FakeHttp{Reply=request=>throw new Exception("Unexpected HTTP: "+request.RequestUri)};
        typeof(LoyaltyFlow).GetField("_httpClient",Static).SetValue(null,new HttpClient(http));
        UnknownOrders();GiftAuthenticationRecovery();JournalRecovery();PreparePayments();ActiveJournalRecovery();
        Check(http.Calls>0,"network scenarios used intercepted production HttpClient");
        Console.WriteLine("PASS: "+assertions+" production-plugin reliability assertions; no actual HTTP/POS.");
        PluginContext.Uninitialize();
    }
    private static void UnknownOrders()
    {
        var id=Guid.NewGuid();PluginEntry.ActiveOrders[id]=new PluginEntry.OrderLoyaltyData{CustomerId=Guid.NewGuid().ToString(),ReservationId=Guid.NewGuid().ToString(),DiscountAmount=500};
        LoyaltyFlow.ReconcileRestoredOrders(services.Operations);
        Check(PluginEntry.ActiveOrders.ContainsKey(id)&&!File.Exists(Path.Combine(data,"BulkaBonusPendingApplies.json")),"missing local order retains bonus reservation and never queues cancel");
        var gift=Guid.NewGuid();Write("BulkaGiftActiveOrders.json",new Dictionary<Guid,GiftReservationState>{{gift,GiftState()}});
        GiftCertificateFlow.RestoreActiveOrders();GiftCertificateFlow.ReconcileRestoredOrders(services.Operations);
        Check((bool)Call(typeof(GiftCertificateFlow),"HasActiveOrder",gift)&&!File.Exists(Path.Combine(data,"BulkaGiftPendingOperations.json")),"missing local order retains gift reservation and never queues cancel");
        var deleted=(IOrder)Proxy.Props(typeof(IOrder),new Dictionary<string,object>{{"Id",id},{"Status",OrderStatus.Deleted}});
        services.Operations=Proxy.Make<IOperationService>(call=>call.MethodName=="GetOrders"?new[]{deleted}:throw new InvalidOperationException(call.MethodName));
        LoyaltyFlow.ReconcileRestoredOrders(services.Operations);
        Check(!PluginEntry.ActiveOrders.ContainsKey(id)&&Read<List<LoyaltyApplyQueueItem>>("BulkaBonusPendingApplies.json").Single().operation=="cancel","explicitly deleted order releases bonus hold through durable cancellation");
        services.Operations=Proxy.Make<IOperationService>(call=>call.MethodName=="GetOrders"?new IOrder[0]:throw new InvalidOperationException(call.MethodName));
    }
    private static GiftReservationState GiftState()=>new GiftReservationState{ReservationId=Guid.NewGuid().ToString(),Amount=500,CommitKey=Guid.NewGuid().ToString(),CancelKey=Guid.NewGuid().ToString(),ExpiresAtUtc=DateTime.UtcNow.AddHours(-1).ToString("o")};
    private static void GiftAuthenticationRecovery()
    {
        var id=Guid.NewGuid().ToString();var key=Guid.NewGuid().ToString();
        Call(typeof(GiftCertificateFlow),"EnqueueOperation","commit",Guid.NewGuid().ToString(),id,key);
        foreach(var status in new[]{HttpStatusCode.Unauthorized,HttpStatusCode.Forbidden})
        {
            http.Reply=request=>Response(status,"{\"error\":\"credentials revoked\"}");
            Call(typeof(GiftCertificateFlow),"FlushPendingOperations");
            var queued=Read<List<GiftReservationQueueItem>>("BulkaGiftPendingOperations.json").Single();
            Check(!queued.Terminal&&queued.LastHttpStatus==(int)status,"gift HTTP "+(int)status+" remains retryable and preserves operation");
        }
        http.Reply=request=>GiftSuccess(request);
        Call(typeof(GiftCertificateFlow),"FlushPendingOperations");
        Check(Read<List<GiftReservationQueueItem>>("BulkaGiftPendingOperations.json").Count==0,"gift queue drains after credentials recover");
        Write("BulkaGiftPendingOperations.json",new List<GiftReservationQueueItem>{new GiftReservationQueueItem{Operation="commit",ReservationId=id,IdempotencyKey=key,Terminal=true,LastError="old credentials error"}});
        Call(typeof(GiftCertificateFlow),"FlushPendingOperations");
        Check(Read<List<GiftReservationQueueItem>>("BulkaGiftPendingOperations.json").Count==0,"legacy terminal operation is safely rechecked with original idempotency key");
        Write("BulkaGiftPendingOperations.json",new List<GiftReservationQueueItem>{new GiftReservationQueueItem{Operation="commit",ReservationId=id,IdempotencyKey=key,Terminal=true,LastError="expired"}});
        http.Reply=request=>Response(HttpStatusCode.Conflict,"{\"error\":\"reservation expired\"}");
        Call(typeof(GiftCertificateFlow),"FlushPendingOperations");var calls=http.Calls;Call(typeof(GiftCertificateFlow),"FlushPendingOperations");
        Check(http.Calls==calls,"legacy business rejection is not retried forever");
    }
    private static void JournalRecovery()
    {
        var durable=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.DurableJsonFile");
        var offline=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.OfflineReceiptSync");
        var file=Path.Combine(data,"BulkaOfflineReceipts.json");File.WriteAllText(file,"null");
        using(var worker=(IDisposable)Activator.CreateInstance(offline,Instance,null,new object[0],null))
        {
            offline.GetMethod("Tick",Instance).Invoke(worker,new object[]{null});
            Check(!(bool)offline.GetField("storageHealthy",Instance).GetValue(worker),"null offline ledger enters recovery state without an unhandled timer exception");
            Check(Directory.GetFiles(data,"BulkaOfflineReceipts.json.corrupt-*").Length==1,"invalid offline ledger retained and quarantined once");
            var blocked=false;try{offline.GetMethod("EnsureHealthy",Instance).Invoke(worker,new object[0]);}catch(TargetInvocationException error){blocked=error.InnerException is InvalidOperationException;}
            Check(blocked,"payment is blocked while offline journal cannot be recovered");
            File.WriteAllText(file+".bak","[]");offline.GetMethod("Tick",Instance).Invoke(worker,new object[]{null});
            Check((bool)offline.GetField("storageHealthy",Instance).GetValue(worker)&&File.ReadAllText(file)=="[]","offline idempotent receipt ledger recovers validated backup and retries without restart");
        }
        var automatic=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.OnlineReceiptSync");
        var autoFile=Path.Combine(data,"BulkaAutomaticReceipts.json");File.WriteAllText(autoFile,"null");File.WriteAllText(autoFile+".bak","[]");
        using(var worker=(IDisposable)Activator.CreateInstance(automatic,Instance,null,new object[]{null},null))
        {
            Check(!(bool)automatic.GetField("storageHealthy",Instance).GetValue(worker),"automatic receipt journal cannot blindly replay an old empty backup");
            File.WriteAllText(autoFile,"[]");Check((bool)automatic.GetMethod("TryLoad",Instance).Invoke(worker,new object[0]),"automatic receipt service can reload a repaired journal without restart");
        }
        var sample=Path.Combine(data,"malformed.json");File.WriteAllText(sample,"{");File.WriteAllText(sample+".bak","[]");
        var refused=false;try{durable.GetMethod("Read",Static).MakeGenericMethod(typeof(List<int>)).Invoke(null,new object[]{sample});}catch(TargetInvocationException){refused=true;}
        Check(refused&&Directory.GetFiles(data,"malformed.json.corrupt-*").Length==1,"generic journal read fails closed and preserves malformed primary");
        var shared=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.SharedStockGuard");
        var sharedFile=Path.Combine(data,"BulkaSharedStock.json");File.WriteAllText(sharedFile,"null");File.WriteAllText(sharedFile+".bak","[]");
        using(var worker=(IDisposable)Activator.CreateInstance(shared,Instance,null,new object[0],null))
        {
            Check(!(bool)shared.GetField("storageHealthy",Instance).GetValue(worker),"shared-stock corrupt ledger remains blocked without replaying stale holds");
            File.WriteAllText(sharedFile,"[]");Check((bool)shared.GetMethod("TryLoadLedger",Instance).Invoke(worker,new object[0]),"shared-stock ledger can be repaired without restarting the plugin");
        }
    }
    private static void PreparePayments()
    {
        var bonusId=Guid.NewGuid();var bonus=new PluginEntry.OrderLoyaltyData{CustomerId=Guid.NewGuid().ToString(),ReservationId=Guid.NewGuid().ToString(),DiscountAmount=500};
        PluginEntry.ActiveOrders[bonusId]=bonus;
        var bonusOrder=DiscountedOrder(bonusId,"Bulka Bonus");
        http.Reply=request=>{
            if(request.RequestUri.AbsolutePath.EndsWith("/reserve"))return Response(HttpStatusCode.OK,"{\"success\":true,\"reservationId\":\""+bonus.ReservationId+"\",\"discountAmount\":500}");
            Check(Read<Dictionary<Guid,PluginEntry.OrderLoyaltyData>>("BulkaBonusActiveOrders.json")[bonusId].ReservationId==bonus.ReservationId,"bonus reservation persisted before prepare");
            Check(request.RequestUri.AbsolutePath.EndsWith("/prepare"),"bonus payment sends prepare instead of premature commit");
            return Response(HttpStatusCode.OK,"{\"success\":true,\"reservationId\":\""+bonus.ReservationId+"\",\"status\":\"prepared\"}");
        };
        LoyaltyFlow.BeforeProceedOrderPayment(ValueTuple.Create(bonusOrder,View,services.Operations));
        Check(PluginEntry.ActiveOrders.ContainsKey(bonusId),"prepared bonus remains active until the physical order closes");
        http.Reply=request=>request.RequestUri.AbsolutePath.EndsWith("/reserve")?Response(HttpStatusCode.OK,"{\"success\":true,\"reservationId\":\""+bonus.ReservationId+"\",\"discountAmount\":500}"):throw new HttpRequestException("connection lost");
        var stopped=false;try{LoyaltyFlow.BeforeProceedOrderPayment(ValueTuple.Create(bonusOrder,View,services.Operations));}catch(OperationCanceledException){stopped=true;}
        Check(stopped,"bonus payment cannot proceed when prepare response is lost");
        var giftId=Guid.NewGuid();var gift=GiftState();Write("BulkaGiftActiveOrders.json",new Dictionary<Guid,GiftReservationState>{{giftId,gift}});GiftCertificateFlow.RestoreActiveOrders();
        var giftOrder=DiscountedOrder(giftId,"Bulka Gift Certificate");
        http.Reply=request=>{
            Check(Read<Dictionary<Guid,GiftReservationState>>("BulkaGiftActiveOrders.json")[giftId].CommitKey==gift.CommitKey,"gift recovery key persisted before prepare");
            Check(request.RequestUri.AbsolutePath.EndsWith("/gift-cards/prepare"),"gift payment sends prepare instead of premature commit");
            return GiftSuccess(request,"prepared");
        };
        GiftCertificateFlow.BeforeProceedOrderPayment(ValueTuple.Create(giftOrder,View,services.Operations));
        Check((bool)Call(typeof(GiftCertificateFlow),"HasActiveOrder",giftId),"gift replays prepared hold after original local TTL without local rejection");
        http.Reply=request=>throw new HttpRequestException("connection lost");stopped=false;
        try{GiftCertificateFlow.BeforeProceedOrderPayment(ValueTuple.Create(giftOrder,View,services.Operations));}catch(OperationCanceledException){stopped=true;}
        Check(stopped,"gift payment cannot proceed when prepare response is lost");
        http.Reply=request=>Response(HttpStatusCode.OK,"{\"success\":true,\"reservation\":{\"id\":\"wrong\",\"status\":\"prepared\"}}");stopped=false;
        try{GiftCertificateFlow.BeforeProceedOrderPayment(ValueTuple.Create(giftOrder,View,services.Operations));}catch(OperationCanceledException){stopped=true;}
        Check(stopped,"gift refuses a mismatched prepare reservation identity");
    }
    private static void ActiveJournalRecovery()
    {
        foreach(var gift in new[]{false,true})
        {
            var type=gift?typeof(GiftCertificateFlow):typeof(LoyaltyFlow);
            var name=gift?"BulkaGiftActiveOrders.json":"BulkaBonusActiveOrders.json";
            var file=Path.Combine(data,name);
            File.WriteAllText(file,"null");File.WriteAllText(file+".bak","{");
            type.GetMethod("RestoreActiveOrders").Invoke(null,new object[0]);
            var persist=type.GetMethod("PersistActiveOrders",Static|BindingFlags.Public);
            Check(!(bool)persist.Invoke(null,new object[0])&&File.ReadAllText(file)=="null",name+" cannot overwrite corrupted reservations when both durable copies are invalid");
            var order=DiscountedOrder(Guid.NewGuid(),gift?"Bulka Gift Certificate":"Bulka Bonus");
            var calls=http.Calls;var blocked=false;
            try
            {
                if(gift)GiftCertificateFlow.BeforeProceedOrderPayment(ValueTuple.Create(order,View,services.Operations));
                else LoyaltyFlow.BeforeProceedOrderPayment(ValueTuple.Create(order,View,services.Operations));
            }
            catch(OperationCanceledException){blocked=true;}
            Check(blocked&&http.Calls==calls,name+" blocks payment with visible recovery error before making network calls");
            File.WriteAllText(file,"[]");type.GetMethod("RestoreActiveOrders").Invoke(null,new object[0]);
            Check((bool)persist.Invoke(null,new object[0]),name+" resumes after explicit journal repair without restart");
        }
    }
    private static IOrder DiscountedOrder(Guid id,string name)
    {
        var discountType=Proxy.Props(typeof(IDiscountType),new Dictionary<string,object>{{"Id",Guid.NewGuid()},{"Name",name}});
        var element=typeof(IOrder).GetProperty("AppliedDiscounts").PropertyType.GetGenericArguments()[0];
        var discountInterface=element.GetProperty("Discount").PropertyType;
        var discount=Proxy.Props(discountInterface,new Dictionary<string,object>{{"DiscountType",discountType}});
        var applied=Proxy.Props(element,new Dictionary<string,object>{{"Discount",discount},{"DiscountSum",500m}});
        var array=Array.CreateInstance(element,1);array.SetValue(applied,0);
        services.Operations=Proxy.Make<IOperationService>(call=>{
            if(call.MethodName=="GetDiscountTypes")return new[]{(IDiscountType)discountType};
            if(call.MethodName=="GetOrders")return new IOrder[0];
            throw new InvalidOperationException("Unexpected SDK call: "+call.MethodName);
        });
        return (IOrder)Proxy.Props(typeof(IOrder),new Dictionary<string,object>{{"Id",id},{"ResultSum",500m},{"AppliedDiscounts",array}});
    }
}
