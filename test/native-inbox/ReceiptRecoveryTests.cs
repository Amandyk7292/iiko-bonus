using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Serialization;
using Resto.Front.Api;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.IikoBonusPlugin;

internal static partial class Program
{
    private static readonly Type ReceiptWorker=typeof(LoyaltyFlow).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.OnlineReceiptSync",true);
    private static object InvokeReceipt(string name,object instance,params object[] args)
    {
        try {return ReceiptWorker.GetMethod(name,instance==null?Static:Instance).Invoke(instance,args);}
        catch(TargetInvocationException error) {throw error.InnerException;}
    }
    private sealed class RecoveryCase
    {
        internal readonly Guid Id=Guid.NewGuid(),Receipt=Guid.NewGuid(),ProductId=Guid.NewGuid();
        internal int PaymentAdds,PayCalls,TypeReads,Completes,Verifies,Polls,Creates;
        internal bool Closed,Missing,Archived,DeletedPast,WrongPast,RejectComplete,RejectVerify,LostResponse,FailPayment,WrongPayment,NoPayment;
        internal decimal Sum=11680M;
        internal readonly List<string> Calls=new List<string>();
        internal IOrder Order;
        internal IOperationService Operations;
        internal PastOrder Past;
        internal RecoveryCase()
        {
            var product=Proxy.Make<IProduct>(call=>call.MethodName=="get_Id"?ProductId:throw new Exception(call.MethodName));
            var paymentType=Proxy.Make<IPaymentType>(call=>{
                switch(call.MethodName) {
                    case "get_Kind":return PaymentTypeKind.External;
                    case "get_IsEnabled":return false; // Original payment type was disabled after adding payment.
                    case "get_ProcessAsDiscount":return false;
                    default:throw new Exception("Payment type should not be replaced: "+call.MethodName);
                }
            });
            var payment=Proxy.Make<IPaymentItem>(call=>{
                switch(call.MethodName) {
                    case "get_Type":return paymentType;
                    case "get_Sum":return WrongPayment?Sum-1:Sum;
                    case "get_Status":return PaymentStatus.Processed;
                    default:throw new Exception("Payment item: "+call.MethodName);
                }
            });
            var item=Proxy.Make<IOrderProductItem>(call=>{
                switch(call.MethodName) {
                    case "get_Id":return ProductId;
                    case "get_Product":return product;
                    case "get_Amount":return 1M;
                    case "get_Size":return null;
                    case "get_Deleted":return false;
                    case "get_AssignedModifiers":return Array.CreateInstance(((MethodInfo)call.MethodBase).ReturnType.GetGenericArguments()[0],0);
                    default:throw new Exception("Product item: "+call.MethodName);
                }
            });
            Order=Proxy.Make<IOrder>(call=>{
                switch(call.MethodName) {
                    case "get_Id":return Receipt;
                    case "get_Status":return Closed?OrderStatus.Closed:OrderStatus.Bill;
                    case "get_ExternalNumber":return "Bulka №100075";
                    case "get_ResultSum":return Sum;
                    case "get_Payments":return NoPayment?new IPaymentItem[0]:new[]{payment};
                    case "get_Items":return new IOrderRootItem[]{item};
                    default:throw new Exception("Order: "+call.MethodName);
                }
            });
            Past=new PastOrder {
                OrderId=Receipt,ExternalNumber="Bulka №100075",CloseTime=DateTime.Now,
                Items=new List<PastOrderItem>{new PastOrderItem {Product=product,IsMainDish=true,Amount=1M,SumWithDiscounts=Sum}},
                Payments=new[]{new PastOrderPayment {PaymentType=paymentType,Sum=Sum}}
            };
            Operations=Proxy.Make<IOperationService>(call=>{
                switch(call.MethodName) {
                    case "GetHostTerminal":return Proxy.Make(((MethodInfo)call.MethodBase).ReturnType,t=>t.MethodName=="get_Id"?TerminalId:throw new Exception(t.MethodName));
                    case "GetHostTerminalsGroup":return Proxy.Make(((MethodInfo)call.MethodBase).ReturnType,g=>g.MethodName=="get_MainTerminal"?Operations.GetHostTerminal():null);
                    case "TryGetOrderById":
                    case "GetOrderById":Check((Guid)call.Args[0]==Receipt,"recovery always reads the original receipt UUID");return Missing?null:Order;
                    case "GetOrders":return Missing?new IOrder[0]:new[]{Order};
                    case "TryGetOrderExternalDataByKey":return Id.ToString();
                    case "GetPastOrder":
                        Check((Guid)call.Args[0]==Receipt,"archive lookup uses the bound receipt UUID");
                        Past.Deleted=DeletedPast;Past.OrderId=WrongPast?Guid.NewGuid():Receipt;
                        return Archived?Past:null;
                    case "GetDefaultCredentials":return Proxy.Make(((MethodInfo)call.MethodBase).ReturnType,_=>null);
                    case "GetPaymentSystemKey":return "BulkaOnline";
                    case "GetPaymentTypes":TypeReads++;throw new InvalidOperationException("New payments are not configured");
                    case "AddExternalPaymentItem":PaymentAdds++;throw new Exception("Must not add a second payment");
                    case "PayOrder":
                        PayCalls++;
                        Check(((IOrder)call.Args[0]).Id==Receipt && (bool)call.Args[1],"retry pays the same local receipt");
                        if(FailPayment) throw new InvalidOperationException("Cash register locked or unavailable");
                        Closed=true;
                        if(LostResponse) throw new InvalidOperationException("Response lost after fiscalization");
                        return null;
                    case "CreateEditSession":Creates++;throw new Exception("Must not create a replacement receipt");
                    default:throw new Exception("Unexpected SDK operation during recovery: "+call.MethodName);
                }
            });
        }
        internal HttpResponseMessage Reply(HttpRequestMessage request)
        {
            var body=request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if(request.RequestUri.AbsolutePath.EndsWith("/receipts/poll")) {
                Polls++;
                Check(body.Contains("\"orderId\":\""+Id+"\""),"manual recovery requests only the selected online order");
                return Response(HttpStatusCode.OK,"{\"jobs\":[{\"orderId\":\""+Id+"\",\"receiptId\":\""+Receipt+"\",\"number\":100075,\"fiscalDue\":true,\"assemblyStatus\":\"printed\"}]}");
            }
            if(request.RequestUri.AbsolutePath.EndsWith("/receipt-draft"))
                return Response(HttpStatusCode.OK,"{\"id\":\""+Id+"\",\"items\":[{\"key\":\"line\",\"productId\":\""+ProductId+"\",\"quantity\":1}],\"merchandiseTotal\":11680}");
            foreach(var action in new[]{"claim","bind","verify","complete","problem"})
            if(body.Contains("\"action\":\""+action+"\"")) {
                Calls.Add(action);
                if(action=="claim") return Response(HttpStatusCode.OK,"{\"status\":\"assigned\",\"receiptId\":\""+Receipt+"\"}");
                if(action=="verify" || action=="complete") {
                    Check(body.Contains("\"receiptId\":\""+Receipt+"\"") && body.Contains(ProductId.ToString()) && body.Contains("11680"),"server verification receives original UUID, items and paid total");
                    if(action=="verify") Verifies++;else Completes++;
                    if((action=="complete" && RejectComplete) || (action=="verify" && RejectVerify))
                        return Response(HttpStatusCode.Conflict,"{\"error\":\"Server rejected changed/refunded receipt\"}");
                }
                return Response(HttpStatusCode.OK,"{\"status\":\""+(action=="verify"?"verified":action=="complete"?"completed":"assigned")+"\"}");
            }
            throw new Exception("Unexpected receipt request: "+request.RequestUri);
        }
    }
    private static void WithRecovery(Services services,Action<RecoveryCase,object> run)
    {
        var originalOs=services.Operations;
        var pairing=typeof(LoyaltyFlow).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.PosPairing",true);
        var pairingState=pairing.GetField("state",Static);
        var pairingLoaded=pairing.GetField("loaded",Static);
        var previousState=pairingState.GetValue(null);var previousLoaded=pairingLoaded.GetValue(null);
        var paired=Activator.CreateInstance(pairingState.FieldType,true);
        pairingState.FieldType.GetProperty("TerminalId").SetValue(paired,TerminalId.ToString());
        pairingState.FieldType.GetProperty("BranchId").SetValue(paired,Environment.GetEnvironmentVariable("IIKO_BRANCH_ID"));
        pairingState.FieldType.GetProperty("Token").SetValue(paired,new string('b',48));
        pairingState.SetValue(null,paired);pairingLoaded.SetValue(null,true);
        var httpField=typeof(LoyaltyFlow).GetField("_httpClient",Static);
        var originalHttp=httpField.GetValue(null);
        var state=new RecoveryCase();
        using(var client=new HttpClient(new FakeHttp {Reply=state.Reply})) {
            services.Operations=state.Operations;httpField.SetValue(null,client);
            PluginContext.Uninitialize();PluginContext.Initialize(services,()=>{},Proxy.Make<ILog>(_=>null));
            var guardType=typeof(LoyaltyFlow).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.SharedStockGuard",true);
            // This fixture uses existing imported items; no guard timer or stock edit is allowed.
            var guard=FormatterServices.GetUninitializedObject(guardType);
            using(var worker=(IDisposable)Activator.CreateInstance(ReceiptWorker,Instance,null,new object[]{guard,null,false},null))
            try {run(state,worker);Check(state.Creates==0 && state.PaymentAdds==0,"recovery never creates a replacement sale or second payment");}
            finally {
                services.Operations=originalOs;httpField.SetValue(null,originalHttp);pairingState.SetValue(null,previousState);pairingLoaded.SetValue(null,previousLoaded);
                PluginContext.Uninitialize();PluginContext.Initialize(services,()=>{},Proxy.Make<ILog>(_=>null));
            }
        }
    }
    private static void ReceiptRecoveryTests(Services services)
    {
        RetryReceiptInboxAction();
        WithRecovery(services,(state,worker)=>{
            state.NoPayment=true;
            try {InvokeReceipt("ClosePaidReceipt",null,state.Operations,state.Order);throw new Exception("Expected missing type rejection");}catch(InvalidOperationException) { }
            Check(state.TypeReads==1 && state.PayCalls==0,"new payment still requires an enabled configured Bulka type");
        });
        WithRecovery(services,(state,worker)=>{
            var result=(string)InvokeReceipt("RecoverOrder",worker,state.Id.ToString());
            Check(result.Contains("закрыт") && state.PayCalls==1 && state.TypeReads==0 && state.Completes==1 && state.Verifies==1,
                "processed payment on a disabled type is preserved and retried without reading current cashier or adding payment");
            InvokeReceipt("RecoverOrder",worker,state.Id.ToString());
            Check(state.PayCalls==1 && state.Completes==2,"a repeated recovery acknowledges closed receipt without another fiscal payment");
        });
        WithRecovery(services,(state,worker)=>{
            state.LostResponse=true;
            InvokeReceipt("RecoverOrder",worker,state.Id.ToString());
            Check(state.PayCalls==1 && state.Completes==1,"a lost PayOrder response reconciles its already closed receipt");
        });
        WithRecovery(services,(state,worker)=>{
            state.FailPayment=true;
            try {InvokeReceipt("RecoverOrder",worker,state.Id.ToString());throw new Exception("Expected payment failure");}catch(InvalidOperationException) { }
            Check(state.PayCalls==1 && state.Completes==0,"a locked/unavailable register never reports a completed receipt");
            state.FailPayment=false;
            InvokeReceipt("RecoverOrder",worker,state.Id.ToString());
            Check(state.PayCalls==2 && state.Completes==1,"the same pending payment closes after the register becomes available");
        });
        foreach(var guard in new[]{"wrong-payment","refund","busy","archive-missing","archive-deleted","archive-wrong-id"})
        WithRecovery(services,(state,worker)=>{
            state.WrongPayment=guard=="wrong-payment";state.RejectVerify=guard=="refund";
            if(guard.StartsWith("archive")) {state.Missing=true;state.Archived=guard!="archive-missing";state.DeletedPast=guard=="archive-deleted";state.WrongPast=guard=="archive-wrong-id";}
            if(guard=="busy") ReceiptWorker.GetField("busy",Instance).SetValue(worker,1);
            try {InvokeReceipt("RecoverOrder",worker,state.Id.ToString());}catch(InvalidOperationException) { }
            Check(state.PayCalls==0 && state.Completes==0,guard+" cannot pay or complete an unverified receipt");
            if(guard=="busy") Check(state.Polls==0,"manual retry cannot overlap the active background worker");
        });
        WithRecovery(services,(state,worker)=>{
            state.Missing=true;state.Archived=true;
            InvokeReceipt("RecoverOrder",worker,state.Id.ToString());
            Check(state.PayCalls==0 && state.TypeReads==0 && state.Completes==1,"archived original receipt reconciles after shift without a payment type or reprint");
        });
        WithRecovery(services,(state,worker)=>{
            state.Missing=true;state.Archived=true;state.RejectComplete=true;
            try {InvokeReceipt("RecoverOrder",worker,state.Id.ToString());throw new Exception("Expected archive rejection");}catch(InvalidOperationException) { }
            Check(state.PayCalls==0 && state.Completes==1,"archived receipt still requires server ownership, refund, item and total checks");
        });
    }

