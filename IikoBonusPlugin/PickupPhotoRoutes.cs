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
        [DataMember(EmitDefaultValue=false)] public string Phase {get;set;}
        [DataMember] public bool PhotoAcknowledged {get;set;}
    }

    // The SDK's queue UUID is not a physical printing-device UUID. Observe the
    // configured assembly route through the supported before-format callback.
    internal static partial class PickupPhotoRoutes
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
        internal sealed class Lease:IDisposable
        {
            private int released;
            private int disposalRequested;
            private Task flight;
            internal void Track(Task pending) {flight=pending;}
            private void Release(){if(Interlocked.Exchange(ref released,1)==0) printGate.Release();}
            public void Dispose()
            {
                if(Interlocked.Exchange(ref disposalRequested,1)!=0) return;
                var pending=flight;
                if(pending==null || pending.IsCompleted) Release();
                else pending.ContinueWith(_=>Release(),TaskContinuationOptions.ExecuteSynchronously);
            }
        }
        internal static bool PrintBusy => printGate.CurrentCount==0;
        internal static bool UncertainPrintBusy => uncertainProbeFlight && PrintBusy;
        internal static Lease TryReservePrint() => printGate.Wait(0) ? new Lease() : null;
        private static string BindingKey(string branch,string terminal,string order) => branch+"|"+terminal+"|"+order;
        private static bool Valid(Dictionary<string,PickupPhotoRouteBinding> entries) => entries.Count<=MaximumBindings && entries.All(pair=>
            pair.Value!=null && pair.Key==BindingKey(pair.Value.BranchId,pair.Value.TerminalId,pair.Value.OrderId)
            && Guid.TryParse(pair.Value.BranchId,out _) && Guid.TryParse(pair.Value.TerminalId,out _)
            && Guid.TryParse(pair.Value.OrderId,out _) && Guid.TryParse(pair.Value.FrontOrderId,out _)
            && Guid.TryParse(pair.Value.PhotoId,out _)
            && Guid.TryParse(pair.Value.DeviceId,out _) && Guid.TryParse(pair.Value.QueueId,out _)
            && (pair.Value.SectionId=="none" || Guid.TryParse(pair.Value.SectionId,out _))
            && pair.Value.Number>0 && new[]{"bill","document"}.Contains(pair.Value.Kind)
            && (pair.Value.Phase==null || new[]{"reserved","assembly_printed","assembly_acknowledged"}.Contains(pair.Value.Phase)));
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
            catch(Exception error)
            {
                lock(gate) startupDiagnostic="route_queue_failed type="+error.GetType().Name;
                PickupPhotoPrinter.Diagnose("route_queue",null,error.GetType().Name);
            }
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
        private static Document BeforeFormat(ValueTuple<Guid,Document> args,int callbackGeneration)
        {
            lock(gate) {if(callbackGeneration!=generation || !initialized) return null;}
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
                    if(callbackGeneration!=generation || !initialized || nonce==null || !observations.TryGetValue(nonce,out var observation)
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
                    QueueId=route.Queue.ToString(),SectionId=route.Section,Kind=route.Kind,Phase="assembly_printed"};
                // Never replace evidence of an earlier successful assembly print.
                if(bindings.TryGetValue(key,out var previous))
                {
                    if(previous.FrontOrderId!=binding.FrontOrderId || previous.Number!=number || previous.PhotoId!=photoId)
                        {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",route.Queue,"binding_conflict");}
                    else if(previous.DeviceId!=binding.DeviceId)
                        PickupPhotoPrinter.Diagnose("route_retained",Guid.Parse(previous.DeviceId),"original_assembly_device");
                    else
                    {
                        previous.Phase="assembly_printed";
                        SaveBindings(route.Queue);
                    }
                    return;
                }
                if(!healthy || bindings.Count>=MaximumBindings)
                    {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",route.Queue,"capacity");return;}
                bindings.Add(key,binding);
                SaveBindings(route.Queue);
                // A storage failure must not turn a successfully printed assembly
                // ticket into a failed receipt that another worker might reprint.
            }
        }
        private static void SaveBindings(Guid? queue)
        {
            try {DurableJsonFile.Write(path,bindings);}
            catch(Exception error) {healthy=false;PickupPhotoPrinter.Diagnose("route_journal",queue,error.GetType().Name);}
        }
        internal static bool TryDefaultDevice(IOperationService os,out Guid device,out string reason)
        {
            device=Guid.Empty;reason="device_unmapped";
            EnsureRegistration();
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
            return TryQueueDevice(os,queue,out device,out reason);
        }
        internal static bool TryQueueDevice(IOperationService os,IPrinterQueueRef queue,out Guid device,out string reason)
        {
            device=Guid.Empty;reason="device_unmapped";
            EnsureRegistration();
            lock(gate)
            {
                if(!initialized) return false;if(!healthy){reason="journal_unhealthy";return false;}
                if(queue==null || !queues.TryGetValue(queue,out var route)) return false;
                if(confirmed.TryGetValue(route.Key,out device)) {reason="ready";startupDiagnostic=null;return true;}
                if(probes.TryGetValue(route.Key,out reason) && (!probeAttempts.TryGetValue(route.Key,out var previous)
                    || previous.InFlight || !previous.Retryable || previous.Attempts>=MaximumStartupAttempts || utcNow()<previous.RetryAt)) return false;
                var lease=TryReservePrint();if(lease==null) {reason="print_in_progress";return false;}
                if(!probeAttempts.TryGetValue(route.Key,out var attempt))
                    {attempt=new ProbeAttempt {Generation=generation};probeAttempts[route.Key]=attempt;}
                attempt.Attempts++;attempt.InFlight=true;attempt.Retryable=false;startupDiagnostic=null;
                probes[route.Key]="print_in_progress";reason="print_in_progress";
                Task.Run(()=>Probe(os,queue,route,attempt,lease));return false;
            }
        }
        internal static bool ReserveOrder(IOperationService os,IPrinterQueueRef queue,string orderId,Guid frontOrder,
            string photoId,long number,Guid device,out string reason)
        {
            reason="device_unmapped";
            var terminal=os.GetHostTerminal().Id.ToString();var branch=LoyaltyFlow.BranchId;
            lock(gate)
            {
                if(!initialized || !healthy || !queues.TryGetValue(queue,out var route)) return false;
                if(route.Terminal!=terminal || route.Branch!=branch) return false;
                if(!Guid.TryParse(orderId,out _) || !Guid.TryParse(photoId,out _) || number<=0 || frontOrder==Guid.Empty) return false;
                var key=BindingKey(route.Branch,route.Terminal,orderId);
                if(bindings.TryGetValue(key,out var existing))
                {
                    if(existing.FrontOrderId!=frontOrder.ToString() || existing.PhotoId!=photoId || existing.Number!=number)
                        {reason="journal_unhealthy";return false;}
                    if(existing.Phase!="reserved") return false;
                    // The reservation pins the exact original route and physical
                    // target across restarts; a new section/queue needs review.
                    if(existing.QueueId!=route.Queue.ToString() || existing.SectionId!=route.Section || existing.Kind!=route.Kind
                        || existing.DeviceId!=device.ToString()) return false;
                    reason="ready";return true;
                }
                if(!confirmed.TryGetValue(route.Key,out var confirmedDevice) || confirmedDevice!=device) return false;
                if(bindings.Count>=MaximumBindings) {reason="queue_full";return false;}
                bindings.Add(key,new PickupPhotoRouteBinding {BranchId=route.Branch,TerminalId=route.Terminal,OrderId=orderId,
                    FrontOrderId=frontOrder.ToString(),PhotoId=photoId,Number=number,DeviceId=device.ToString(),
                    QueueId=route.Queue.ToString(),SectionId=route.Section,Kind=route.Kind,Phase="reserved"});
                SaveBindings(route.Queue);reason=healthy ? "ready" : "journal_unhealthy";return healthy;
            }
        }
        internal static void ConfirmAssembly(string branch,string terminal,string orderId,Guid frontOrder,
            string photoId,long number,Guid device)
        {
            lock(gate)
            {
                var key=BindingKey(branch,terminal,orderId);
                if(!healthy || !bindings.TryGetValue(key,out var binding) || binding.FrontOrderId!=frontOrder.ToString()
                    || binding.PhotoId!=photoId || binding.Number!=number || binding.DeviceId!=device.ToString()) return;
                binding.Phase="assembly_printed";
                SaveBindings(null);
            }
        }
        internal static void ForgetAssemblyAcknowledged(string branch,string terminal,string orderId,Guid frontOrder)
        {
            lock(gate)
            {
                var key=BindingKey(branch,terminal,orderId);
                if(!healthy || !bindings.TryGetValue(key,out var binding) || binding.FrontOrderId!=frontOrder.ToString()
                    || (binding.Phase!="assembly_printed" && binding.Phase!=null)) return;
                binding.Phase="assembly_acknowledged";
                if(binding.PhotoAcknowledged) bindings.Remove(key);
                SaveBindings(null);
            }
        }
        internal static void ForgetCompletedOrder(string branch,string terminal,string orderId,Guid frontOrder)
        {
            lock(gate)
            {
                var key=BindingKey(branch,terminal,orderId);
                if(!healthy || !bindings.TryGetValue(key,out var binding) || binding.FrontOrderId!=frontOrder.ToString()) return;
                bindings.Remove(key);SaveBindings(null);
            }
        }
        internal static bool IsReserved(string branch,string terminal,string orderId,string photoId,long number)
        {
            lock(gate) return initialized && healthy && bindings.TryGetValue(BindingKey(branch,terminal,orderId),out var binding)
                && binding.Phase=="reserved" && binding.PhotoId==photoId && binding.Number==number;
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
        internal static bool TryRecoveryDevice(IOperationService os,string orderId,Guid frontOrder,string photoId,long number,
            out Guid device,out string reason)
        {
            device=Guid.Empty;reason="device_unmapped";
            var terminal=os.GetHostTerminal().Id.ToString();var branch=LoyaltyFlow.BranchId;
            lock(gate)
            {
                if(!initialized || !healthy || !bindings.TryGetValue(BindingKey(branch,terminal,orderId),out var binding)
                    || binding.FrontOrderId!=frontOrder.ToString() || binding.Number!=number || binding.PhotoId!=photoId) return false;
                device=Guid.Parse(binding.DeviceId);reason="ready";return true;
            }
        }
        internal static void ForgetAcknowledged(string branch,string terminal,string orderId,string photoId,long number)
        {
            lock(gate)
            {
                var key=BindingKey(branch,terminal,orderId);
                if(!healthy || !bindings.TryGetValue(key,out var binding) || binding.PhotoId!=photoId || binding.Number!=number) return;
                binding.PhotoAcknowledged=true;
                if(binding.Phase==null || binding.Phase=="assembly_acknowledged") bindings.Remove(key);
                SaveBindings(null);
            }
        }
    }
}
