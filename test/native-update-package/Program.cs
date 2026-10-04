using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.CSharp;
using Resto.Front.Api.IikoBonusPlugin;

internal static class Program
{
    private static string root;
    private static RSACryptoServiceProvider signingKey;
    private static Dictionary<string, byte[]> files;
    private static int assertions;
    private const string GoodVersion = "1.12.2";
    private const string GoodManifest = "<?xml version=\"1.0\"?><Manifest><FileName>Resto.Front.Api.IikoBonusPlugin.dll</FileName><TypeName>Resto.Front.Api.IikoBonusPlugin.PluginEntry</TypeName><ApiVersion>V9Preview7</ApiVersion><LicenseModuleId>21016318</LicenseModuleId></Manifest>";

    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--validate-release") return ValidateRelease(args);
        root = Path.Combine(Path.GetTempPath(), "bulka-update-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        signingKey = new RSACryptoServiceProvider(2048) { PersistKeyInCsp = false };
        try
        {
            files = new Dictionary<string, byte[]>(StringComparer.Ordinal) {
                { PluginUpdatePackage.PluginFileName, CompileFixture("Resto.Front.Api.IikoBonusPlugin", GoodVersion + ".0", false) },
                { PluginUpdatePackage.ManifestFileName, Encoding.UTF8.GetBytes(GoodManifest) },
                { PluginUpdatePackage.UpdaterFileName, CompileFixture("BulkaPluginUpdater", "1.0.0.0", true) }
            };
            MetadataTests();
            PackageTests();
            Console.WriteLine("PASS: " + assertions + " signed update assertions");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
        finally
        {
            signingKey.Dispose();
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private static int ValidateRelease(string[] args)
    {
        if (args.Length != 3)
        {
            Console.Error.WriteLine("Usage: --validate-release <manifest.json> <zip>");
            return 2;
        }
        string staging = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "bulka-release-verify-" + Guid.NewGuid().ToString("N")));
        try
        {
            string envelopePath = Path.GetFullPath(args[1]);
            PluginUpdatePackage.EnsureNoReparsePoints(envelopePath);
            if (new FileInfo(envelopePath).Length > 128 * 1024) throw new InvalidDataException("Update information is too large.");
            PluginUpdateManifest manifest = PluginUpdatePackage.ParseAndVerify(File.ReadAllText(envelopePath), "0.0.0");
            PluginUpdatePackage.ValidateAndExtract(Path.GetFullPath(args[2]), staging, manifest);
            Console.WriteLine("Validated production release " + manifest.Version + ": " + manifest.Files.Count + " files.");
            foreach (string name in PluginUpdatePackage.RequiredFileNames) Console.WriteLine("PASS: " + name);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Release validation failed: " + error.Message);
            return 1;
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                PluginUpdatePackage.EnsureNoReparsePoints(staging);
                Directory.Delete(staging, true);
            }
        }
    }

