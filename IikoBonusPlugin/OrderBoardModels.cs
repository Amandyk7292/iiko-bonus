using System.Collections.Generic;
using System.Runtime.Serialization;
namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class InboxItem
    {
        [DataMember(Name="name")] public string Name { get; set; }
        [DataMember(Name="quantity")] public decimal Quantity { get; set; }
        [DataMember(Name="unit")] public string Unit { get; set; }
    }
    [DataContract] internal sealed class InboxOrder
    {
        [DataMember(Name="id")] public string Id { get; set; }
        [DataMember(Name="number")] public long Number { get; set; }
        [DataMember(Name="phone")] public string Phone { get; set; }
        [DataMember(Name="customer")] public string Customer { get; set; }
        [DataMember(Name="items")] public List<InboxItem> Items { get; set; }
        [DataMember(Name="orderType")] public string OrderType { get; set; }
        [DataMember(Name="scheduledAt")] public string ScheduledAt { get; set; }
        [DataMember(Name="amount")] public decimal Amount { get; set; }
        [DataMember(Name="comment")] public string Comment { get; set; }
        [DataMember(Name="posReceiptDue")] public bool PosReceiptDue { get; set; }
        [DataMember(Name="courierName")] public string CourierName { get; set; }
        [DataMember(Name="courierPhone")] public string CourierPhone { get; set; }
        [DataMember(Name="courierVehicle")] public string CourierVehicle { get; set; }
        internal string TypeLabel => OrderType == "preorder" ? "Предзаказ · Самовывоз" : OrderType == "delivery" ? "Доставка" : "Самовывоз";
    }
    [DataContract] internal sealed class InboxResponse
    {
        [DataMember(Name="orders")] public List<InboxOrder> Orders { get; set; }
        [DataMember(Name="total")] public int Total { get; set; }
        [DataMember(Name="revision")] public string Revision { get; set; }
    }
    [DataContract] internal sealed class BoardColumn
    {
        internal static readonly string[] Stages = { "new", "preparing", "ready", "handed_over" };
        [DataMember(Name="stage")] public string Stage { get; set; }
        [DataMember(Name="page")] public int Page { get; set; }
        [DataMember(Name="total")] public int Total { get; set; }
        [DataMember(Name="orders")] public List<InboxOrder> Orders { get; set; }
    }
    [DataContract] internal sealed class BoardResponse
    {
        [DataMember(Name="columns")] public List<BoardColumn> Columns { get; set; }
    }
    [DataContract] internal sealed class InboxDecision
    {
        [DataMember(Name="orderId")] public string OrderId { get; set; }
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
        [DataMember(Name="action")] public string Action { get; set; }
    }
    [DataContract] internal sealed class InboxPoll
    {
        [DataMember(Name="terminalId")] public string TerminalId { get; set; }
    }
}
