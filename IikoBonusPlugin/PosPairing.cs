using System;
using System.IO;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class PosPairingState
    {
        [DataMember] public string TerminalId { get; set; }
        [DataMember] public string BranchId { get; set; }
        [DataMember] public string BranchName { get; set; }
        [DataMember] public string Token { get; set; }
        [DataMember] public bool SharedStockEnabled { get; set; }
        [DataMember] public string PendingCode { get; set; }
        [DataMember] public string PendingToken { get; set; }
    }
    [DataContract] internal sealed class PosActivation
    {
        [DataMember(Name="code")] public string Code { get; set; }
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="terminalGroupId")] public string TerminalGroupId { get; set; }
        [DataMember(Name="terminalName")] public string TerminalName { get; set; }
        [DataMember(Name="terminalToken")] public string TerminalToken { get; set; }
        [DataMember(Name="expectedBranchId",EmitDefaultValue=false)] public string ExpectedBranchId { get; set; }
    }
    [DataContract] internal sealed class PosActivationResult
    {
        [DataMember(Name="branchId")] public string BranchId { get; set; }
        [DataMember(Name="branchName")] public string BranchName { get; set; }
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="sharedStockEnabled")] public bool SharedStockEnabled { get; set; }
        [DataMember(Name="error")] public string Error { get; set; }
    }
    internal static class PosPairing
    {
        private static readonly object Gate = new object();
        private static PosPairingState state;
        private static bool loaded;
        private static string PathName => Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaPosPairing.dat");
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Bulka POS pairing v1");
        internal static PosPairingState Current
        {
            get
            {
                lock(Gate)
                {
                    if(!loaded)
                    {
                        if(File.Exists(PathName))
                        {
                            try
                            {
                                var bytes=ProtectedData.Unprotect(File.ReadAllBytes(PathName),Entropy,DataProtectionScope.CurrentUser);
                                using(var stream=new MemoryStream(bytes))
                                    state=(PosPairingState)new DataContractJsonSerializer(typeof(PosPairingState)).ReadObject(stream);
                                if(state?.TerminalId!=PluginContext.Operations.GetHostTerminal().Id.ToString()) state=null;
                            }
                            catch { PluginContext.Log.Warn("Bulka pairing storage unreadable; pair this register again.");state=null; }
                        }
                        loaded=true;
                    }
                    return state;
                }
            }
        }
        internal static bool IsPaired => !string.IsNullOrWhiteSpace(Current?.Token) && Guid.TryParse(Current.BranchId,out _);
        private static void Save(PosPairingState value)
        {
            using(var stream=new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(PosPairingState)).WriteObject(stream,value);
                var bytes=ProtectedData.Protect(stream.ToArray(),Entropy,DataProtectionScope.CurrentUser);
                var temporary=PathName+".tmp";
                using(var file=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None))
                { file.Write(bytes,0,bytes.Length); file.Flush(true); }
                if(File.Exists(PathName)) File.Replace(temporary,PathName,PathName+".bak");
                else File.Move(temporary,PathName);
                state=value; loaded=true;
            }
        }
        internal static void Show(IViewManager vm)
        {
            try
            {
                var current=Current;
                var title="Введите код из приложения кассира: «Кассы филиала» → «Привязать кассу»";
                if(IsPaired) title="Касса привязана: "+current.BranchName+". Для повторной привязки введите новый код.";
                else if(!string.IsNullOrEmpty(current?.PendingCode)) title="Повторите код "+current.PendingCode+" после сбоя связи или введите новый код из приложения.";
                var input=vm.ShowInputDialog(title,InputDialogTypes.Number,null,"Привязать","Отмена");
                if(input==null) return;
                var number=input is NumberInputDialogResult integer ? integer.Number
                    : input is DecimalInputDialogResult dec && dec.Decimal==decimal.Truncate(dec.Decimal) ? dec.Decimal : 0;
                if(number<100000 || number>999999) {vm.ShowErrorPopup("Введите шестизначный код из приложения.","ОК");return;}
                lock(Gate)
                {
                    var terminal=PluginContext.Operations.GetHostTerminal();
                    var code=number.ToString("0");
                    var next=new PosPairingState {TerminalId=terminal.Id.ToString(),BranchId=current?.BranchId,
                        BranchName=current?.BranchName,Token=current?.Token,SharedStockEnabled=current?.SharedStockEnabled ?? false,
                        PendingCode=code,PendingToken=current?.PendingCode==code ? current.PendingToken : null};
                    if(string.IsNullOrEmpty(next.PendingToken))
                    {
                        var random=new byte[32];
                        using(var rng=RandomNumberGenerator.Create()) rng.GetBytes(random);
                        next.PendingToken="pt1_"+BitConverter.ToString(random).Replace("-","").ToLowerInvariant();
                    }
                    // Store the candidate secret before consuming the code. Retrying
                    // the same code after a lost response recovers this registration.
                    Save(next);
                    var data=new PosActivation {Code=code,TerminalId=next.TerminalId,
                        TerminalGroupId=PluginContext.Operations.GetHostTerminalsGroup().Id.ToString(),
                        TerminalName=terminal.Name,TerminalToken=next.PendingToken,
                        ExpectedBranchId=next.BranchId ?? LoyaltyFlow.ReadPluginSetting("IIKO_BRANCH_ID")};
                    if(string.IsNullOrWhiteSpace(data.ExpectedBranchId)) data.ExpectedBranchId=null;
                    var result=Activate(data);
                    if(!Guid.TryParse(result.BranchId,out _) || result.TerminalId!=next.TerminalId)
                        throw new InvalidDataException("Некорректный ответ привязки кассы.");
                    if(result.SharedStockEnabled || next.SharedStockEnabled)
                        File.WriteAllText(Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaSharedStock.enabled"),"1");
                    Save(new PosPairingState {TerminalId=next.TerminalId,BranchId=result.BranchId,BranchName=result.BranchName,
                        Token=next.PendingToken,SharedStockEnabled=next.SharedStockEnabled || result.SharedStockEnabled});
                    vm.ShowOkPopup("Касса привязана",result.BranchName+"\nЗаказы, бонусы и остатки подключены.","ОК");
                }
            }
            catch(Exception error)
            {
                PluginContext.Log.Warn("Bulka pairing failed: "+error.GetType().Name);
                var message=error is HttpRequestException || error is System.Threading.Tasks.TaskCanceledException
                    ? "Нет связи с Bulka. Повторите привязку с тем же кодом." : error.Message;
                vm.ShowErrorPopup(message,"ОК");
            }
        }
        private static PosActivationResult Activate(PosActivation input)
        {
            var baseUrl=LoyaltyFlow.ReadPluginSetting("IIKO_LOYALTY_API_BASE_URL") ?? "https://bulka.com.kz/api/loyalty";
            if(!Uri.TryCreate(baseUrl,UriKind.Absolute,out var uri) || uri.Scheme!="https" || !string.IsNullOrEmpty(uri.UserInfo))
                throw new InvalidOperationException("Некорректный адрес Bulka.");
            using(var handler=new HttpClientHandler {AllowAutoRedirect=false})
            using(var client=new HttpClient(handler) {Timeout=TimeSpan.FromSeconds(15)})
            using(var stream=new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(PosActivation)).WriteObject(stream,input);
                using(var content=new StringContent(Encoding.UTF8.GetString(stream.ToArray()),Encoding.UTF8,"application/json"))
                using(var response=client.PostAsync(new Uri(uri,"/api/pos/activate"),content).GetAwaiter().GetResult())
                {
                    var text=response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    PosActivationResult result;
                    try {result=LoyaltyFlow.DeserializeJson<PosActivationResult>(text);}
                    catch {throw new InvalidOperationException("Не удалось связаться с Bulka. Повторите привязку с тем же кодом.");}
                    if(!response.IsSuccessStatusCode) throw new InvalidOperationException(result?.Error ?? "Не удалось привязать кассу. Повторите попытку.");
                    return result ?? throw new InvalidOperationException("Пустой ответ Bulka.");
                }
            }
        }
    }
}
