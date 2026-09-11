using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;

namespace Resto.Front.Api.UI
{
    internal interface IViewManager { void ShowErrorPopup(string text, string button); }
}
namespace Resto.Front.Api
{
    internal static class PluginContext
    {
        internal static readonly TestOperations Operations = new TestOperations();
        internal static readonly TestLog Log = new TestLog();
    }
    internal sealed class TestOperations
    {
        internal int UiCalls;
        internal TestTerminal GetHostTerminal() => new TestTerminal();
        internal void TryExecuteUiOperation(Action<UI.IViewManager> callback)
        {
            Interlocked.Increment(ref UiCalls);
            throw new NotSupportedException("The register is busy with a payment dialog.");
        }
    }
    internal sealed class TestTerminal { internal Guid Id => Guid.Empty; }
    internal sealed class TestLog
    {
        internal void Info(string value) { }
        internal void Warn(string value) { Console.WriteLine(value); }
    }
}
namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class PosPairing { internal static TestPairing Current => new TestPairing(); }
    internal sealed class TestPairing { internal string BranchName => "Проверка автооткрытия"; }
    [DataContract] internal sealed class GuardResponse
    { [DataMember(Name="error")] public string Error { get; set; } }
    internal sealed class TestResponse
    { internal bool IsSuccessStatusCode => true; internal string Body; }
    internal static class LoyaltyFlow
    {
        internal static long Newest = 100001;
        internal static int Pending = 1;
        internal static TestResponse SendApiRequest(HttpMethod method, string path, object body)
        {
            var newest = Interlocked.Read(ref Newest);
            var count = Volatile.Read(ref Pending);
            object value = path.EndsWith("/poll")
                ? (object)new InboxResponse { Total = count, NewestOrderNumber = newest, Revision = newest.ToString() }
                : new BoardResponse { Columns = BoardColumn.Stages.Select((stage, i) => new BoardColumn {
                    Stage = stage, Page = 1, Total = i == 0 ? count : 0,
                    Orders = new System.Collections.Generic.List<InboxOrder>()
                }).ToList() };
            using (var stream = new MemoryStream()) {
                new DataContractJsonSerializer(value.GetType()).WriteObject(stream, value);
                return new TestResponse { Body = Encoding.UTF8.GetString(stream.ToArray()) };
            }
        }
        internal static T DeserializeJson<T>(string body)
        {
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(body)))
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }
    }
}
