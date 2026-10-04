using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.IikoBonusPlugin
{
    [DataContract] internal sealed class PluginUpdateApiResponse
    {
        [DataMember(Name="success")] public bool Success { get; set; }
        [DataMember(Name="release")] public PluginUpdateApiEnvelope Release { get; set; }
    }
    [DataContract] internal sealed class PluginUpdateApiEnvelope
    {
        [DataMember(Name="algorithm")] public string Algorithm { get; set; }
        [DataMember(Name="keyId")] public string KeyId { get; set; }
        [DataMember(Name="payloadBase64")] public string PayloadBase64 { get; set; }
        [DataMember(Name="signatureBase64")] public string SignatureBase64 { get; set; }
    }
    [DataContract] internal sealed class PluginUpdateInstallRequest
    {
        [DataMember] public string TargetDirectory { get; set; }
        [DataMember] public string StagingDirectory { get; set; }
        [DataMember] public int HostProcessId { get; set; }
        [DataMember] public long HostStartedAtUtcTicks { get; set; }
        [DataMember] public int FrontProcessId { get; set; }
        [DataMember] public long FrontStartedAtUtcTicks { get; set; }
        [DataMember] public string CurrentVersion { get; set; }
    }

    internal static class PluginUpdateFlow
    {
        private static int showing;
        internal static string Json<T>(T value)
        {
            using (var stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        internal static void Show(IViewManager vm)
        {
            if (Interlocked.CompareExchange(ref showing, 1, 0) != 0) return;
            try
            {
                if (!LoyaltyFlow.EnsureApiConfiguration(vm)) return;
                PluginUpdateInstallRequest request;
                using(var host = Process.GetCurrentProcess())
                using(var front = Process.GetProcessById(PluginContext.Integration.GetMainApplicationProcessId()))
                request = new PluginUpdateInstallRequest {
                    TargetDirectory=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
                    HostProcessId=host.Id, HostStartedAtUtcTicks=host.StartTime.ToUniversalTime().Ticks,
                    FrontProcessId=front.Id, FrontStartedAtUtcTicks=front.StartTime.ToUniversalTime().Ticks,
                    CurrentVersion=PosHealthSync.Version
                };
                var owner=OrderBoardWindow.CaptureOwner();
                Exception failure=null;
                var thread=new Thread(() => {
                    try { new PluginUpdateWindow(request, owner).ShowDialog(); }
                    catch(Exception error) { failure=error; }
                    finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); }
                });
                thread.IsBackground=true; thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
                if(failure!=null) vm.ShowErrorPopup("Не удалось открыть обновления. Повторите проверку.","ОК");
            }
            catch(Exception error)
            {
                PluginContext.Log.Warn("Bulka update screen: "+error.GetType().Name);
                vm.ShowErrorPopup("Не удалось проверить обновления. Повторите позже.","ОК");
            }
            finally { Interlocked.Exchange(ref showing,0); }
        }
    }

    internal sealed class PluginUpdateWindow : Window
    {
        private readonly PluginUpdateInstallRequest request;
        private readonly CancellationTokenSource cancellation=new CancellationTokenSource();
        private readonly TextBlock status;
        private readonly Button action;
        private PluginUpdateManifest available;
        private string envelope;
        private bool working;
        private bool installerLaunched;
        private bool closeRequested;

        internal PluginUpdateWindow(PluginUpdateInstallRequest installRequest, IntPtr owner)
        {
            request=installRequest;
            Title="Обновления Bulka"; Width=520; Height=340; MinWidth=420; MinHeight=310;
            ResizeMode=ResizeMode.NoResize; WindowStartupLocation=WindowStartupLocation.CenterScreen;
            Background=new SolidColorBrush(Color.FromRgb(255,250,241));
            Foreground=new SolidColorBrush(Color.FromRgb(89,48,25));
            if(owner!=IntPtr.Zero) new System.Windows.Interop.WindowInteropHelper(this).Owner=owner;
            var layout=new StackPanel { Margin=new Thickness(28) };
            layout.Children.Add(new TextBlock { Text="Обновления Bulka",FontSize=25,FontWeight=FontWeights.Bold });
            layout.Children.Add(new TextBlock { Text="Установлена версия "+request.CurrentVersion,FontSize=15,Margin=new Thickness(0,10,0,20) });
            status=new TextBlock { Text="Проверяем новую версию…",FontSize=17,TextWrapping=TextWrapping.Wrap,MinHeight=80 };
            layout.Children.Add(status);
            var buttons=new StackPanel { Orientation=Orientation.Horizontal, Margin=new Thickness(0,20,0,0) };
            action=new Button { Content="Проверить ещё раз",MinWidth=210,MinHeight=52,FontSize=17,FontWeight=FontWeights.SemiBold,
                Background=new SolidColorBrush(Color.FromRgb(255,189,18)),Padding=new Thickness(16,8,16,8),IsEnabled=false };
            action.Click+=async (_,__) => { if(available==null) await Check(); else await Install(); };
            buttons.Children.Add(action);
            var close=new Button {Content="Закрыть",MinHeight=52,MinWidth=120,FontSize=17,Margin=new Thickness(12,0,0,0),Padding=new Thickness(12,8,12,8)};
            close.Click+=(_,__)=>Close(); buttons.Children.Add(close);layout.Children.Add(buttons);Content=layout;
            Loaded+=async (_,__)=>await Check();
            Closing+=(_,args)=> {
                if(!working)return;
                args.Cancel=true;closeRequested=true;cancellation.Cancel();
                status.Text="Завершаем проверку…";action.IsEnabled=false;
            };
            Closed+=(_,__)=>cancellation.Cancel();
        }

        private void FinishOperation()
        {
            working=false;
            if(closeRequested)Close();
            else if(!cancellation.IsCancellationRequested&&!installerLaunched)action.IsEnabled=true;
        }

        private async Task Check()
        {
            if(working||cancellation.IsCancellationRequested)return;
            working=true;action.IsEnabled=false;available=null;status.Text="Проверяем новую версию…";
            try
            {
                var result=await Task.Run(()=>LoyaltyFlow.SendApiRequest(HttpMethod.Get,"pos/updates/latest",null,true));
                cancellation.Token.ThrowIfCancellationRequested();
                if(!result.IsSuccessStatusCode)throw new InvalidOperationException("Обновление пока недоступно. Попробуйте позже.");
                var response=LoyaltyFlow.DeserializeJson<PluginUpdateApiResponse>(result.Body);
                if(response?.Success!=true||response.Release==null)throw new InvalidOperationException("Сервер не подтвердил обновление.");
                envelope=PluginUpdateFlow.Json(response.Release);
                var manifest=PluginUpdatePackage.ParseAndVerify(envelope,"0.0.0");
                if(Version.Parse(manifest.Version)<=Version.Parse(request.CurrentVersion))
                { status.Text="У вас последняя версия.";action.Content="Проверить ещё раз"; }
                else
                {
                    available=manifest;status.Text="Доступна версия "+manifest.Version+".\nУстановка после закрытия iiko.";
                    action.Content="Скачать и установить";
                }
            }
            catch(OperationCanceledException) { }
            catch(Exception error)
            {
                PluginContext.Log.Warn("Bulka update check: "+error.GetType().Name);
                status.Text="Не удалось проверить обновления.\nПопробуйте позже.";
            }
            finally { FinishOperation(); }
        }

        private async Task Install()
        {
            if(working||available==null||cancellation.IsCancellationRequested)return;
            working=true;action.IsEnabled=false;status.Text="Скачиваем и проверяем обновление…";
            string staging=null;
            try
            {
                var manifest=PluginUpdatePackage.ParseAndVerify(envelope,request.CurrentVersion);
                staging=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Bulka","PluginUpdates",Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                var zip=Path.Combine(staging,"update.zip");
                using(var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token))
                using(var handler=new HttpClientHandler { AllowAutoRedirect=false })
                using(var client=new HttpClient(handler) { Timeout=TimeSpan.FromMinutes(2) })
                {
                    deadline.CancelAfter(TimeSpan.FromMinutes(2));
                    using(var response=await client.GetAsync(manifest.PackageUrl,HttpCompletionOption.ResponseHeadersRead,deadline.Token))
                    {
                    if(!response.IsSuccessStatusCode)throw new InvalidOperationException("Пакет обновления недоступен.");
                    if(response.Content.Headers.ContentLength.HasValue&&response.Content.Headers.ContentLength.Value!=manifest.PackageSizeBytes)
                        throw new InvalidOperationException("Размер обновления не совпал.");
                    using(var source=await response.Content.ReadAsStreamAsync())
                    using(var destination=new FileStream(zip,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                    {
                        var buffer=new byte[65536];long total=0;int count;
                        while((count=await source.ReadAsync(buffer,0,buffer.Length,deadline.Token))>0)
                        {
                            total+=count;if(total>manifest.PackageSizeBytes)throw new InvalidOperationException("Размер обновления превышен.");
                            await destination.WriteAsync(buffer,0,count,deadline.Token);
                        }
                        if(total!=manifest.PackageSizeBytes)throw new InvalidOperationException("Обновление скачано не полностью.");
                        destination.Flush(true);
                    }
                    }
                }
                cancellation.Token.ThrowIfCancellationRequested();
                var extracted=Path.Combine(staging,"verified");
                await Task.Run(()=>PluginUpdatePackage.ValidateAndExtract(zip,extracted,manifest));
                cancellation.Token.ThrowIfCancellationRequested();
                File.WriteAllText(Path.Combine(staging,"update.manifest.json"),envelope,new UTF8Encoding(false));
                request.StagingDirectory=staging;
                File.WriteAllText(Path.Combine(staging,"request.json"),PluginUpdateFlow.Json(request),new UTF8Encoding(false));
                var helper=Path.Combine(staging,"BulkaPluginUpdater.exe");
                File.Copy(Path.Combine(extracted,"BulkaPluginUpdater.exe"),helper,false);
                var started=Process.Start(new ProcessStartInfo(helper,"--request \""+Path.Combine(staging,"request.json")+"\"") {
                    UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=staging
                });
                if(started==null)throw new InvalidOperationException("Не удалось запустить установку.");
                installerLaunched=true;
                status.Text="Обновление готово.\nЗакройте iiko и дождитесь сообщения об установке. Затем запустите кассу.";
                action.Content="Готово";action.IsEnabled=false;
                started.Dispose();
            }
            catch(OperationCanceledException)
            {
                if(!cancellation.IsCancellationRequested)status.Text="Загрузка прервалась. Попробуйте ещё раз.";
            }
            catch(Exception error)
            {
                PluginContext.Log.Warn("Bulka update download: "+error.GetType().Name);
                status.Text="Не удалось подготовить обновление.\nТекущая версия сохранена. Попробуйте ещё раз.";
                action.Content="Повторить установку";
            }
            finally
            {
                if(staging!=null&&!installerLaunched)
                {
                    // Only this freshly-created private job is removed; installed files are never touched here.
                    try
                    {
                        var safeRoot=Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Bulka","PluginUpdates"))+Path.DirectorySeparatorChar;
                        var resolved=Path.GetFullPath(staging);
                        if(resolved.StartsWith(safeRoot,StringComparison.OrdinalIgnoreCase)&&Directory.Exists(resolved))
                        { PluginUpdatePackage.EnsureNoReparsePoints(resolved);Directory.Delete(resolved,true); }
                    }
                    catch { }
                }
                FinishOperation();
            }
        }
    }
}
