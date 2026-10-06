using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Remoting.Proxies;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml.Linq;
using Resto.Front.Api;
using Resto.Front.Api.Data.Device;
using Resto.Front.Api.Data.Device.Settings;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Organization.Sections;

using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Print;
using Resto.Front.Api.IikoBonusPlugin;

internal sealed class Proxy : RealProxy
{
    private readonly Func<IMethodCallMessage,object> call;
    private Proxy(Type type,Func<IMethodCallMessage,object> call):base(type){this.call=call;}
    internal static T Make<T>(Func<IMethodCallMessage,object> call) where T:class => (T)new Proxy(typeof(T),call).GetTransparentProxy();
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
internal sealed class Disposable:IDisposable
{
    private readonly Action action;
    internal Disposable(Action action){this.action=action;}
    public void Dispose(){action();}
}
internal sealed class FakeHttp:HttpMessageHandler
{
    internal Func<HttpRequestMessage,HttpResponseMessage> Reply;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
    {
        try{return Task.FromResult(Reply(request));}catch(Exception error){return Task.FromException<HttpResponseMessage>(error);}
    }
}
[DataContract] internal sealed class ActionBody
{
    [DataMember(Name="action")] public string Action {get;set;}
    [DataMember(Name="terminalId")] public string Terminal {get;set;}
    [DataMember(Name="orderId")] public string Order {get;set;}
}
internal static partial class Program
{
    private const BindingFlags Static=BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public;
    private const BindingFlags Instance=BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public;
    private static readonly Assembly Plugin=typeof(LoyaltyFlow).Assembly;
    private static readonly Type Worker=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoSync",true);
    private static readonly Type Raster=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoRaster",true);
    private static readonly Type Routes=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoRoutes",true);
    private static readonly Type AssemblyTicket=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.AssemblyTicket",true);
    private static readonly Guid TerminalId=Guid.NewGuid(),BranchId=Guid.NewGuid(),PrinterId=Guid.NewGuid(),
        BillPrinterId=Guid.NewGuid(),DocumentPrinterId=Guid.NewGuid(),BillDeviceId=Guid.NewGuid(),DocumentDeviceId=Guid.NewGuid(),SectionId=Guid.NewGuid();
    private static Guid frontOrderId;
    private static IRestaurantSection section;
    private static ITable table;
    private static Func<ValueTuple<Guid,Document>,Document> beforeFormat;
    private static readonly object callbackGate=new object();
    private static readonly List<Func<ValueTuple<Guid,Document>,Document>> formatCallbacks=new List<Func<ValueTuple<Guid,Document>,Document>>();
    private static int callbackRegistrations,callbackDisposals;
    private static bool registrationThrows,registrationReturnsNull,queuePrinterThrows;
    private static ManualResetEvent registrationWait,registrationEntered;
    private static DateTime? retryNow;
    private static IDisposable routeSubscription;
    private static int probePrints,assemblyPrints;
    private static readonly List<string> printSequence=new List<string>();
    private static readonly List<Guid> printTargets=new List<Guid>();
    private static bool suppressCallback,multipleTargets;
    private static bool deferProbeCallback;
    private static int queueReturns;
    private static DeferredQueueFormat deferredProbe;
    private static IPointOfSale[] configuredHostPoints=new IPointOfSale[0];
    private static Guid? receiptDeviceTerminal;
    private static Guid? absentReceiptDevice;
    private static bool wrongReceiptDevice;
    private static int receiptDeviceReads;
    private static bool rejectLegacyRouting;
    private static int legacyRouteReads;
    private static bool draftMismatch,noPhoto;
    private static Guid? terminalOverride;
    private static ManualResetEvent probeGate;
    private static readonly Services services=new Services();
    private static readonly PrinterDriverParameters driver=new PrinterDriverParameters();
    private static readonly PrinterDriverParameters billDriver=new PrinterDriverParameters(),documentDriver=new PrinterDriverParameters();
    private static string data,orderId,photoId,status;
    private static byte[] image;
    private static int printed,completed,claims,releases,httpCalls,assertions,receiptQueries;
    private static bool failAck,failDownload,failPrinter,failClaim,badHash,printerPresent=true,printResult=true;
    private static bool handoverAfterDownload,handedOver;
    private static bool billPresent,documentPresent,receiptQueryFails;
    private static Guid lastPrintedPrinter;
    private static ManualResetEvent printGate;
    private static void Check(bool value,string label){if(!value)throw new Exception(label);assertions++;Console.WriteLine("PASS: "+label);}
    private static object Call(Type type,string name,object target,params object[] args)=>type.GetMethod(name,target==null?Static:Instance).Invoke(target,args);
    private static object NewWorker(int timeout=30)=>Activator.CreateInstance(Worker,Instance,null,new object[]{false,timeout},null);
    private static void Tick(object worker)=>Call(Worker,"Tick",worker,new object[]{null});
    private static IOrder TestOrder()=>Proxy.Make<IOrder>(call=>call.MethodName=="get_Id" ? (object)frontOrderId :
        call.MethodName=="get_Number" ? 42 : call.MethodName=="get_Tables" ? new[]{table} :
        call.MethodName=="get_ExternalNumber" ? "Bulka:"+orderId : null);
    private static object Selection()
    {
        var args=new object[]{services.Operations,TestOrder(),orderId,photoId,1057L,null,null,null};
        return (bool)Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoPrinter",true)
            .GetMethods(Static).Single(method=>method.Name=="TryPrepareForOrder" && method.GetParameters()[1].ParameterType==typeof(IOrder))
            .Invoke(null,args) ? args[5] : null;
    }
    private static string Attempt(object worker)
    {
        var selected=Selection();if(selected==null) return "Pending";
        using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
            return lease==null ? "Pending" : Call(Worker,"BeforeAssembly",worker,services.Operations,orderId,photoId,1057L,selected,lease).ToString();
    }
    private static void Dispose(object worker)=>((IDisposable)worker).Dispose();
    private static IDisposable RegisterCallback(Func<ValueTuple<Guid,Document>,Document> callback)
    {
        Interlocked.Increment(ref callbackRegistrations);
        var entered=registrationEntered;var waiting=registrationWait;
        entered?.Set();waiting?.WaitOne();
        if(registrationThrows) throw new IOException("Fake registration unavailable before any print");
        if(registrationReturnsNull) return null;
        lock(callbackGate) {formatCallbacks.Add(callback);beforeFormat=callback;}
        return new Disposable(()=>
        {
            Interlocked.Increment(ref callbackDisposals);
            lock(callbackGate)
            {
                formatCallbacks.Remove(callback);
                if(beforeFormat==callback) beforeFormat=formatCallbacks.LastOrDefault();
            }
        });
    }
    private static Document FormatDocument(Guid target,Document document)
    {
        Func<ValueTuple<Guid,Document>,Document>[] callbacks;
        lock(callbackGate) callbacks=formatCallbacks.ToArray();
        var formatted=document;
        foreach(var callback in callbacks) formatted=callback((target,formatted)) ?? formatted;
        return formatted;
    }
    private sealed class DeferredQueueFormat
    {
        internal readonly Document Original;
        internal readonly Guid Target;
        private readonly Func<ValueTuple<Guid,Document>,Document> originalObserver;
        internal DeferredQueueFormat(Document original,Guid target)
        {
            Original=original;Target=target;originalObserver=beforeFormat;
        }
        // Bill/document queues can acknowledge submission before they format it.
        // Each physical target receives the original document, including its nonce.
        internal Document Observe(Guid? target=null,bool oldObserver=false) => Task.Run(()=>
            oldObserver ? originalObserver((target??Target,Original)) : FormatDocument(target??Target,Original)).GetAwaiter().GetResult();
        internal Document ObserveOldHandler(Document newerDocument) => Task.Run(()=>originalObserver((Target,newerDocument))).GetAwaiter().GetResult();
    }
    private static bool PrintBusy => (bool)Routes.GetProperty("PrintBusy",Static).GetValue(null);
    private static DeferredQueueFormat PendingQueueFormat()
    {
        WaitUntil(()=>Volatile.Read(ref deferredProbe)!=null && Volatile.Read(ref queueReturns)>0,"queue SDK returned before callback");
        var pending=Volatile.Read(ref deferredProbe);
        // Give the production continuation a chance to process the positive SDK
        // return; the callback has not been invoked on any thread yet.
        Thread.Sleep(30);return pending;
    }
    private static IPointOfSale ReceiptPoint(Guid? target,bool virtualRegister=true,bool nullRegister=false,bool isDefault=false,
        Guid? pointId=null,Guid? registerId=null)
    {
        var id=pointId??Guid.NewGuid();var cashId=registerId??Guid.NewGuid();
        var cash=nullRegister ? null : Proxy.Make<ICashRegisterInfo>(call=>
        {
            switch(call.MethodName)
            {
                case "get_Id":return cashId;
                case "get_IsVirtual":return virtualRegister;
                case "get_VirtualChequePrinterId":return target;
                default:throw new Exception("Unexpected configured cash-register read: "+call.MethodName);
            }
        });
        return Proxy.Make<IPointOfSale>(call=>
        {
            switch(call.MethodName)
            {
                case "get_Id":return id;
                case "get_CashRegister":return cash;
                case "get_IsDefault":return isDefault;
                default:throw new Exception("Unexpected configured POS read: "+call.MethodName);
            }
        });
    }
    private static void ConfigureReceipt(Guid? target=null)
    {
        configuredHostPoints=new[]{ReceiptPoint(target??PrinterId),ReceiptPoint(target??PrinterId)};
        receiptDeviceTerminal=TerminalId;
    }
    private static int ActiveCallbacks {get {lock(callbackGate) return formatCallbacks.Count;}}
    private static void UseRetryClock()
    {
        retryNow=DateTime.UtcNow;
        Routes.GetField("utcNow",Static).SetValue(null,new Func<DateTime>(()=>retryNow ?? DateTime.UtcNow));
    }
    private static void AdvanceRetryClock(int seconds) {retryNow=retryNow.Value.AddSeconds(seconds);}
    private static bool PrinterReady() => (bool)Call(Worker,"PrinterReady",null,services.Operations);
    private static bool RegistrationBusy => (bool)Routes.GetProperty("RegistrationBusy",Static).GetValue(null);
    private static string StartupDiagnostic => (string)Routes.GetProperty("DiagnosticStatus",Static).GetValue(null);
    private static string ReadinessDiagnostic => (string)Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoPrinter",true)
        .GetProperty("ReadinessDiagnostic",Static).GetValue(null);
    private static void WaitUntil(Func<bool> condition,string label)
    {
        if(!SpinWait.SpinUntil(condition,3000)) throw new Exception("Timed out: "+label);
    }
    private static HttpResponseMessage Json(string body,HttpStatusCode code=HttpStatusCode.OK)=>new HttpResponseMessage(code){Content=new StringContent(body,Encoding.UTF8,"application/json")};
    private static string Success(string state)=>"{\"success\":true,\"status\":\""+state+"\",\"number\":1057,\"photoId\":\""+photoId+"\"}";
    private static void SetDriver(bool images=true,int? width=384)
        => SetDriverParameters(driver,images,width);
    private static void SetDriverParameters(PrinterDriverParameters target,bool images=true,int? width=384,int left=0,int right=0)
    {
        target.GetType().GetProperty("CanPrintImage").SetValue(target,images);
        target.GetType().GetProperty("PageWidth").SetValue(target,width);
        target.GetType().GetProperty("MarginLeft").SetValue(target,left);
        target.GetType().GetProperty("MarginRight").SetValue(target,right);
    }
    private static byte[] Png(int width=384,int height=32,bool gray=false)
    {
        var pixels=new byte[width*height];
        for(var i=0;i<pixels.Length;i++)pixels[i]=gray?(byte)128:(i%2==0?(byte)0:(byte)255);
        var frame=BitmapFrame.Create(BitmapSource.Create(width,height,96,96,PixelFormats.Gray8,null,pixels,width));
        var encoder=new PngBitmapEncoder();encoder.Frames.Add(frame);
        using(var output=new MemoryStream()){encoder.Save(output);return output.ToArray();}
    }
    private static void RestartRoutes(int timeout=30)
    {
        routeSubscription?.Dispose();routeSubscription=(IDisposable)Call(Routes,"Start",null,services.Operations,timeout);
        // Most fixtures need the initial observer to be registered. Intentional
        // registration barriers must remain asynchronous so receipt readiness
        // and stale/disposed-owner fences can be tested while the SDK is hung.
        if(registrationWait==null) WaitUntil(()=>!RegistrationBusy,"initial startup observer registration");
    }
    private static void LearnAssembly()
    {
        var order=TestOrder();
        var queue=Call(AssemblyTicket,"Printer",null,services.Operations,order);
        Call(AssemblyTicket,"Print",null,services.Operations,queue,order,1057L,orderId,false,null,null);
    }
    private static bool ReadyAfterProbe()
    {
        Call(Worker,"PrinterReady",null,services.Operations);
        SpinWait.SpinUntil(()=>!(bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),3000);
        SpinWait.SpinUntil(()=>(bool)Call(Worker,"PrinterReady",null,services.Operations) ||
            (!((bool)Routes.GetProperty("PrintBusy",Static).GetValue(null)) &&
             !((IDictionary)Routes.GetField("probes",Static).GetValue(null)).Values.Cast<object>()
                .Any(state=>(string)state=="print_in_progress")),3000);
        return (bool)Call(Worker,"PrinterReady",null,services.Operations);
    }
    private static void Scenario(bool mapped=true)
    {
        orderId=Guid.NewGuid().ToString();photoId=Guid.NewGuid().ToString();status="pending";
        printed=completed=claims=releases=httpCalls=0;failAck=failDownload=failPrinter=failClaim=badHash=false;printResult=true;
        printerPresent=true;billPresent=true;documentPresent=receiptQueryFails=false;receiptQueries=0;lastPrintedPrinter=Guid.Empty;
        probePrints=assemblyPrints=0;printSequence.Clear();printTargets.Clear();suppressCallback=multipleTargets=false;probeGate=null;frontOrderId=Guid.NewGuid();
        deferProbeCallback=false;queueReturns=0;deferredProbe=null;
        configuredHostPoints=new IPointOfSale[0];receiptDeviceTerminal=TerminalId;absentReceiptDevice=null;wrongReceiptDevice=false;receiptDeviceReads=0;
        rejectLegacyRouting=false;legacyRouteReads=0;
        draftMismatch=noPhoto=false;terminalOverride=null;
        registrationThrows=registrationReturnsNull=queuePrinterThrows=false;registrationWait=registrationEntered=null;
        retryNow=null;
        Routes.GetField("beforeProbe",Static).SetValue(null,null);
        handoverAfterDownload=handedOver=false;
        printGate=null;image=Png();SetDriver();SetDriverParameters(billDriver);SetDriverParameters(documentDriver);
        Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS",null);
        RestartRoutes();if(mapped) {ReadyAfterProbe();Selection();}
    }
    private static HttpResponseMessage Reply(HttpRequestMessage request)
    {
        httpCalls++;
        if(request.RequestUri.Host!="audit.invalid" || request.Headers.Authorization?.Scheme!="Bearer"
            || request.Headers.Authorization.Parameter!=new string('p',48)
            || request.Headers.GetValues("X-Bulka-Branch-Id").Single()!=BranchId.ToString()
            || request.Headers.GetValues("X-Bulka-Terminal-Id").Single()!=TerminalId.ToString())
            throw new Exception("Wrong private POS request credentials");
        var path=request.RequestUri.AbsolutePath;
        if(path.EndsWith("/poll")) return handedOver ? Json("{\"success\":true,\"jobs\":[]}") :
            Json("{\"success\":true,\"jobs\":[{\"orderId\":\""+orderId+"\",\"photoId\":\""+photoId+"\",\"number\":1057,\"status\":\""+status+"\"}]}");
        if(path.EndsWith("/image"))
        {
            if(!request.RequestUri.Query.Contains("widthDots=384")) throw new Exception("Unbounded image width");
            if(failDownload) return Json("{}",HttpStatusCode.ServiceUnavailable);
            if(handoverAfterDownload) handedOver=true;
            var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(image)};
            response.Content.Headers.ContentType=new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
            response.Headers.TryAddWithoutValidation("X-Content-SHA256",badHash?new string('0',64):(string)Call(Raster,"Hash",null,image));
            return response;
        }
        if(path.EndsWith("/action"))
        {
            ActionBody action;
            using(var stream=request.Content.ReadAsStreamAsync().Result)
                action=(ActionBody)new DataContractJsonSerializer(typeof(ActionBody)).ReadObject(stream);
            if(action.Order!=orderId || action.Terminal!=TerminalId.ToString()) throw new Exception("Wrong print job");
            switch(action.Action)
            {
                case "claim": claims++;if(status!="pending")return Json(Success("uncertain"));status="printing";if(failClaim)throw new TaskCanceledException();return Json(Success("print"));
                case "release":releases++;status="pending";return Json(Success(status));
                case "uncertain":status="uncertain";return Json(Success(status));
                case "complete":completed++;if(failAck){failAck=false;return Json("{}",HttpStatusCode.ServiceUnavailable);}status="printed";return Json(Success(status));
            }
        }
        throw new Exception("Unexpected photo API request");
    }
    [STAThread] private static void Main(string[] args)
    {
        if(args.Length>0 && args[0]=="--validate-image")
        {
            if(args.Length!=3 || !int.TryParse(args[2],out var width) || (width!=384 && width!=576))
                throw new ArgumentException("Use --validate-image <private PNG fixture> <384|576>.");
            if(new FileInfo(args[1]).Length>500*1024) throw new InvalidDataException("Fixture exceeds the bounded private image size.");
            var document=(Document)Call(Raster,"Prepare",null,File.ReadAllBytes(args[1]),width);
            var raster=Convert.FromBase64String(document.Markup.Element("image").Value);
            Check(BitConverter.ToInt32(raster,18)==width && BitConverter.ToInt16(raster,28)==1,"actual server PNG converts to an exact-width 1-bit SDK image");
            Check(document.Markup.Name=="doc" && !document.Markup.Descendants("fiscal").Any(),"actual server image stays a separate non-fiscal document");
            Console.WriteLine("PASS: server strip interoperability; width "+width+", height "+BitConverter.ToInt32(raster,22)+"; no physical printer.");
            return;
        }
        data=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"state-"+Guid.NewGuid());Directory.CreateDirectory(data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR",data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_API_BASE_URL","https://audit.invalid/api/loyalty");
        var terminal=Proxy.Make<ITerminal>(call=>call.MethodName=="get_Id"?(object)(terminalOverride??TerminalId):null);
        var printer=Proxy.Make<IPrinterQueueRef>(call=>call.MethodName=="get_Id"?(object)PrinterId:true);
        var bill=Proxy.Make<IPrinterQueueRef>(call=>call.MethodName=="get_Id"?(object)BillPrinterId:true);
        var documentPrinter=Proxy.Make<IPrinterQueueRef>(call=>call.MethodName=="get_Id"?(object)DocumentPrinterId:true);
        Func<IMethodCallMessage,Guid,object> deviceRead=(call,id)=>call.MethodName=="get_Id" ? (object)id :
            call.MethodName=="get_RelatedTerminal" ? (receiptDeviceTerminal.HasValue ?
                Proxy.Make<ITerminal>(read=>read.MethodName=="get_Id"?(object)receiptDeviceTerminal.Value:null) : null) : null;
        var device=Proxy.Make<IPrintingDeviceInfo>(call=>deviceRead(call,PrinterId));
        var billDevice=Proxy.Make<IPrintingDeviceInfo>(call=>deviceRead(call,BillDeviceId));
        var documentDevice=Proxy.Make<IPrintingDeviceInfo>(call=>deviceRead(call,DocumentDeviceId));
        section=Proxy.Make<IRestaurantSection>(call=>call.MethodName=="get_Id"?(object)SectionId:null);
        table=Proxy.Make<ITable>(call=>call.MethodName=="get_IsActive"?(object)true:call.MethodName=="get_RestaurantSection"?section:null);
        services.Operations=Proxy.Make<IOperationService>(call=>{
            switch(call.MethodName)
            {
                case "GetHostTerminal":return terminal;
                case "GetHostTerminalPointsOfSale":return configuredHostPoints;
                case "GetHostTerminalRestaurantSections":legacyRouteReads++;if(rejectLegacyRouting)throw new Exception("Configured receipt must not inspect unrelated assembly section");return new[]{section};
                case "GetTables":legacyRouteReads++;if(rejectLegacyRouting)throw new Exception("Configured receipt must not inspect unrelated assembly table");return new[]{table};
                case "RegisterBeforeFormatDocumentHandler":return RegisterCallback((Func<ValueTuple<Guid,Document>,Document>)call.Args[0]);
                case "TryGetReceiptChequePrinter":receiptQueries++;if(receiptQueryFails)throw new IOException("Receipt query failed");return printerPresent?printer:null;
                case "TryGetBillPrinter":legacyRouteReads++;if(rejectLegacyRouting)throw new Exception("Configured receipt must not inspect unrelated bill queue");if(call.Args[0]!=section || !(bool)call.Args[1])throw new Exception("Wrong automatic assembly section");return billPresent?bill:null;
                case "TryGetDocumentPrinter":legacyRouteReads++;if(rejectLegacyRouting)throw new Exception("Configured receipt must not inspect unrelated document queue");if(call.Args[0]!=section || !(bool)call.Args[1])throw new Exception("Wrong automatic assembly section");return documentPresent?documentPrinter:null;
                case "GetPrintingDeviceInfos":return new[]{device,documentDevice,billDevice};
                case "TryGetPrintingDeviceInfoById":
                    receiptDeviceReads++;
                    var requested=(Guid)call.Args[0];
                    if(configuredHostPoints==null || configuredHostPoints.Length==0 || requested==BillPrinterId || requested==DocumentPrinterId)
                        throw new Exception("Queue UUID must not be used as physical printer UUID");
                    if(absentReceiptDevice==requested)return null;
                    if(wrongReceiptDevice)return documentDevice;
                    if(requested==PrinterId)return device;
                    if(requested==BillDeviceId)return billDevice;
                    if(requested==DocumentDeviceId)return documentDevice;
                    return null;
                case "GetPrinterDriverParameters":return ((IPrintingDeviceInfo)call.Args[0]).Id==BillDeviceId?billDriver:((IPrintingDeviceInfo)call.Args[0]).Id==DocumentDeviceId?documentDriver:driver;
                case "Print":
                    var payload=(Document)call.Args[1];
                    var markup=payload.Markup;
                    if(call.Args[0] is IPrinterQueueRef queue)
                    {
                        if(call.Args.Length!=3 || !(bool)call.Args[2])throw new Exception("Assembly/probe must wait for printer completion");
                        var target=queue.Id==BillPrinterId?BillDeviceId:DocumentDeviceId;
                        var serviceProbe=markup.Value.Contains("проверка фотопечати");
                        if(serviceProbe && deferProbeCallback)
                            Interlocked.Exchange(ref deferredProbe,new DeferredQueueFormat(payload,target));
                        else if(!suppressCallback)
                        {
                            var formatted=FormatDocument(target,payload);
                            if(multipleTargets)FormatDocument(PrinterId,payload);
                            if(formatted!=null)markup=formatted.Markup;
                            if(markup.Descendants("section").Any())throw new Exception("Private route marker leaked to paper");
                        }
                        if(serviceProbe){Interlocked.Increment(ref probePrints);probeGate?.WaitOne();}
                        else Interlocked.Increment(ref assemblyPrints);
                        if(queuePrinterThrows) throw new IOException("Fake queue printer failed after dispatch");
                        Interlocked.Increment(ref queueReturns);
                        return printResult;
                    }
                    if(call.Args.Length!=2)throw new Exception("Physical photo/assembly target uses bool-returning SDK overload");
                    var actual=((IPrintingDeviceInfo)call.Args[0]).Id;
                    var physicalFormatted=FormatDocument(actual,payload);
                    if(physicalFormatted!=null)markup=physicalFormatted.Markup;
                    if(markup.Descendants("section").Any())throw new Exception("Private route marker leaked to paper");
                    if(markup.Element("image")==null)
                    {
                        Interlocked.Increment(ref assemblyPrints);lock(printSequence){printSequence.Add("assembly");printTargets.Add(actual);}
                        return printResult;
                    }
                    Interlocked.Increment(ref printed);
                    lastPrintedPrinter=actual;lock(printSequence){printSequence.Add("photo");printTargets.Add(actual);}
                    var photo=markup.Element("image");
                    if(photo==null || markup.Descendants("fiscal").Any())throw new Exception("Separate non-fiscal raster missing");
                    var bytes=Convert.FromBase64String(photo.Value);
                    if(bytes[0]!=66 || bytes[1]!=77 || BitConverter.ToInt16(bytes,28)!=1)
                        throw new Exception("SDK image must be 1-bit BMP");
                    printGate?.WaitOne();
                    if(failPrinter)throw new IOException("Fake printer failed after start");
                    return printResult;
                default:throw new Exception("Unexpected SDK operation: "+call.MethodName);
            }
        });
        PluginContext.Initialize(services,()=>{},Proxy.Make<ILog>(call=>null));
        var pairing=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PosPairing",true);
        var pairType=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PosPairingState",true);
        var state=Activator.CreateInstance(pairType);
        pairType.GetProperty("TerminalId").SetValue(state,TerminalId.ToString());
        pairType.GetProperty("BranchId").SetValue(state,BranchId.ToString());
        pairType.GetProperty("Token").SetValue(state,new string('p',48));
        pairing.GetField("state",Static).SetValue(null,state);pairing.GetField("loaded",Static).SetValue(null,true);
        Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoTransport",true).GetField("client",Static)
            .SetValue(null,new HttpClient(new FakeHttp{Reply=Reply}));
        typeof(LoyaltyFlow).GetField("_httpClient",Static).SetValue(null,new HttpClient(new FakeHttp{Reply=request=>
            Json("{\"id\":\""+(draftMismatch?Guid.NewGuid().ToString():orderId)+"\",\"pickupPhotoId\":"+(noPhoto?"null":"\""+photoId+"\"")+",\"items\":[{\"name\":\"Test\",\"quantity\":1}]}")}));
        var waitField=Routes.GetField("observationWaitMilliseconds",Static);
        var settleField=Routes.GetField("observationSettleMilliseconds",Static);
        var originalWait=waitField.GetValue(null);var originalSettle=settleField.GetValue(null);
        try
        {
            waitField.SetValue(null,600);settleField.SetValue(null,50);
            RasterBounds();PrinterCapability();RouteFailures();StartupRecovery();DelayedQueueCallbacks();ConfiguredReceiptPaths();PrintAndAck();PrintFailures();PreparationRecovery();FreshDispatchGuard();LostClaim();Timeout();LedgerRetention();RouteStorage();CorruptJournal();
            PhotoFirstIntegration();
            Check(Plugin.GetName().Version.ToString(3)=="1.14.5","configured receipt recovery and delayed callbacks have version 1.14.5");
            Console.WriteLine("PASS: "+assertions+" photo-print assertions; intercepted HTTP and SDK only, no physical printer.");
        }
        finally
        {
            waitField.SetValue(null,originalWait);settleField.SetValue(null,originalSettle);
            PluginContext.Uninitialize();
        }
    }
    private static bool Reject(byte[] bytes,int width=384)
    {
        try{Call(Raster,"Prepare",null,bytes,width);return false;}catch(TargetInvocationException){return true;}
    }
    private static void RasterBounds()
    {
        Scenario();var document=(Document)Call(Raster,"Prepare",null,image,384);
        var bmp=Convert.FromBase64String(document.Markup.Element("image").Value);
        Check(BitConverter.ToInt32(bmp,18)==384 && BitConverter.ToInt32(bmp,22)==32,"monochrome strip preserves dimensions");
        Check(BitConverter.ToInt16(bmp,28)==1,"thermal strip uses exactly one bit per dot");
        Check(Reject(new byte[600*1024]),"oversized response rejected before decode");
        Check(Reject(Png(384,1801)),"excessive pixel height rejected before decode");
        Check(Reject(Png(576)),"wrong requested width cannot clip narrow paper");
        Check(Reject(Png(gray:true)),"undithered gray/color input rejected");
        Check(Reject(Encoding.UTF8.GetBytes("not PNG")),"malformed image rejected");
        Check(Reject(image,512),"only bounded 384/576 widths accepted");
    }
    private static void PrinterCapability()
    {
        Scenario(false);Check(ReadyAfterProbe(),"one non-fiscal probe resolves automatic assembly queue to a distinct physical UUID");
        Check(probePrints==1 && assemblyPrints==0 && printed==0 && receiptQueries==0,"startup probe submits only one service strip, without fiscal/receipt calls");
        Check(ReadyAfterProbe() && probePrints==1,"every heartbeat reuses confirmed route without another probe");
        SetDriverParameters(billDriver,false);Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"text-only assembly driver never falls back to another image-capable printer");
        SetDriverParameters(billDriver,true,300);Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"too-narrow assembly printer does not enable customer photo offer");
        SetDriverParameters(billDriver);billPresent=false;Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"missing assembly queue does not select the fiscal printer");
        billPresent=true;Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS","576");
        Check((int)Call(Worker,"PrintableWidth",null,services.Operations)==384,"58mm actual printer safely caps configured 576-dot image");
        SetDriverParameters(billDriver,true,576);Check((int)Call(Worker,"PrintableWidth",null,services.Operations)==576,"80mm actual printer can use configured 576-dot image");
        SetDriverParameters(billDriver,true,null);Check((int)Call(Worker,"PrintableWidth",null,services.Operations)==384,"unknown page width never authorizes a 576-dot image");
        Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS","999");Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"invalid local paper width fails closed");
        Scenario(false);billPresent=false;documentPresent=true;
        Check(ReadyAfterProbe(),"automatic assembly document fallback is observed when its bill queue is absent");
        SetDriverParameters(documentDriver,true,400,10,10);
        Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"physical printable width subtracts both margins");
        Scenario();var worker=NewWorker();SetDriverParameters(billDriver,false);
        var readiness=new object[]{services.Operations,null};
        Check((string)Worker.GetMethod("ReadinessStatus",Instance).Invoke(worker,readiness)=="image_unsupported" && readiness[1]==null,
            "unsupported configured assembly image driver is diagnosed without false readiness");
        SetDriverParameters(billDriver);readiness=new object[]{services.Operations,null};
        Check((string)Worker.GetMethod("ReadinessStatus",Instance).Invoke(worker,readiness)=="ready" &&
            (string)readiness[1].GetType().GetProperty("Kind",Instance).GetValue(readiness[1])=="device",
            "readiness describes the observed physical device");
        using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
        {
            Check((bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker) &&
                (string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="ready",
                "brief ordinary printer activity queues work without blinking the customer photo offer");
            Tick(worker);Check(claims==0 && printed==0,"busy shared printer gate blocks photo polling and claims");
        }
        Dispose(worker);
    }
    private static void RouteFailures()
    {
        Scenario(false);printResult=false;Check(!ReadyAfterProbe(),"negative control-print completion never confirms a route");
        printResult=true;Check(!ReadyAfterProbe() && probePrints==1,"failed probe is not automatically replayed by heartbeats");
        var worker=NewWorker();Tick(worker);Check(claims==0 && printed==0,"timer cannot start a new photo even after control-route proof");Dispose(worker);
        Scenario(false);suppressCallback=true;Check(!ReadyAfterProbe(),"successful SDK return without physical callback observation fails closed");
        Scenario(false);multipleTargets=true;Check(!ReadyAfterProbe(),"one assembly route reporting multiple physical devices fails closed");
        Scenario();multipleTargets=true;LearnAssembly();
        Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"an ambiguous newer observation invalidates previously confirmed readiness");
        Scenario(false);probeGate=new ManualResetEvent(false);RestartRoutes(1);
        Call(Worker,"PrinterReady",null,services.Operations);
        SpinWait.SpinUntil(()=>probePrints==1,3000);Thread.Sleep(1200);
        worker=NewWorker();Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"timed-out probe retains its shared flight and disables new photo offers");
        Tick(worker);Check(claims==0 && printed==0,"hung probe never takes a photo claim or overlaps another SDK print");
        for(var i=0;i<3;i++)Call(Worker,"PrinterReady",null,services.Operations);
        Check(probePrints==1,"hung service probe is submitted once per startup route");
        probeGate.Set();SpinWait.SpinUntil(()=>!(bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),3000);Thread.Sleep(30);
        Check(!ReadyAfterProbe() && probePrints==1,"late probe completion does not turn an uncertain strip into authorization");
        Dispose(worker);probeGate.Dispose();probeGate=null;
        Scenario();RestartRoutes();worker=NewWorker();Attempt(worker);
        Check(printed==1 && lastPrintedPrinter==BillDeviceId,"restart restores reserved exact order-to-physical-printer mapping before assembly");Dispose(worker);
        Scenario(false);printResult=false;try{LearnAssembly();}catch(TargetInvocationException){}
        printResult=true;worker=NewWorker();Tick(worker);Check(claims==0 && printed==0,"failed ordinary assembly print cannot persist a photo route");Dispose(worker);
        Scenario();photoId=Guid.NewGuid().ToString();worker=NewWorker();Tick(worker);
        Check(printed==0 && claims==0,"changed attachment UUID cannot use another photo's assembly binding");Dispose(worker);
        Scenario();var pairType=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PosPairingState",true);
        var pair=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PosPairing",true).GetField("state",Static).GetValue(null);
        pairType.GetProperty("BranchId").SetValue(pair,Guid.NewGuid().ToString());
        var selection=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoPrinter",true);
        var args=new object[]{services.Operations,orderId,photoId,1057L,null,null};
        Check(!(bool)selection.GetMethod("TrySelectForOrder",Static).Invoke(null,args),"re-pairing another branch cannot reuse historical order mapping");
        pairType.GetProperty("BranchId").SetValue(pair,BranchId.ToString());
        terminalOverride=Guid.NewGuid();args=new object[]{services.Operations,orderId,photoId,1057L,null,null};
        Check(!(bool)selection.GetMethod("TrySelectForOrder",Static).Invoke(null,args),"another terminal cannot reuse the same branch's order binding");terminalOverride=null;
        Scenario(false);draftMismatch=true;try{LearnAssembly();}catch(TargetInvocationException){}
        Check(assemblyPrints==0,"mismatched receipt draft identity is rejected before ordinary SDK print");
        Scenario();LearnAssembly();billPresent=false;documentPresent=true;LearnAssembly();worker=NewWorker();Tick(worker);
        args=new object[]{services.Operations,orderId,photoId,1057L,null,null};
        Check((bool)selection.GetMethod("TrySelectForOrder",Static).Invoke(null,args) &&
            ((IPrintingDeviceInfo)args[4].GetType().GetProperty("Printer",Instance).GetValue(args[4])).Id==BillDeviceId,
            "manual assembly reprint after route change retains original physical route evidence");
        Check(printed==0,"legacy assembly-first order is never automatically given a late photo");Dispose(worker);
    }
    private static void StartupRecovery()
    {
        RegistrationRecovery();

        Scenario(false);UseRetryClock();suppressCallback=true;printResult=false;
        Check(!ReadyAfterProbe() && probePrints==1,"a definite SDK false without physical observation leaves startup mapping unavailable");
        Check(StartupDiagnostic?.StartsWith("probe_negative_unobserved")==true && StartupDiagnostic.Contains("retry=pending")
            && ReadinessDiagnostic==StartupDiagnostic,"definite startup failure exposes a fixed retryable stage in readiness diagnostics");
        printResult=true;suppressCallback=false;
        Parallel.For(0,12,_=>PrinterReady());
        Check(probePrints==1,"concurrent heartbeats cannot retry a definite startup failure before its deadline");
        AdvanceRetryClock(29);PrinterReady();
        Check(probePrints==1,"definite startup probe retry preserves the full initial thirty-second spacing");
        AdvanceRetryClock(1);
        Check(ReadyAfterProbe() && probePrints==2,"a delayed definite startup retry recovers the exact physical assembly printer");
        Check(StartupDiagnostic==null && ReadinessDiagnostic==null,"successful definite startup recovery clears stale printer diagnostics");
        Check(printed==0 && assemblyPrints==0 && claims==0 && httpCalls==0 && ActiveCallbacks==1,
            "startup recovery emits no customer photo, order claim or assembly and retains one observer");

        Scenario(false);UseRetryClock();suppressCallback=true;printResult=false;
        Check(!ReadyAfterProbe() && probePrints==1,"bounded startup retry begins with one definite no-observation failure");
        AdvanceRetryClock(30);ReadyAfterProbe();
        Check(probePrints==2,"definite startup retry permits one second attempt after thirty seconds");
        AdvanceRetryClock(59);PrinterReady();
        Check(probePrints==2,"a second definite failure waits sixty seconds before the final retry");
        AdvanceRetryClock(1);ReadyAfterProbe();
        Check(probePrints==3,"definite startup retry reaches its third bounded attempt");
        AdvanceRetryClock(3600);printResult=true;suppressCallback=false;
        Parallel.For(0,12,_=>PrinterReady());
        Check(!ReadyAfterProbe() && probePrints==3,"exhausted definite startup failures never create an unbounded service-strip loop");
        Check(StartupDiagnostic?.Contains("retry=exhausted")==true,"bounded startup failure exposes exhausted retry state without hiding its cause");

        foreach(var mode in new[]{"observed_false","unobserved_true","exception","ambiguous"})
        {
            Scenario(false);UseRetryClock();
            printResult=mode!="observed_false";suppressCallback=mode=="unobserved_true";
            queuePrinterThrows=mode=="exception";multipleTargets=mode=="ambiguous";
            Check(!ReadyAfterProbe() && probePrints==1,"uncertain startup result fails closed: "+mode);
            Check(StartupDiagnostic?.Contains("retry=blocked")==true && !StartupDiagnostic.Contains(orderId)
                && !StartupDiagnostic.Contains(photoId) && !StartupDiagnostic.Contains(new string('p',48)) && !StartupDiagnostic.Contains("Fake"),
                "uncertain startup diagnostic is blocked and excludes raw SDK/customer/credential values: "+mode);
            printResult=true;suppressCallback=queuePrinterThrows=multipleTargets=false;
            foreach(var delay in new[]{30,60,3600})
            {
                AdvanceRetryClock(delay);Parallel.For(0,8,_=>PrinterReady());
                Check(!ReadyAfterProbe() && probePrints==1,"uncertain startup result never auto-replays after delayed heartbeats: "+mode+"/"+delay);
            }
        }

        Scenario(false);UseRetryClock();
        var queue=Call(AssemblyTicket,"Printer",null,services.Operations,TestOrder());
        var doc=new XElement("doc",new XElement("center","Stale generation fixture"));
        var oldObservation=Call(Routes,"Attach",null,queue,doc);var oldCallback=beforeFormat;
        RestartRoutes();
        var formatted=oldCallback((BillDeviceId,(Document)doc));
        Call(Routes,"Complete",null,oldObservation,true,null,null,0L,null);
        Check(ActiveCallbacks==1 && oldCallback!=beforeFormat &&
            formatted==null &&
            ((IDictionary)Routes.GetField("confirmed",Static).GetValue(null)).Count==0,
            "an old-generation callback cannot mutate metadata, confirm or revive the current printer route");
        var currentDoc=new XElement("doc",new XElement("center","Current generation fixture"));
        var currentObservation=Call(Routes,"Attach",null,queue,currentDoc);
        Check(oldCallback((PrinterId,(Document)currentDoc))==null && currentDoc.Descendants("section").Any(),
            "a stale chained callback leaves the current generation's route marker for its active observer");
        formatted=beforeFormat((BillDeviceId,(Document)currentDoc));
        Call(Routes,"Complete",null,currentObservation,false,null,null,0L,null);
        Check(formatted!=null && !formatted.Markup.Descendants("section").Any(),
            "the active callback observes and removes its own generation's route metadata");
        Check(ReadyAfterProbe() && probePrints==1,"only the current registered observer can recover a new startup route");
        DeferredProbeRecovery();
    }
    private static void RegistrationRecovery()
    {
        foreach(var failure in new[]{"throw","null"})
        {
            Scenario(false);UseRetryClock();var initial=callbackRegistrations;
            registrationThrows=failure=="throw";registrationReturnsNull=failure=="null";RestartRoutes();
            Check(routeSubscription!=null && ActiveCallbacks==0 && callbackRegistrations==initial+1 && !PrinterReady(),
                "startup registration "+failure+" retains a disposable recovery owner without printer readiness");
            Check(StartupDiagnostic?.StartsWith("callback_registration_failed")==true && StartupDiagnostic.Contains("retry=pending")
                && ReadinessDiagnostic==StartupDiagnostic && !StartupDiagnostic.Contains("Fake") && !StartupDiagnostic.Contains(orderId),
                "registration "+failure+" reports only a fixed failure stage and retry state");
            registrationThrows=registrationReturnsNull=false;
            Parallel.For(0,12,_=>PrinterReady());AdvanceRetryClock(29);PrinterReady();
            Check(callbackRegistrations==initial+1 && probePrints==0,"registration "+failure+" cannot loop before its thirty-second deadline");
            AdvanceRetryClock(1);PrinterReady();
            WaitUntil(()=>callbackRegistrations==initial+2 && !RegistrationBusy,"registration recovery "+failure);
            Check(ReadyAfterProbe() && ActiveCallbacks==1 && callbackRegistrations==initial+2 && probePrints==1,
                "registration "+failure+" recovers later with one observer and one exact-route probe");
            Check(StartupDiagnostic==null && ReadinessDiagnostic==null,"registration "+failure+" recovery clears prior readiness diagnostics");
            Parallel.For(0,12,_=>PrinterReady());
            Check(callbackRegistrations==initial+2 && probePrints==1 && assemblyPrints==0 && printed==0 && claims==0,
                "registered recovery stays stable without duplicate subscriptions or customer work");
        }

        Scenario(false);UseRetryClock();registrationThrows=true;var baseline=callbackRegistrations;RestartRoutes();
        AdvanceRetryClock(30);PrinterReady();WaitUntil(()=>callbackRegistrations==baseline+2 && !RegistrationBusy,"second failed registration");
        AdvanceRetryClock(59);PrinterReady();
        Check(callbackRegistrations==baseline+2,"second registration failure waits sixty seconds before its final attempt");
        AdvanceRetryClock(1);PrinterReady();WaitUntil(()=>callbackRegistrations==baseline+3 && !RegistrationBusy,"third failed registration");
        AdvanceRetryClock(3600);registrationThrows=false;Parallel.For(0,12,_=>PrinterReady());
        Check(!PrinterReady() && callbackRegistrations==baseline+3 && ActiveCallbacks==0 && probePrints==0,
            "failed callback registration is capped at three attempts per startup generation");

        Scenario(false);UseRetryClock();registrationReturnsNull=true;RestartRoutes();registrationReturnsNull=false;
        using(var waiting=new ManualResetEvent(false))
        using(var entered=new ManualResetEvent(false))
        {
            registrationWait=waiting;registrationEntered=entered;AdvanceRetryClock(30);PrinterReady();
            WaitUntil(()=>entered.WaitOne(0),"registration blocked before disposal");
            var registrations=callbackRegistrations;var disposals=callbackDisposals;
            routeSubscription.Dispose();routeSubscription=null;registrationWait=registrationEntered=null;waiting.Set();
            WaitUntil(()=>callbackDisposals>disposals && ActiveCallbacks==0,"disposed late callback registration");
            AdvanceRetryClock(3600);Parallel.For(0,12,_=>PrinterReady());
            Check(!PrinterReady() && callbackRegistrations==registrations && ActiveCallbacks==0 && probePrints==0,
                "a late successful registration after disposal is immediately removed and cannot revive readiness");
        }

        Scenario(false);UseRetryClock();registrationReturnsNull=true;RestartRoutes();registrationReturnsNull=false;
        using(var waiting=new ManualResetEvent(false))
        using(var entered=new ManualResetEvent(false))
        {
            registrationWait=waiting;registrationEntered=entered;AdvanceRetryClock(30);PrinterReady();
            WaitUntil(()=>entered.WaitOne(0),"old registration blocked before newer Start");
            registrationWait=registrationEntered=null;RestartRoutes();
            var disposals=callbackDisposals;waiting.Set();
            WaitUntil(()=>callbackDisposals>disposals && ActiveCallbacks==1,"stale registration removed after newer Start");
            Check(ReadyAfterProbe() && ActiveCallbacks==1 && probePrints==1 && printed==0 && assemblyPrints==0,
                "a stale registration return cannot replace or dispose the new generation's observer");
        }
    }
    private static void DeferredProbeRecovery()
    {
        foreach(var replacement in new[]{"dispose","restart"})
        {
            Scenario(false);UseRetryClock();
            using(var waiting=new ManualResetEvent(false))
            using(var entered=new ManualResetEvent(false))
            {
                Routes.GetField("beforeProbe",Static).SetValue(null,new Action(()=>{entered.Set();waiting.WaitOne();}));
                try
                {
                    PrinterReady();WaitUntil(()=>entered.WaitOne(0),"queued probe before "+replacement);
                    Check((bool)Routes.GetProperty("PrintBusy",Static).GetValue(null) && probePrints==0,
                        "a queued startup probe holds one lease before any SDK dispatch: "+replacement);
                    Routes.GetField("beforeProbe",Static).SetValue(null,null);
                    if(replacement=="restart") RestartRoutes();
                    else {routeSubscription.Dispose();routeSubscription=null;}
                    PrinterReady();
                    Check(probePrints==0,"a replaced queued probe cannot overlap new startup work: "+replacement);
                    waiting.Set();WaitUntil(()=>!(bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),"stale queued probe exits");
                    Check(probePrints==0 && ((IDictionary)Routes.GetField("confirmed",Static).GetValue(null)).Count==0,
                        "a stale queued probe never attaches or dispatches under the newer generation: "+replacement);
                    if(replacement=="restart")
                        Check(ReadyAfterProbe() && probePrints==1 && ActiveCallbacks==1,
                            "the replacement startup recovers only through its own observer and single service probe");
                    else
                    {
                        AdvanceRetryClock(3600);PrinterReady();
                        Check(probePrints==0 && ActiveCallbacks==0,"disposing queued startup work cannot trigger a late retry or callback");
                    }
                }
                finally
                {
                    Routes.GetField("beforeProbe",Static).SetValue(null,null);waiting.Set();
                    WaitUntil(()=>!(bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),"queued probe cleanup");
                }
            }
        }

        Scenario(false);UseRetryClock();
        using(var waiting=new ManualResetEvent(false))
        {
            probeGate=waiting;RestartRoutes(1);PrinterReady();WaitUntil(()=>probePrints==1,"physical startup probe in flight");
            Thread.Sleep(1200);RestartRoutes(1);Parallel.For(0,8,_=>PrinterReady());
            Check(probePrints==1 && (bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),
                "timeout plus restart retains the actual SDK lease and cannot submit a competing strip");
            waiting.Set();WaitUntil(()=>!(bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),"old physical probe exits");
            Check(((IDictionary)Routes.GetField("confirmed",Static).GetValue(null)).Count==0,
                "late old-generation physical completion cannot authorize the new startup route");
            probeGate=null;
            Check(ReadyAfterProbe() && probePrints==2 && assemblyPrints==0 && printed==0,
                "after the old SDK call ends only the new startup's independent service probe can recover readiness");
        }
    }
    private static void DelayedQueueCallbacks()
    {
        var waitField=Routes.GetField("observationWaitMilliseconds",Static);
        var settleField=Routes.GetField("observationSettleMilliseconds",Static);
        var oldWait=waitField.GetValue(null);var oldSettle=settleField.GetValue(null);
        try
        {
            waitField.SetValue(null,1500);settleField.SetValue(null,350);
            Scenario(false);deferProbeCallback=true;UseRetryClock();PrinterReady();
            var pending=PendingQueueFormat();
            Check(PrintBusy && !PrinterReady() && probePrints==1,
                "positive queue SDK return retains the shared lease until its delayed physical callback arrives");
            using(var competing=(IDisposable)Call(Routes,"TryReservePrint",null))
                Check(competing==null,"photo and assembly cannot reserve a competing print while queue observation is pending");
            var worker=NewWorker();Tick(worker);Attempt(worker);Dispose(worker);
            Parallel.For(0,12,_=>PrinterReady());
            Check(probePrints==1 && printed==0 && assemblyPrints==0 && claims==0 && httpCalls==0,
                "delayed callback wait emits no repeat probe, photo, assembly or order claim under concurrent readiness checks");
            var unrelated=(Document)new XElement("doc",new XElement("center","Unrelated ordinary document"));
            FormatDocument(BillDeviceId,unrelated);
            Check(!PrinterReady() && PrintBusy,"a physical callback without this probe's nonce cannot confirm its route");
            var formatted=pending.Observe();
            Check(formatted!=null && !formatted.Markup.Descendants("section").Any() && pending.Original.Markup.Descendants("section").Any(),
                "delayed formatting strips the private nonce from paper while preserving the original fan-out document");
            Thread.Sleep(180);pending.Observe();Thread.Sleep(200);
            Check(!PrinterReady() && PrintBusy,"a repeated same-device callback resets the quiet observation interval before readiness");
            Check(ReadyAfterProbe() && probePrints==1 && Selection()!=null && StartupDiagnostic==null,
                "delayed same-device queue callbacks resolve one exact physical printer without another SDK print");
            Check(printed==0 && assemblyPrints==0 && claims==0 && httpCalls==0,
                "route confirmation after delayed callbacks remains independent of customer order printing");

            Scenario(false);billPresent=false;documentPresent=true;deferProbeCallback=true;PrinterReady();
            pending=PendingQueueFormat();pending.Observe();
            Check(ReadyAfterProbe() && probePrints==1 && pending.Target==DocumentDeviceId && Selection()!=null,
                "a document queue's delayed callback confirms its own physical device rather than a receipt or bill printer");

            foreach(var second in new[]{PrinterId,Guid.Empty})
            {
                Scenario(false);deferProbeCallback=true;UseRetryClock();PrinterReady();pending=PendingQueueFormat();
                pending.Observe();Thread.Sleep(500);pending.Observe(second);
                Check(!ReadyAfterProbe() && !PrintBusy && probePrints==1 && StartupDiagnostic?.Contains("retry=blocked")==true,
                    "a second physical target after the quiet interval but before deadline still makes the probe unavailable: "+(second==Guid.Empty?"empty":"different"));
                AdvanceRetryClock(3600);deferProbeCallback=false;Parallel.For(0,12,_=>PrinterReady());
                Check(!ReadyAfterProbe() && probePrints==1 && printed==0 && assemblyPrints==0 && claims==0,
                    "ambiguous delayed physical callbacks never auto-replay a service or customer strip");
            }

            foreach(var missing in new[]{"callback","marker"})
            {
                Scenario(false);deferProbeCallback=true;UseRetryClock();PrinterReady();pending=PendingQueueFormat();
                if(missing=="marker") FormatDocument(BillDeviceId,unrelated);
                Check(!ReadyAfterProbe() && !PrintBusy && probePrints==1 && StartupDiagnostic?.Contains("retry=blocked")==true,
                    "positive SDK submission with a missing "+missing+" expires its bounded observation wait");
                pending.Observe();AdvanceRetryClock(3600);deferProbeCallback=false;Parallel.For(0,12,_=>PrinterReady());
                Check(!ReadyAfterProbe() && probePrints==1 && printed==0 && assemblyPrints==0 && claims==0,
                    "a callback arriving after observation expiry cannot authorize or replay the positive submission: "+missing);
            }

            Scenario(false);deferProbeCallback=true;UseRetryClock();PrinterReady();pending=PendingQueueFormat();
            using(var stop=new CancellationTokenSource())
            {
                var observed=0;
                var callbacks=Task.Run(()=>
                {
                    while(!stop.IsCancellationRequested)
                    {
                        pending.Observe();Interlocked.Increment(ref observed);Thread.Sleep(80);
                    }
                });
                try
                {
                    Check(!ReadyAfterProbe() && observed>2 && StartupDiagnostic?.StartsWith("probe_callback_unsettled")==true && probePrints==1,
                        "repeated same-device callbacks cannot extend the bounded observation deadline indefinitely");
                }
                finally {stop.Cancel();callbacks.GetAwaiter().GetResult();}
            }
            AdvanceRetryClock(3600);pending.Observe();
            Check(!ReadyAfterProbe() && probePrints==1,"an unsettled positive probe never auto-replays or accepts a post-expiry callback");

            foreach(var replacement in new[]{"dispose","restart"})
            {
                Scenario(false);deferProbeCallback=true;UseRetryClock();PrinterReady();pending=PendingQueueFormat();
                Check(PrintBusy,"a pending delayed callback owns the print lease before "+replacement);
                if(replacement=="restart") RestartRoutes();
                else {routeSubscription.Dispose();routeSubscription=null;}
                WaitUntil(()=>!PrintBusy,"replaced delayed queue observation exits");
                var stale=pending.Observe(oldObserver:true);
                Check(stale==null && ((IDictionary)Routes.GetField("confirmed",Static).GetValue(null)).Count==0,
                    "a delayed captured callback from the replaced generation cannot strip or confirm current metadata: "+replacement);
                if(replacement=="restart")
                {
                    // The active observer may still see an old printer job. Its
                    // expired nonce must not count as a new route observation.
                    pending.Observe();PrinterReady();
                    WaitUntil(()=>probePrints==2 && !ReferenceEquals(Volatile.Read(ref deferredProbe),pending),"replacement queue probe dispatched");
                    var current=PendingQueueFormat();
                    Check(pending.ObserveOldHandler(current.Original)==null && current.Original.Markup.Descendants("section").Any(),
                        "a stale queue callback leaves the replacement probe's nonce untouched");
                    current.Observe();
                    Check(ReadyAfterProbe() && probePrints==2 && ActiveCallbacks==1,
                        "only the new generation's delayed callback can confirm its independently submitted service probe");
                }
                else
                {
                    AdvanceRetryClock(3600);Parallel.For(0,12,_=>PrinterReady());
                    Check(!PrinterReady() && probePrints==1 && ActiveCallbacks==0 && printed==0 && assemblyPrints==0,
                        "disposing a positive submission awaiting its callback cannot revive readiness or trigger a later probe");
                }
            }
        }
        finally {waitField.SetValue(null,oldWait);settleField.SetValue(null,oldSettle);}
    }
    private static void ConfiguredReceiptPaths()
    {
        WithReceiptScenario((state,photos,automatic)=>
        {
            ConfigureReceipt();rejectLegacyRouting=true;
            using(var waiting=new ManualResetEvent(false))
            using(var entered=new ManualResetEvent(false))
            {
                registrationWait=waiting;registrationEntered=entered;
                var startup=Task.Run(()=>RestartRoutes());
                try
                {
                    WaitUntil(()=>entered.WaitOne(0),"configured receipt startup registration is still in flight");
                    Check(RegistrationBusy && PrinterReady() && probePrints==0 && legacyRouteReads==0,
                        "exact configured receipt readiness does not wait for a hung unrelated formatter registration");
                    Check(ProcessAutomatic(automatic,state) && printSequence.SequenceEqual(new[]{"photo","assembly"}) &&
                        printTargets.All(id=>id==PrinterId) && probePrints==0,
                        "photo-first configured receipt acceptance remains available while formatter registration is in flight");
                }
                finally
                {
                    waiting.Set();startup.GetAwaiter().GetResult();registrationWait=registrationEntered=null;
                }
                WaitUntil(()=>!RegistrationBusy && ActiveCallbacks==1,"late configured receipt observer registered");
                Check(ActiveCallbacks==1 && PrinterReady() && printed==1 && assemblyPrints==1 && probePrints==0,
                    "late successful formatter registration does not replay or replace the already verified receipt route");
            }
        },false);

        foreach(var registration in new[]{"throw","null"})
        {
            WithReceiptScenario((state,photos,automatic)=>
            {
                ConfigureReceipt();registrationThrows=registration=="throw";registrationReturnsNull=registration=="null";
                suppressCallback=true;billPresent=documentPresent=printerPresent=false;rejectLegacyRouting=true;RestartRoutes();
                Check(PrinterReady() && ActiveCallbacks==0 && probePrints==0 && legacyRouteReads==0 && receiptQueries==0,
                    "matching configured virtual POS targets enable the exact receipt printer without format registration or queue probes: "+registration);
                Check(ProcessAutomatic(automatic,state) && printSequence.SequenceEqual(new[]{"photo","assembly"}) &&
                    printTargets.All(id=>id==PrinterId) && printed==1 && assemblyPrints==1 && claims==1 && state.AssemblyClaims==1,
                    "configured receipt route prints PHOTO then ASSEMBLY on the same exact Xprinter without any legacy queue: "+registration);
                Check(state.PaymentTypeReads==0 && state.FiscalSdkCalls==0 && receiptQueries==0 && legacyRouteReads==0 && probePrints==0,
                    "configured receipt acceptance neither fiscalizes nor consults unrelated table, bill, document or receipt queues");
                Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==1,
                    "repeated configured receipt acceptance never duplicates either customer strip");
                var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
                try
                {
                    RestartRoutes();
                    Check(PrinterReady() && ProcessAutomatic(restarted,state) && printed==1 && assemblyPrints==1 && ActiveCallbacks==0,
                        "configured receipt readiness and completed order evidence recover after restart despite unavailable callbacks");
                }
                finally {Dispose(restarted);Dispose(restartedPhotos);}
            },false);
        }

        WithReceiptScenario((state,photos,automatic)=>
        {
            ConfigureReceipt();suppressCallback=true;registrationReturnsNull=true;RestartRoutes();failAck=true;
            Check(ProcessAutomatic(automatic,state) && printed==1 && assemblyPrints==1 && status=="printing",
                "lost ACK on configured receipt retains durable physical proof and permits only the following assembly");
            var restartedPhotos=NewWorker();var restarted=NewAutomatic(restartedPhotos);
            try
            {
                RestartRoutes();Tick(restartedPhotos);
                Check(ProcessAutomatic(restarted,state) && status=="printed" && printed==1 && assemblyPrints==1 && claims==1,
                    "configured receipt restart reconciles lost photo ACK without repeating photo or assembly");
            }
            finally {Dispose(restarted);Dispose(restartedPhotos);}
        },false);

        WithReceiptScenario((state,photos,automatic)=>
        {
            ConfigureReceipt();suppressCallback=true;registrationThrows=true;RestartRoutes();
            var originalPoints=configuredHostPoints;
            Check(Selection()!=null && probePrints==0,"an unprinted configured receipt order durably reserves its exact physical printer");
            var binding=RouteBindings().Values.Cast<object>().Single(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId);
            Check((string)binding.GetType().GetProperty("Kind").GetValue(binding)=="receipt" &&
                binding.GetType().GetProperty("QueueId").GetValue(binding)==null &&
                (int)binding.GetType().GetProperty("ReceiptPointCount").GetValue(binding)==2,
                "receipt reservation records configuration proof rather than disguising a physical ID as a legacy queue UUID");
            configuredHostPoints=originalPoints.Reverse().ToArray();RestartRoutes();
            Check(Selection()!=null && probePrints==0 && printed==0,
                "receipt reservation survives restart and sorted POS order without a service probe or premature photo");
            ConfigureReceipt(BillDeviceId);
            Check(Selection()==null && printed==0 && assemblyPrints==0 && claims==0,
                "changed configured receipt target cannot silently replace an existing unprinted order reservation");
            configuredHostPoints=new[]{ReceiptPoint(PrinterId),ReceiptPoint(PrinterId)};
            Check(Selection()==null,"changed POS or cash-register identity cannot reuse a receipt reservation merely because its device matches");
            configuredHostPoints=originalPoints;RestartRoutes();
            Check(ProcessAutomatic(automatic,state) && printSequence.SequenceEqual(new[]{"photo","assembly"}) && printTargets.All(id=>id==PrinterId),
                "restoring the exact original receipt configuration resumes the reserved photo-first order on its pinned device");
        },false);

        WithReceiptScenario((state,photos,automatic)=>
        {
            // Scenario(true) has already persisted the legacy bill reservation.
            ConfigureReceipt();RestartRoutes();
            Check(Selection()!=null && ProcessAutomatic(automatic,state) && printTargets.All(id=>id==BillDeviceId) &&
                printSequence.SequenceEqual(new[]{"photo","assembly"}),
                "new receipt configuration preserves an existing legacy order's original device instead of auto-upgrading its route");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            configuredHostPoints=new[]{ReceiptPoint(PrinterId)};registrationReturnsNull=true;suppressCallback=true;RestartRoutes();
            Check(PrinterReady() && Selection()!=null && probePrints==0,"one valid host POS is sufficient to pin its configured receipt device");
            routeSubscription.Dispose();routeSubscription=null;
            Check(!PrinterReady() && Selection()==null && probePrints==0 && printed==0 && claims==0,
                "disposing callback-independent receipt lifecycle disables further readiness and order reservations");
        },false);

        foreach(var invalid in new[]{"no_pos","null_points","null_pos","conflicting","nonvirtual","mixed_nonvirtual","null_register","null_target","empty_target",
            "empty_pos_id","empty_register_id","duplicate_pos","too_many_pos","missing_device","wrong_device","remote_terminal","no_terminal","unsupported_image","narrow_width"})
        {
            WithReceiptScenario((state,photos,automatic)=>
            {
                ConfigureReceipt();registrationReturnsNull=true;suppressCallback=true;
                switch(invalid)
                {
                    case "no_pos":configuredHostPoints=new IPointOfSale[0];break;
                    case "null_points":configuredHostPoints=null;break;
                    case "null_pos":configuredHostPoints=new IPointOfSale[]{null};break;
                    case "conflicting":configuredHostPoints=new[]{ReceiptPoint(PrinterId,isDefault:true),ReceiptPoint(BillDeviceId)};break;
                    case "nonvirtual":configuredHostPoints=new[]{ReceiptPoint(PrinterId,false)};break;
                    case "mixed_nonvirtual":configuredHostPoints=new[]{ReceiptPoint(PrinterId),ReceiptPoint(PrinterId,false)};break;
                    case "null_register":configuredHostPoints=new[]{ReceiptPoint(PrinterId,nullRegister:true)};break;
                    case "null_target":configuredHostPoints=new[]{ReceiptPoint(null)};break;
                    case "empty_target":configuredHostPoints=new[]{ReceiptPoint(Guid.Empty)};break;
                    case "empty_pos_id":configuredHostPoints=new[]{ReceiptPoint(PrinterId,pointId:Guid.Empty)};break;
                    case "empty_register_id":configuredHostPoints=new[]{ReceiptPoint(PrinterId,registerId:Guid.Empty)};break;
                    case "duplicate_pos":var samePoint=ReceiptPoint(PrinterId);configuredHostPoints=new[]{samePoint,samePoint};break;
                    case "too_many_pos":configuredHostPoints=Enumerable.Range(0,33).Select(_=>ReceiptPoint(PrinterId)).ToArray();break;
                    case "missing_device":absentReceiptDevice=PrinterId;break;
                    case "wrong_device":wrongReceiptDevice=true;break;
                    case "remote_terminal":receiptDeviceTerminal=Guid.NewGuid();break;
                    case "no_terminal":receiptDeviceTerminal=null;break;
                    case "unsupported_image":SetDriver(false);break;
                    case "narrow_width":SetDriver(true,300);break;
                }
                RestartRoutes();
                Check(!PrinterReady() && Selection()==null && printed==0 && assemblyPrints==0 && probePrints==0 && claims==0,
                    "invalid exact receipt configuration fails closed without selecting arbitrary inventory/default printer: "+invalid);
            },false);
        }

        foreach(var corrupt in new[]{"proof","count"})
        {
            WithReceiptScenario((state,photos,automatic)=>
            {
                ConfigureReceipt();registrationReturnsNull=true;suppressCallback=true;RestartRoutes();
                Check(Selection()!=null,"receipt journal fixture has one valid reserved configuration before corruption: "+corrupt);
                var bindings=RouteBindings();
                var binding=bindings.Values.Cast<object>().Single(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId);
                if(corrupt=="proof") binding.GetType().GetProperty("ReceiptProof").SetValue(binding,"invalid-proof");
                else binding.GetType().GetProperty("ReceiptPointCount").SetValue(binding,0);
                var path=(string)Routes.GetField("path",Static).GetValue(null);
                using(var file=File.Create(path))new DataContractJsonSerializer(bindings.GetType()).WriteObject(file,bindings);
                RestartRoutes();
                Check(!PrinterReady() && Selection()==null && probePrints==0 && printed==0 && claims==0 &&
                    (string)Call(Worker,"ReadinessStatus",photos,services.Operations,null)=="journal_unhealthy",
                    "malformed persisted receipt configuration proof disables printing rather than losing or replacing old evidence: "+corrupt);
            },false);
        }
    }
    private static void PrintAndAck()
    {
        Scenario();var worker=NewWorker();Attempt(worker);
        Check(printed==1 && status=="printed" && lastPrintedPrinter==BillDeviceId && BillDeviceId!=BillPrinterId && receiptQueries==0,
            "photo prints on the confirmed physical assembly route before any assembly, never on queue UUID or fiscal printer");
        Attempt(worker);Tick(worker);Check(printed==1,"repeated orchestration and polling never prints a completed strip twice");Dispose(worker);
        Scenario(false);billPresent=false;documentPresent=true;ReadyAfterProbe();worker=NewWorker();Attempt(worker);
        Check(printed==1 && status=="printed" && lastPrintedPrinter==DocumentDeviceId,
            "order using the assembly document fallback prints photo on that exact confirmed device");Dispose(worker);
        Scenario();failAck=true;worker=NewWorker();Attempt(worker);
        Check(printed==1 && status=="printing","lost acknowledgement retains printed local tombstone");Dispose(worker);
        Check(RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),"unacknowledged printed photo retains durable route evidence");
        RestartRoutes();worker=NewWorker();Tick(worker);Check(printed==1 && status=="printed" && completed==2,"restart retries acknowledgement without printing");Dispose(worker);
        Check(RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),"photo acknowledgement retains reserved route until assembly physically succeeds");
        LearnAssembly();Check(RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),
            "physical assembly retains exact route through receipt-journal and server-ACK recovery window");
        Call(Routes,"ForgetAssemblyAcknowledged",null,BranchId.ToString(),TerminalId.ToString(),orderId,frontOrderId);
        Check(!RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),
            "confirmed assembly and photo acknowledgements together retire the route binding");
        Check(!Directory.GetFiles(data).Any(p=>p.EndsWith(".png") || p.EndsWith(".bmp")),"local journal never stores customer photo bytes");
    }    private static void PrintFailures()
    {
        Scenario();printResult=false;var worker=NewWorker();Attempt(worker);
        Check(printed==1 && status=="uncertain","printer negative completion is uncertain, not safe to replay");Tick(worker);
        Check(printed==1,"uncertain print is never retried automatically");Dispose(worker);
        Scenario();failPrinter=true;worker=NewWorker();Attempt(worker);Dispose(worker);worker=NewWorker();Attempt(worker);
        Check(printed==1 && status=="uncertain","printer exception survives restart without duplicate strip");Dispose(worker);
    }
    private static void PreparationRecovery()
    {
        Scenario();failDownload=true;var worker=NewWorker();Attempt(worker);
        Check(printed==0 && releases==1 && status=="pending","definite download failure releases only before printing");
        failDownload=false;Attempt(worker);Check(printed==1 && status=="printed","pre-print download failure can recover through before-assembly orchestration");Dispose(worker);
        Scenario();image=Png(gray:true);worker=NewWorker();Attempt(worker);
        Check(printed==0 && releases==1,"invalid raster never enters printer queue");image=Png();Attempt(worker);
        Check(printed==1,"corrected private image can print after definite preparation failure");Dispose(worker);
        Scenario();badHash=true;worker=NewWorker();Attempt(worker);
        Check(printed==0 && releases==1,"mismatched server image checksum is rejected before printing");Dispose(worker);
    }
    private static void LostClaim()
    {
        Scenario();status="printing";var worker=NewWorker();Attempt(worker);
        Check(printed==0 && status=="uncertain" && claims==0,"server claim without local proof is reconciled, never replayed");Dispose(worker);
        Scenario();failClaim=true;worker=NewWorker();Attempt(worker);
        Check(printed==0 && status=="printing","lost claim response never starts a speculative print");Attempt(worker);
        Check(printed==0 && status=="uncertain" && claims==1,"claim timeout is reconciled without taking a second claim");Dispose(worker);
    }
    private static void FreshDispatchGuard()
    {
        Scenario();handoverAfterDownload=true;var worker=NewWorker();
        Check(Attempt(worker)=="Pending" && printed==0 && releases==1 && !Ledger(worker).Contains(orderId),
            "fresh post-download kitchen revalidation blocks photo dispatch after handover without leaving started evidence");Dispose(worker);
        Scenario();frontOrderId=Guid.NewGuid();worker=NewWorker();
        Check(Attempt(worker)=="Pending" && printed==0 && claims==0,"reserved route cannot be reused by a different linked Front order");Dispose(worker);
        Scenario();billPresent=false;documentPresent=true;worker=NewWorker();
        Check(Attempt(worker)=="Pending" && printed==0 && claims==0,"changed assembly queue cannot silently reuse another reserved route");Dispose(worker);
        Scenario();LearnAssembly();worker=NewWorker();
        Check(Attempt(worker)=="Pending" && printed==0 && claims==0,"already printed legacy assembly cannot authorize photo-first dispatch later");
        Tick(worker);Check(printed==0 && claims==0,"reconciliation timer never adds a late photo to an assembly-first order");Dispose(worker);
        Scenario();worker=NewWorker();Check(Attempt(worker)=="Printed","closed-order route cleanup fixture keeps confirmed photo proof");
        Call(Routes,"ForgetCompletedOrder",null,BranchId.ToString(),TerminalId.ToString(),orderId,Guid.NewGuid());
        Check(RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),
            "route retirement cannot cross a different linked Front order");
        Call(Routes,"ForgetCompletedOrder",null,Guid.NewGuid().ToString(),TerminalId.ToString(),orderId,frontOrderId);
        Check(RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId),
            "route retirement cannot cross a different paired branch");
        using(var lease=(IDisposable)Call(Routes,"TryReservePrint",null))
        {
            Call(Routes,"ForgetCompletedOrder",null,BranchId.ToString(),TerminalId.ToString(),orderId,frontOrderId);
            Check(!RouteBindings().Values.Cast<object>().Any(entry=>(string)entry.GetType().GetProperty("OrderId").GetValue(entry)==orderId)
                && Ledger(worker).Contains(orderId) && (bool)Routes.GetProperty("PrintBusy",Static).GetValue(null),
                "confirmed closed-order cleanup retires only route while keeping photo evidence and shared flight lease");
        }
        Dispose(worker);
    }
    private static void Timeout()
    {
        Scenario();printGate=new ManualResetEvent(false);var worker=NewWorker(1);Attempt(worker);
        Check(printed==1 && status=="uncertain","bounded SDK wait records uncertain outcome");var calls=httpCalls;Tick(worker);
        Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"unfinished printer call prevents advertising new photo jobs");
        Check((string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="print_in_progress","heartbeat diagnoses a pending physical printer call without advertising readiness");
        Check(httpCalls==calls && printed==1,"an unfinished SDK call blocks any further printer submission");
        printGate.Set();var flight=(Task<bool>)Worker.GetField("printerFlight",Instance).GetValue(worker);flight.Wait();
        Tick(worker);Check(printed==1 && status=="uncertain","late physical completion cannot authorize automatic reprint");Dispose(worker);printGate.Dispose();printGate=null;
    }
    private static IDictionary Ledger(object worker)=>(IDictionary)Worker.GetField("ledger",Instance).GetValue(worker);
    private static void AddLedger(IDictionary ledger,string id,string state,string acknowledged=null,string photo=null)
    {
        var type=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoLedgerEntry",true);
        var entry=Activator.CreateInstance(type);
        type.GetProperty("OrderId").SetValue(entry,id);
        type.GetProperty("PhotoId").SetValue(entry,photo??Guid.NewGuid().ToString());
        type.GetProperty("TerminalId").SetValue(entry,TerminalId.ToString());
        type.GetProperty("BranchId").SetValue(entry,BranchId.ToString());
        type.GetProperty("Number").SetValue(entry,1057L);
        type.GetProperty("Status").SetValue(entry,state);
        type.GetProperty("StartedAt").SetValue(entry,"2026-10-06T00:00:00.0000000Z");
        type.GetProperty("AcknowledgedAt").SetValue(entry,acknowledged);
        type.GetProperty("ImageSha256").SetValue(entry,new string('a',64));
        ledger.Add(id,entry);
    }
    private static void SaveLedger(IDictionary ledger)
    {
        using(var file=File.Create(Path.Combine(data,"BulkaPickupPhotos.json")))
            new DataContractJsonSerializer(ledger.GetType()).WriteObject(file,ledger);
    }
    private static void LedgerRetention()
    {
        Scenario();var worker=NewWorker();var ledger=Ledger(worker);ledger.Clear();
        var old=Guid.NewGuid().ToString();var newest=Guid.NewGuid().ToString();
        var started=Guid.NewGuid().ToString();var uncertain=Guid.NewGuid().ToString();var unacknowledged=Guid.NewGuid().ToString();
        for(var i=0;i<2049;i++)
            AddLedger(ledger,i==0?old:(i==2048?newest:Guid.NewGuid().ToString()),"printed",new DateTime(2026,10,1,0,0,0,DateTimeKind.Utc).AddSeconds(i).ToString("o"));
        AddLedger(ledger,started,"started");AddLedger(ledger,uncertain,"uncertain");AddLedger(ledger,unacknowledged,"printed");
        Call(Worker,"PruneAcknowledged",worker);
        Check(ledger.Count==2051 && !ledger.Contains(old) && ledger.Contains(newest),"retention keeps the latest 2048 server-acknowledged strips");
        Check(ledger.Contains(started) && ledger.Contains(uncertain) && ledger.Contains(unacknowledged),"retention never removes unfinished or unacknowledged print evidence");
        Dispose(worker);

        Scenario();worker=NewWorker();ledger=Ledger(worker);ledger.Clear();
        for(var i=0;i<256;i++) AddLedger(ledger,Guid.NewGuid().ToString(),"uncertain");
        SaveLedger(ledger);Dispose(worker);worker=NewWorker();Tick(worker);
        Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"256 unconfirmed strips disable the photo offer after restart");
        Check((string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="queue_full","heartbeat diagnoses a full reconciliation journal");
        Check(printed==0 && claims==0 && Ledger(worker).Count==256,"a full reconciliation journal pauses new claims without discarding evidence");
        Dispose(worker);

        Scenario();worker=NewWorker();ledger=Ledger(worker);ledger.Clear();status="printing";
        AddLedger(ledger,orderId,"printed",photo:photoId);
        for(var i=0;i<255;i++) AddLedger(ledger,Guid.NewGuid().ToString(),"uncertain");
        SaveLedger(ledger);Dispose(worker);worker=NewWorker();Tick(worker);
        Check(printed==0 && completed==1 && status=="printed","a full journal still recovers confirmed-print acknowledgements without a second strip");
        Check((bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"successful reconciliation releases capacity for new photo jobs");
        Dispose(worker);
    }
    private static IDictionary RouteBindings() => (IDictionary)Routes.GetField("bindings",Static).GetValue(null);
    private static void RouteStorage()
    {
        Scenario(false);noPhoto=true;var count=RouteBindings().Count;LearnAssembly();
        Check(RouteBindings().Count==count,"ordinary orders without attached photos never consume durable photo route capacity");
        Scenario(false);var pathField=Routes.GetField("path",Static);var original=(string)pathField.GetValue(null);
        var blocked=Path.Combine(data,"blocked-routes");Directory.CreateDirectory(blocked+".tmp");pathField.SetValue(null,blocked);
        LearnAssembly();var worker=NewWorker();
        Check(assemblyPrints==1 && (string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="journal_unhealthy",
            "route storage failure after physical success disables photos without failing or replaying ordinary assembly");
        Dispose(worker);pathField.SetValue(null,original);
        Scenario(false);File.WriteAllText(original,"invalid route journal");RestartRoutes();worker=NewWorker();Tick(worker);
        Check(printed==0 && claims==0 && (string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="journal_unhealthy",
            "corrupt printer binding journal fails closed without stale backup selection or photo claims");
        Check(Directory.GetFiles(data,"BulkaPickupPhotoRoutes.json.corrupt-*").Length==1,"damaged route journal retained for reconciliation");Dispose(worker);
    }
    private static void CorruptJournal()
    {
        Scenario();File.WriteAllText(Path.Combine(data,"BulkaPickupPhotos.json"),"broken journal");var worker=NewWorker();Tick(worker);
        Check(httpCalls==0 && printed==0,"corrupt journal stops photo printing without falling back to stale backup");
        Check((string)Call(Worker,"ReadinessStatus",worker,services.Operations,null)=="journal_unhealthy","heartbeat diagnoses corrupted print evidence without enabling a second strip");Dispose(worker);
        Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"corrupt journal prevents advertising new photo jobs");
        Check(Directory.GetFiles(data,"BulkaPickupPhotos.json.corrupt-*").Length==1,"damaged original journal retained for reconciliation");
    }
}
