using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;

[assembly: InternalsVisibleTo("VirtualPosTests")]

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class VirtualPosItem
    {
        [DataMember(Name="productId")] public string ProductId {get;set;}
        [DataMember(Name="quantity")] public decimal Quantity {get;set;}
        [DataMember(Name="price")] public decimal Price {get;set;}
        [DataMember(Name="name")] public string Name {get;set;}
        [DataMember(Name="lineTotal")] public decimal LineTotal {get;set;}
    }
    [DataContract] internal sealed class VirtualPosProduct
    {
        [DataMember(Name="id")] public string Id {get;set;}
        [DataMember(Name="name")] public string Name {get;set;}
        [DataMember(Name="price")] public decimal Price {get;set;}
        [DataMember(Name="unit")] public string Unit {get;set;}
        [DataMember(Name="quantityStep")] public decimal QuantityStep {get;set;}
        [DataMember(Name="paymentTypeIds")] public List<string> PaymentTypeIds {get;set;} = new List<string>();
        [DataMember(Name="available")] public bool Available {get;set;}
        [DataMember(Name="unavailableReason",EmitDefaultValue=false)] public string UnavailableReason {get;set;}
    }
    [DataContract] internal sealed class VirtualPosPayment
    {
        [DataMember(Name="id")] public string Id {get;set;}
        [DataMember(Name="name")] public string Name {get;set;}
        [DataMember(Name="kind")] public string Kind {get;set;}
        [DataMember(Name="isFiscal")] public bool IsFiscal {get;set;}
        [DataMember(Name="selectable")] public bool Selectable {get;set;}
        [DataMember(Name="reason",EmitDefaultValue=false)] public string Reason {get;set;}
    }
    [DataContract] internal sealed class VirtualPosShift
    {
        [DataMember(Name="id")] public string Id {get;set;}
        [DataMember(Name="isOpen")] public bool IsOpen {get;set;}
        [DataMember(Name="number",EmitDefaultValue=false)] public string Number {get;set;}
    }
    [DataContract] internal sealed class VirtualPosProfile
    {
        [DataMember(Name="nonFiscalNoPaperVerified")] public bool NonFiscalNoPaperVerified {get;set;}
        [DataMember(Name="reason",EmitDefaultValue=false)] public string Reason {get;set;}
    }
    [DataContract] internal sealed class VirtualPosSnapshot
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="terminalName")] public string TerminalName {get;set;}
        [DataMember(Name="revision")] public string Revision {get;set;}
        [DataMember(Name="capturedAt")] public string CapturedAt {get;set;}
        [DataMember(Name="cashShift")] public VirtualPosShift CashShift {get;set;}
        [DataMember(Name="products")] public List<VirtualPosProduct> Products {get;set;} = new List<VirtualPosProduct>();
        [DataMember(Name="paymentTypes")] public List<VirtualPosPayment> PaymentTypes {get;set;} = new List<VirtualPosPayment>();
        [DataMember(Name="profile")] public VirtualPosProfile Profile {get;set;}
    }
    [DataContract] internal sealed class VirtualPosCommand
    {
        [DataMember(Name="saleId")] public string SaleId {get;set;}
        [DataMember(Name="leaseToken")] public string LeaseToken {get;set;}
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="cashShiftId")] public string CashShiftId {get;set;}
        [DataMember(Name="paymentTypeId")] public string PaymentTypeId {get;set;}
        [DataMember(Name="snapshotRevision")] public string SnapshotRevision {get;set;}
        [DataMember(Name="items")] public List<VirtualPosItem> Items {get;set;}
        [DataMember(Name="total")] public decimal Total {get;set;}
        [DataMember(Name="phase")] public string Phase {get;set;}
    }
    [DataContract] internal sealed class VirtualPosAction
    {
        [DataMember(Name="terminalId")] public string TerminalId {get;set;}
        [DataMember(Name="saleId")] public string SaleId {get;set;}
        [DataMember(Name="leaseToken")] public string LeaseToken {get;set;}
        [DataMember(Name="action")] public string Action {get;set;}
        [DataMember(Name="frontOrderId",EmitDefaultValue=false)] public string FrontOrderId {get;set;}
        [DataMember(Name="frontOrderNumber",EmitDefaultValue=false)] public string FrontOrderNumber {get;set;}
        [DataMember(Name="error",EmitDefaultValue=false)] public string Error {get;set;}
    }
    [DataContract] internal sealed class VirtualPosSaleState
    {
        [DataMember(Name="phase")] public string Phase {get;set;}
        [DataMember(Name="status")] public string Status {get;set;}
    }
    [DataContract] internal sealed class VirtualPosResponse
    {
        [DataMember(Name="success")] public bool Success {get;set;}
        [DataMember(Name="guardAccepted")] public bool GuardAccepted {get;set;}
        [DataMember(Name="error")] public string Error {get;set;}
        [DataMember(Name="command")] public VirtualPosCommand Command {get;set;}
        [DataMember(Name="sale")] public VirtualPosSaleState Sale {get;set;}
    }
    [DataContract] internal sealed class VirtualPosLedgerEntry
    {
        [DataMember] public string SaleId {get;set;}
        [DataMember] public string BranchId {get;set;}
        [DataMember] public string TerminalId {get;set;}
        [DataMember] public string Digest {get;set;}
        [DataMember] public VirtualPosCommand Quote {get;set;}
        [DataMember] public string FrontOrderId {get;set;}
        [DataMember] public string FrontOrderNumber {get;set;}
        [DataMember] public string CashRegisterId {get;set;}
        [DataMember] public string CashShiftId {get;set;}
        [DataMember] public string PaymentTypeId {get;set;}
        [DataMember] public decimal Total {get;set;}
        [DataMember] public bool CreationStarted {get;set;}
        [DataMember] public bool PaymentStarted {get;set;}
        [DataMember] public string Phase {get;set;}
        [DataMember] public string Error {get;set;}
    }
}