    private static void RetryReceiptInboxAction()
    {
        var id=Guid.NewGuid().ToString();var callbacks=0;var posts=0;
        using(var loaded=new System.Threading.ManualResetEventSlim())
        using(var handler=new FakeHttp())
        using(var client=new HttpClient(handler))
        {
            handler.Reply=request=>{
                if(request.Method==HttpMethod.Post) posts++;
                Check(request.Method==HttpMethod.Get && request.RequestUri.AbsolutePath.EndsWith("/orders/board"),"receipt retry refreshes the board without replaying acceptance or handover");
                loaded.Set();return Response(HttpStatusCode.OK,"{\"columns\":[{},{},{},{}]}");
            };
            var http=typeof(LoyaltyFlow).GetField("_httpClient",Static);var original=http.GetValue(null);http.SetValue(null,client);
            Action wake=()=>{throw new Exception("Unscoped queue wakeup is forbidden for selected retry");};
            Func<string,string> recover=selected=>{Check(selected==id,"board retry passes the selected order UUID");callbacks++;return "Чек закрыт";};
            using(var inbox=(IDisposable)Activator.CreateInstance(Inbox,Instance,null,new object[]{wake,recover},null))
            try {
                ((System.Threading.Timer)Inbox.GetField("timer",Instance).GetValue(inbox)).Change(System.Threading.Timeout.Infinite,System.Threading.Timeout.Infinite);
                var order=Activator.CreateInstance(Order,true);Order.GetProperty("Id").SetValue(order,id);
                Inbox.GetMethod("Change",Instance).Invoke(inbox,new object[]{order,"retry_receipt"});
                Check(loaded.Wait(TimeSpan.FromSeconds(5)),"selected receipt recovery finishes and refreshes the board");
                var network=(System.Threading.SemaphoreSlim)Inbox.GetField("network",Instance).GetValue(inbox);
                Check(network.Wait(TimeSpan.FromSeconds(5)),"receipt recovery releases board controls");network.Release();
                Check(callbacks==1 && posts==0,"receipt retry executes exactly once without a commercial state transition");
            } finally {http.SetValue(null,original);}
        }
    }
}
