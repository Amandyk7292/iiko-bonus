using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class PickupPhotoSync : IDisposable
    {
        private readonly string path=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaPickupPhotos.json");
        private Dictionary<string,PickupPhotoLedgerEntry> ledger=new Dictionary<string,PickupPhotoLedgerEntry>();
        private readonly Timer timer;
        private volatile bool storageHealthy;
        private int busy;
        private volatile bool disposed;
        private volatile Task<bool> printerFlight;
        private volatile bool printerOutcomeUncertain;
        private readonly TimeSpan printTimeout;
        private const int MaximumUnconfirmed=256;
        private const int RetainedAcknowledged=2048;
        private volatile int unconfirmedCount;
        internal string StatusText {get;private set;}="Фото в подарок: ожидание привязки кассы";
        internal bool CanAcceptJobs
        {
            get
            {
                var flight=printerFlight;
                return storageHealthy && !disposed && unconfirmedCount<MaximumUnconfirmed
                    && (!printerOutcomeUncertain || flight==null || flight.IsCompleted) && !PickupPhotoRoutes.UncertainPrintBusy;
            }
        }
        internal PickupPhotoSync(bool startTimer=true,int timeoutSeconds=30)
        {
            printTimeout=TimeSpan.FromSeconds(Math.Max(1,Math.Min(60,timeoutSeconds)));
            TryLoad();
            if(startTimer) timer=new Timer(Tick,null,TimeSpan.FromSeconds(10),TimeSpan.FromSeconds(5));
        }
        private bool TryLoad()
        {
            try
            {
                ledger=DurableJsonFile.ReadValidated<Dictionary<string,PickupPhotoLedgerEntry>>(path,
                    entries=>entries.All(pair=>pair.Value!=null && pair.Key==pair.Value.OrderId
                        && Guid.TryParse(pair.Key,out _) && Guid.TryParse(pair.Value.PhotoId,out _)
                        && Guid.TryParse(pair.Value.BranchId,out _) && Guid.TryParse(pair.Value.TerminalId,out _)
                        && pair.Value.Number>0 && new[]{"started","printed","uncertain"}.Contains(pair.Value.Status)),false);
                RefreshCount();storageHealthy=true;return true;
            }
            catch
            {
                storageHealthy=false;
                StatusText="Фото в подарок: журнал требует сверки; повторная печать остановлена";
                PluginContext.Log.Error("Bulka photo gift ledger requires reconciliation");
                return false;
            }
        }
        internal static int PrintableWidth(IOperationService os)
        {
            if(!PickupPhotoPrinter.TrySelect(os,out var selected,out var reason))
                throw new InvalidOperationException(PickupPhotoPrinter.StatusMessage(reason));
            return selected.WidthDots;
        }
        internal static bool PrinterReady(IOperationService os) => PickupPhotoPrinter.TrySelect(os,out _,out _);
        internal string ReadinessStatus(IOperationService os,out PickupPhotoPrinterSelection selected)
        {
            selected=null;
            if(disposed) return "stopped";
            if(!storageHealthy) return "journal_unhealthy";
            if(unconfirmedCount>=MaximumUnconfirmed) return "queue_full";
            var flight=printerFlight;
            if(printerOutcomeUncertain && flight!=null && !flight.IsCompleted) return "print_in_progress";
            if(PickupPhotoRoutes.UncertainPrintBusy) return "print_in_progress";
            PickupPhotoPrinter.TrySelect(os,out selected,out var status);
            return status;
        }
        private void Tick(object state)
        {
            if(disposed || !PosPairing.IsPaired || Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                // An SDK call that timed out can still complete physically.
                // Wait for that call to finish before submitting any new image.
                var flight=printerFlight;
                if((flight!=null && !flight.IsCompleted) || PickupPhotoRoutes.PrintBusy) return;
                printerFlight=null;
                printerOutcomeUncertain=false;
                if(!storageHealthy && !TryLoad()) return;
                var os=PluginContext.Operations;var terminalId=os.GetHostTerminal().Id.ToString();
                var result=PickupPhotoTransport.Post("poll",new PickupPhotoPoll {TerminalId=terminalId},terminalId);
                if(result.Jobs==null || result.Jobs.Count>20) throw new InvalidDataException("Недопустимая очередь фотопечати.");
                foreach(var job in result.Jobs)
                {
                    if(disposed || (printerFlight!=null && !printerFlight.IsCompleted)) break;
                    try {Process(job,os,terminalId);}
                    catch {StatusText="Фото в подарок: требуется проверка очереди или принтера";}
                }
            }
            catch {StatusText="Фото в подарок: нет связи с Bulka";}
            finally {Interlocked.Exchange(ref busy,0);}
        }
        private PickupPhotoResponse Action(string terminalId,string orderId,string action,string error=null) =>
            PickupPhotoTransport.Post("action",new PickupPhotoAction {TerminalId=terminalId,OrderId=orderId,Action=action,Error=error},terminalId);
        private void RefreshCount() => unconfirmedCount=ledger.Values.Count(entry=>entry.Status!="printed" || entry.AcknowledgedAt==null);
        private void PruneAcknowledged()
        {
            // Only a terminal, irreversible server acknowledgement permits
            // pruning. Local started/uncertain evidence is retained forever.
            var retired=ledger.Values.Where(entry=>entry.Status=="printed" && entry.AcknowledgedAt!=null)
                .OrderByDescending(entry=>entry.AcknowledgedAt,StringComparer.Ordinal).Skip(RetainedAcknowledged)
                .Select(entry=>entry.OrderId).ToArray();
            foreach(var id in retired) ledger.Remove(id);
            RefreshCount();
        }
        private void Acknowledge(PickupPhotoLedgerEntry saved,string terminalId)
        {
            var result=Action(terminalId,saved.OrderId,"complete");
            if(result.Status!="printed" || result.PhotoId!=saved.PhotoId || result.Number!=saved.Number)
                throw new InvalidDataException("Сервер не подтвердил завершение фотопечати.");
            saved.AcknowledgedAt=DateTime.UtcNow.ToString("o");
            PruneAcknowledged();DurableJsonFile.Write(path,ledger);
            PickupPhotoRoutes.ForgetAcknowledged(saved.BranchId,saved.TerminalId,saved.OrderId,saved.PhotoId,saved.Number);
        }
        private void Process(PickupPhotoJob job,IOperationService os,string terminalId)
        {
            if(job==null || !Guid.TryParse(job.OrderId,out _) || !Guid.TryParse(job.PhotoId,out _)
                || job.Number<=0 || !new[]{"pending","printing","printed","uncertain"}.Contains(job.Status))
                throw new InvalidDataException("Недопустимое задание фотопечати.");
            var branchId=LoyaltyFlow.BranchId;
            if(ledger.TryGetValue(job.OrderId,out var saved))
            {
                if(saved.PhotoId!=job.PhotoId || saved.BranchId!=branchId || saved.TerminalId!=terminalId || saved.Number!=job.Number)
                    throw new InvalidDataException("Задание фотопечати требует сверки.");
                if(saved.Status=="printed") {Acknowledge(saved,terminalId);return;}
                // A started record survives crashes, printer exceptions and lost
                // acknowledgements. It never authorizes another print attempt.
                Action(terminalId,job.OrderId,"uncertain","PRINT_OUTCOME_UNCERTAIN");
                StatusText="Фото №"+job.Number+": проверьте ленту принтера; автоматический повтор запрещён";
                return;
            }
            if(job.Status=="printed") return;
            if(job.Status!="pending")
            {
                Action(terminalId,job.OrderId,"uncertain","CLAIM_OUTCOME_UNCERTAIN");
                StatusText="Фото №"+job.Number+": требуется сверка ленты";return;
            }
            if(unconfirmedCount>=MaximumUnconfirmed)
            {
                StatusText="Фото в подарок: сверка незавершённых заданий; новая печать приостановлена";return;
            }
            if(!PickupPhotoPrinter.TrySelectForOrder(os,job.OrderId,job.PhotoId,job.Number,out var selected,out var printerStatus))
                {StatusText=PickupPhotoPrinter.StatusMessage(printerStatus);return;}
            // Keep the exact inspected printer and width through claim/download/print.
            var printer=selected.Printer;
            var widthDots=selected.WidthDots;
            var lease=PickupPhotoRoutes.TryReservePrint();if(lease==null) return;
            var leaseInFlight=false;
            try
            {
                var claim=Action(terminalId,job.OrderId,"claim");
                if(claim.Status!="print") return;
                var printStarted=false;
                try
                {
                    if(claim.PhotoId!=job.PhotoId || claim.Number!=job.Number)
                        throw new InvalidDataException("Изменилось задание фотопечати.");
                    var image=PickupPhotoTransport.Image(job.OrderId,terminalId,widthDots);
                    var document=PickupPhotoRaster.Prepare(image,widthDots);
                    if(disposed) throw new OperationCanceledException();
                    saved=new PickupPhotoLedgerEntry {OrderId=job.OrderId,PhotoId=job.PhotoId,Number=job.Number,
                        BranchId=branchId,TerminalId=terminalId,Status="started",StartedAt=DateTime.UtcNow.ToString("o"),
                        ImageSha256=PickupPhotoRaster.Hash(image)};
                    ledger.Add(job.OrderId,saved);
                    RefreshCount();
                    DurableJsonFile.Write(path,ledger); // Must succeed before any SDK print call.
                    printStarted=true;
                    printerFlight=Task.Run(()=>{try{return os.Print(printer,document);}finally{lease.Dispose();}});
                    leaseInFlight=true;
                    if(!printerFlight.Wait(printTimeout) || !printerFlight.Result)
                        throw new InvalidOperationException("PRINT_OUTCOME_UNCERTAIN");
                    saved.Status="printed";
                    DurableJsonFile.Write(path,ledger); // Persist before acknowledgement; retries only ack.
                    Acknowledge(saved,terminalId);
                    StatusText="Фото №"+job.Number+": напечатано";
                }
                catch
                {
                    if(!printStarted)
                    {
                        // Only definite failures before invoking the printer may be
                        // released for automatic retry; no physical strip existed.
                        if(saved!=null && saved.Status=="started") {ledger.Remove(job.OrderId);RefreshCount();}
                        try {Action(terminalId,job.OrderId,"release","PHOTO_PREPARE_FAILED");} catch { }
                    }
                    else if(saved.Status!="printed")
                    {
                        printerOutcomeUncertain=true;
                        saved.Status="uncertain";
                        try {DurableJsonFile.Write(path,ledger);} catch {storageHealthy=false;}
                        try {Action(terminalId,job.OrderId,"uncertain","PRINT_OUTCOME_UNCERTAIN");} catch { }
                    }
                    // A completed print whose acknowledgement failed remains a
                    // printed tombstone. The next poll acknowledges without reprint.
                    throw;
                }
            }
            finally {if(!leaseInFlight) lease.Dispose();}
        }
        internal void RequestRetry() {if(!disposed) ThreadPool.QueueUserWorkItem(Tick);}
        public void Dispose() {disposed=true;timer?.Dispose();}
    }
}
