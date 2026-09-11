using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

namespace Resto.Front.Api.Data.Orders
{
    internal enum OrderStatus { New, Closed }
    internal interface IOrder
    {
        Guid Id { get; } OrderStatus Status { get; } DateTime? CloseTime { get; }
        Guid? StornedOrderId { get; } decimal ResultSum { get; }
        bool Online { get; } List<IikoBonusPlugin.GuardItem> Items { get; }
    }
    internal sealed class TestOrder : IOrder
    {
        public Guid Id { get; } = Guid.NewGuid();
        public OrderStatus Status { get; set; } = OrderStatus.Closed;
        public DateTime? CloseTime { get; } = DateTime.UtcNow;
        public Guid? StornedOrderId => null;
        public decimal ResultSum => 100;
        public bool Online { get; set; }
        public List<IikoBonusPlugin.GuardItem> Items { get; } = new List<IikoBonusPlugin.GuardItem> {
            new IikoBonusPlugin.GuardItem { ProductId=Guid.NewGuid().ToString(), Quantity=5 }
        };
    }
}
namespace Resto.Front.Api
{
    internal struct VoidValue { }
    internal static class PluginContext
    {
        internal static readonly TestOperations Operations=new TestOperations();
        internal static readonly TestNotifications Notifications=new TestNotifications();
        internal static readonly TestLog Log=new TestLog();
    }
    internal sealed class TestLog { internal void Warn(string message) { } }
    internal sealed class TestTerminal { internal Guid Id=Guid.NewGuid(); }
    internal sealed class TestGroup { internal Guid Id=Guid.NewGuid(); internal TestTerminal MainTerminal; }
    internal sealed class TestProduct
    {
        internal Guid Id=Guid.NewGuid(); internal string Name="Булочка";
        internal bool UseBalanceForSell => false; internal TestUnit MeasuringUnit => new TestUnit();
    }
    internal sealed class TestUnit { internal string Name => "шт"; }
    internal sealed class TestKey { internal TestProduct Product=new TestProduct(); }
    internal sealed class TestOperations
    {
        private readonly TestTerminal terminal=new TestTerminal();
        private readonly TestKey product=new TestKey();
        internal decimal Quantity=10;
        internal TestTerminal GetHostTerminal() => terminal;
        internal TestGroup GetHostTerminalsGroup() => new TestGroup { MainTerminal=terminal };
        internal bool IsConnectedToMainTerminal() => true;
        internal Dictionary<TestKey,Tuple<decimal,bool>> GetStopListProductsRemainingAmounts()
            => new Dictionary<TestKey,Tuple<decimal,bool>> {{product,Tuple.Create(Quantity,false)}};
    }
    internal sealed class TestNotifications
    {
        internal readonly TestObservable StopListProductsRemainingAmountsChanged=new TestObservable();
    }
    internal sealed class TestObservable : IObservable<VoidValue>, IDisposable
    {
        private IObserver<VoidValue> observer;
        public IDisposable Subscribe(IObserver<VoidValue> value) { observer=value; return this; }
        internal void Fire() { observer?.OnNext(new VoidValue()); }
        public void Dispose() { observer=null; }
    }
}
namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class PosPairing { internal static object Current => new object(); }
    [DataContract] internal sealed class GuardItem
    {
        [DataMember(Name="productId")] public string ProductId { get; set; }
        [DataMember(Name="quantity")] public decimal Quantity { get; set; }
    }
    [DataContract] internal sealed class GuardResponse
    {
        [DataMember(Name="status")] public string Status { get; set; }
        [DataMember(Name="error")] public string Error { get; set; }
    }
    internal sealed class TestResponse
    {
        internal bool IsSuccessStatusCode=true;
        internal string Body="{\"status\":\"recorded\"}";
        internal int StatusCode => IsSuccessStatusCode ? 200 : 503;
    }
    internal static class LoyaltyFlow
    {
        internal static string DataDirectoryPath;
        internal static Func<string,object,TestResponse> Handler;
        internal static TestResponse SendApiRequest(HttpMethod method,string path,object payload) => Handler(path,payload);
        internal static T DeserializeJson<T>(string json)
        {
            using(var stream=new MemoryStream(Encoding.UTF8.GetBytes(json)))
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }
    }
    internal static class OnlineReceiptSync
    {
        internal static string OrderId(Data.Orders.IOrder order) => order.Online ? "online" : null;
        internal static List<GuardItem> ReceiptItems(Data.Orders.IOrder order) => order.Items;
    }
}
