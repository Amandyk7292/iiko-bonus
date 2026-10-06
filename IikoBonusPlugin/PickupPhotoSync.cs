using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api.Data.Print;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal enum PickupPhotoOutcome { Pending,Printed,Uncertain }
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
                var terminalId=PluginContext.Operations.GetHostTerminal().Id.ToString();
                // A timer can reconcile existing physical evidence only. A new
                // photo is exclusively orchestrated before its assembly ticket.
                foreach(var saved in ledger.Values.Where(entry=>entry.BranchId==LoyaltyFlow.BranchId
                    && entry.TerminalId==terminalId && entry.AcknowledgedAt==null)
                    .OrderBy(entry=>entry.Status=="printed" ? 0 : 1).Take(20).ToArray())
                {
                    if(disposed) break;
                    try
                    {
                        if(saved.Status=="printed") Acknowledge(saved,terminalId);
                        else Action(terminalId,saved.OrderId,"uncertain","PRINT_OUTCOME_UNCERTAIN");
                    }
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
            var previous=saved.AcknowledgedAt;saved.AcknowledgedAt=DateTime.UtcNow.ToString("o");
            try {PruneAcknowledged();DurableJsonFile.Write(path,ledger);}
            catch {saved.AcknowledgedAt=previous;RefreshCount();throw;}
            PickupPhotoRoutes.ForgetAcknowledged(saved.BranchId,saved.TerminalId,saved.OrderId,saved.PhotoId,saved.Number);
        }
        private PickupPhotoJob CurrentJob(string terminalId,string orderId,string photoId,long number)
        {
            var result=PickupPhotoTransport.Post("poll",new PickupPhotoPoll {TerminalId=terminalId},terminalId);
            if(result.Jobs==null || result.Jobs.Count>20) throw new InvalidDataException("Недопустимая очередь фотопечати.");
            var jobs=result.Jobs.Where(job=>job!=null && job.OrderId==orderId).ToArray();
            if(jobs.Length==0) return null;
            if(jobs.Length!=1 || jobs[0].PhotoId!=photoId || jobs[0].Number!=number
                || !new[]{"pending","printing","printed","uncertain"}.Contains(jobs[0].Status))
                throw new InvalidDataException("Изменилось задание фотопечати.");
            return jobs[0];
        }
        internal bool HasPrintedProof(IOperationService os,string orderId,string photoId,long number)
        {
            if(disposed || !storageHealthy || Interlocked.CompareExchange(ref busy,1,0)!=0) return false;
            try
            {
                return ledger.TryGetValue(orderId,out var saved) && saved.Status=="printed" && saved.PhotoId==photoId
                    && saved.Number==number && saved.BranchId==LoyaltyFlow.BranchId
                    && saved.TerminalId==os.GetHostTerminal().Id.ToString();
            }
            finally {Interlocked.Exchange(ref busy,0);}
        }
        internal PickupPhotoOutcome BeforeAssembly(IOperationService os,string orderId,string photoId,long number,
            PickupPhotoPrinterSelection selected,PickupPhotoRoutes.Lease lease)
        {
            if(disposed || !storageHealthy || lease==null || selected==null || !Guid.TryParse(orderId,out _)
                || !Guid.TryParse(photoId,out _) || number<=0 || Interlocked.CompareExchange(ref busy,1,0)!=0)
                return PickupPhotoOutcome.Pending;
            try {return PrintBeforeAssembly(os,orderId,photoId,number,selected,lease);}
            catch {StatusText="Фото №"+number+": ожидаем подтверждение перед сборочным чеком";return PickupPhotoOutcome.Pending;}
            finally {Interlocked.Exchange(ref busy,0);}
        }
        private PickupPhotoOutcome PrintBeforeAssembly(IOperationService os,string orderId,string photoId,long number,
            PickupPhotoPrinterSelection selected,PickupPhotoRoutes.Lease lease)
        {
            var branchId=LoyaltyFlow.BranchId;var terminalId=os.GetHostTerminal().Id.ToString();
            if(!PickupPhotoRoutes.IsReserved(branchId,terminalId,orderId,photoId,number)) return PickupPhotoOutcome.Pending;
            if(ledger.TryGetValue(orderId,out var saved))
            {
                if(saved.PhotoId!=photoId || saved.BranchId!=branchId || saved.TerminalId!=terminalId || saved.Number!=number)
                    throw new InvalidDataException("Задание фотопечати требует сверки.");
                if(saved.Status=="printed")
                {
                    if(saved.AcknowledgedAt==null) {try {Acknowledge(saved,terminalId);} catch { }}
                    return PickupPhotoOutcome.Printed;
                }
                // A started record survives crashes, printer exceptions and lost
                // acknowledgements. It never authorizes another print attempt.
                try {Action(terminalId,orderId,"uncertain","PRINT_OUTCOME_UNCERTAIN");} catch { }
                StatusText="Фото №"+number+": проверьте ленту принтера; автоматический повтор запрещён";
                return PickupPhotoOutcome.Uncertain;
            }
            var job=CurrentJob(terminalId,orderId,photoId,number);
            if(job==null) return PickupPhotoOutcome.Pending;
            // Server completion without this terminal's durable physical proof
            // never authorizes another strip or an automatic assembly sequence.
            if(job.Status!="pending")
            {
                try {Action(terminalId,orderId,"uncertain","CLAIM_OUTCOME_UNCERTAIN");} catch { }
                StatusText="Фото №"+number+": требуется сверка ленты";return PickupPhotoOutcome.Uncertain;
            }
            if(unconfirmedCount>=MaximumUnconfirmed)
            {
                StatusText="Фото в подарок: сверка незавершённых заданий; новая печать приостановлена";return PickupPhotoOutcome.Pending;
            }
            // Keep the exact inspected printer and width through claim/download/print.
            var printer=selected.Printer;
            var widthDots=selected.WidthDots;
            var claim=Action(terminalId,orderId,"claim");
            if(claim.Status!="print") return claim.Status=="uncertain" ? PickupPhotoOutcome.Uncertain : PickupPhotoOutcome.Pending;
            var sdkInvoked=0;var cancelDispatch=0;Task<bool> flight=null;
            try
            {
                if(claim.PhotoId!=photoId || claim.Number!=number) throw new InvalidDataException("Изменилось задание фотопечати.");
                var image=PickupPhotoTransport.Image(orderId,terminalId,widthDots);
                var document=PickupPhotoRaster.Prepare(image,widthDots);
                if(disposed) throw new OperationCanceledException();
                saved=new PickupPhotoLedgerEntry {OrderId=orderId,PhotoId=photoId,Number=number,
                    BranchId=branchId,TerminalId=terminalId,Status="started",StartedAt=DateTime.UtcNow.ToString("o"),
                    ImageSha256=PickupPhotoRaster.Hash(image)};
                ledger.Add(orderId,saved);RefreshCount();
                DurableJsonFile.Write(path,ledger); // Must succeed before any SDK print call.
                flight=Task.Run(()=>
                {
                    // Revalidate acceptance after download/preparation and while
                    // holding the shared lease, immediately before SDK dispatch.
                    var current=CurrentJob(terminalId,orderId,photoId,number);
                    if(current?.Status!="printing" || disposed || Volatile.Read(ref cancelDispatch)!=0
                        || LoyaltyFlow.BranchId!=branchId || os.GetHostTerminal().Id.ToString()!=terminalId)
                        throw new OperationCanceledException();
                    Interlocked.Exchange(ref sdkInvoked,1);
                    return os.Print(printer,document);
                });
                printerFlight=flight;lease.Track(flight);
                if(!flight.Wait(printTimeout) || !flight.Result) throw new InvalidOperationException("PRINT_OUTCOME_UNCERTAIN");
                saved.Status="printed";
                DurableJsonFile.Write(path,ledger); // Persist before acknowledgement; retries only ack.
                try {Acknowledge(saved,terminalId);} catch { }
                StatusText="Фото №"+number+": напечатано";
                return PickupPhotoOutcome.Printed;
            }
            catch
            {
                Interlocked.Exchange(ref cancelDispatch,1);
                if(Volatile.Read(ref sdkInvoked)==0 && (flight==null || flight.IsCompleted))
                {
                    // No SDK invocation exists or can start later. Safe retry
                    // remains restricted to this order's before-assembly path.
                    if(saved!=null) {ledger.Remove(orderId);RefreshCount();try {DurableJsonFile.Write(path,ledger);} catch {storageHealthy=false;}}
                    try {Action(terminalId,orderId,"release","PHOTO_PREPARE_FAILED");} catch { }
                    StatusText="Фото №"+number+": ожидаем печать перед сборочным чеком";return PickupPhotoOutcome.Pending;
                }
                printerOutcomeUncertain=true;
                saved.Status="uncertain";
                try {DurableJsonFile.Write(path,ledger);} catch {storageHealthy=false;}
                try {Action(terminalId,orderId,"uncertain","PRINT_OUTCOME_UNCERTAIN");} catch { }
                StatusText="Фото №"+number+": проверьте ленту; повтор и сборочный чек остановлены";
                return PickupPhotoOutcome.Uncertain;
            }
        }
        internal void RequestRetry() {if(!disposed) ThreadPool.QueueUserWorkItem(Tick);}
        public void Dispose() {disposed=true;timer?.Dispose();}
    }
}