    private static void MetadataTests()
    {
        string package = MakePackage();
        UpdatePayload payload = Payload(package);
        string envelope = Sign(payload);
        PluginUpdateManifest manifest = Verify(envelope);
        Check(manifest.Version == GoodVersion && manifest.Files.Count == 3, "valid signed payload accepted");
        Check(PluginUpdatePackage.ParseAndVerify(envelope, "1.12.1.0", signingKey.ToXmlString(false)).Version == GoodVersion, "installed assembly version accepted");
        Reject("production trust refuses test key", () => PluginUpdatePackage.ParseAndVerify(envelope, "1.12.1"));
        using (var wrongKey = new RSACryptoServiceProvider(2048) { PersistKeyInCsp = false })
            Reject("wrong signing key", () => PluginUpdatePackage.ParseAndVerify(envelope, "1.12.1", wrongKey.ToXmlString(false)));
        Reject("equal version", () => PluginUpdatePackage.ParseAndVerify(envelope, GoodVersion, signingKey.ToXmlString(false)));
        Reject("downgrade", () => PluginUpdatePackage.ParseAndVerify(envelope, "1.13.0", signingKey.ToXmlString(false)));
        Reject("invalid installed version", () => PluginUpdatePackage.ParseAndVerify(envelope, "unknown", signingKey.ToXmlString(false)));
        UpdateEnvelope tampered = JsonRead<UpdateEnvelope>(envelope);
        byte[] altered = Convert.FromBase64String(tampered.payloadBase64);
        altered[altered.Length / 2] ^= 1;
        tampered.payloadBase64 = Convert.ToBase64String(altered);
        Reject("payload tampering", () => Verify(Json(tampered)));
        tampered = JsonRead<UpdateEnvelope>(envelope);
        byte[] signature = Convert.FromBase64String(tampered.signatureBase64);
        signature[0] ^= 1;
        tampered.signatureBase64 = Convert.ToBase64String(signature);
        Reject("signature tampering", () => Verify(Json(tampered)));
        tampered = JsonRead<UpdateEnvelope>(envelope);
        tampered.algorithm = "RSA-SHA1";
        Reject("wrong signature algorithm", () => Verify(Json(tampered)));
        tampered = JsonRead<UpdateEnvelope>(envelope);
        tampered.keyId = "attacker-key";
        Reject("wrong key identity", () => Verify(Json(tampered)));
        tampered = JsonRead<UpdateEnvelope>(envelope);
        tampered.signatureBase64 = "%%%";
        Reject("malformed base64", () => Verify(Json(tampered)));
        tampered = JsonRead<UpdateEnvelope>(envelope);
        tampered.payloadBase64 += "\n";
        Reject("noncanonical base64", () => Verify(Json(tampered)));

        ChangeMetadata(package, "schema", p => p.schemaVersion = 2);
        ChangeMetadata(package, "four-part release version", p => p.version = GoodVersion + ".0");
        ChangeMetadata(package, "leading zero release version", p => p.version = "01.12.2");
        ChangeMetadata(package, "negative release version", p => p.version = "-1.12.2");
        ChangeMetadata(package, "newline in release version", p => { p.version += "\n"; p.packageUrl = "https://bulka.com.kz/downloads/BulkaPlugin-" + p.version + "-update.zip"; });
        ChangeMetadata(package, "incompatible API", p => p.apiVersion = "V8");
        foreach (string address in new[] {
            "http://bulka.com.kz/downloads/BulkaPlugin-1.12.2-update.zip",
            "https://evil.invalid/downloads/BulkaPlugin-1.12.2-update.zip",
            "https://bulka.com.kz@evil.invalid/downloads/BulkaPlugin-1.12.2-update.zip",
            "https://bulka.com.kz:443/downloads/BulkaPlugin-1.12.2-update.zip",
            "https://bulka.com.kz/downloads/../BulkaPlugin-1.12.2-update.zip",
            "https://bulka.com.kz/downloads/BulkaPlugin-1.12.2-update.zip?next=evil",
            "https://bulka.com.kz/downloads/BulkaPlugin-1.12.1-update.zip" })
            ChangeMetadata(package, "invalid download address", p => p.packageUrl = address);
        ChangeMetadata(package, "invalid package hash", p => p.packageSha256 = "abc");
        ChangeMetadata(package, "newline in package hash", p => p.packageSha256 += "\n");
        ChangeMetadata(package, "zero package size", p => p.packageSizeBytes = 0);
        ChangeMetadata(package, "negative package size", p => p.packageSizeBytes = -1);
        ChangeMetadata(package, "oversized package", p => p.packageSizeBytes = PluginUpdatePackage.MaximumPackageBytes + 1);
        ChangeMetadata(package, "unexpected config inventory", p => p.files.Add("Resto.Front.Api.IikoBonusPlugin.dll.config", new string('a', 64)));
        ChangeMetadata(package, "missing updater inventory", p => p.files.Remove(PluginUpdatePackage.UpdaterFileName));
        ChangeMetadata(package, "path inventory", p => { p.files.Remove(PluginUpdatePackage.UpdaterFileName); p.files.Add("../BulkaPluginUpdater.exe", new string('a', 64)); });
        ChangeMetadata(package, "invalid file hash", p => p.files[PluginUpdatePackage.PluginFileName] = "bad");
        ChangeMetadata(package, "invalid source commit", p => p.sourceCommit = "main");
        ChangeMetadata(package, "newline in source commit", p => p.sourceCommit += "\n");
        ChangeMetadata(package, "non-UTC publication date", p => p.publishedAt = "2026-10-04T12:00:00+05:00");
        ChangeMetadata(package, "invalid publication date", p => p.publishedAt = "2026-02-30T12:00:00Z");
        ChangeMetadata(package, "empty publication date", p => p.publishedAt = "");
        ChangeMetadata(package, "newline in publication date", p => p.publishedAt += "\n");

        string rawPayload = Json(payload);
        Reject("duplicate JSON payload field", () => Verify(SignBytes(Encoding.UTF8.GetBytes(rawPayload.Insert(1, "\"version\":\"1.99.0\",")))));
        Reject("duplicate JSON envelope field", () => Verify(envelope.Insert(1, "\"keyId\":\"bulka-plugin-2026\",")));
        Reject("trailing JSON payload data", () => Verify(SignBytes(Encoding.UTF8.GetBytes(rawPayload + "{}"))));
        Reject("trailing JSON envelope data", () => Verify(envelope + "{}"));
        byte[] domainless = Encoding.UTF8.GetBytes(Json(payload));
        var domainlessEnvelope = new UpdateEnvelope { algorithm = "RSA-SHA256", keyId = PluginUpdateTrust.KeyId, payloadBase64 = Convert.ToBase64String(domainless), signatureBase64 = Convert.ToBase64String(signingKey.SignData(domainless, CryptoConfig.MapNameToOID("SHA256"))) };
        Reject("signature requires domain prefix", () => Verify(Json(domainlessEnvelope)));
    }

