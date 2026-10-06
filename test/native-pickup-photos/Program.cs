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
internal static class Program
{
    private const BindingFlags Static=BindingFlags.Static|BindingFlags.NonPublic|BindingFlags.Public;
    private const BindingFlags Instance=BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public;
    private static readonly Assembly Plugin=typeof(LoyaltyFlow).Assembly;
    private static readonly Type Worker=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoSync",true);
    private static readonly Type Raster=Plugin.GetType("Resto.Front.Api.IikoBonusPlugin.PickupPhotoRaster",true);
    private static readonly Guid TerminalId=Guid.NewGuid(),BranchId=Guid.NewGuid(),PrinterId=Guid.NewGuid();
    private static readonly Services services=new Services();
    private static readonly PrinterDriverParameters driver=new PrinterDriverParameters();
    private static string data,orderId,photoId,status;
    private static byte[] image;
    private static int printed,completed,claims,releases,httpCalls,assertions;
    private static bool failAck,failDownload,failPrinter,failClaim,badHash,printerPresent=true,printResult=true;
    private static ManualResetEvent printGate;
    private static void Check(bool value,string label){if(!value)throw new Exception(label);assertions++;Console.WriteLine("PASS: "+label);}
    private static object Call(Type type,string name,object target,params object[] args)=>type.GetMethod(name,target==null?Static:Instance).Invoke(target,args);
    private static object NewWorker(int timeout=30)=>Activator.CreateInstance(Worker,Instance,null,new object[]{false,timeout},null);
    private static void Tick(object worker)=>Call(Worker,"Tick",worker,new object[]{null});
    private static void Dispose(object worker)=>((IDisposable)worker).Dispose();
    private static HttpResponseMessage Json(string body,HttpStatusCode code=HttpStatusCode.OK)=>new HttpResponseMessage(code){Content=new StringContent(body,Encoding.UTF8,"application/json")};
    private static string Success(string state)=>"{\"success\":true,\"status\":\""+state+"\",\"number\":1057,\"photoId\":\""+photoId+"\"}";
    private static void SetDriver(bool images=true,int? width=384)
    {
        driver.GetType().GetProperty("CanPrintImage").SetValue(driver,images);
        driver.GetType().GetProperty("PageWidth").SetValue(driver,width);
        driver.GetType().GetProperty("MarginLeft").SetValue(driver,0);
        driver.GetType().GetProperty("MarginRight").SetValue(driver,0);
    }
    private static byte[] Png(int width=384,int height=32,bool gray=false)
    {
        var pixels=new byte[width*height];
        for(var i=0;i<pixels.Length;i++)pixels[i]=gray?(byte)128:(i%2==0?(byte)0:(byte)255);
        var frame=BitmapFrame.Create(BitmapSource.Create(width,height,96,96,PixelFormats.Gray8,null,pixels,width));
        var encoder=new PngBitmapEncoder();encoder.Frames.Add(frame);
        using(var output=new MemoryStream()){encoder.Save(output);return output.ToArray();}
    }
    private static void Scenario()
    {
        orderId=Guid.NewGuid().ToString();photoId=Guid.NewGuid().ToString();status="pending";
        printed=completed=claims=releases=httpCalls=0;failAck=failDownload=failPrinter=failClaim=badHash=false;printResult=true;
        printerPresent=true;printGate=null;image=Png();SetDriver();
        Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS",null);
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
        if(path.EndsWith("/poll")) return Json("{\"success\":true,\"jobs\":[{\"orderId\":\""+orderId+"\",\"photoId\":\""+photoId+"\",\"number\":1057,\"status\":\""+status+"\"}]}");
        if(path.EndsWith("/image"))
        {
            if(!request.RequestUri.Query.Contains("widthDots=384")) throw new Exception("Unbounded image width");
            if(failDownload) return Json("{}",HttpStatusCode.ServiceUnavailable);
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
        var terminal=Proxy.Make<ITerminal>(call=>call.MethodName=="get_Id"?(object)TerminalId:null);
        var printer=Proxy.Make<IPrinterQueueRef>(call=>call.MethodName=="get_Id"?(object)PrinterId:true);
        var device=Proxy.Make<IPrintingDeviceInfo>(call=>call.MethodName=="get_Id"?(object)PrinterId:null);
        services.Operations=Proxy.Make<IOperationService>(call=>{
            switch(call.MethodName)
            {
                case "GetHostTerminal":return terminal;
                case "TryGetReceiptChequePrinter":return printerPresent?printer:null;
                case "TryGetPrintingDeviceInfoById":return device;
                case "GetPrinterDriverParameters":return driver;
                case "Print":
                    Interlocked.Increment(ref printed);
                    if((bool)call.Args[2]!=true)throw new Exception("Must wait for printer completion");
                    var markup=((Document)call.Args[1]).Markup;
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
        RasterBounds();PrinterCapability();PrintAndAck();PrintFailures();PreparationRecovery();LostClaim();Timeout();LedgerRetention();CorruptJournal();
        Check(Plugin.GetName().Version.ToString(3)=="1.14.0","new plugin feature version is 1.14.0");
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
        Scenario();Check((bool)Call(Worker,"PrinterReady",null,services.Operations),"configured image-capable receipt printer advertised");
        SetDriver(false);Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"text-only printer does not enable customer photo offer");
        SetDriver(true,300);Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"too-narrow printer does not enable customer photo offer");
        SetDriver();printerPresent=false;Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"missing receipt printer does not enable customer photo offer");
        printerPresent=true;Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS","576");
        Check((int)Call(Worker,"PrintableWidth",null,services.Operations)==384,"58mm printer safely caps configured 576-dot image");
        SetDriver(true,576);Check((int)Call(Worker,"PrintableWidth",null,services.Operations)==576,"80mm printer can use configured 576-dot image");
        Environment.SetEnvironmentVariable("IIKO_PICKUP_PHOTO_WIDTH_DOTS","999");Check(!(bool)Call(Worker,"PrinterReady",null,services.Operations),"invalid local paper width fails closed");
    }
    private static void PrintAndAck()
    {
        Scenario();var worker=NewWorker();Tick(worker);
        Check(printed==1 && status=="printed","paid accepted photo job prints and acknowledges once");
        Tick(worker);Check(printed==1,"repeated polling never prints a completed strip twice");Dispose(worker);
        Scenario();failAck=true;worker=NewWorker();Tick(worker);
        Check(printed==1 && status=="printing","lost acknowledgement retains printed local tombstone");Dispose(worker);
        worker=NewWorker();Tick(worker);Check(printed==1 && status=="printed" && completed==2,"restart retries acknowledgement without printing");Dispose(worker);
        Check(!Directory.GetFiles(data).Any(p=>p.EndsWith(".png") || p.EndsWith(".bmp")),"local journal never stores customer photo bytes");
    }
    private static void PrintFailures()
    {
        Scenario();printResult=false;var worker=NewWorker();Tick(worker);
        Check(printed==1 && status=="uncertain","printer negative completion is uncertain, not safe to replay");Tick(worker);
        Check(printed==1,"uncertain print is never retried automatically");Dispose(worker);
        Scenario();failPrinter=true;worker=NewWorker();Tick(worker);Dispose(worker);worker=NewWorker();Tick(worker);
        Check(printed==1 && status=="uncertain","printer exception survives restart without duplicate strip");Dispose(worker);
    }
    private static void PreparationRecovery()
    {
        Scenario();failDownload=true;var worker=NewWorker();Tick(worker);
        Check(printed==0 && releases==1 && status=="pending","definite download failure releases only before printing");
        failDownload=false;Tick(worker);Check(printed==1 && status=="printed","pre-print download failure can recover automatically");Dispose(worker);
        Scenario();image=Png(gray:true);worker=NewWorker();Tick(worker);
        Check(printed==0 && releases==1,"invalid raster never enters printer queue");image=Png();Tick(worker);
        Check(printed==1,"corrected private image can print after definite preparation failure");Dispose(worker);
        Scenario();badHash=true;worker=NewWorker();Tick(worker);
        Check(printed==0 && releases==1,"mismatched server image checksum is rejected before printing");Dispose(worker);
    }
    private static void LostClaim()
    {
        Scenario();status="printing";var worker=NewWorker();Tick(worker);
        Check(printed==0 && status=="uncertain" && claims==0,"server claim without local proof is reconciled, never replayed");Dispose(worker);
        Scenario();failClaim=true;worker=NewWorker();Tick(worker);
        Check(printed==0 && status=="printing","lost claim response never starts a speculative print");Tick(worker);
        Check(printed==0 && status=="uncertain" && claims==1,"claim timeout is reconciled without taking a second claim");Dispose(worker);
    }
    private static void Timeout()
    {
        Scenario();printGate=new ManualResetEvent(false);var worker=NewWorker(1);Tick(worker);
        Check(printed==1 && status=="uncertain","bounded SDK wait records uncertain outcome");var calls=httpCalls;Tick(worker);
        Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"unfinished printer call prevents advertising new photo jobs");
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
    private static void CorruptJournal()
    {
        Scenario();File.WriteAllText(Path.Combine(data,"BulkaPickupPhotos.json"),"broken journal");var worker=NewWorker();Tick(worker);
        Check(httpCalls==0 && printed==0,"corrupt journal stops photo printing without falling back to stale backup");Dispose(worker);
        Check(!(bool)Worker.GetProperty("CanAcceptJobs",Instance).GetValue(worker),"corrupt journal prevents advertising new photo jobs");
        Check(Directory.GetFiles(data,"BulkaPickupPhotos.json.corrupt-*").Length==1,"damaged original journal retained for reconciliation");
    }
}
