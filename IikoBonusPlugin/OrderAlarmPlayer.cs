using System;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Media;
using System.Windows.Threading;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class OrderAlarmPlayer : IDisposable
    {
        private readonly string audioPath;
        private readonly Thread thread;
        private readonly ManualResetEvent ready = new ManualResetEvent(false);
        private volatile bool disposed;
        private Dispatcher dispatcher;
        private MediaPlayer player;
        private Exception startupError;

        internal OrderAlarmPlayer()
        {
            audioPath = ExtractAudio();
            thread = new Thread(Run)
            {
                IsBackground = true,
                Name = "Bulka order alert audio"
            };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!ready.WaitOne(TimeSpan.FromSeconds(3)))
            {
                disposed = true;
                try { dispatcher?.BeginInvokeShutdown(DispatcherPriority.Background); }
                catch { }
                thread.Join(TimeSpan.FromSeconds(1));
                TryDeleteAudio();
                throw new TimeoutException("Не удалось запустить звук новых заказов.");
            }
            if (startupError != null)
            {
                TryDeleteAudio();
                throw new InvalidOperationException("Не удалось запустить звук новых заказов.", startupError);
            }
        }

        internal void Play()
        {
            var target = dispatcher;
            if (disposed || target == null || target.HasShutdownStarted) return;
            target.BeginInvoke(DispatcherPriority.Background, new Action(() =>
            {
                if (disposed || player == null) return;
                try
                {
                    player.Stop();
                    player.Close();
                    player.Open(new Uri(audioPath, UriKind.Absolute));
                }
                catch (Exception error)
                {
                    LogFailure("play", error);
                }
            }));
        }

        internal void Stop()
        {
            var target = dispatcher;
            if (disposed || target == null || target.HasShutdownStarted) return;
            target.BeginInvoke(DispatcherPriority.Background, new Action(() =>
            {
                if (player == null) return;
                try
                {
                    player.Stop();
                    player.Close();
                }
                catch (Exception error)
                {
                    LogFailure("stop", error);
                }
            }));
        }

        private void Run()
        {
            try
            {
                dispatcher = Dispatcher.CurrentDispatcher;
                if (disposed)
                {
                    ready.Set();
                    dispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
                    return;
                }
                player = new MediaPlayer { Volume = 1.0 };
                player.MediaOpened += (_, __) =>
                {
                    if (disposed || player == null) return;
                    try { player.Play(); }
                    catch (Exception error) { LogFailure("start", error); }
                };
                player.MediaFailed += (_, args) => LogFailure("decode", args.ErrorException);
                ready.Set();
                Dispatcher.Run();
            }
            catch (Exception error)
            {
                startupError = error;
                ready.Set();
            }
            finally
            {
                try
                {
                    player?.Stop();
                    player?.Close();
                }
                catch { }
            }
        }

        private static string ExtractAudio()
        {
            const string resourceSuffix = ".Assets.wolt_v2.mp3";
            var assembly = Assembly.GetExecutingAssembly();
            string resourceName = null;
            foreach (var name in assembly.GetManifestResourceNames())
            {
                if (name.EndsWith(resourceSuffix, StringComparison.OrdinalIgnoreCase))
                {
                    resourceName = name;
                    break;
                }
            }
            if (resourceName == null)
                throw new FileNotFoundException("В плагине отсутствует звук новых заказов.");

            var directory = Path.Combine(Path.GetTempPath(), "BulkaOrderAlerts");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "order-alert-" + Guid.NewGuid().ToString("N") + ".mp3");
            using (var stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null) throw new FileNotFoundException("Не удалось прочитать звук новых заказов.");
                using (var output = File.Create(path)) stream.CopyTo(output);
            }
            return path;
        }

        private static void LogFailure(string operation, Exception error)
        {
            try { PluginContext.Log.Warn("Bulka order alert audio " + operation + ": " + error?.Message); }
            catch { }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            var target = dispatcher;
            if (target != null && !target.HasShutdownStarted)
            {
                using (var stopped = new ManualResetEvent(false))
                {
                    try
                    {
                        target.BeginInvoke(DispatcherPriority.Send, new Action(() =>
                        {
                            try
                            {
                                player?.Stop();
                                player?.Close();
                            }
                            catch { }
                            finally
                            {
                                target.BeginInvokeShutdown(DispatcherPriority.Background);
                                stopped.Set();
                            }
                        }));
                    }
                    catch { }
                    stopped.WaitOne(TimeSpan.FromSeconds(2));
                }
                thread.Join(TimeSpan.FromSeconds(2));
            }
            try { ready.Dispose(); }
            catch { }
            TryDeleteAudio();
        }

        private void TryDeleteAudio()
        {
            try { File.Delete(audioPath); }
            catch { }
        }
    }
}
