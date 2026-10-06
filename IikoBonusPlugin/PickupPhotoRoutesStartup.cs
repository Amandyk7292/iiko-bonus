using System;
using System.Collections.Generic;
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
            private bool Current=>!disposed && generation==ownGeneration && ReferenceEquals(subscription,this);
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
                    if(generation==ownGeneration && ReferenceEquals(subscription,this)) initialized=false;
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
                observations.Clear();confirmed.Clear();probes.Clear();probeAttempts.Clear();startupDiagnostic=null;
                probeTimeoutSeconds=Math.Max(1,Math.Min(60,timeoutSeconds));
                path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaPickupPhotoRoutes.json");
                try {bindings=DurableJsonFile.ReadValidated<Dictionary<string,PickupPhotoRouteBinding>>(path,Valid,false);healthy=true;}
                catch {bindings=new Dictionary<string,PickupPhotoRouteBinding>();PickupPhotoPrinter.Diagnose("route_journal",null,"invalid");}
                current=new Subscription(os,generation);subscription=current;
            }
            previous?.Dispose();current.TryRegister(false);return current;
        }
        private static void EnsureRegistration()
        {
            Subscription current;lock(gate) current=subscription;
            current?.TryRegister(true);
        }
        private static bool Active(ProbeAttempt attempt)=>initialized && attempt.Generation==generation;
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
                    try
                    {
                        lock(gate) {if(!Active(attempt) || observation.Expired) return false;}
                        return os.Print(queue,(Document)doc,true);
                    }
                    finally {lease.Dispose();}
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
                if(flight==null) lease.Dispose();
            }
        }
    }
}
