using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api.IikoBonusPlugin;

internal static partial class Program
{
    private static void HttpConcurrencyTests()
    {
        // Use the actual configured production HttpClient, before the inbox
        // scenarios replace it. Only this ephemeral loopback port is contacted.
        var client = (HttpClient)typeof(LoyaltyFlow).GetField("_httpClient", Static).GetValue(null);
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var uri = new Uri("http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/");
        var servicePoint = ServicePointManager.FindServicePoint(uri);
        var previousLimit = servicePoint.ConnectionLimit;
        var previousDefault = ServicePointManager.DefaultConnectionLimit;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var workers = new ConcurrentBag<Task>();
        var requests = new ConcurrentBag<Task>();
        var received = 0;
        using (var twoEntered = new ManualResetEventSlim())
        using (var thirdEntered = new ManualResetEventSlim())
        {
            // .NET Framework can exempt loopback from the default two-slot
            // limit. Set this endpoint explicitly to reproduce a real origin.
            ServicePointManager.DefaultConnectionLimit = 2;
            servicePoint.ConnectionLimit = 2;
            var accept = Task.Run(async () => {
                for (var index = 0; index < 3; index++)
                {
                    var peer = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
                    workers.Add(ServeHeldResponse(peer, release.Task, () => {
                        var count = Interlocked.Increment(ref received);
                        if (count == 2) twoEntered.Set();
                        if (count == 3) thirdEntered.Set();
                    }));
                }
            });
            try
            {
                requests.Add(ReadLoopback(client, new Uri(uri, "background-1")));
                requests.Add(ReadLoopback(client, new Uri(uri, "background-2")));
                Check(twoEntered.Wait(TimeSpan.FromSeconds(3)), "two background HTTP responses can remain in flight");
                requests.Add(ReadLoopback(client, new Uri(uri, "receipt")));
                Check(thirdEntered.Wait(TimeSpan.FromSeconds(3)),
                    "receipt HTTP reaches the server while both background responses are still held");
                Check(!release.Task.IsCompleted && received == 3,
                    "receipt is not queued behind completion of the first two responses");
                Check(servicePoint.ConnectionLimit == 8,
                    "production handler applies the bounded eight-connection endpoint limit");
            }
            finally
            {
                release.TrySetResult(true);
                try
                {
                    try { Task.WaitAll(requests.ToArray(), TimeSpan.FromSeconds(5)); }
                    finally
                    {
                        listener.Stop();
                        try { accept.GetAwaiter().GetResult(); }
                        catch (SocketException) { }
                        catch (ObjectDisposedException) { }
                        Task.WaitAll(workers.ToArray(), TimeSpan.FromSeconds(5));
                    }
                }
                finally
                {
                    servicePoint.ConnectionLimit = previousLimit;
                    ServicePointManager.DefaultConnectionLimit = previousDefault;
                }
            }
        }
    }

    private static async Task ReadLoopback(HttpClient client, Uri uri)
    {
        using (var response = await client.GetAsync(uri).ConfigureAwait(false))
        {
            response.EnsureSuccessStatusCode();
            if (await response.Content.ReadAsStringAsync().ConfigureAwait(false) != "ok")
                throw new InvalidDataException("Unexpected loopback response");
        }
    }

    private static async Task ServeHeldResponse(TcpClient peer, Task release, Action entered)
    {
        using (peer)
        using (var stream = peer.GetStream())
        using (var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
        {
            string line;
            do { line = await reader.ReadLineAsync().ConfigureAwait(false); }
            while (!string.IsNullOrEmpty(line));
            entered();
            await release.ConfigureAwait(false);
            var response = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
            await stream.WriteAsync(response, 0, response.Length).ConfigureAwait(false);
        }
    }
}
