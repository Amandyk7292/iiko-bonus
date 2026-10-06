using System.Collections.Generic;
using System.Runtime.Serialization;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class PickupPhotoJob
    {
        [DataMember(Name="orderId")] public string OrderId {get;set;}
        [DataMember(Name="number")] public long Number {get;set;}
        [DataMember(Name="photoId")] public string PhotoId {get;set;}
        [DataMember(Name="status")] public string Status {get;set;}
    }
    [DataContract] internal sealed class PickupPhotoPoll
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="photoGiftVersion")] public int Version {get;set;}=1;
    }
    [DataContract] internal sealed class PickupPhotoAction
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="orderId")] public string OrderId {get;set;}
        [DataMember(Name="action")] public string Action {get;set;}
        [DataMember(Name="error",EmitDefaultValue=false)] public string Error {get;set;}
    }
    [DataContract] internal sealed class PickupPhotoResponse
    {
        [DataMember(Name="success")] public bool Success {get;set;}
        [DataMember(Name="jobs")] public List<PickupPhotoJob> Jobs {get;set;}
        [DataMember(Name="status")] public string Status {get;set;}
        [DataMember(Name="number")] public long Number {get;set;}
        [DataMember(Name="photoId")] public string PhotoId {get;set;}
    }
    [DataContract] internal sealed class PickupPhotoLedgerEntry
    {
        [DataMember] public string OrderId {get;set;}
        [DataMember] public string TerminalId {get;set;}
        [DataMember] public string BranchId {get;set;}
        [DataMember] public string PhotoId {get;set;}
        [DataMember] public long Number {get;set;}
        [DataMember] public string Status {get;set;}
        [DataMember] public string StartedAt {get;set;}
        [DataMember] public string ImageSha256 {get;set;}
        [DataMember] public string AcknowledgedAt {get;set;}
    }
}
