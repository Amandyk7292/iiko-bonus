using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.IikoBonusPlugin;

internal static class StockSyncTests
{
    private static void Check(bool value,string message) { if(!value) throw new Exception(message); }
    private static void Wait(ManualResetEventSlim signal,string message) { Check(signal.Wait(1200),message); }
    private static int Main()
    {
        try { Receipts(); Snapshots(); Console.WriteLine("PASS: durable immediate receipt delivery, busy-worker drain, disputed receipt isolation, snapshot event refresh."); return 0; }
        catch(Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static void Receipts()
    {
        LoyaltyFlow.DataDirectoryPath=Path.Combine(Path.GetTempPath(),"Bulka-stock-test-"+Guid.NewGuid());
        var first=new TestOrder(); var second=new TestOrder(); var failed=new TestOrder(); var fourth=new TestOrder();
        var entered=new ManualResetEventSlim(); var release=new ManualResetEventSlim();
        var secondSent=new ManualResetEventSlim(); var failedSent=new ManualResetEventSlim();
        var fourthSent=new ManualResetEventSlim();
        Exception workerError=null;
        LoyaltyFlow.Handler=(path,payload)=> {
            try {
                var receipt=(OfflineReceipt)payload;
                var journal=DurableJsonFile.Read<Dictionary<string,OfflineReceipt>>(Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaOfflineReceipts.json"));
                Check(journal.ContainsKey(receipt.ReceiptId),"HTTP must follow durable journal persistence");
                if(receipt.ReceiptId==first.Id.ToString()) { entered.Set(); Check(release.Wait(3000),"blocked HTTP not released"); }
                if(receipt.ReceiptId==second.Id.ToString()) secondSent.Set();
                if(receipt.ReceiptId==failed.Id.ToString()) { failedSent.Set(); return new TestResponse { IsSuccessStatusCode=false }; }
                if(receipt.ReceiptId==fourth.Id.ToString()) fourthSent.Set();
                return new TestResponse();
            } catch(Exception error) { workerError=error; throw; }
        };
        using(var sync=new OfflineReceiptSync())
        {
            sync.Observe(first);
            Wait(entered,"closed receipt waited for the two-second timer");
            sync.Observe(second);
            release.Set();
            Wait(secondSent,"receipt arriving during HTTP waited for the retry timer");
            sync.Observe(failed);
            Wait(failedSent,"failure scenario not exercised");
            sync.Observe(fourth);
            Wait(fourthSent,"disputed receipt blocked an unrelated sale");
            Check(SpinWait.SpinUntil(()=>sync.StatusText.Contains("витрина обновлена"),500),"last receipt not acknowledged");
        }
        if(workerError!=null) throw workerError;
        var pending=DurableJsonFile.Read<Dictionary<string,OfflineReceipt>>(Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaOfflineReceipts.json"));
        Check(pending.ContainsKey(failed.Id.ToString()),"failed receipt must survive restart");
        Check(!pending.ContainsKey(first.Id.ToString()) && !pending.ContainsKey(second.Id.ToString()),"acknowledged receipts must leave the journal");
    }
    private static void Snapshots()
    {
        var sent=new ManualResetEventSlim();
        decimal quantity=0;
        LoyaltyFlow.Handler=(path,payload)=> { quantity=((StockSnapshot)payload).Items[0].Quantity; sent.Set(); return new TestResponse(); };
        using(var sync=new StockSync())
        {
            PluginContext.Operations.Quantity=5;
            PluginContext.Notifications.StopListProductsRemainingAmountsChanged.Fire();
            Check(sent.Wait(700),"changed stock waited for the periodic snapshot");
            Check(quantity==5,"wrong updated quantity");
        }
    }
}
