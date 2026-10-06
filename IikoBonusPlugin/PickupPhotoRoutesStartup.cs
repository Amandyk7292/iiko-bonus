using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Xml.Linq;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static partial class PickupPhotoRoutes
    {
        private const int MaximumStartupAttempts=3;
        private static Func<DateTime> utcNow=()=>DateTime.UtcNow;
        private static Action beforeProbe=null;
        private static int observationWaitMilliseconds=5000,observationSettleMilliseconds=250;
        private static readonly Dictionary<string,ProbeAttempt> probeAttempts=new Dictionary<string,ProbeAttempt>();
        private static Subscription subscription;
        private static string startupDiagnostic;
        internal static string DiagnosticStatus {get {lock(gate) return startupDiagnostic;}}
        internal static bool RegistrationBusy {get {lock(gate) return subscription?.InFlight==true;}}
        private static DateTime RetryAt(int attempts)=>utcNow().AddSeconds(30*attempts);
        private sealed class ProbeAttempt
        {
            internal int Generation,Attempts;
            internal bool InFlight,Retryable;
            internal DateTime RetryAt;
        }
        private sealed class Subscription:IDisposable
        {
            private readonly IOperationService os;
            private readonly int ownGeneration;
            private IDisposable handler;
            private bool disposed;
            private int attempts;
            private DateTime retryAt;
            internal bool InFlight;
            internal Subscription(IOperationService os,int ownGeneration){this.os=os;this.ownGeneration=ownGeneration;}
            internal bool Current=>!disposed && generation==ownGeneration && ReferenceEquals(subscription,this);
            internal void TryRegister(bool asynchronously)
            {
                lock(gate)
                {
                    if(!Current || initialized || InFlight || attempts>=MaximumStartupAttempts || utcNow()<retryAt) return;
                    InFlight=true;attempts++;
                }
                if(asynchronously) Task.Run((Action)Register);else Register();
            }
            private void Register()
            {
                lock(gate) {if(!Current){InFlight=false;return;}}
                IDisposable registered=null;string failure=null;
                try
                {
                    registered=os.RegisterBeforeFormatDocumentHandler(args=>BeforeFormat(args,ownGeneration));
                    if(registered==null) failure="null";
                }
                catch(Exception error) {failure=error.GetType().Name;}
                lock(gate)
                {
                    InFlight=false;
                    if(Current)
                    {
                        if(registered!=null) {handler=registered;registered=null;initialized=true;startupDiagnostic=null;}
                        else
                        {
                            retryAt=RetryAt(attempts);
                            startupDiagnostic="callback_registration_failed attempt="+attempts+" type="+failure+
                                (attempts<MaximumStartupAttempts ? " retry=pending" : " retry=exhausted");
                        }
                    }
                }
                // The SDK may return after disposal or a newer Start. A stale
                // registration is never allowed to revive readiness or leak.
                DisposeHandler(registered);
                if(failure!=null) PickupPhotoPrinter.Diagnose("route_callback",null,failure);
            }
            public void Dispose()
            {
                IDisposable old;
                lock(gate)
                {
                    if(disposed) return;disposed=true;old=handler;handler=null;
                    if(generation==ownGeneration && ReferenceEquals(subscription,this))
                    {
                        initialized=false;
                        foreach(var observation in observations.Values) {observation.Expired=true;Signal(observation);}
                    }
                }
                DisposeHandler(old);
            }
            private static void DisposeHandler(IDisposable value)
            {
                try {value?.Dispose();}
                catch(Exception error) {PickupPhotoPrinter.Diagnose("route_callback_dispose",null,error.GetType().Name);}
            }
        }
        internal static IDisposable Start(IOperationService os,int timeoutSeconds=30)
        {
            Subscription previous,current;
            lock(gate)
            {
                previous=subscription;initialized=false;healthy=false;generation++;
                foreach(var observation in observations.Values) {observation.Expired=true;Signal(observation);}
                observations.Clear();confirmed.Clear();probes.Clear();probeAttempts.Clear();startupDiagnostic=null;
                probeTimeoutSeconds=Math.Max(1,Math.Min(60,timeoutSeconds));
                path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaPickupPhotoRoutes.json");
                try {bindings=DurableJsonFile.ReadValidated<Dictionary<string,PickupPhotoRouteBinding>>(path,Valid,false);healthy=true;}
                catch {bindings=new Dictionary<string,PickupPhotoRouteBinding>();PickupPhotoPrinter.Diagnose("route_journal",null,"invalid");}
                current=new Subscription(os,generation);subscription=current;
            }
            previous?.Dispose();current.TryRegister(true);return current;
        }
        private static void EnsureRegistration()
        {
            Subscription current;lock(gate) current=subscription;
            current?.TryRegister(true);
        }
        private static bool Active(ProbeAttempt attempt)=>initialized && attempt.Generation==generation;
        private static void Signal(Observation observation)
        {
            observation.Changed.TrySetResult(true);
            observation.Changed=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        private static async Task<string> AwaitObservation(Observation observation,ProbeAttempt attempt)
        {
            var elapsed=Stopwatch.StartNew();
            var maximum=Math.Max(1,Math.Min(10000,observationWaitMilliseconds));
            var settle=Math.Max(1,Math.Min(maximum,observationSettleMilliseconds));
            while(true)
            {
                Task signal;long remaining;
                lock(gate)
                {
                    if(!Active(attempt) || observation.Expired) return "stale";
                    if(observation.Ambiguous) return "probe_ambiguous";
                    var quiet=(Stopwatch.GetTimestamp()-observation.LastObservedTick)*1000.0/Stopwatch.Frequency;
                    remaining=maximum-elapsed.ElapsedMilliseconds;
                    if(remaining<=0)
                    {
                        if(observation.Device.HasValue && quiet>=settle) return null;
                        observation.Expired=true;
                        return observation.Device.HasValue ? "probe_callback_unsettled" :
                            observation.CallbacksSeen==0 ? "probe_callback_not_seen" : "probe_marker_not_seen";
                    }
                    signal=observation.Changed.Task;
                }
                // The queue can return success before formatting begins. Keep
                // the original nonce live; no further physical Print is sent.
                await Task.WhenAny(signal,Task.Delay((int)Math.Max(1,remaining)));
            }
        }
        private static void ProbeOutcome(Route route,ProbeAttempt attempt,string status,string detail,bool retryable)
        {
            lock(gate)
            {
                if(attempt.Generation!=generation || !initialized) return;
                probes[route.Key]=status;attempt.Retryable=retryable && attempt.Attempts<MaximumStartupAttempts;
                attempt.RetryAt=RetryAt(attempt.Attempts);
                startupDiagnostic=detail+" attempt="+attempt.Attempts+
                    (attempt.Retryable ? " retry=pending" : retryable ? " retry=exhausted" : " retry=blocked");
            }
        }
        private static async Task Probe(IOperationService os,IPrinterQueueRef queue,Route route,ProbeAttempt attempt,IDisposable lease)
        {
            Observation observation=null;Task<bool> flight=null;
            try
            {
                beforeProbe?.Invoke();
                var doc=new XElement("doc",new XElement("center","Bulka — проверка фотопечати"));
                lock(gate)
                {
                    if(!Active(attempt)) return;
                    observation=Attach(queue,doc);
                }
                if(observation==null) {ProbeOutcome(route,attempt,"device_unmapped","probe_attach_failed",true);return;}
                flight=Task.Run(()=>
                {
                    lock(gate) {if(!Active(attempt) || observation.Expired) return false;}
                    return os.Print(queue,(Document)doc,true);
                });
                if(await Task.WhenAny(flight,Task.Delay(TimeSpan.FromSeconds(probeTimeoutSeconds)))!=flight)
                {
                    lock(gate) observation.Expired=true;
                    ProbeOutcome(route,attempt,"driver_unavailable","probe_timeout",false);uncertainProbeFlight=true;
                    PickupPhotoPrinter.Diagnose("route_probe",route.Queue,"timeout");
                    // A late SDK completion cannot authorize a retry. Keep the
                    // shared lease until the physical call actually terminates.
                    try {await flight;} catch { } finally {uncertainProbeFlight=false;}
                    Complete(observation,false);return;
                }
                var result=await flight;
                if(result)
                {
                    var failure=await AwaitObservation(observation,attempt);
                    if(failure!=null)
                    {
                        Complete(observation,false);
                        if(failure!="stale") ProbeOutcome(route,attempt,failure=="probe_ambiguous" ? "ambiguous_printer" : "device_unmapped",failure,false);
                        return;
                    }
                }
                bool safeNegative;
                lock(gate) safeNegative=!result && !observation.Device.HasValue && !observation.Ambiguous;
                Complete(observation,result);
                if(!result)
                {
                    ProbeOutcome(route,attempt,observation.Ambiguous ? "ambiguous_printer" : "device_unmapped",
                        observation.Ambiguous ? "probe_ambiguous" : safeNegative ? "probe_negative_unobserved" : "probe_negative_observed",safeNegative);
                    PickupPhotoPrinter.Diagnose("route_probe",route.Queue,"negative_completion");
                }
                else lock(gate)
                {
                    if(Active(attempt))
                    {
                        if(confirmed.ContainsKey(route.Key)) startupDiagnostic=null;
                        else ProbeOutcome(route,attempt,observation.Ambiguous ? "ambiguous_printer" : "device_unmapped",
                            observation.Ambiguous ? "probe_ambiguous" : "probe_missing_callback",false);
                    }
                }
            }
            catch(Exception error)
            {
                Complete(observation,false);
                ProbeOutcome(route,attempt,flight==null ? "device_unmapped" : "driver_unavailable",
                    (flight==null ? "probe_predispatch_failed" : "probe_dispatch_failed")+" type="+error.GetType().Name,flight==null);
                PickupPhotoPrinter.Diagnose("route_probe",route.Queue,error.GetType().Name);
            }
            finally
            {
                lock(gate) attempt.InFlight=false;
                // SDK completion alone does not end a positive bill/document
                // observation. Serialize the callback grace with photo work.
                lease.Dispose();
            }
        }
    }
}
