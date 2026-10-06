using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Serialization.Json;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.IikoBonusPlugin;
using Resto.Front.Api.UI;

internal static partial class Program
{
    private static Type AutomaticWorker => Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.OnlineReceiptSync",true);
    private static Type AutomaticJob => Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.AutomaticReceiptJob",true);

    private sealed class ReceiptState
    {
        internal string Assembly="pending";
        internal int Claims,Binds,AssemblyClaims,AssemblyAcknowledgements,FiscalSdkCalls,PaymentTypeReads;
        internal bool RejectNextAssemblyClaim;
        internal int DraftReads;
        internal string CompleteStatus="completed";
        internal readonly List<string> Calls=new List<string>();
    }

    private static object RuntimeProxy(Type type,Func<IMethodCallMessage,object> call) =>
        typeof(Proxy).GetMethod("Make",Static).MakeGenericMethod(type).Invoke(null,new object[]{call});

    // Decorate the existing printer mock rather than replacing its observed
    // queue/section/device behavior with a permissive alternate printer.
    private static IOperationService ReceiptOperations(IOperationService original,ReceiptState state)
    {
        var order=Proxy.Make<IOrder>(call=>
        {
            switch(call.MethodName)
            {
                case "get_Id":return frontOrderId;
                case "get_Number":return 42;
                case "get_Tables":return new[]{table};
                case "get_Status":return OrderStatus.New;
                case "get_ExternalNumber":return "Bulka:"+orderId;
                case "get_Items":return new IOrderRootItem[0];
                case "get_ResultSum":return 0M;
                default:throw new InvalidOperationException("Unexpected receipt order read: "+call.MethodName);
            }
        });
        return Proxy.Make<IOperationService>(call=>
        {
            switch(call.MethodName)
            {
                case "GetHostTerminalsGroup":
                    var returnType=((MethodInfo)call.MethodBase).ReturnType;
                    return RuntimeProxy(returnType,item=>item.MethodName=="get_MainTerminal" ? original.GetHostTerminal() : null);
                case "IsConnectedToMainTerminal":return true;
                case "TryGetOrderById":
                    if((Guid)call.Args[0]!=frontOrderId) throw new InvalidOperationException("Wrong bound front order");
                    return order;
                case "GetOrders":return new[]{order};
                case "TryGetOrderExternalDataByKey":return orderId;
                case "GetPaymentTypes":
                    state.PaymentTypeReads++;
                    return new[]{Proxy.Make<IPaymentType>(payment=>
                    {
                        switch(payment.MethodName)
                        {
                            case "get_Kind":return PaymentTypeKind.External;
                            case "get_IsEnabled":return true;
                            case "get_ProcessAsDiscount":return false;
                            default:throw new InvalidOperationException("Unexpected payment-type read: "+payment.MethodName);
                        }
                    })};
                case "GetPaymentSystemKey":return "BulkaOnline";
                case "AddExternalPaymentItem":
                case "PayOrder":
                    state.FiscalSdkCalls++;
                    throw new InvalidOperationException("Financial SDK must not run during acceptance");
                default:
                    try {return call.MethodBase.Invoke(original,call.Args);}
                    catch(TargetInvocationException error) {throw error.InnerException;}
            }
        });
    }

