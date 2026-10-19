using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Remoting.Messaging;
using System.Runtime.Remoting.Proxies;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api;
using Resto.Front.Api.IikoBonusPlugin;

internal sealed class Proxy : RealProxy
{
    private readonly Func<IMethodCallMessage, object> call;
    private Proxy(Type type, Func<IMethodCallMessage, object> call) : base(type) { this.call = call; }
    internal static object Make(Type type, Func<IMethodCallMessage, object> call) => new Proxy(type, call).GetTransparentProxy();
    internal static T Make<T>(Func<IMethodCallMessage, object> call) where T : class => (T)Make(typeof(T), call);
    public override IMessage Invoke(IMessage message)
    {
        var invocation = (IMethodCallMessage)message;
        try { return new ReturnMessage(call(invocation), null, 0, invocation.LogicalCallContext, invocation); }
        catch (Exception error) { return new ReturnMessage(error, invocation); }
    }
}
internal sealed class Services : IServiceProvider
{
    internal IOperationService Operations;
    public object GetService(Type type) => type == typeof(IOperationService) ? Operations : null;
}
internal sealed class FakeHttp : HttpMessageHandler
{
    internal Func<HttpRequestMessage, HttpResponseMessage> Reply;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        try { return Task.FromResult(Reply(request)); }
        catch (Exception error) { return Task.FromException<HttpResponseMessage>(error); }
    }
}
internal static partial class Program
{
    private const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Static;
    private const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;
    private static readonly Type Inbox = typeof(LoyaltyFlow).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.OnlineOrderInbox", true);
    private static readonly Type Order = typeof(LoyaltyFlow).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.InboxOrder", true);
    private static readonly Guid TerminalId = Guid.NewGuid();
    private static int assertions, warnings;
    private static void Check(bool value, string label)
    {
        if (!value) throw new Exception(label);
        assertions++;
        Console.WriteLine("PASS: " + label);
    }
    private static HttpResponseMessage Response(HttpStatusCode status, string body) =>
        new HttpResponseMessage(status) { Content = new StringContent(body) };
    private static void Main()
    {
        var data = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "state-" + Guid.NewGuid());
        Directory.CreateDirectory(data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR", data);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_API_BASE_URL", "https://inbox-test.invalid/api/loyalty");
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_API_TOKEN", new string('a', 48));
        Environment.SetEnvironmentVariable("IIKO_BRANCH_ID", Guid.NewGuid().ToString());
        Environment.SetEnvironmentVariable("IIKO_BRANCH_POS_TOKEN", new string('b', 48));
        var services = new Services { Operations = Proxy.Make<IOperationService>(call => {
            if (call.MethodName == "GetHostTerminal")
                return Proxy.Make(((MethodInfo)call.MethodBase).ReturnType, terminal => {
                    if (terminal.MethodName == "get_Id") return TerminalId;
                    throw new InvalidOperationException("Unexpected terminal call: " + terminal.MethodName);
                });
            throw new InvalidOperationException("Unexpected SDK call: " + call.MethodName);
        }) };
        PluginContext.Initialize(services, () => { }, Proxy.Make<ILog>(call => {
            if (call.MethodName == "Warn") Interlocked.Increment(ref warnings);
            return null;
        }));
        try
        {
            HttpConcurrencyTests();
            Scenario("accept", true, true);
            Scenario("hand_over", true, true);
            Scenario("ready", true, false);
            Scenario("reject", true, false);
            Scenario("accept", false, false);
            Scenario("hand_over", false, false);
            Scenario("accept", true, true, throwCallback: true);
            Scenario("hand_over", true, true, failRefresh: true);
            Scenario("accept", true, true, idempotent: true);
            Check(warnings == 1, "a wake-up failure is logged once without changing the confirmed action");
            Console.WriteLine("PASS: " + assertions + " inbox receipt wake-up and loopback HTTP assertions; no external HTTP, POS, printer or UI.");
        }
        finally { PluginContext.Uninitialize(); }
    }
    private static void Scenario(string action, bool success, bool shouldWake, bool throwCallback = false,
        bool failRefresh = false, bool idempotent = false)
    {
        var posts = 0;
        var boardLoads = 0;
        var callbacks = 0;
        var refreshSawCallback = false;
        var successWasConfirmed = false;
        using (var boardEntered = new ManualResetEventSlim())
        using (var boardContinue = new ManualResetEventSlim())
        using (var handler = new FakeHttp())
        using (var client = new HttpClient(handler))
        {
            handler.Reply = request => {
                if (request.RequestUri.AbsolutePath.EndsWith("/orders/board/action"))
                {
                    Interlocked.Increment(ref posts);
                    Check(request.Method == HttpMethod.Post, action + " uses one confirmed board mutation");
                    var body = request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    Check(body.Contains("\"action\":\"" + action + "\""), action + " preserves the original action payload");
                    successWasConfirmed = success;
                    return Response(success ? HttpStatusCode.OK : HttpStatusCode.Conflict,
                        success ? (idempotent ? "{\"success\":true,\"idempotent\":true}" : "{\"success\":true}") : "{\"error\":\"Action rejected\"}");
                }
                if (request.RequestUri.AbsolutePath.EndsWith("/orders/board"))
                {
                    Interlocked.Increment(ref boardLoads);
                    refreshSawCallback = callbacks == (shouldWake ? 1 : 0);
                    boardEntered.Set();
                    if (!boardContinue.Wait(TimeSpan.FromSeconds(5))) throw new Exception("Test did not release board refresh");
                    return Response(failRefresh ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK,
                        failRefresh ? "{\"error\":\"Refresh unavailable\"}" : "{\"columns\":[{},{},{},{}]}");
                }
                throw new Exception("Unexpected HTTP: " + request.RequestUri);
            };
            var httpField = typeof(LoyaltyFlow).GetField("_httpClient", Static);
            var originalHttp = httpField.GetValue(null);
            httpField.SetValue(null, client);
            Action callback = () => {
                Check(successWasConfirmed, action + " wakes only after the mutation response succeeds");
                Interlocked.Increment(ref callbacks);
                if (throwCallback) throw new InvalidOperationException("Scheduler unavailable");
            };
            var inbox = (IDisposable)Activator.CreateInstance(Inbox, Instance, null, new object[] { callback }, null);
            ((Timer)Inbox.GetField("timer", Instance).GetValue(inbox)).Change(Timeout.Infinite, Timeout.Infinite);
            try
            {
                var order = Activator.CreateInstance(Order, true);
                Order.GetProperty("Id").SetValue(order, Guid.NewGuid().ToString());
                Inbox.GetMethod("Change", Instance).Invoke(inbox, new object[] { order, action });
                Check(boardEntered.Wait(TimeSpan.FromSeconds(5)), action + " reaches board refresh");
                Check(refreshSawCallback, action + " wakes receipts before a blocked refresh only when required");
                boardContinue.Set();
                var network = (SemaphoreSlim)Inbox.GetField("network", Instance).GetValue(inbox);
                Check(network.Wait(TimeSpan.FromSeconds(5)), action + " finishes despite refresh or callback failure");
                network.Release();
                Check(posts == 1, action + " never repeats a confirmed or rejected action");
                Check(callbacks == (shouldWake ? 1 : 0), action + " requests exactly the required receipt wake-up count");
                Check(boardLoads == (failRefresh ? 2 : 1), action + " preserves existing board recovery behavior");
            }
            finally
            {
                boardContinue.Set();
                inbox.Dispose();
                httpField.SetValue(null, originalHttp);
            }
        }
    }
}
