using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract]
    internal sealed class PickupPhotoRouteBinding
    {
        [DataMember] public string BranchId {get;set;}
        [DataMember] public string TerminalId {get;set;}
        [DataMember] public string OrderId {get;set;}
        [DataMember] public string FrontOrderId {get;set;}
        [DataMember] public string PhotoId {get;set;}
        [DataMember] public long Number {get;set;}
        [DataMember] public string DeviceId {get;set;}
        [DataMember] public string QueueId {get;set;}
        [DataMember] public string SectionId {get;set;}
        [DataMember] public string Kind {get;set;}
    }

    // The SDK's queue UUID is not a physical printing-device UUID. Observe the
    // configured assembly route through the supported before-format callback.
    internal static class PickupPhotoRoutes
    {
        private const string Marker="BulkaPhotoPrinterRoute";
        private const int MaximumBindings=8192;
        private static readonly object gate=new object();
        private static readonly SemaphoreSlim printGate=new SemaphoreSlim(1,1);
        private static readonly ConditionalWeakTable<IPrinterQueueRef,Route> queues=new ConditionalWeakTable<IPrinterQueueRef,Route>();
        private static readonly Dictionary<string,Observation> observations=new Dictionary<string,Observation>();
        private static readonly Dictionary<string,Guid> confirmed=new Dictionary<string,Guid>();
        private static readonly Dictionary<string,string> probes=new Dictionary<string,string>();
        private static Dictionary<string,PickupPhotoRouteBinding> bindings;
        private static bool initialized,healthy;
        private static int generation,probeTimeoutSeconds=30;
        private static string path;
        private static volatile bool uncertainProbeFlight;
        private sealed class Route
        {
            internal string Branch,Terminal,Section,Kind,Key;
            internal Guid Queue;
        }
        internal sealed class Observation
        {
            internal string Nonce;
            internal object Route;
            internal Guid? Device;
            internal bool Ambiguous,Expired;
            internal int Generation;
        }
        private sealed class Lease:IDisposable
        {
            private int released;
            public void Dispose(){if(Interlocked.Exchange(ref released,1)==0) printGate.Release();}
        }
        private sealed class Subscription:IDisposable
        {
            private readonly IDisposable handler;
            private readonly int ownGeneration;
            internal Subscription(IDisposable handler,int ownGeneration){this.handler=handler;this.ownGeneration=ownGeneration;}
            public void Dispose()
            {
                lock(gate) {if(generation==ownGeneration) initialized=false;}
                handler?.Dispose();
            }
        }
        internal static bool PrintBusy => printGate.CurrentCount==0;
        internal static bool UncertainPrintBusy => uncertainProbeFlight && PrintBusy;
        internal static IDisposable TryReservePrint() => printGate.Wait(0) ? new Lease() : null;
        private static string BindingKey(string branch,string terminal,string order) => branch+"|"+terminal+"|"+order;
        private static bool Valid(Dictionary<string,PickupPhotoRouteBinding> entries) => entries.Count<=MaximumBindings && entries.All(pair=>
            pair.Value!=null && pair.Key==BindingKey(pair.Value.BranchId,pair.Value.TerminalId,pair.Value.OrderId)
            && Guid.TryParse(pair.Value.BranchId,out _) && Guid.TryParse(pair.Value.TerminalId,out _)
            && Guid.TryParse(pair.Value.OrderId,out _) && Guid.TryParse(pair.Value.FrontOrderId,out _)
            && Guid.TryParse(pair.Value.PhotoId,out _)
            && Guid.TryParse(pair.Value.DeviceId,out _) && Guid.TryParse(pair.Value.QueueId,out _)
            && (pair.Value.SectionId=="none" || Guid.TryParse(pair.Value.SectionId,out _))
            && pair.Value.Number>0 && new[]{"bill","document"}.Contains(pair.Value.Kind));
        internal static IDisposable Start(IOperationService os,int timeoutSeconds=30)
        {
            int ownGeneration;
            lock(gate)
            {
                initialized=false;healthy=false;generation++;ownGeneration=generation;
                observations.Clear();confirmed.Clear();probes.Clear();probeTimeoutSeconds=Math.Max(1,Math.Min(60,timeoutSeconds));
                path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaPickupPhotoRoutes.json");
                try {bindings=DurableJsonFile.ReadValidated<Dictionary<string,PickupPhotoRouteBinding>>(path,Valid,false);healthy=true;}
                catch {bindings=new Dictionary<string,PickupPhotoRouteBinding>();PickupPhotoPrinter.Diagnose("route_journal",null,"invalid");}
            }
            try
            {
                var handler=os.RegisterBeforeFormatDocumentHandler(BeforeFormat);
                if(handler==null) {PickupPhotoPrinter.Diagnose("route_callback",null,"null");return null;}
                lock(gate) {initialized=true;}
                return new Subscription(handler,ownGeneration);
            }
            catch(Exception error) {PickupPhotoPrinter.Diagnose("route_callback",null,error.GetType().Name);return null;}
        }
        internal static void BindQueue(IOperationService os,IPrinterQueueRef queue,Guid? section,string kind)
        {
            if(queue==null) return;
            try
            {
                var branch=LoyaltyFlow.BranchId;var terminal=os.GetHostTerminal().Id.ToString();
                var route=new Route {Branch=branch,Terminal=terminal,Queue=queue.Id,Section=section?.ToString() ?? "none",Kind=kind};
                route.Key=branch+"|"+terminal+"|"+route.Queue+"|"+route.Section+"|"+kind;
                lock(gate) {queues.Remove(queue);queues.Add(queue,route);}
            }
            catch(Exception error) {PickupPhotoPrinter.Diagnose("route_queue",null,error.GetType().Name);}
        }
        internal static Observation Attach(IPrinterQueueRef queue,XElement doc)
        {
            lock(gate)
            {
                if(!initialized || !healthy || !queues.TryGetValue(queue,out var route)) return null;
                var observation=new Observation {Nonce=Guid.NewGuid().ToString("N"),Route=route,Generation=generation};
                observations.Add(observation.Nonce,observation);
                doc.Add(new XElement("section",new XAttribute("name",Marker),new XAttribute("data",observation.Nonce)));
                return observation;
            }
        }
        private static Document BeforeFormat(ValueTuple<Guid,Document> args)
        {
            if(args.Item2?.Markup==null) return null;
            var doc=new XElement(args.Item2.Markup);
            var markers=doc.Descendants("section").Where(item=>(string)item.Attribute("name")==Marker).ToArray();
            if(markers.Length==0) return null;
            // Remove private metadata even when the observation is stale or fails.
            foreach(var marker in markers)
            {
                var nonce=(string)marker.Attribute("data");marker.Remove();
                lock(gate)
                {
                    if(nonce==null || !observations.TryGetValue(nonce,out var observation)
                        || observation.Expired || observation.Generation!=generation) continue;
                    if(args.Item1==Guid.Empty || (observation.Device.HasValue && observation.Device!=args.Item1))
                        observation.Ambiguous=true;
                    else observation.Device=args.Item1;
                }
            }
            return (Document)doc;
        }
        internal static void Complete(Observation observation,bool success,string serverOrderId=null,Guid? frontOrderId=null,long number=0,string photoId=null)
        {
            if(observation==null) return;
            lock(gate)
            {
                observations.Remove(observation.Nonce);
                var route=(Route)observation.Route;
                if(!success || observation.Expired || observation.Generation!=generation || !initialized) return;
                if(observation.Ambiguous || !observation.Device.HasValue)
                {
                    confirmed.Remove(route.Key);
                    probes[route.Key]=observation.Ambiguous ? "ambiguous_printer" : "device_unmapped";
                    PickupPhotoPrinter.Diagnose("route_observation",route.Queue,probes[route.Key]);return;
                }
                confirmed[route.Key]=observation.Device.Value;
                PickupPhotoPrinter.Diagnose("route_observed",observation.Device.Value,route.Kind+" queue="+route.Queue);
                if(!Guid.TryParse(serverOrderId,out _) || !frontOrderId.HasValue || frontOrderId==Guid.Empty || number<=0
                    || !Guid.TryParse(photoId,out _)) return;
                var key=BindingKey(route.Branch,route.Terminal,serverOrderId);
                var binding=new PickupPhotoRouteBinding {BranchId=route.Branch,TerminalId=route.Terminal,OrderId=serverOrderId,
                    FrontOrderId=frontOrderId.Value.ToString(),PhotoId=photoId,Number=number,DeviceId=observation.Device.Value.ToString(),
                    QueueId=route.Queue.ToString(),SectionId=route.Section,Kind=route.Kind};
                // Never replace evidence of an earlier successful assembly print.
                if(bindings.TryGetValue(key,out var previous))
                {
                    if(previous.FrontOrderId!=binding.FrontOrderId || previous.Number!=number || previous.PhotoId!=photoId)
                        {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",route.Queue,"binding_conflict");}
                    else if(previous.DeviceId!=binding.DeviceId)
                        PickupPhotoPrinter.Diagnose("route_retained",Guid.Parse(previous.DeviceId),"original_assembly_device");
                    return;
                }
                if(!healthy || bindings.Count>=MaximumBindings)
                    {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",route.Queue,"capacity");return;}
                bindings.Add(key,binding);
                try {DurableJsonFile.Write(path,bindings);}
                catch(Exception error) {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",route.Queue,error.GetType().Name);}
                // A storage failure must not turn a successfully printed assembly
                // ticket into a failed receipt that another worker might reprint.
            }
        }
        private static async Task Probe(IOperationService os,IPrinterQueueRef queue,Route route,IDisposable lease)
        {
            Observation observation=null;
            Task<bool> flight=null;
            try
            {
                var doc=new XElement("doc",new XElement("center","Bulka — проверка фотопечати"));
                observation=Attach(queue,doc);
                if(observation==null) {lock(gate) probes[route.Key]="device_unmapped";return;}
                flight=Task.Run(()=>{try{return os.Print(queue,(Document)doc,true);}finally{lease.Dispose();}});
                if(await Task.WhenAny(flight,Task.Delay(TimeSpan.FromSeconds(probeTimeoutSeconds)))!=flight)
                {
                    lock(gate) {observation.Expired=true;if(observation.Generation==generation) probes[route.Key]="driver_unavailable";}
                    uncertainProbeFlight=true;
                    PickupPhotoPrinter.Diagnose("route_probe",route.Queue,"timeout");
                    // Keep the gate until the SDK call truly finishes, even after
                    // timeout/dispose. Neither a heartbeat nor a job may replay it.
                    try {await flight;} catch { } finally {uncertainProbeFlight=false;}
                    Complete(observation,false);return;
                }
                var result=await flight;
                Complete(observation,result);
                lock(gate) {if(observation.Generation==generation && !confirmed.ContainsKey(route.Key)
                    && probes.TryGetValue(route.Key,out var state) && state=="print_in_progress") probes[route.Key]="device_unmapped";}
                if(!result) PickupPhotoPrinter.Diagnose("route_probe",route.Queue,"negative_completion");
            }
            catch(Exception error)
            {
                Complete(observation,false);lock(gate) {if(observation?.Generation==generation) probes[route.Key]="driver_unavailable";}
                PickupPhotoPrinter.Diagnose("route_probe",route.Queue,error.GetType().Name);
            }
            finally {if(flight==null) lease.Dispose();}
        }
        internal static bool TryDefaultDevice(IOperationService os,out Guid device,out string reason)
        {
            device=Guid.Empty;reason="device_unmapped";
            lock(gate) {if(!initialized) return false;if(!healthy){reason="journal_unhealthy";return false;}}
            IPrinterQueueRef queue;
            try
            {
                // This is the exact section/table choice used by online imports.
                var sections=os.GetHostTerminalRestaurantSections().Select(section=>section.Id).ToArray();
                var table=os.GetTables(false).FirstOrDefault(item=>item.IsActive && sections.Contains(item.RestaurantSection.Id));
                queue=AssemblyTicket.PrinterForSection(os,table?.RestaurantSection);
            }
            catch(Exception error) {reason="not_configured";PickupPhotoPrinter.Diagnose("assembly_queue",null,error.GetType().Name);return false;}
            lock(gate)
            {
                if(!queues.TryGetValue(queue,out var route)) return false;
                if(confirmed.TryGetValue(route.Key,out device)) {reason="ready";return true;}
                if(probes.TryGetValue(route.Key,out reason)) return false;
                var lease=TryReservePrint();if(lease==null) {reason="print_in_progress";return false;}
                probes[route.Key]="print_in_progress";reason="print_in_progress";
                // Record the attempt before invoking the SDK. There is no timer
                // retry for a failed/uncertain control strip during this startup.
                Task.Run(()=>Probe(os,queue,route,lease));return false;
            }
        }
        internal static bool TryOrderDevice(IOperationService os,string orderId,string photoId,long number,out Guid device,out string reason)
        {
            device=Guid.Empty;reason="device_unmapped";
            var terminal=os.GetHostTerminal().Id.ToString();
            lock(gate)
            {
                if(!initialized) return false;if(!healthy){reason="journal_unhealthy";return false;}
                if(!bindings.TryGetValue(BindingKey(LoyaltyFlow.BranchId,terminal,orderId),out var binding)
                    || binding.Number!=number || binding.PhotoId!=photoId) return false;
                device=Guid.Parse(binding.DeviceId);reason="ready";return true;
            }
        }
        internal static void ForgetAcknowledged(string branch,string terminal,string orderId,string photoId,long number)
        {
            lock(gate)
            {
                var key=BindingKey(branch,terminal,orderId);
                if(!healthy || !bindings.TryGetValue(key,out var binding) || binding.PhotoId!=photoId || binding.Number!=number) return;
                bindings.Remove(key);
                try {DurableJsonFile.Write(path,bindings);}
                catch(Exception error) {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",null,error.GetType().Name);}
            }
        }
    }
}
