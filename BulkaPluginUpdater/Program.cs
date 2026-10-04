using System;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Resto.Front.Api.IikoBonusPlugin;

namespace Bulka.PluginUpdater
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length != 2 || (args[0] != "--request" && args[0] != "--recover"))
            {
                MessageBox.Show("Откройте «Проверить обновления» в плагине Bulka на кассе.", "Обновление Bulka", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 2;
            }
            using (var window = new UpdateWindow(args[1], args[0] == "--recover"))
            { Application.Run(window); return window.Succeeded ? 0 : 1; }
        }
    }

    internal sealed class UpdateWindow : Form
    {
        private string requestPath;
        private bool recovery;
        private string recoveryRequestPath;
        private ProcessWaitContext activeProcesses;
        private readonly TextBox message;
        private readonly Button close;
        private readonly Button recover;
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private bool installing;
        internal bool Succeeded { get; private set; }

        internal UpdateWindow(string requestPath, bool recovery)
        {
            this.requestPath = requestPath;
            this.recovery = recovery;
            Text = "Обновление Bulka";
            ClientSize = new Size(640, 340);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            Font = new Font("Segoe UI", 11);
            message = new TextBox { Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = SystemColors.Control,
                ScrollBars = ScrollBars.Vertical, TabStop = false, Location = new Point(24, 24), Size = new Size(592, 250), Text = "Проверяем обновление…" };
            close = new Button { Text = "Отмена", Location = new Point(476, 287), Size = new Size(140, 34) };
            close.Click += (sender, args) => Close();
            recover = new Button { Text = "Восстановить", Location = new Point(256, 287), Size = new Size(200, 34), Visible = false };
            recover.Click += async (sender, args) =>
            {
                requestPath = recoveryRequestPath;
                recovery = true;
                recover.Visible = false;
                close.Text = "Отмена";
                await Execute();
            };
            Controls.Add(message);
            Controls.Add(close);
            Controls.Add(recover);
            Shown += async (sender, args) => await Execute();
            FormClosing += (sender, args) => { if (installing) args.Cancel = true; else cancellation.Cancel(); };
        }

        private void SetMessage(string text)
        {
            if (IsDisposed || cancellation.IsCancellationRequested) return;
            if (InvokeRequired) { BeginInvoke(new Action<string>(SetMessage), text); return; }
            message.Text = text;
        }

        private async Task Execute()
        {
            UpdateInstaller installer = null;
            Mutex updateLock = null;
            var interrupted = false;
            try
            {
                var request = UpdateRequest.Read(requestPath);
                // Switching to an old backup request must retain the current cash register's
                // identities. Old journal PIDs may have exited or been reused long ago.
                if (activeProcesses == null) activeProcesses = new ProcessWaitContext(request);
                var lockName = "Local\\BulkaPluginUpdater." + SafePaths.TextHash(request.TargetDirectory.ToUpperInvariant());
                updateLock = new Mutex(false, lockName);
                try { if (!updateLock.WaitOne(0)) throw new InvalidOperationException("Для этой кассы уже открыто обновление."); }
                catch (AbandonedMutexException) { }
                installer = new UpdateInstaller(request);
                interrupted = installer.HasInterruptedTransaction;
                if (!recovery && interrupted)
                    throw new InvalidOperationException("Незавершённое обновление требует восстановления. Нажмите «Восстановить».");
                if (!recovery) SafePaths.ValidateInstalled(request, true);
                SafePaths.CheckWriteAccess(request.TargetDirectory, false);
                using (var barrier = activeProcesses.OpenBarrier())
                {
                    SetMessage("Закройте iiko для установки обновления.\n\nТекущая работа кассы продолжается. После закрытия iiko дождитесь сообщения об окончании установки.");
                    while (!barrier.Exited) await Task.Delay(500, cancellation.Token);
                }
                cancellation.Token.ThrowIfCancellationRequested();
                installing = true;
                close.Enabled = false;
                SetMessage(recovery ? "Восстанавливаем предыдущую версию…" : "Проверяем и устанавливаем обновление…");
                await Task.Run(() =>
                {
                    SafePaths.RejectReparsePoints(request.StagingDirectory);
                    if (recovery) { installer.Recover(); return; }
                    SafePaths.ValidateInstalled(request, true);
                    SafePaths.CheckWriteAccess(request.TargetDirectory, true);
                    var envelope = Path.Combine(request.StagingDirectory, "update.manifest.json");
                    var package = Path.Combine(request.StagingDirectory, "update.zip");
                    SafePaths.RejectReparsePoints(envelope);
                    SafePaths.RejectReparsePoints(package);
                    if (new FileInfo(envelope).Length > 131072) throw new InvalidDataException("Манифест обновления слишком большой.");
                    var manifest = PluginUpdatePackage.ParseAndVerify(File.ReadAllText(envelope), request.CurrentVersion);
                    var candidate = Path.Combine(request.StagingDirectory, "candidate");
                    if (Directory.Exists(candidate)) throw new InvalidDataException("Папка подготовки уже использовалась. Проверьте обновления заново.");
                    PluginUpdatePackage.ValidateAndExtract(package, candidate, manifest);
                    SafePaths.ValidateInstalled(request, true);
                    installer.Install();
                });
                Succeeded = true;
                SetMessage(recovery ? "Предыдущая версия восстановлена. Запустите iiko." : "Обновление установлено. Запустите iiko.");
            }
            catch (OperationCanceledException) { }
            catch (Exception error)
            {
                var status = installer?.Restored == true ? "\n\nПредыдущая версия восстановлена." : "";
                recoveryRequestPath = installer?.RecoveryRequestPath;
                var recoveryHelp = installer?.RecoveryRequired == true || interrupted
                    ? "\n\nСохранена резервная копия: " + installer.RecoveryBackupDirectory + "\nЗакройте iiko и нажмите «Восстановить». Команда для ручного запуска:\n\"" + Application.ExecutablePath + "\" --recover \"" + recoveryRequestPath + "\""
                    : "";
                recover.Visible = recoveryHelp.Length != 0 && !string.IsNullOrEmpty(recoveryRequestPath);
                SetMessage("Обновление не завершено. " + error.Message + status + recoveryHelp);
            }
            finally
            {
                installing = false;
                if (updateLock != null)
                {
                    try { updateLock.ReleaseMutex(); } catch (ApplicationException) { }
                    updateLock.Dispose();
                }
                if (!IsDisposed) { close.Text = "Закрыть"; close.Enabled = true; }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { cancellation.Cancel(); cancellation.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
