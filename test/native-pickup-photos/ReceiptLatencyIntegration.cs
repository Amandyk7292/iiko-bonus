using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;

internal static partial class Program
{
    private static void WithAutomaticHttp(Func<HttpRequestMessage,HttpResponseMessage> reply,Action run)
    {
        var field=typeof(Resto.Front.Api.IikoBonusPlugin.LoyaltyFlow).GetField("_httpClient",Static);
        var previous=(HttpClient)field.GetValue(null);
        using(var replacement=new HttpClient(new FakeHttp {Reply=reply}))
        {
            field.SetValue(null,replacement);
            try {run();} finally {field.SetValue(null,previous);}
        }
    }

    private static void AutomaticTick(object automatic)=>Call(AutomaticWorker,"Tick",automatic,new object[]{null});
    private static bool AutomaticBusy(object automatic)=>(int)AutomaticWorker.GetField("busy",Instance).GetValue(automatic)!=0;

    private static void ReceiptLatencyIntegration()
    {
        WithReceiptScenario((state,photos,automatic)=>
        {
            state.Assembly="printed";
            Check(ProcessAutomatic(automatic,state) && state.Claims==0 && state.Binds==0 && state.DraftReads==0 &&
                state.PaymentTypeReads==0 && state.FiscalSdkCalls==0 && printed==0 && assemblyPrints==0,
                "an idle prepared order uses no claim/bind, payment reads or physical print calls");
            var pollCount=0;
            WithAutomaticHttp(request=>
            {
                Check(request.RequestUri.AbsolutePath.EndsWith("/receipts/poll"),"idle background work sends only its queue poll");
                var body=request.Content.ReadAsStringAsync().Result;
                Check(body.Contains("\"workOnly\":true"),"automatic queue poll requests only actionable work");
                pollCount++;
                return ReceiptReply(request,state); // An older server may still include idle rows.
            },()=>AutomaticTick(automatic));
            Check(pollCount==1 && state.Claims==0 && state.Binds==0 &&
                (int)AutomaticWorker.GetProperty("PendingCount",Instance).GetValue(automatic)==0,
                "a legacy unfiltered queue cannot make idle rows consume worker round trips or pending count");
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            var assemblyOrder=Guid.NewGuid().ToString();
            var claimsInOrder=new List<string>();
            WithAutomaticHttp(request=>
            {
                if(request.RequestUri.AbsolutePath.EndsWith("/receipts/poll"))
                    return Json("{\"jobs\":[{\"orderId\":\""+assemblyOrder+"\",\"number\":1056,\"fiscalDue\":false,\"assemblyStatus\":\"pending\"},"+
                        "{\"orderId\":\""+orderId+"\",\"number\":1057,\"fiscalDue\":true,\"assemblyStatus\":\"printed\"}]}");
                ActionBody action;
                using(var stream=request.Content.ReadAsStreamAsync().Result)
                    action=(ActionBody)new DataContractJsonSerializer(typeof(ActionBody)).ReadObject(stream);
                if(action.Action=="claim")
                {
                    claimsInOrder.Add(action.Order);
                    return Json("{\"error\":\"Controlled claim rejection before any SDK print\"}",HttpStatusCode.Conflict);
                }
                if(action.Action=="problem") return Json("{\"status\":\"assigned\"}");
                throw new InvalidOperationException("Latency ordering fixture cannot authorize another action: "+action.Action);
            },()=>AutomaticTick(automatic));
            Check(claimsInOrder.Count==2 && claimsInOrder[0]==orderId && claimsInOrder[1]==assemblyOrder &&
                printed==0 && assemblyPrints==0 && state.FiscalSdkCalls==0,
                "fiscal handover work precedes older assembly work without bypassing either server claim; claims="+
                string.Join(",",claimsInOrder)+"; paymentReads="+state.PaymentTypeReads+"; status="+
                AutomaticWorker.GetProperty("StatusText",Instance).GetValue(automatic));
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            var polls=0;var concurrent=0;var maximumConcurrent=0;var workOnly=true;
            using(var entered=new ManualResetEvent(false))
            using(var release=new ManualResetEvent(false))
            WithAutomaticHttp(request=>
            {
                if(!request.RequestUri.AbsolutePath.EndsWith("/receipts/poll"))
                    throw new InvalidOperationException("Wakeup fixture cannot dispatch print work");
                var active=Interlocked.Increment(ref concurrent);
                maximumConcurrent=Math.Max(maximumConcurrent,active);
                try
                {
                    workOnly &= request.Content.ReadAsStringAsync().Result.Contains("\"workOnly\":true");
                    if(Interlocked.Increment(ref polls)==1)
                    {
                        entered.Set();
                        if(!release.WaitOne(5000)) throw new TimeoutException("Test poll gate was not released");
                    }
                    return Json("{\"jobs\":[]}");
                }
                finally {Interlocked.Decrement(ref concurrent);}
            },()=>
            {
                var initial=Task.Run(()=>AutomaticTick(automatic));
                try
                {
                    Check(entered.WaitOne(3000),"receipt worker can be held inside its real HTTP poll");
                    for(var attempt=0;attempt<8;attempt++) Call(AutomaticWorker,"RequestRetry",automatic);
                    Check(Volatile.Read(ref polls)==1,"busy worker coalesces wakeups without overlapping queue polls");
                }
                finally {release.Set();initial.GetAwaiter().GetResult();}
                WaitUntil(()=>Volatile.Read(ref polls)>=2 && !AutomaticBusy(automatic),"immediate receipt follow-up poll");
                Check(polls==2 && maximumConcurrent==1 && workOnly && printed==0 && assemblyPrints==0,
                    "wakeups during an active worker produce one immediate serialized follow-up without a five-second timer wait");
            });
        });

        WithReceiptScenario((state,photos,automatic)=>
        {
            var polls=0;
            WithAutomaticHttp(request=>
            {
                Check(request.RequestUri.AbsolutePath.EndsWith("/receipts/poll"),"manual recovery of idle queue makes no mutation calls");
                Check(request.Content.ReadAsStringAsync().Result.Contains("\"workOnly\":true"),"manual recovery also requests only actionable work");
                polls++;
                state.Assembly="printed";
                return ReceiptReply(request,state);
            },()=>Call(AutomaticWorker,"CheckAndRecover",automatic));
            Check(polls==1 && state.Claims==0 && state.Binds==0 && printed==0 && assemblyPrints==0,
                "manual recovery excludes idle prepared orders without repeating any ticket");
        });

        foreach(var recovery in new[]{false,true})
        WithReceiptScenario((state,photos,automatic)=>
        {
            var obsoleteOrder=Guid.NewGuid().ToString();
            var polls=0;var claimCount=0;var claimedOrder="";
            WithAutomaticHttp(request=>
            {
                if(request.RequestUri.AbsolutePath.EndsWith("/receipts/poll"))
                {
                    if(Interlocked.Increment(ref polls)>1) return Json("{\"jobs\":[]}");
                    return Json("{\"jobs\":[{\"orderId\":\""+orderId+"\",\"number\":1057,\"fiscalDue\":true,\"assemblyStatus\":\"printed\"},"+
                        "{\"orderId\":\""+obsoleteOrder+"\",\"number\":1056,\"fiscalDue\":false,\"assemblyStatus\":\"pending\"}]}");
                }
                ActionBody action;
                using(var stream=request.Content.ReadAsStreamAsync().Result)
                    action=(ActionBody)new DataContractJsonSerializer(typeof(ActionBody)).ReadObject(stream);
                if(action.Action=="claim")
                {
                    Interlocked.Increment(ref claimCount);claimedOrder=action.Order;
                    Call(AutomaticWorker,"RequestRetry",automatic);
                    return Json("{\"error\":\"Controlled claim rejection\"}",HttpStatusCode.Conflict);
                }
                if(action.Action=="problem") return Json("{\"status\":\"assigned\"}");
                throw new InvalidOperationException("Batch wakeup fixture cannot authorize another action: "+action.Action);
            },()=>
            {
                if(recovery) Call(AutomaticWorker,"CheckAndRecover",automatic);else AutomaticTick(automatic);
                WaitUntil(()=>Volatile.Read(ref polls)>=2 && !AutomaticBusy(automatic),"fresh queue before old batch continues");
                Check(polls==2 && claimCount==1 && claimedOrder==orderId && printed==0 && assemblyPrints==0,
                    (recovery?"manual recovery":"automatic worker")+" retains a wakeup inside job processing and refreshes before the remaining stale batch");
            });
        });
    }
}
