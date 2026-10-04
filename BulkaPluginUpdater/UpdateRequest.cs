using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Xml;

namespace Bulka.PluginUpdater
{
    [DataContract]
    internal sealed class UpdateRequest
    {
        [DataMember(IsRequired = true)] public string TargetDirectory { get; set; }
        [DataMember(IsRequired = true)] public string StagingDirectory { get; set; }
        [DataMember(IsRequired = true)] public int HostProcessId { get; set; }
        [DataMember(IsRequired = true)] public long HostStartedAtUtcTicks { get; set; }
        [DataMember(IsRequired = true)] public int FrontProcessId { get; set; }
        [DataMember(IsRequired = true)] public long FrontStartedAtUtcTicks { get; set; }
        [DataMember(IsRequired = true)] public string CurrentVersion { get; set; }

        internal static UpdateRequest Read(string requestPath)
        {
            requestPath = SafePaths.FullPath(requestPath);
            SafePaths.RejectReparsePoints(requestPath);
            if (new FileInfo(requestPath).Length > 16384) throw new InvalidDataException("Запрос обновления слишком большой.");
            UpdateRequest request;
            using (var file = File.OpenRead(requestPath))
                request = (UpdateRequest)new DataContractJsonSerializer(typeof(UpdateRequest)).ReadObject(file);
            if (request == null) throw new InvalidDataException("Пустой запрос обновления.");
            request.TargetDirectory = SafePaths.DirectoryPath(request.TargetDirectory);
            request.StagingDirectory = SafePaths.DirectoryPath(request.StagingDirectory);
            if (!string.Equals(Path.GetDirectoryName(requestPath), request.StagingDirectory, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Запрос должен находиться в папке подготовки обновления.");
            if (SafePaths.Contains(request.TargetDirectory, request.StagingDirectory) || SafePaths.Contains(request.StagingDirectory, request.TargetDirectory))
                throw new InvalidDataException("Папки установки и подготовки обновления должны быть отдельными.");
            if (!Directory.Exists(request.TargetDirectory) || !Directory.Exists(request.StagingDirectory))
                throw new DirectoryNotFoundException("Папка плагина или обновления отсутствует.");
            if (request.HostProcessId <= 0 || request.FrontProcessId <= 0 || request.HostProcessId == request.FrontProcessId ||
                request.HostStartedAtUtcTicks <= 0 || request.FrontStartedAtUtcTicks <= 0)
                throw new InvalidDataException("Не удалось проверить процессы кассы.");
            ParseVersion(request.CurrentVersion);
            SafePaths.RejectReparsePoints(request.TargetDirectory);
            SafePaths.RejectReparsePoints(request.StagingDirectory);
            return request;
        }

        internal static Version ParseVersion(string text)
        {
            Version result;
            if (string.IsNullOrWhiteSpace(text) || !Version.TryParse(text, out result) || result.Build < 0)
                throw new InvalidDataException("Некорректная версия плагина.");
            return new Version(result.Major, result.Minor, result.Build, Math.Max(0, result.Revision));
        }
    }

    internal static class SafePaths
    {
        internal static readonly string[] InstalledFiles = { "Resto.Front.Api.IikoBonusPlugin.dll", "Manifest.xml", "BulkaPluginUpdater.exe" };
        internal static string FullPath(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value) || value.StartsWith(@"\\", StringComparison.Ordinal))
                throw new InvalidDataException("Обновление требует локальный абсолютный путь.");
            var root = Path.GetPathRoot(value);
            if (root.Length != 3 || root[1] != ':' || (root[2] != Path.DirectorySeparatorChar && root[2] != Path.AltDirectorySeparatorChar))
                throw new InvalidDataException("Обновление требует локальный абсолютный путь.");
            var full = Path.GetFullPath(value);
            if (full.Substring(Path.GetPathRoot(full).Length).IndexOf(':') >= 0)
                throw new InvalidDataException("Дополнительные потоки файлов запрещены.");
            return full;
        }
        internal static string DirectoryPath(string path)
        {
            var full = FullPath(path);
            return full.Length == Path.GetPathRoot(full).Length ? full : full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        internal static bool Contains(string parent, string child) =>
            string.Equals(parent, child, StringComparison.OrdinalIgnoreCase) ||
            child.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        internal static void RejectReparsePoints(string path)
        {
            var full = FullPath(path);
            for (var current = full; !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            {
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("Ссылки на другие папки или файлы запрещены: " + current);
            }
        }

        internal static string Hash(string path)
        {
            using (var file = File.OpenRead(path))
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
        }

        internal static string TextHash(string value)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
        }

        internal static void ValidateInstalled(UpdateRequest request, bool requireOriginalVersion)
        {
            RejectReparsePoints(request.TargetDirectory);
            foreach (var name in InstalledFiles) RejectReparsePoints(Path.Combine(request.TargetDirectory, name));
            var assembly = AssemblyName.GetAssemblyName(Path.Combine(request.TargetDirectory, InstalledFiles[0]));
            if (assembly.Name != "Resto.Front.Api.IikoBonusPlugin") throw new InvalidDataException("В выбранной папке отсутствует плагин Bulka.");
            if (requireOriginalVersion && assembly.Version != UpdateRequest.ParseVersion(request.CurrentVersion))
                throw new InvalidDataException("Версия установленного плагина изменилась. Проверьте обновления заново.");
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            var manifest = new XmlDocument { XmlResolver = null };
            using (var reader = XmlReader.Create(Path.Combine(request.TargetDirectory, "Manifest.xml"), settings)) manifest.Load(reader);
            if (manifest.DocumentElement?.Name != "Manifest" ||
                manifest.SelectSingleNode("/Manifest/FileName")?.InnerText != InstalledFiles[0] ||
                manifest.SelectSingleNode("/Manifest/TypeName")?.InnerText != "Resto.Front.Api.IikoBonusPlugin.PluginEntry" ||
                manifest.SelectSingleNode("/Manifest/ApiVersion")?.InnerText != "V9Preview7" ||
                manifest.SelectSingleNode("/Manifest/LicenseModuleId")?.InnerText != "21016318")
                throw new InvalidDataException("Manifest.xml не соответствует плагину Bulka.");
        }

        internal static void CheckWriteAccess(string targetDirectory, bool exclusiveFiles)
        {
            RejectReparsePoints(targetDirectory);
            foreach (var name in InstalledFiles)
            {
                var path = Path.Combine(targetDirectory, name);
                RejectReparsePoints(path);
                if (!File.Exists(path)) continue;
                if ((File.GetAttributes(path) & FileAttributes.ReadOnly) != 0) throw new UnauthorizedAccessException("Файл доступен только для чтения: " + name);
                if (exclusiveFiles) using (File.Open(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            }
            var probe = Path.Combine(targetDirectory, ".bulka-update-write-" + Guid.NewGuid().ToString("N") + ".tmp");
            using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
        }
    }

    internal sealed class ProcessWaitContext
    {
        private readonly UpdateRequest identity;
        internal ProcessWaitContext(UpdateRequest activeRequest)
        {
            identity = new UpdateRequest
            {
                HostProcessId = activeRequest.HostProcessId,
                HostStartedAtUtcTicks = activeRequest.HostStartedAtUtcTicks,
                FrontProcessId = activeRequest.FrontProcessId,
                FrontStartedAtUtcTicks = activeRequest.FrontStartedAtUtcTicks
            };
        }
        internal ProcessBarrier OpenBarrier() => new ProcessBarrier(identity);
    }

    internal sealed class ProcessBarrier : IDisposable
    {
        private Process host;
        private Process front;
        internal ProcessBarrier(UpdateRequest request)
        {
            try
            {
                host = Open(request.HostProcessId, request.HostStartedAtUtcTicks);
                front = Open(request.FrontProcessId, request.FrontStartedAtUtcTicks);
            }
            catch { Dispose(); throw; }
        }
        internal static Process Open(int id, long expectedStartTicks)
        {
            Process process;
            try { process = Process.GetProcessById(id); }
            catch (ArgumentException) { return null; }
            try
            {
                // Force opening the handle now; a later PID reuse cannot change it.
                var handle = process.Handle;
                if (process.HasExited) { process.Dispose(); return null; }
                if (process.StartTime.ToUniversalTime().Ticks != expectedStartTicks)
                    throw new InvalidDataException("Процесс кассы изменился. Закройте окно обновления и проверьте обновления заново.");
                return process;
            }
            catch (InvalidOperationException) { process.Dispose(); return null; }
            catch { process.Dispose(); throw; }
        }
        internal bool Exited => (host == null || host.HasExited) && (front == null || front.HasExited);
        public void Dispose() { host?.Dispose(); front?.Dispose(); host = null; front = null; }
    }
}