    private static void PackageTests()
    {
        string package = MakePackage();
        PluginUpdateManifest manifest = Verify(Sign(Payload(package)));
        string destination = NewPath("valid-stage");
        PluginUpdatePackage.ValidateAndExtract(package, destination, manifest);
        Check(Directory.GetFiles(destination).Length == 3, "verified exact files extracted");
        foreach (var file in files) Check(Hash(File.ReadAllBytes(Path.Combine(destination, file.Key))) == Hash(file.Value), "extracted bytes match " + file.Key);
        string originalConfig = NewPath("installed-config");
        Directory.CreateDirectory(originalConfig);
        string sentinel = Path.Combine(originalConfig, "Resto.Front.Api.IikoBonusPlugin.dll.config");
        File.WriteAllText(sentinel, "keep local branch and credentials");
        Reject("nonempty installed folder cannot be extraction target", () => PluginUpdatePackage.ValidateAndExtract(package, originalConfig, manifest));
        Check(File.ReadAllText(sentinel) == "keep local branch and credentials" && Directory.GetFiles(originalConfig).Length == 1, "failed extraction leaves installed configuration unchanged");

        UpdatePayload badHash = Payload(package);
        badHash.packageSha256 = new string('0', 64);
        RejectPackage("package checksum", package, badHash);
        UpdatePayload badSize = Payload(package);
        badSize.packageSizeBytes += 1;
        RejectPackage("package size", package, badSize);
        UpdatePayload badFileHash = Payload(package);
        badFileHash.files[PluginUpdatePackage.ManifestFileName] = new string('0', 64);
        RejectPackage("file checksum and staging cleanup", package, badFileHash);

        var entries = CopyFiles();
        entries.Add("branch.json", Encoding.UTF8.GetBytes("config"));
        RejectPackage("extra config file", MakePackage(entries));
        entries = CopyFiles(); entries.Remove(PluginUpdatePackage.UpdaterFileName);
        RejectPackage("missing updater", MakePackage(entries));
        entries = CopyFiles(); entries.Remove(PluginUpdatePackage.UpdaterFileName); entries.Add("../BulkaPluginUpdater.exe", files[PluginUpdatePackage.UpdaterFileName]);
        RejectPackage("path traversal", MakePackage(entries));
        entries = CopyFiles(); entries.Remove(PluginUpdatePackage.UpdaterFileName); entries.Add("..\\BulkaPluginUpdater.exe", files[PluginUpdatePackage.UpdaterFileName]);
        RejectPackage("Windows path traversal", MakePackage(entries));
        entries = CopyFiles(); entries.Remove(PluginUpdatePackage.UpdaterFileName); entries.Add("C:\\BulkaPluginUpdater.exe", files[PluginUpdatePackage.UpdaterFileName]);
        RejectPackage("absolute drive path", MakePackage(entries));
        entries = CopyFiles(); entries.Remove(PluginUpdatePackage.UpdaterFileName); entries.Add("bulkAPluginUpdater.exe", files[PluginUpdatePackage.UpdaterFileName]);
        RejectPackage("wrong entry casing", MakePackage(entries));
        string duplicate = MakePackage(null, archive => { var entry = archive.CreateEntry(PluginUpdatePackage.ManifestFileName); using (var stream = entry.Open()) stream.Write(files[PluginUpdatePackage.ManifestFileName], 0, files[PluginUpdatePackage.ManifestFileName].Length); });
        RejectPackage("duplicate ZIP file", duplicate);
        string symlink = MakePackage(null, archive => archive.GetEntry(PluginUpdatePackage.ManifestFileName).ExternalAttributes = unchecked((int)0xa1ff0000));
        RejectPackage("ZIP symlink", symlink);
        string reparse = MakePackage(null, archive => archive.GetEntry(PluginUpdatePackage.ManifestFileName).ExternalAttributes = (int)FileAttributes.ReparsePoint);
        RejectPackage("ZIP reparse attribute", reparse);
        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = new byte[512 * 1024];
        RejectPackage("compressed expansion bomb", MakePackage(entries), null, entries);
        string maliciousSize = MakePackage();
        byte[] sizeBytes = File.ReadAllBytes(maliciousSize);
        for (int i = 0; i < sizeBytes.Length - 28; i++)
        {
            if (sizeBytes[i] == 0x50 && sizeBytes[i + 1] == 0x4b && sizeBytes[i + 2] == 0x01 && sizeBytes[i + 3] == 0x02)
            { Buffer.BlockCopy(BitConverter.GetBytes((uint)(PluginUpdatePackage.MaximumPackageBytes + 1)), 0, sizeBytes, i + 24, 4); break; }
        }
        File.WriteAllBytes(maliciousSize, sizeBytes);
        RejectPackage("malicious declared uncompressed size", maliciousSize);

        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = Encoding.UTF8.GetBytes(GoodManifest.Replace("V9Preview7", "V8"));
        RejectPackage("incompatible manifest contract", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = Encoding.UTF8.GetBytes(GoodManifest.Replace("21016318", "0"));
        RejectPackage("wrong license module", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = Encoding.UTF8.GetBytes(GoodManifest.Replace("<ApiVersion>", "<ApiVersion ignored=\"V8\">"));
        RejectPackage("ambiguous manifest attributes", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = Encoding.UTF8.GetBytes(GoodManifest.Replace("V9Preview7", "<Nested>V9Preview7</Nested>"));
        RejectPackage("nested manifest value", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.ManifestFileName] = Encoding.UTF8.GetBytes("<!DOCTYPE Manifest [<!ENTITY x SYSTEM 'file:///does-not-exist'>]>" + GoodManifest.Replace("<?xml version=\"1.0\"?>", "").Replace("V9Preview7", "&x;"));
        RejectPackage("XML entity expansion", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.PluginFileName] = CompileFixture("Resto.Front.Api.IikoBonusPlugin", "1.12.1.0", false);
        RejectPackage("assembly version mismatch", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.PluginFileName] = CompileFixture("OtherPlugin", GoodVersion + ".0", false);
        RejectPackage("plugin assembly identity mismatch", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.UpdaterFileName] = CompileFixture("OtherUpdater", "1.0.0.0", true);
        RejectPackage("updater assembly identity mismatch", MakePackage(entries), null, entries);
        entries = CopyFiles(); entries[PluginUpdatePackage.PluginFileName] = Encoding.UTF8.GetBytes("not a PE assembly");
        RejectPackage("invalid plugin binary", MakePackage(entries), null, entries);
        string junk = NewPath("junk.zip"); File.WriteAllText(junk, "not a zip"); RejectPackage("invalid ZIP archive", junk);
    }

    private static byte[] CompileFixture(string name, string version, bool executable)
    {
        string path = Path.Combine(root, name + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        string output = Path.Combine(path, name + (executable ? ".exe" : ".dll"));
        using (var compiler = new CSharpCodeProvider())
        {
            var parameters = new CompilerParameters { GenerateExecutable = executable, OutputAssembly = output, TreatWarningsAsErrors = true };
            string source = "[assembly: System.Reflection.AssemblyVersion(\"" + version + "\")] public static class Fixture { public static void Main() {} }";
            CompilerResults result = compiler.CompileAssemblyFromSource(parameters, source);
            if (result.Errors.HasErrors) throw new Exception(result.Errors[0].ToString());
        }
        return File.ReadAllBytes(output);
    }

    private static string MakePackage(Dictionary<string, byte[]> content = null, Action<ZipArchive> mutate = null)
    {
        string path = NewPath("package.zip");
        using (var stream = File.Create(path))
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
        {
            foreach (var file in content ?? files)
            {
                ZipArchiveEntry entry = archive.CreateEntry(file.Key, CompressionLevel.Optimal);
                using (var output = entry.Open()) output.Write(file.Value, 0, file.Value.Length);
            }
        }
        if (mutate != null)
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Update)) mutate(archive);
        return path;
    }

    private static UpdatePayload Payload(string package, Dictionary<string, byte[]> content = null)
    {
        var hashes = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in content ?? files) hashes.Add(file.Key, Hash(file.Value));
        return new UpdatePayload { schemaVersion = 1, version = GoodVersion, apiVersion = PluginUpdatePackage.RequiredApiVersion,
            packageUrl = "https://bulka.com.kz/downloads/BulkaPlugin-" + GoodVersion + "-update.zip", packageSha256 = Hash(File.ReadAllBytes(package)),
            packageSizeBytes = new FileInfo(package).Length, files = hashes, sourceCommit = new string('a', 40), publishedAt = "2026-10-04T07:30:00.000Z" };
    }

    private static string Sign(UpdatePayload payload) { return SignBytes(Encoding.UTF8.GetBytes(Json(payload))); }
    private static string SignBytes(byte[] payload)
    {
        byte[] domain = Encoding.UTF8.GetBytes(PluginUpdatePackage.SignatureDomain);
        byte[] bytes = new byte[domain.Length + payload.Length];
        Buffer.BlockCopy(domain, 0, bytes, 0, domain.Length); Buffer.BlockCopy(payload, 0, bytes, domain.Length, payload.Length);
        return Json(new UpdateEnvelope { algorithm = "RSA-SHA256", keyId = PluginUpdateTrust.KeyId, payloadBase64 = Convert.ToBase64String(payload),
            signatureBase64 = Convert.ToBase64String(signingKey.SignData(bytes, CryptoConfig.MapNameToOID("SHA256"))) });
    }
    private static PluginUpdateManifest Verify(string envelope) { return PluginUpdatePackage.ParseAndVerify(envelope, "1.12.1", signingKey.ToXmlString(false)); }
    private static void ChangeMetadata(string package, string label, Action<UpdatePayload> change) { UpdatePayload payload = Payload(package); change(payload); Reject(label, () => Verify(Sign(payload))); }
    private static void RejectPackage(string label, string package, UpdatePayload payload = null, Dictionary<string, byte[]> content = null)
    {
        PluginUpdateManifest manifest = Verify(Sign(payload ?? Payload(package, content)));
        string destination = NewPath("rejected-stage");
        Reject(label, () => PluginUpdatePackage.ValidateAndExtract(package, destination, manifest));
        Check(!Directory.Exists(destination) || Directory.GetFileSystemEntries(destination).Length == 0, label + " leaves no staged files");
    }
    private static Dictionary<string, byte[]> CopyFiles() { return new Dictionary<string, byte[]>(files, StringComparer.Ordinal); }
    private static string NewPath(string name) { return Path.Combine(root, Guid.NewGuid().ToString("N") + "-" + name); }
    private static string Hash(byte[] value) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); }
    private static string Json<T>(T value) { using (var stream = new MemoryStream()) { Serializer(typeof(T)).WriteObject(stream, value); return Encoding.UTF8.GetString(stream.ToArray()); } }
    private static T JsonRead<T>(string value) { using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(value))) return (T)Serializer(typeof(T)).ReadObject(stream); }
    private static DataContractJsonSerializer Serializer(Type type) { return new DataContractJsonSerializer(type, new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true }); }
    private static void Check(bool condition, string label) { if (!condition) throw new Exception("FAIL: " + label); assertions++; Console.WriteLine("PASS: " + label); }
    private static void Reject(string label, Action action)
    {
        try { action(); }
        catch (InvalidDataException error) { Check(error.Message.Length < 120 && error.Message.IndexOf(root, StringComparison.OrdinalIgnoreCase) < 0, label); return; }
        throw new Exception("FAIL: accepted " + label);
    }
}
