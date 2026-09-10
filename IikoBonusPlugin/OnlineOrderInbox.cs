using System;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Resto.Front.Api.UI;
namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class OnlineOrderInbox : IDisposable
    {
        private readonly Timer timer;
        private readonly object gate = new object();
        private readonly SemaphoreSlim network = new SemaphoreSlim(1, 1);
        private readonly int[] pages = {1, 1, 1, 1};
        private OrderBoardWindow window;
        private int polling, opening, refreshing;
        private volatile bool disposed;
        private string revision = "", lastAlertKey = "";
        private DateTime lastAlert = DateTime.MinValue;
        internal OnlineOrderInbox() { timer = new Timer(Poll, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5)); }

        private static T Request<T>(HttpMethod method, string path, object body = null)
        {
            var response = LoyaltyFlow.SendApiRequest(method, path, body);
            if (!response.IsSuccessStatusCode)
            {
                GuardResponse error = null;
                try { error = LoyaltyFlow.DeserializeJson<GuardResponse>(response.Body); } catch { }
                throw new InvalidOperationException(error?.Error ?? "Нет связи с Bulka. Действие не подтверждено. Повторите после восстановления связи.");
            }
            return LoyaltyFlow.DeserializeJson<T>(response.Body);
        }
        private BoardResponse Load()
        {
            int[] current; lock (gate) current = (int[])pages.Clone();
            var query = string.Join("&", BoardColumn.Stages.Select((stage, i) => stage + "=" + current[i]));
            var result = Request<BoardResponse>(HttpMethod.Get, "orders/board?" + query);
            if (result?.Columns == null || result.Columns.Count != 4)
                throw new InvalidOperationException("Не удалось загрузить экран заказов. Обновите плагин и проверьте связь.");
            return result;
        }
        private void OnWindow(Action<OrderBoardWindow> action)
        {
            lock (gate)
            {
                var target = window;
                if (target != null && !target.Dispatcher.HasShutdownStarted)
                    target.Dispatcher.BeginInvoke(new Action(() => action(target)));
            }
        }
        private async void Poll(object state)
        {
            if (disposed || Interlocked.CompareExchange(ref polling, 1, 0) != 0) return;
            try
            {
                await network.WaitAsync().ConfigureAwait(false);
                try
                {
                    if (disposed) return;
                    var peek = Request<InboxResponse>(HttpMethod.Post, "orders/board/poll", new InboxPoll {
                        TerminalId = PluginContext.Operations.GetHostTerminal().Id.ToString() });
                    if (peek == null) throw new InvalidOperationException("Нет ответа от Bulka.");
                    bool visible; lock (gate) visible = window != null;
                    if (visible && peek.Revision != revision)
                    {
                        var result = Load(); OnWindow(view => view.Update(result)); revision = peek.Revision;
                    }
                    else if (visible) OnWindow(view => view.SetConnected());
                    var key = (peek.Orders?.FirstOrDefault()?.Id ?? "") + ":" + peek.Total;
                    if (peek.Total > 0 && !visible && (key != lastAlertKey || DateTime.UtcNow - lastAlert > TimeSpan.FromSeconds(30)))
                    { lastAlertKey = key; RequestAutomaticOpen(); }
                    if (peek.Total == 0) lastAlertKey = "";
                }
                finally { network.Release(); }
            }
            catch (Exception error)
            { revision = ""; OnWindow(view => view.SetError(error.Message)); PluginContext.Log.Warn("Bulka board poll: " + error.Message); }
            finally { Interlocked.Exchange(ref polling, 0); }
        }
        private void RequestAutomaticOpen()
        {
            if (Interlocked.CompareExchange(ref opening, 1, 0) != 0) return;
            ThreadPool.QueueUserWorkItem(_ => {
                try
                {
                    // Wait for iikoFront's active payment/dialog operation to finish.
                    PluginContext.Operations.TryExecuteUiOperation(vm => Show(vm, false, true));
                }
                catch (Exception error) { PluginContext.Log.Warn("Bulka board open: " + error.Message); }
                finally { lastAlert = DateTime.UtcNow; Interlocked.Exchange(ref opening, 0); }
            });
        }
        internal long? Show(IViewManager vm, bool canImport = false, bool automatic = false)
        {
            lock (gate) { if (disposed || window != null) return null; }
            var owner = OrderBoardWindow.CaptureOwner();
            if (automatic && owner == IntPtr.Zero) return null;
            long? selected = null; Exception failure = null;
            var thread = new Thread(() => {
                try
                {
                    var view = new OrderBoardWindow(PosPairing.Current?.BranchName ?? "Bulka", owner, canImport, automatic);
                    view.ActionRequested += Change;
                    view.RefreshRequested += Refresh;
                    view.PageRequested += (index, page) => { lock (gate) pages[index] = page; Refresh(); };
                    lock (gate)
                    {
                        if (disposed || window != null) return;
                        window = view;
                        for (var i = 0; i < pages.Length; i++) pages[i] = 1;
                        revision = "";
                    }
                    view.Loaded += (_, __) => Refresh();
                    view.ShowDialog(); selected = view.SelectedReceiptNumber;
                }
                catch (Exception error) { failure = error; }
                finally { lock (gate) window = null; lastAlert = DateTime.UtcNow; System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); }
            });
            thread.IsBackground = true; thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
            if (failure != null) vm.ShowErrorPopup("Не удалось открыть экран заказов: " + failure.Message, "ОК");
            return selected;
        }
        private void Refresh()
        {
            if (Interlocked.CompareExchange(ref refreshing, 1, 0) != 0) return;
            Task.Run(async () => {
                await network.WaitAsync().ConfigureAwait(false);
                try { if (!disposed) { var result = Load(); OnWindow(view => view.Update(result)); } }
                catch (Exception error) { OnWindow(view => view.SetError(error.Message)); }
                finally { network.Release(); Interlocked.Exchange(ref refreshing, 0); }
            });
        }
        private void Change(InboxOrder order, string action)
        {
            Task.Run(async () => {
                await network.WaitAsync().ConfigureAwait(false);
                try
                {
                    if (disposed) return;
                    Request<GuardResponse>(HttpMethod.Post, "orders/board/action", new InboxDecision {
                        OrderId = order.Id, TerminalId = PluginContext.Operations.GetHostTerminal().Id.ToString(), Action = action });
                    var result = Load(); OnWindow(view => view.Update(result));
                }
                catch (Exception error)
                {
                    try { if (!disposed) { var result = Load(); OnWindow(view => view.Update(result)); } } catch { }
                    OnWindow(view => view.SetError(error.Message));
                }
                finally { network.Release(); OnWindow(view => view.FinishAction(order.Id)); }
            });
        }
        public void Dispose()
        {
            disposed = true; timer.Dispose(); OnWindow(view => view.Close());
        }
    }
}
