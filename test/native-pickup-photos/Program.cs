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
        var queue=Call(AssemblyTicket,"Printer",null,services.Operations,TestOrder());
        var args=new object[]{services.Operations,queue,orderId,frontOrderId,photoId,1057L,null,null};
        return (bool)Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoPrinter",true)
            .GetMethod("TryPrepareForOrder",Static).Invoke(null,args) ? args[6] : null;
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
        var device=Proxy.Make<IPrintingDeviceInfo>(call=>call.MethodName=="get_Id"?(object)PrinterId:null);
        var billDevice=Proxy.Make<IPrintingDeviceInfo>(call=>call.MethodName=="get_Id"?(object)BillDeviceId:null);
        var documentDevice=Proxy.Make<IPrintingDeviceInfo>(call=>call.MethodName=="get_Id"?(object)DocumentDeviceId:null);
        section=Proxy.Make<IRestaurantSection>(call=>call.MethodName=="get_Id"?(object)SectionId:null);
        table=Proxy.Make<ITable>(call=>call.MethodName=="get_IsActive"?(object)true:call.MethodName=="get_RestaurantSection"?section:null);
        services.Operations=Proxy.Make<IOperationService>(call=>{
            switch(call.MethodName)
            {
                case "GetHostTerminal":return terminal;
                case "GetHostTerminalRestaurantSections":return new[]{section};
                case "GetTables":return new[]{table};
                case "RegisterBeforeFormatDocumentHandler":return RegisterCallback((Func<ValueTuple<Guid,Document>,Document>)call.Args[0]);
                case "TryGetReceiptChequePrinter":receiptQueries++;if(receiptQueryFails)throw new IOException("Receipt query failed");return printerPresent?printer:null;
                case "TryGetBillPrinter":if(call.Args[0]!=section || !(bool)call.Args[1])throw new Exception("Wrong automatic assembly section");return billPresent?bill:null;
                case "TryGetDocumentPrinter":if(call.Args[0]!=section || !(bool)call.Args[1])throw new Exception("Wrong automatic assembly section");return documentPresent?documentPrinter:null;
                case "GetPrintingDeviceInfos":return new[]{device,documentDevice,billDevice};
                case "TryGetPrintingDeviceInfoById":throw new Exception("Queue UUID must not be used as physical printer UUID");
                case "GetPrinterDriverParameters":return ((IPrintingDeviceInfo)call.Args[0]).Id==BillDeviceId?billDriver:((IPrintingDeviceInfo)call.Args[0]).Id==DocumentDeviceId?documentDriver:driver;
                case "Print":
                    var payload=(Document)call.Args[1];
                    var markup=payload.Markup;
                    if(call.Args[0] is IPrinterQueueRef queue)
                    {
                        if(call.Args.Length!=3 || !(bool)call.Args[2])throw new Exception("Assembly/probe must wait for printer completion");
                        var target=queue.Id==BillPrinterId?BillDeviceId:DocumentDeviceId;
                        if(!suppressCallback)
                        {
                            var formatted=FormatDocument(target,payload);
                            if(multipleTargets)FormatDocument(PrinterId,payload);
                            if(formatted!=null)markup=formatted.Markup;
                            if(markup.Descendants("section").Any())throw new Exception("Private route marker leaked to paper");
                        }
                        if(markup.Value.Contains("проверка фотопечати")){Interlocked.Increment(ref probePrints);probeGate?.WaitOne();}
                        else Interlocked.Increment(ref assemblyPrints);
                        if(queuePrinterThrows) throw new IOException("Fake queue printer failed after dispatch");
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
        RasterBounds();PrinterCapability();RouteFailures();StartupRecovery();PrintAndAck();PrintFailures();PreparationRecovery();FreshDispatchGuard();LostClaim();Timeout();LedgerRetention();RouteStorage();CorruptJournal();
        PhotoFirstIntegration();
        Check(Plugin.GetName().Version.ToString(3)=="1.14.4","safe startup recovery and photo-first orchestration have version 1.14.4");
        Console.WriteLine("PASS: "+assertions+" photo-print assertions; intercepted HTTP and SDK only, no physical printer.");
        PluginContext.Uninitialize();
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
