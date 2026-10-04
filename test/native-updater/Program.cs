using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.Serialization.Json;
using System.Threading;
using Bulka.PluginUpdater;

internal static class Program
{
    private static int checks;
    private static string root;
    private static void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; Console.WriteLine("PASS: " + label); }
    private static void Reject(Action action, string label) { try { action(); } catch { Check(true, label); return; } throw new Exception("Expected rejection: " + label); }
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--child") { Thread.Sleep(800); return 0; }
        if (args.Length == 2 && args[0] == "--interrupt")
        {
            new UpdateInstaller(UpdateRequest.Read(args[1])).Install(count => { if (count == 1) Environment.Exit(79); });
            return 78;
        }
        if (args.Length == 2 && args[0] == "--completed-interrupt")
        {
            new UpdateInstaller(UpdateRequest.Read(args[1])).Install(null, null, () => Environment.Exit(80));
            return 78;
        }
        root = Path.Combine(Path.GetTempPath(), "bulka-updater-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Requests(); ProcessIdentity(); InstallAndPreserve(); LockedTarget(); PartialRollback(); InterruptedRecovery(); DamagedBackup();
            VersionChangedAtCommit(); SnapshotChangedAtCommit(); FreshJobInterrupted(); StaleRecovery(); OriginallyAbsentHelperChanged(); CompletedMarker();
            RecoveryWaitsForCurrentProcesses();
            Console.WriteLine("PASS: " + checks + " updater assertions; only temporary files and test child processes were used.");
            return 0;
        }
        finally { Directory.Delete(root, true); }
    }

    private static UpdateRequest Fixture(string label)
    {
        var fixture = Path.Combine(root, label);
        var target = Path.Combine(fixture, "plugin");
        var stage = Path.Combine(fixture, "stage");
        Directory.CreateDirectory(target);
        Directory.CreateDirectory(stage);
        Directory.CreateDirectory(Path.Combine(stage, "candidate"));
        foreach (var name in SafePaths.InstalledFiles)
        {
            var path = Path.Combine(target, name);
            if (name == SafePaths.InstalledFiles[0] || name == "Manifest.xml")
                File.Copy(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixture", name), path);
            else File.WriteAllText(path, "old-helper");
            File.WriteAllText(Path.Combine(stage, "candidate", name), "new:" + name);
        }
        File.WriteAllText(Path.Combine(target, "Resto.Front.Api.IikoBonusPlugin.dll.config"), "secret-config-sentinel");
        Directory.CreateDirectory(Path.Combine(target, "data"));
        File.WriteAllText(Path.Combine(target, "data", "pairing.json"), "pairing-sentinel");
        var request = new UpdateRequest
        {
            TargetDirectory = target,
            StagingDirectory = stage,
            HostProcessId = int.MaxValue,
            HostStartedAtUtcTicks = 1,
            FrontProcessId = int.MaxValue - 1,
            FrontStartedAtUtcTicks = 1,
            CurrentVersion = AssemblyName.GetAssemblyName(Path.Combine(target, SafePaths.InstalledFiles[0])).Version.ToString()
        };
        WriteRequest(request);
        return request;
    }

    private static string WriteRequest(UpdateRequest request)
    {
        var path = Path.Combine(request.StagingDirectory, "request.json");
        using (var file = File.Create(path)) new DataContractJsonSerializer(typeof(UpdateRequest)).WriteObject(file, request);
        return path;
    }

    private static string[] Hashes(UpdateRequest request) => SafePaths.InstalledFiles.Select(name => SafePaths.Hash(Path.Combine(request.TargetDirectory, name))).ToArray();
    private static bool SameHashes(UpdateRequest request, string[] expected) => Hashes(request).SequenceEqual(expected);

    private static void Requests()
    {
        var request = Fixture("request");
        var read = UpdateRequest.Read(WriteRequest(request));
        SafePaths.ValidateInstalled(read, true);
        SafePaths.CheckWriteAccess(read.TargetDirectory, false);
        Check(read.CurrentVersion == request.CurrentVersion, "real plugin identity and private request accepted");
        read.CurrentVersion = "99.0.0";
        Reject(() => SafePaths.ValidateInstalled(read, true), "changed installed version rejected");
        Reject(() => SafePaths.FullPath(@"\\server\share\request.json"), "remote share paths rejected");
        Reject(() => SafePaths.FullPath(@"C:request.json"), "drive-relative paths rejected");
        Reject(() => SafePaths.FullPath(@"\request.json"), "current-drive-relative paths rejected");
        Reject(() => SafePaths.FullPath(request.TargetDirectory + ":alternate"), "alternate data streams rejected");
        request.StagingDirectory = request.TargetDirectory;
        Reject(() => UpdateRequest.Read(WriteRequest(request)), "staging inside installation rejected");
    }

    private static void ProcessIdentity()
    {
        using (var self = Process.GetCurrentProcess())
        {
            Reject(() => { using (ProcessBarrier.Open(self.Id, self.StartTime.ToUniversalTime().Ticks + 1)) { } }, "reused or unexpected process timestamp fails closed");
            using (var opened = ProcessBarrier.Open(self.Id, self.StartTime.ToUniversalTime().Ticks)) Check(opened != null, "matching process handle accepted");
        }
        Check(ProcessBarrier.Open(int.MaxValue, 1) == null, "already exited process tolerated");
        using (var child = Start("--child"))
        {
            var request = Fixture("process");
            request.FrontProcessId = child.Id;
            request.FrontStartedAtUtcTicks = child.StartTime.ToUniversalTime().Ticks;
            using (var barrier = new ProcessBarrier(request))
            {
                Check(!barrier.Exited, "updater waits for tracked active process");
                Check(child.WaitForExit(10000), "test child exited normally");
                Check(barrier.Exited, "barrier releases after normal process exit");
            }
        }
    }

    private static void InstallAndPreserve()
    {
        var request = Fixture("success");
        new UpdateInstaller(request).Install();
        Check(SafePaths.InstalledFiles.All(name => File.ReadAllText(Path.Combine(request.TargetDirectory, name)) == "new:" + name), "all three verified candidate files installed");
        Check(File.ReadAllText(Path.Combine(request.TargetDirectory, "Resto.Front.Api.IikoBonusPlugin.dll.config")) == "secret-config-sentinel" &&
            File.ReadAllText(Path.Combine(request.TargetDirectory, "data", "pairing.json")) == "pairing-sentinel", "configuration and pairing data preserved");
        Check(Directory.GetFiles(Path.Combine(request.StagingDirectory, "backup")).Length == 3, "only allowlisted files backed up");
        Reject(() => new UpdateInstaller(request).Install(), "completed transaction cannot run twice");
    }

    private static void LockedTarget()
    {
        var request = Fixture("locked");
        var before = Hashes(request);
        using (File.Open(Path.Combine(request.TargetDirectory, "Manifest.xml"), FileMode.Open, FileAccess.Read, FileShare.Read))
            Reject(() => new UpdateInstaller(request).Install(), "running-file sharing lock stops installation before changes");
        Check(SameHashes(request, before), "locked installation leaves original files intact");
    }

    private static void PartialRollback()
    {
        var request = Fixture("rollback");
        var before = Hashes(request);
        FileStream locked = null;
        var installer = new UpdateInstaller(request);
        try
        {
            Reject(() => installer.Install(count =>
            {
                if (count == 1) locked = File.Open(Path.Combine(request.TargetDirectory, "Manifest.xml"), FileMode.Open, FileAccess.Read, FileShare.Read);
            }), "failure during second replacement triggers rollback");
            Check(installer.Restored && SameHashes(request, before), "partial replacement restores old bytes while untouched file remains locked");
        }
        finally { locked?.Dispose(); }
    }

    private static Process Start(string arguments) => Process.Start(new ProcessStartInfo
    {
        FileName = Assembly.GetExecutingAssembly().Location,
        Arguments = arguments,
        UseShellExecute = false,
        CreateNoWindow = true
    });

    private static void InterruptedRecovery()
    {
        var request = Fixture("interruption");
        var before = Hashes(request);
        using (var child = Start("--interrupt \"" + WriteRequest(request) + "\""))
        {
            Check(child.WaitForExit(10000) && child.ExitCode == 79, "test process interrupted after first real replacement");
        }
        var installer = new UpdateInstaller(request);
        Check(installer.HasInterruptedTransaction && !SameHashes(request, before), "durable journal identifies interrupted transaction");
        installer.Recover();
        Check(installer.Restored && SameHashes(request, before), "recovery restores interrupted transaction from durable backup");
        installer.Recover();
        Check(SameHashes(request, before), "repeated recovery is harmless");
    }

    private static void DamagedBackup()
    {
        var request = Fixture("damaged-backup");
        using (var child = Start("--interrupt \"" + WriteRequest(request) + "\"")) Check(child.WaitForExit(10000), "damaged-backup test child completed");
        var beforeRecovery = Hashes(request);
        File.WriteAllText(Path.Combine(request.StagingDirectory, "backup", "Manifest.xml"), "tampered");
        var installer = new UpdateInstaller(request);
        Reject(() => installer.Recover(), "modified backup fails closed");
        Check(installer.RecoveryRequired && SameHashes(request, beforeRecovery), "backup failure performs no partial recovery and preserves evidence");
    }

    private static string NewerAssembly(UpdateRequest request)
    {
        var name = new AssemblyName("Resto.Front.Api.IikoBonusPlugin") { Version = new Version(99, 0, 0, 0) };
        var assembly = AppDomain.CurrentDomain.DefineDynamicAssembly(name, AssemblyBuilderAccess.Save, request.StagingDirectory);
        var module = assembly.DefineDynamicModule("Newer", "newer.dll");
        module.DefineType("Resto.Front.Api.IikoBonusPlugin.PluginEntry", TypeAttributes.Public).CreateType();
        assembly.Save("newer.dll");
        return Path.Combine(request.StagingDirectory, "newer.dll");
    }

    private static void VersionChangedAtCommit()
    {
        var request = Fixture("changed-version");
        var newer = NewerAssembly(request);
        string[] changed = null;
        Reject(() => new UpdateInstaller(request).Install(null, () =>
        {
            File.Copy(newer, Path.Combine(request.TargetDirectory, SafePaths.InstalledFiles[0]), true);
            changed = Hashes(request);
        }), "newer DLL introduced inside snapshot boundary stops transaction");
        Check(changed != null && SameHashes(request, changed), "inside-boundary newer version is never replaced or rolled back");
    }

    private static void SnapshotChangedAtCommit()
    {
        var request = Fixture("changed-bytes");
        string[] changed = null;
        Reject(() => new UpdateInstaller(request).Install(null, () =>
        {
            File.WriteAllText(Path.Combine(request.TargetDirectory, "BulkaPluginUpdater.exe"), "later-helper");
            changed = Hashes(request);
        }), "same-version installed byte change is detected against backup snapshot");
        Check(changed != null && SameHashes(request, changed), "snapshot mismatch stops before the first replacement");
    }

    private static UpdateRequest FreshRequest(UpdateRequest old, string label)
    {
        var fresh = Fixture(label);
        fresh.TargetDirectory = old.TargetDirectory;
        fresh.CurrentVersion = old.CurrentVersion;
        WriteRequest(fresh);
        return fresh;
    }

    private static void Interrupt(UpdateRequest request, bool completed = false)
    {
        using (var child = Start((completed ? "--completed-interrupt" : "--interrupt") + " \"" + WriteRequest(request) + "\""))
            Check(child.WaitForExit(10000) && child.ExitCode == (completed ? 80 : 79), "test interruption reached requested transaction boundary");
    }

    private static void FreshJobInterrupted()
    {
        var old = Fixture("old-pending");
        Interrupt(old);
        var before = Hashes(old);
        var fresh = FreshRequest(old, "fresh-pending");
        var installer = new UpdateInstaller(fresh);
        Check(installer.HasInterruptedTransaction && installer.RecoveryRequestPath == Path.Combine(old.StagingDirectory, "request.json"),
            "fresh job detects target-scoped old transaction and exposes old recovery request");
        Reject(() => installer.Install(), "fresh job cannot install over interrupted old transaction");
        Check(SameHashes(old, before), "fresh-job rejection performs no target writes");
    }

    private static void StaleRecovery()
    {
        var old = Fixture("stale-recovery");
        Interrupt(old);
        File.Copy(NewerAssembly(old), Path.Combine(old.TargetDirectory, SafePaths.InstalledFiles[0]), true);
        File.AppendAllText(Path.Combine(old.TargetDirectory, "Manifest.xml"), "\n<!-- later healthy release -->");
        File.WriteAllText(Path.Combine(old.TargetDirectory, "BulkaPluginUpdater.exe"), "later-healthy-helper");
        var healthy = Hashes(old);
        Reject(() => new UpdateInstaller(old).Recover(), "stale recovery refuses unrelated newer healthy release");
        Check(SameHashes(old, healthy), "stale recovery leaves every newer release byte intact");
    }

    private static void OriginallyAbsentHelperChanged()
    {
        var request = Fixture("absent-helper");
        File.Delete(Path.Combine(request.TargetDirectory, "BulkaPluginUpdater.exe"));
        Interrupt(request);
        File.WriteAllText(Path.Combine(request.TargetDirectory, "BulkaPluginUpdater.exe"), "unrelated-later-helper");
        var before = Hashes(request);
        Reject(() => new UpdateInstaller(request).Recover(), "unrelated helper introduced after originally absent helper blocks recovery");
        Check(SameHashes(request, before), "all-target recovery preflight rejects before restoring an earlier candidate DLL");
    }

    private static void CompletedMarker()
    {
        var completed = Fixture("completed-marker");
        Interrupt(completed, true);
        var installed = Hashes(completed);
        var fresh = new UpdateInstaller(FreshRequest(completed, "fresh-completed"));
        Check(!fresh.HasInterruptedTransaction, "durably completed journal with matching candidates is accepted after marker-cleanup interruption");
        Check(!File.Exists(Path.Combine(completed.TargetDirectory, ".bulka-update-transaction.json")) && SameHashes(completed, installed),
            "completed marker cleanup preserves installed candidate bytes");

        var mismatched = Fixture("mismatched-completed-marker");
        Interrupt(mismatched, true);
        File.WriteAllText(Path.Combine(mismatched.TargetDirectory, "BulkaPluginUpdater.exe"), "later-helper");
        var before = Hashes(mismatched);
        var other = new UpdateInstaller(FreshRequest(mismatched, "fresh-mismatched"));
        Reject(() => { var pending = other.HasInterruptedTransaction; }, "completed marker cannot be cleared when installed candidate bytes changed");
        Check(File.Exists(Path.Combine(mismatched.TargetDirectory, ".bulka-update-transaction.json")) && SameHashes(mismatched, before),
            "mismatched completed marker fails closed without target changes");
    }

    private static void RecoveryWaitsForCurrentProcesses()
    {
        using (var child = Start("--child"))
        {
            var fresh = Fixture("recovery-process");
            fresh.FrontProcessId = child.Id;
            fresh.FrontStartedAtUtcTicks = child.StartTime.ToUniversalTime().Ticks;
            var current = new ProcessWaitContext(fresh);
            // Simulate loading an old transaction request whose PID has since been reused.
            using (var self = Process.GetCurrentProcess())
            {
                fresh.FrontProcessId = self.Id;
                fresh.FrontStartedAtUtcTicks = self.StartTime.ToUniversalTime().Ticks + 1;
                Reject(() => { using (new ProcessBarrier(fresh)) { } }, "old recovery process identity would fail closed on PID reuse");
            }
            using (var barrier = current.OpenBarrier())
            {
                Check(!barrier.Exited, "recovery retains current fresh-job process identity after switching old journal request");
                Check(child.WaitForExit(10000) && barrier.Exited, "recovery waits for the actual current test cash-register process to exit normally");
            }
        }
    }
}
