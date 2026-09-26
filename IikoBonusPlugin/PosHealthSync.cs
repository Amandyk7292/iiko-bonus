using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Serialization;
using System.Threading;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class PosHealthQueues
    {
        [DataMember(Name="loyaltyPending")] public int LoyaltyPending {get;set;}
        [DataMember(Name="loyaltyFailed")] public int LoyaltyFailed {get;set;}
        [DataMember(Name="giftPending")] public int GiftPending {get;set;}
        [DataMember(Name="giftFailed")] public int GiftFailed {get;set;}
        [DataMember(Name="offlineReceipts")] public int OfflineReceipts {get;set;}
        [DataMember(Name="stockPending")] public int StockPending {get;set;}
        [DataMember(Name="automaticReceipts")] public int AutomaticReceipts {get;set;}
        [DataMember(Name="personalAccountPending")] public int PersonalAccountPending {get;set;}
    }
    [DataContract] internal sealed class PosHealthStatuses
    {
        [DataMember(Name="loyalty")] public string Loyalty {get;set;}
        [DataMember(Name="gifts")] public string Gifts {get;set;}
        [DataMember(Name="stock")] public string Stock {get;set;}
        [DataMember(Name="receipts")] public string Receipts {get;set;}
        [DataMember(Name="offlineReceipts")] public string OfflineReceipts {get;set;}
        [DataMember(Name="personalAccount")] public string PersonalAccount {get;set;}
    }
    [DataContract] internal sealed class PosHealthError
    {
        [DataMember(Name="kind")] public string Kind {get;set;}
        [DataMember(Name="sourceId",EmitDefaultValue=false)] public string SourceId {get;set;}
        [DataMember(Name="message")] public string Message {get;set;}
    }
    [DataContract] internal sealed class PosHealthRequest
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="pluginVersion")] public string PluginVersion {get;set;}
        [DataMember(Name="apiVersion")] public string ApiVersion {get;set;}
        [DataMember(Name="startedAt")] public string StartedAt {get;set;}
        [DataMember(Name="connectedToMain")] public bool ConnectedToMain {get;set;}
        [DataMember(Name="printerStatus")] public string PrinterStatus {get;set;}
        [DataMember(Name="queues")] public PosHealthQueues Queues {get;set;}
        [DataMember(Name="statuses")] public PosHealthStatuses Statuses {get;set;}
        [DataMember(Name="errors")] public List<PosHealthError> Errors {get;set;}
    }
    [DataContract] internal sealed class PosHealthPolicy
    {
        [DataMember(Name="latestVersion")] public string LatestVersion {get;set;}
        [DataMember(Name="minimumVersion")] public string MinimumVersion {get;set;}
        [DataMember(Name="enforceMinimum")] public bool EnforceMinimum {get;set;}
        [DataMember(Name="downloadUrl")] public string DownloadUrl {get;set;}
        [DataMember(Name="guideUrl")] public string GuideUrl {get;set;}
    }
    [DataContract] internal sealed class PosHealthCommand
    {
        [DataMember(Name="id")] public string Id {get;set;}
        [DataMember(Name="kind")] public string Kind {get;set;}
        [DataMember(Name="sourceKey")] public string SourceKey {get;set;}
    }
    [DataContract] internal sealed class PosHealthResponse
    {
        [DataMember(Name="success")] public bool Success {get;set;}
        [DataMember(Name="status")] public string Status {get;set;}
        [DataMember(Name="policy")] public PosHealthPolicy Policy {get;set;}
        [DataMember(Name="commands")] public List<PosHealthCommand> Commands {get;set;}
        [DataMember(Name="branchVersions")] public List<string> BranchVersions {get;set;}
        [DataMember(Name="error")] public string Error {get;set;}
    }

    internal sealed class PosHealthSync : IDisposable
    {
        private readonly SharedStockGuard stock;
        private readonly OnlineReceiptSync automaticReceipts;
        private readonly OfflineReceiptSync offlineReceipts;
        private readonly Timer timer;
        private readonly string startedAt=DateTime.UtcNow.ToString("o");
        private int busy;
        private volatile bool disposed;
        internal string StatusText {get;private set;}="Мониторинг кассы: ожидает первой проверки";

        internal PosHealthSync(SharedStockGuard stockGuard,OnlineReceiptSync automatic,OfflineReceiptSync offline)
        {
            stock=stockGuard;automaticReceipts=automatic;offlineReceipts=offline;
            timer=new Timer(Tick,null,TimeSpan.FromSeconds(5),TimeSpan.FromSeconds(20));
        }

        internal static string Version => Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
        private static string Safe(string value) => string.IsNullOrWhiteSpace(value) ? "Нет данных" :
            value.Substring(0,Math.Min(1000,value.Length));
        private static bool Problem(string value)
        {
            var text=(value ?? "").ToLowerInvariant();
            return text.Contains("ошиб") || text.Contains("требуют") || text.Contains("не чита") ||
                text.Contains("недоступ") || text.Contains("не подтверж") || text.Contains("сверк");
        }
        private static bool ConnectedToMain()
        {
            var os=PluginContext.Operations;var terminal=os.GetHostTerminal();
            var main=os.GetHostTerminalsGroup().MainTerminal;
            return main!=null && (main.Id==terminal.Id || os.IsConnectedToMainTerminal());
        }
        private static string PrinterStatus()
        {
            try
            {
                var os=PluginContext.Operations;
                return os.TryGetBillPrinter(null,true)!=null || os.TryGetDocumentPrinter(null,true)!=null
                    ? "ready" : "missing";
            }
            catch {return "error";}
        }

        private PosHealthRequest Snapshot()
        {
            var loyalty=LoyaltyFlow.GetQueueStatusText();var gifts=GiftCertificateFlow.GetStatusText();
            var stockStatus=stock?.StatusText ?? "Общий учёт: обработчик недоступен";
            var receipts=automaticReceipts?.StatusText ?? "Онлайн-чеки: обработчик недоступен";
            var offline=offlineReceipts?.StatusText ?? "Продажи кассы: журнал недоступен";
            var personal=PersonalAccountLocalLedger.StatusText;
            var errors=new List<PosHealthError>();
            if(LoyaltyFlow.FailedQueueCount>0)
                errors.Add(new PosHealthError {Kind="loyalty_queue",Message=Safe(loyalty)});
            if(Problem(stockStatus)) errors.Add(new PosHealthError {Kind="stock_sync",Message=Safe(stockStatus)});
            if(Problem(receipts)) errors.Add(new PosHealthError {Kind="front_receipt",Message=Safe(receipts)});
            foreach(var item in PersonalAccountLocalLedger.Snapshot().Take(10))
                errors.Add(new PosHealthError {Kind="personal_account",SourceId=item.PaymentId,
                    Message=Safe((item.LastError ?? item.Status)+" · чек "+item.OrderId)});
            var os=PluginContext.Operations;
            return new PosHealthRequest {
                TerminalId=os.GetHostTerminal().Id.ToString(),PluginVersion=Version,
                ApiVersion="V9Preview7",StartedAt=startedAt,ConnectedToMain=ConnectedToMain(),
                PrinterStatus=PrinterStatus(),
                Queues=new PosHealthQueues {
                    LoyaltyPending=LoyaltyFlow.PendingQueueCount,LoyaltyFailed=LoyaltyFlow.FailedQueueCount,
                    GiftPending=GiftCertificateFlow.PendingQueueCount,GiftFailed=GiftCertificateFlow.FailedQueueCount,
                    OfflineReceipts=offlineReceipts?.PendingCount ?? 0,StockPending=stock?.PendingCount ?? 0,
                    AutomaticReceipts=automaticReceipts?.PendingCount ?? 0,
                    PersonalAccountPending=PersonalAccountLocalLedger.PendingCount
                },
                Statuses=new PosHealthStatuses {Loyalty=Safe(loyalty),Gifts=Safe(gifts),Stock=Safe(stockStatus),
                    Receipts=Safe(receipts),OfflineReceipts=Safe(offline),PersonalAccount=Safe(personal)},
                Errors=errors.Take(20).ToList()
            };
        }

        private void Execute(PosHealthCommand command)
        {
            switch(command.Kind)
            {
                case "loyalty_queue": LoyaltyFlow.RequestImmediateRetry(); break;
                case "offline_receipt": offlineReceipts?.RequestRetry(); break;
                case "stock_sync": stock?.RequestRetry(); break;
                case "front_receipt":
                case "assembly_print": automaticReceipts?.RequestRetry(); break;
                case "personal_account": PersonalAccountLocalLedger.RequestRetry(); break;
                case "plugin_health":
                    LoyaltyFlow.RequestImmediateRetry();GiftCertificateFlow.RequestImmediateRetry();
                    offlineReceipts?.RequestRetry();stock?.RequestRetry();automaticReceipts?.RequestRetry();break;
            }
        }

        private void Tick(object state)
        {
            if(disposed || PosPairing.Current==null || Interlocked.CompareExchange(ref busy,1,0)!=0) return;
            try
            {
                var response=LoyaltyFlow.SendApiRequest(HttpMethod.Post,"pos/health/heartbeat",Snapshot());
                var parsed=LoyaltyFlow.DeserializeJson<PosHealthResponse>(response.Body);
                if(!response.IsSuccessStatusCode || parsed?.Success!=true)
                    throw new InvalidOperationException(parsed?.Error ?? "Сервер не подтвердил состояние кассы");
                foreach(var command in parsed.Commands ?? new List<PosHealthCommand>()) Execute(command);
                var policy=parsed.Policy;
                StatusText=policy!=null && System.Version.TryParse(policy.LatestVersion,out var latest) &&
                    latest>System.Version.Parse(Version)
                    ? "Мониторинг кассы: доступно обновление "+policy.LatestVersion+" (установлено "+Version+")"
                    : "Мониторинг кассы: данные переданы в админку";
                var versions=parsed.BranchVersions;
                if(versions!=null && versions.Any(v=>v!=Version))
                    StatusText += "\nВнимание: на кассах филиала разные версии: "+string.Join(", ",versions)+". Обновите все кассы.";
            }
            catch(Exception error)
            {
                StatusText="Мониторинг кассы: "+error.Message;PluginContext.Log.Warn(StatusText);
            }
            finally {Interlocked.Exchange(ref busy,0);}
        }

        public void Dispose() {disposed=true;timer.Dispose();}
    }
}