    private static HttpResponseMessage ReceiptReply(HttpRequestMessage request,ReceiptState state)
    {
        var path=request.RequestUri.AbsolutePath;
        if(path.EndsWith("/receipts/poll"))
            return Json("{\"jobs\":[{\"orderId\":\""+orderId+"\",\"receiptId\":\""+frontOrderId+
                "\",\"number\":1057,\"fiscalDue\":false,\"assemblyStatus\":\""+state.Assembly+"\"}]}");
        if(path.EndsWith("/receipt-draft"))
        {
            state.DraftReads++;
            return Json("{\"id\":\""+(draftMismatch?Guid.NewGuid().ToString():orderId)+"\",\"pickupPhotoId\":"+
                (noPhoto?"null":"\""+photoId+"\"")+",\"items\":[{\"name\":\"Test\",\"quantity\":1}]}");
        }
        if(!path.EndsWith("/receipts/action")) throw new InvalidOperationException("Unexpected receipt endpoint: "+path);
        ActionBody action;
        using(var stream=request.Content.ReadAsStreamAsync().Result)
            action=(ActionBody)new DataContractJsonSerializer(typeof(ActionBody)).ReadObject(stream);
        if(action.Order!=orderId || action.Terminal!=TerminalId.ToString())
            throw new InvalidOperationException("Receipt claim must match its paired terminal and Bulka order");
        state.Calls.Add(action.Action);
        switch(action.Action)
        {
            case "claim":state.Claims++;return Json("{\"status\":\"assigned\",\"receiptId\":\""+frontOrderId+"\"}");
            case "bind":state.Binds++;return Json("{\"status\":\"assigned\"}");
            case "assembly-claim":
                state.AssemblyClaims++;
                if(state.RejectNextAssemblyClaim)
                {state.RejectNextAssemblyClaim=false;return Json("{\"error\":\"temporary assembly claim failure\"}",HttpStatusCode.ServiceUnavailable);}
                if(state.Assembly!="pending") throw new InvalidOperationException("Second assembly claim must not print");
                state.Assembly="printing";return Json("{\"status\":\"print\"}");
            case "assembly-complete":
                state.AssemblyAcknowledgements++;
                if(state.Assembly!="printing" && state.Assembly!="printed") throw new InvalidOperationException("Assembly ACK lacks prior claim");
                state.Assembly="printed";return Json("{\"status\":\"printed\"}");
            case "complete":return Json("{\"status\":\""+state.CompleteStatus+"\"}");
            default:throw new InvalidOperationException("Unexpected receipt action: "+action.Action);
        }
    }

    private static object NewAutomatic(object photos) =>
        Activator.CreateInstance(AutomaticWorker,Instance,null,new object[]{null,photos,false},null);

    private static bool ProcessAutomatic(object automatic,ReceiptState state,bool fiscalDue=false)
    {
        var job=Activator.CreateInstance(AutomaticJob);
        foreach(var value in new Dictionary<string,object>
        {
            {"OrderId",orderId},{"ReceiptId",frontOrderId.ToString()},{"Number",1057L},
            {"FiscalDue",fiscalDue},{"AssemblyStatus",state.Assembly}
        }) AutomaticJob.GetProperty(value.Key).SetValue(job,value.Value);
        try {return (bool)Call(AutomaticWorker,"Process",automatic,job,services.Operations);}
        catch(TargetInvocationException error) {throw error.InnerException;}
    }

