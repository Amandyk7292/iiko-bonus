using System.Collections.Generic;
using System.Runtime.Serialization;
namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class AutomaticReceiptJob
    {
        [DataMember(Name="orderId")] public string OrderId {get;set;}
        [DataMember(Name="receiptId")] public string ReceiptId {get;set;}
        [DataMember(Name="number")] public long Number {get;set;}
        [DataMember] public bool CreationStarted {get;set;}
    }
    [DataContract] internal sealed class AutomaticReceiptJobs
    {
        [DataMember(Name="jobs")] public List<AutomaticReceiptJob> Jobs {get;set;}
    }
    [DataContract] internal sealed class AutomaticReceiptAction
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="orderId")] public string OrderId {get;set;}
        [DataMember(Name="action")] public string Action {get;set;}
        [DataMember(Name="receiptId",EmitDefaultValue=false)] public string ReceiptId {get;set;}
        [DataMember(Name="items",EmitDefaultValue=false)] public List<GuardItem> Items {get;set;}
        [DataMember(Name="total",EmitDefaultValue=false)] public decimal? Total {get;set;}
        [DataMember(Name="error",EmitDefaultValue=false)] public string Error {get;set;}
    }
    [DataContract] internal sealed class AutomaticReceiptResult
    {
        [DataMember(Name="status")] public string Status {get;set;}
        [DataMember(Name="receiptId")] public string ReceiptId {get;set;}
        [DataMember(Name="number")] public long Number {get;set;}
        [DataMember(Name="error")] public string Error {get;set;}
    }
}