    private static void WithReceiptScenario(Action<ReceiptState,object,object> run,bool mapped=true)
    {
        var originalOperations=services.Operations;
        var httpField=typeof(LoyaltyFlow).GetField("_httpClient",Static);
        var originalHttp=(HttpClient)httpField.GetValue(null);
        var directoryField=typeof(LoyaltyFlow).GetField("DataDirectory",Static);
        var originalDirectory=(string)directoryField.GetValue(null);
        var originalData=data;
        var originalEnvironment=Environment.GetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR");
        object photos=null,automatic=null;
        HttpClient replacement=null;
        try
        {
            // Corruption tests intentionally retain their damaged primary files.
            // Give every integration scenario a fresh directory, preserving all
            // earlier evidence rather than repairing/deleting it for this test.
            data=Path.Combine(originalData,"receipt-integration-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(data);
            Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR",data);
            // The production setting is captured once by LoyaltyFlow's static
            // initializer; changing only the environment cannot isolate it.
            directoryField.SetValue(null,data);
            Scenario(mapped);
            var state=new ReceiptState();
            services.Operations=ReceiptOperations(originalOperations,state);
            replacement=new HttpClient(new FakeHttp{Reply=request=>ReceiptReply(request,state)});
            httpField.SetValue(null,replacement);
            photos=NewWorker();automatic=NewAutomatic(photos);
            run(state,photos,automatic);
        }
        finally
        {
            if(automatic!=null) Dispose(automatic);
            if(photos!=null) Dispose(photos);
            services.Operations=originalOperations;
            httpField.SetValue(null,originalHttp);
            replacement?.Dispose();
            directoryField.SetValue(null,originalDirectory);
            data=originalData;
            Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR",originalEnvironment);
        }
    }

    private static void PhotoFirstIntegration()
    {
        WithReceiptScenario((state,photos,automatic)=>
        {
            var accepted=ProcessAutomatic(automatic,state);
            if(!accepted)
                Console.WriteLine("INTEGRATION acceptance pending: "+AutomaticWorker.GetProperty("StatusText",Instance).GetValue(automatic)+
                    "; photo="+Worker.GetProperty("StatusText",Instance).GetValue(photos)+
                    "; claims="+claims+"; photoPrints="+printed+"; assemblyPrints="+assemblyPrints+
                    "; healthy="+Worker.GetField("storageHealthy",Instance).GetValue(photos));
            Check(accepted,"real automatic acceptance completes its available stages");
            Check(printSequence.SequenceEqual(new[]{"photo","assembly"}) && printTargets.All(id=>id==BillDeviceId),
                "real OnlineReceiptSync prints PHOTO then ASSEMBLY on the same observed physical device");
            Check(claims==1 && printed==1 && assemblyPrints==1 && state.AssemblyClaims==1,
                "photo-first acceptance uses one photo claim and one assembly claim");
            Check(state.PaymentTypeReads==0 && state.FiscalSdkCalls==0 && !state.Calls.Contains("verify"),
                "acceptance does not run payment verification or fiscal SDK operations");
            Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==1,
                "a repeated automatic poll cannot duplicate either strip");
            var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
            try
            {
                RestartRoutes();
                Check(ProcessAutomatic(restarted,state) && printed==1 && assemblyPrints==1,
                    "persisted automatic receipt and photo evidence survive a full worker/route restart");
            }
            finally {Dispose(restarted);Dispose(restartedPhotos);}
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            failAck=true;
            Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==1 && status=="printing",
                "lost photo ACK preserves physical proof and permits only the following assembly");
            var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
            try
            {
                RestartRoutes();Tick(restartedPhotos);
                Check(ProcessAutomatic(restarted,state) && printed==1 && assemblyPrints==1 && claims==1 && status=="printed",
                    "restart retries the lost photo ACK without repeating photo or assembly");
            }
            finally {Dispose(restarted);Dispose(restartedPhotos);}
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            state.RejectNextAssemblyClaim=true;
            var rejected=false;
            try {ProcessAutomatic(automatic,state);} catch(InvalidOperationException error) {rejected=error.Message.Contains("temporary assembly");}
            Check(rejected && printed==1 && assemblyPrints==0 && status=="printed",
                "an assembly claim failure occurs after durable photo proof and before assembly dispatch");
            var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
            try
            {
                RestartRoutes();
                Check(ProcessAutomatic(restarted,state) && printed==1 && claims==1 && assemblyPrints==1 &&
                    printSequence.SequenceEqual(new[]{"photo","assembly"}),
                    "restart between photo and assembly retains the reserved route and never repeats the photo");
            }
            finally {Dispose(restarted);Dispose(restartedPhotos);}
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            noPhoto=true;
            Check(ProcessAutomatic(automatic,state) && printed==0 && claims==0 && assemblyPrints==1,
                "ordinary no-photo acceptance retains the existing assembly queue path");
            Check(ProcessAutomatic(automatic,state) && assemblyPrints==1 && state.FiscalSdkCalls==0,
                "ordinary no-photo repeated polls do not duplicate assembly or fiscalize early");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
                Check(lease!=null && !ProcessAutomatic(automatic,state) && claims==0 && state.AssemblyClaims==0 && assemblyPrints==0,
                    "a busy shared printer prevents both claims without bypassing photo-first order");
            Check(ProcessAutomatic(automatic,state) && printSequence.SequenceEqual(new[]{"photo","assembly"}),
                "releasing a busy printer resumes the ordered photo/assembly sequence");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            failDownload=true;
            Check(!ProcessAutomatic(automatic,state) && printed==0 && assemblyPrints==0 && releases==1 && state.AssemblyClaims==0,
                "definite photo preparation failure releases only the photo claim and blocks assembly");
            failDownload=false;
            Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==1 && claims==2,
                "definite pre-dispatch recovery prints one photo then one assembly");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            failPrinter=true;
            Check(!ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==0 && state.AssemblyClaims==0 && status=="uncertain",
                "an uncertain physical photo result blocks assembly and retains irreversible print evidence");
            failPrinter=false;
            Check(!ProcessAutomatic(automatic,state) && printed==1 && claims==1 && assemblyPrints==0,
                "automatic retry cannot replay an uncertain photo or bypass it with assembly");
            var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
            try
            {
                RestartRoutes();Tick(restartedPhotos);
                Check(!ProcessAutomatic(restarted,state) && printed==1 && claims==1 && assemblyPrints==0,
                    "uncertain photo tombstones still block automatic assembly after restart");
            }
            finally {Dispose(restarted);Dispose(restartedPhotos);}
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            suppressCallback=true;
            Check(!ReadyAfterProbe(),"missing physical route evidence never advertises a photo target");
            Check(!ProcessAutomatic(automatic,state) && claims==0 && printed==0 && state.AssemblyClaims==0 && assemblyPrints==0,
                "a queue without physical route proof cannot claim photo or start assembly");
        },false);

        WithReceiptScenario((state,photos,automatic)=>
        {
            status="printed";
            Check(!ProcessAutomatic(automatic,state) && printed==0 && assemblyPrints==0 && state.AssemblyClaims==0,
                "server printed status alone cannot replace this terminal's durable physical proof");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            status="uncertain";
            Worker.GetField("busy",Instance).SetValue(photos,1);
            var reachedFinancialImport=false;
            using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
            {
                Check(lease!=null,"handover fixture keeps the optional printer busy");
                // The guard is intentionally null. Its exact dereference is the
                // boundary of this orchestration test, not a fiscal SDK mock.
                // Reaching it proves no optional photo/assembly wait intercepted
                // handover; fiscal correctness is covered by receipt tests.
                try {ProcessAutomatic(automatic,state,true);}
                catch(NullReferenceException) {reachedFinancialImport=true;}
            }
            var saved=((IDictionary)AutomaticWorker.GetField("ledger",Instance).GetValue(automatic))[orderId];
            Check(reachedFinancialImport && state.Claims==1 && state.Binds==1 && state.DraftReads==0 && state.PaymentTypeReads==1,
                "fiscal-due handover reaches financial import despite a busy worker and uncertain optional photo");
            Check(printed==0 && claims==0 && assemblyPrints==0 && state.AssemblyClaims==0 &&
                !(bool)AutomaticJob.GetProperty("AssemblyPrinted").GetValue(saved),
                "handover never prints a late photo/assembly or invents assembly completion proof");
            Worker.GetField("busy",Instance).SetValue(photos,0);
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            noPhoto=true;
            var reachedFinancialImport=false;
            using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
            {
                Check(lease!=null,"ordinary handover fixture keeps the optional printer busy");
                try {ProcessAutomatic(automatic,state,true);}
                catch(NullReferenceException) {reachedFinancialImport=true;}
            }
            var saved=((IDictionary)AutomaticWorker.GetField("ledger",Instance).GetValue(automatic))[orderId];
            Check(reachedFinancialImport && state.Claims==1 && state.Binds==1 && state.DraftReads==0 && state.PaymentTypeReads==1,
                "ordinary fiscal-due handover reaches financial import without waiting for a missed assembly");
            Check(printed==0 && claims==0 && assemblyPrints==0 && state.AssemblyClaims==0 &&
                !(bool)AutomaticJob.GetProperty("AssemblyPrinted").GetValue(saved),
                "ordinary handover does not start a late assembly or fabricate print proof");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            var confirmations=0;var errors=0;
            var view=Proxy.Make<IViewManager>(call=>
            {
                if(call.MethodName=="ShowOkCancelPopup") {confirmations++;return true;}
                if(call.MethodName=="ShowErrorPopup") {errors++;return null;}
                throw new InvalidOperationException("Unexpected recovery popup: "+call.MethodName);
            });
            Call(AssemblyTicket,"Reprint",null,TestOrder(),services.Operations,view,photos);
            Check(confirmations==1 && errors==1 && printed==0 && assemblyPrints==0 && claims==0 && state.Claims==0 && state.AssemblyClaims==0,
                "manual pending-photo assembly cannot bypass the missing durable photo proof, even after user confirmation");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            Check(Attempt(photos)=="Printed" && printed==1 && status=="printed",
                "manual recovery fixture has a physically printed and durably acknowledged photo");
            printResult=false;
            var failedAssembly=false;
            try {ProcessAutomatic(automatic,state);}
            catch(InvalidOperationException error) {failedAssembly=error.Message.Contains("Принтер не подтвердил сборочный чек");}
            Check(failedAssembly && printed==1 && assemblyPrints==1 && state.Assembly=="printing" && state.AssemblyAcknowledgements==0,
                "negative assembly SDK completion retains the original photo proof and requires explicit recovery");
            printResult=true;
            var confirmations=0;var errors=0;
            var view=Proxy.Make<IViewManager>(call=>
            {
                if(call.MethodName=="ShowOkCancelPopup") {confirmations++;return true;}
                if(call.MethodName=="ShowErrorPopup") {errors++;return null;}
                throw new InvalidOperationException("Unexpected recovery popup: "+call.MethodName);
            });
            Call(AssemblyTicket,"Reprint",null,TestOrder(),services.Operations,view,photos);
            Check(confirmations==1 && errors==0 && printed==1 && assemblyPrints==2 && claims==1 && state.Assembly=="printed" &&
                state.AssemblyAcknowledgements==1 && printTargets.All(id=>id==BillDeviceId),
                "explicit manual assembly recovery uses the pinned original physical device and never repeats the photo");
            Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==2 && state.AssemblyClaims==1,
                "automatic polls respect the manually recovered assembly confirmation without reprinting");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            Check(Attempt(photos)=="Printed","completed-order retirement fixture retains a printed photo tombstone");
            var routeKey=BranchId+"|"+TerminalId+"|"+orderId;
            var ledgerCount=Ledger(photos).Count;
            var order=services.Operations.TryGetOrderById(frontOrderId);
            state.CompleteStatus="processing";
            var rejected=false;
            try {Call(AutomaticWorker,"CompleteReceipt",null,services.Operations,orderId,order);}
            catch(TargetInvocationException error) {rejected=error.InnerException is InvalidOperationException;}
            Check(rejected && RouteBindings().Contains(routeKey) && Ledger(photos).Contains(orderId),
                "an unconfirmed fiscal completion cannot discard the reserved photo route or tombstone");
            state.CompleteStatus="completed";
            Call(AutomaticWorker,"CompleteReceipt",null,services.Operations,orderId,order);
            Check(!RouteBindings().Contains(routeKey) && Ledger(photos).Contains(orderId) && Ledger(photos).Count==ledgerCount && printed==1 && claims==1,
                "server-confirmed completed order retires its exact route without erasing photo proof or printing again");
        });
    }
}
