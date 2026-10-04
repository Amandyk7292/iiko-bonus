using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal sealed class PluginUpdateManifest
    {
        internal string Version { get; private set; }
        internal string ApiVersion { get; private set; }
        internal string PackageUrl { get; private set; }
        internal string PackageSha256 { get; private set; }
        internal long PackageSizeBytes { get; private set; }
        internal IReadOnlyDictionary<string, string> Files { get; private set; }
        internal string SourceCommit { get; private set; }
        internal string PublishedAt { get; private set; }

        internal PluginUpdateManifest(UpdatePayload payload)
        {
            Version = payload.version;
            ApiVersion = payload.apiVersion;
            PackageUrl = payload.packageUrl;
            PackageSha256 = payload.packageSha256.ToLowerInvariant();
            PackageSizeBytes = payload.packageSizeBytes;
            var hashes = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var file in payload.files) hashes.Add(file.Key, file.Value.ToLowerInvariant());
            Files = new ReadOnlyDictionary<string, string>(hashes);
            SourceCommit = payload.sourceCommit.ToLowerInvariant();
            PublishedAt = payload.publishedAt;
        }
    }

    [DataContract]
    internal sealed class UpdateEnvelope
    {
        [DataMember(IsRequired = true)] internal string algorithm = null;
        [DataMember(IsRequired = true)] internal string keyId = null;
        [DataMember(IsRequired = true)] internal string payloadBase64 = null;
        [DataMember(IsRequired = true)] internal string signatureBase64 = null;
    }

    [DataContract]
    internal sealed class UpdatePayload
    {
        [DataMember(IsRequired = true)] internal int schemaVersion = 0;
        [DataMember(IsRequired = true)] internal string version = null;
        [DataMember(IsRequired = true)] internal string apiVersion = null;
        [DataMember(IsRequired = true)] internal string packageUrl = null;
        [DataMember(IsRequired = true)] internal string packageSha256 = null;
        [DataMember(IsRequired = true)] internal long packageSizeBytes = 0;
        [DataMember(IsRequired = true)] internal Dictionary<string, string> files = null;
        [DataMember(IsRequired = true)] internal string sourceCommit = null;
        [DataMember(EmitDefaultValue = false)] internal string publishedAt = null;
    }

    // Shared by the plugin and the separate updater; this file has no iiko SDK dependency.
    internal static class PluginUpdatePackage
    {
        internal const long MaximumPackageBytes = 20 * 1024 * 1024;
        internal const string PluginFileName = "Resto.Front.Api.IikoBonusPlugin.dll";
        internal const string UpdaterFileName = "BulkaPluginUpdater.exe";
        internal const string ManifestFileName = "Manifest.xml";
        internal const string RequiredApiVersion = "V9Preview7";
        internal const string SignatureDomain = "BulkaPluginUpdate:v1\n";
        private const int MaximumPayloadBytes = 64 * 1024;
        private const int MaximumEnvelopeCharacters = 128 * 1024;
        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
        private static readonly Regex ThreePartVersion = new Regex(@"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z", RegexOptions.CultureInvariant);
        private static readonly Regex Sha256 = new Regex(@"\A[a-fA-F0-9]{64}\z", RegexOptions.CultureInvariant);
        private static readonly Regex Commit = new Regex(@"\A[a-fA-F0-9]{40}\z", RegexOptions.CultureInvariant);
        internal static readonly string[] RequiredFileNames = { PluginFileName, ManifestFileName, UpdaterFileName };

        internal static PluginUpdateManifest ParseAndVerify(string envelopeJson, string currentVersion)
        {
            return ParseAndVerify(envelopeJson, currentVersion, PluginUpdateTrust.PublicKeyXml);
        }

        // The explicit key overload is for linked-source tests. Production callers use embedded trust.
        internal static PluginUpdateManifest ParseAndVerify(string envelopeJson, string currentVersion, string publicKeyXml)
        {
            if (string.IsNullOrWhiteSpace(envelopeJson) || envelopeJson.Length > MaximumEnvelopeCharacters)
                throw Invalid("Update information is invalid.");
            byte[] envelopeBytes;
            try { envelopeBytes = StrictUtf8.GetBytes(envelopeJson); }
            catch (EncoderFallbackException) { throw Invalid("Update information is invalid."); }
            UpdateEnvelope envelope = ReadJson<UpdateEnvelope>(envelopeBytes, "Update information is invalid.");
            if (envelope.algorithm != "RSA-SHA256" || envelope.keyId != PluginUpdateTrust.KeyId)
                throw Invalid("Update signature is not trusted.");

            byte[] payloadBytes;
            byte[] signature;
            try
            {
                payloadBytes = DecodeBase64(envelope.payloadBase64, MaximumPayloadBytes);
                signature = DecodeBase64(envelope.signatureBase64, 1024);
            }
            catch (Exception error) when (error is FormatException || error is ArgumentException)
            {
                throw Invalid("Update signature is invalid.");
            }
            if (payloadBytes.Length == 0 || signature.Length == 0) throw Invalid("Update signature is invalid.");
            byte[] domain = StrictUtf8.GetBytes(SignatureDomain);
            byte[] signedBytes = new byte[domain.Length + payloadBytes.Length];
            Buffer.BlockCopy(domain, 0, signedBytes, 0, domain.Length);
            Buffer.BlockCopy(payloadBytes, 0, signedBytes, domain.Length, payloadBytes.Length);
            try
            {
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(publicKeyXml);
                    if (rsa.KeySize < 2048 || signature.Length != rsa.KeySize / 8 ||
                        !rsa.VerifyData(signedBytes, CryptoConfig.MapNameToOID("SHA256"), signature))
                        throw Invalid("Update signature is invalid.");
                }
            }
            catch (Exception error) when (error is CryptographicException || error is ArgumentException || error is XmlException)
            {
                throw Invalid("Update signature is invalid.");
            }

            UpdatePayload payload = ReadJson<UpdatePayload>(payloadBytes, "Signed update information is invalid.");
            ValidatePayload(payload, currentVersion);
            return new PluginUpdateManifest(payload);
        }

        internal static void ValidateAndExtract(string packagePath, string destinationDirectory, PluginUpdateManifest manifest)
        {
            if (manifest == null) throw Invalid("Update information is missing.");
            if (string.IsNullOrWhiteSpace(packagePath) || string.IsNullOrWhiteSpace(destinationDirectory))
                throw Invalid("Update staging location is invalid.");
            string package = Path.GetFullPath(packagePath);
            string destination = Path.GetFullPath(destinationDirectory);
            EnsureNoReparsePoints(package);
            EnsureNoReparsePoints(destination);
            if (Directory.Exists(destination))
                foreach (string unused in Directory.EnumerateFileSystemEntries(destination))
                    throw Invalid("Update staging folder must be empty.");
            bool directoryCreated = false;
            var extracted = new List<string>();
            try
            {
                // Holding this handle prevents replacement between package hash and ZIP validation on Windows.
                using (var input = new FileStream(package, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (input.Length != manifest.PackageSizeBytes || input.Length <= 0 || input.Length > MaximumPackageBytes)
                        throw Invalid("Update package size does not match.");
                    if (!EqualHash(Hash(input), manifest.PackageSha256)) throw Invalid("Update package checksum does not match.");
                    input.Position = 0;
                    using (var archive = new ZipArchive(input, ZipArchiveMode.Read, true))
                    {
                        ValidateInventory(archive, manifest);
                        if (!Directory.Exists(destination))
                        {
                            Directory.CreateDirectory(destination);
                            directoryCreated = true;
                        }
                        EnsureNoReparsePoints(destination);
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            string outputPath = Path.Combine(destination, entry.FullName);
                            EnsureNoReparsePoints(outputPath);
                            long written = 0;
                            using (Stream source = entry.Open())
                            using (var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                            using (var hash = SHA256.Create())
                            {
                                extracted.Add(outputPath);
                                byte[] buffer = new byte[81920];
                                int count;
                                while ((count = source.Read(buffer, 0, buffer.Length)) != 0)
                                {
                                    written += count;
                                    if (written > entry.Length || written > MaximumPackageBytes)
                                        throw Invalid("Update package expands beyond its limit.");
                                    hash.TransformBlock(buffer, 0, count, buffer, 0);
                                    output.Write(buffer, 0, count);
                                }
                                hash.TransformFinalBlock(new byte[0], 0, 0);
                                if (written != entry.Length || !EqualHash(ToHex(hash.Hash), manifest.Files[entry.FullName]))
                                    throw Invalid("Update file checksum does not match.");
                            }
                        }
                    }
                }
                ValidateManifestFile(Path.Combine(destination, ManifestFileName));
                ValidateAssembly(Path.Combine(destination, PluginFileName), "Resto.Front.Api.IikoBonusPlugin", manifest.Version);
                ValidateAssembly(Path.Combine(destination, UpdaterFileName), "BulkaPluginUpdater", null);
            }
            catch (Exception error) when (!(error is OutOfMemoryException) && !(error is StackOverflowException))
            {
                foreach (string file in extracted)
                {
                    try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
                if (directoryCreated)
                {
                    try { Directory.Delete(destination, false); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
                if (error is InvalidDataException) throw;
                throw Invalid("Update package could not be verified.");
            }
        }

        internal static void ValidateManifestFile(string path)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 64 * 1024 };
            var document = new XmlDocument { XmlResolver = null };
            try
            {
                using (var reader = XmlReader.Create(path, settings)) document.Load(reader);
                XmlElement root = document.DocumentElement;
                if (root == null || root.Name != "Manifest" || root.NamespaceURI.Length != 0) throw Invalid("Update plugin manifest is invalid.");
                foreach (XmlAttribute attribute in root.Attributes)
                    if (attribute.NamespaceURI != "http://www.w3.org/2000/xmlns/") throw Invalid("Update plugin manifest is invalid.");
                var values = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (XmlNode child in root.ChildNodes)
                {
                    if (child.NodeType == XmlNodeType.Comment || child.NodeType == XmlNodeType.Whitespace) continue;
                    if (child.NodeType != XmlNodeType.Element || child.NamespaceURI.Length != 0 || child.Attributes.Count != 0 || values.ContainsKey(child.Name))
                        throw Invalid("Update plugin manifest is invalid.");
                    foreach (XmlNode text in child.ChildNodes)
                        if (text.NodeType != XmlNodeType.Text && text.NodeType != XmlNodeType.Whitespace && text.NodeType != XmlNodeType.CDATA)
                            throw Invalid("Update plugin manifest is invalid.");
                    values.Add(child.Name, child.InnerText.Trim());
                }
                if (values.Count != 4 || Get(values, "FileName") != PluginFileName ||
                    Get(values, "TypeName") != "Resto.Front.Api.IikoBonusPlugin.PluginEntry" ||
                    Get(values, "ApiVersion") != RequiredApiVersion || Get(values, "LicenseModuleId") != "21016318")
                    throw Invalid("Update plugin manifest is incompatible.");
            }
            catch (Exception error) when (error is XmlException || error is IOException || error is UnauthorizedAccessException)
            {
                throw Invalid("Update plugin manifest is invalid.");
            }
        }

        internal static void ValidateAssembly(string path, string expectedName, string expectedVersion)
        {
            try
            {
                AssemblyName assembly = AssemblyName.GetAssemblyName(path);
                if (assembly.Name != expectedName) throw Invalid("Update program identity is invalid.");
                if (expectedVersion != null && (assembly.Version == null || assembly.Version.Revision != 0 ||
                    assembly.Version.ToString(3) != expectedVersion)) throw Invalid("Update plugin version does not match.");
            }
            catch (Exception error) when (error is BadImageFormatException || error is FileLoadException || error is IOException || error is UnauthorizedAccessException)
            {
                throw Invalid("Update program is invalid.");
            }
        }

        private static void ValidatePayload(UpdatePayload payload, string currentVersion)
        {
            Version next;
            Version current;
            if (payload == null || payload.schemaVersion != 1 || !TryVersion(payload.version, out next))
                throw Invalid("Signed update version is invalid.");
            if (!TryCurrentVersion(currentVersion, out current)) throw Invalid("Installed plugin version is invalid.");
            if (next.CompareTo(current) <= 0) throw Invalid("Update must be newer than the installed plugin.");
            if (payload.apiVersion != RequiredApiVersion) throw Invalid("Update requires an incompatible iiko API.");
            string expectedUrl = "https://bulka.com.kz/downloads/BulkaPlugin-" + payload.version + "-update.zip";
            if (payload.packageUrl != expectedUrl) throw Invalid("Update download address is invalid.");
            if (payload.packageSha256 == null || !Sha256.IsMatch(payload.packageSha256) ||
                payload.packageSizeBytes <= 0 || payload.packageSizeBytes > MaximumPackageBytes)
                throw Invalid("Signed update package details are invalid.");
            if (payload.files == null || payload.files.Count != RequiredFileNames.Length)
                throw Invalid("Signed update file inventory is invalid.");
            foreach (string name in RequiredFileNames)
            {
                string hash;
                if (!payload.files.TryGetValue(name, out hash) || hash == null || !Sha256.IsMatch(hash))
                    throw Invalid("Signed update file inventory is invalid.");
            }
            if (payload.sourceCommit == null || !Commit.IsMatch(payload.sourceCommit)) throw Invalid("Signed update source revision is invalid.");
            DateTimeOffset published;
            if (payload.publishedAt != null && (!Regex.IsMatch(payload.publishedAt, @"\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z\z", RegexOptions.CultureInvariant) ||
                !DateTimeOffset.TryParse(payload.publishedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out published) || published.Offset != TimeSpan.Zero))
                throw Invalid("Signed update publication date is invalid.");
        }

        private static void ValidateInventory(ZipArchive archive, PluginUpdateManifest manifest)
        {
            if (archive.Entries.Count != RequiredFileNames.Length) throw Invalid("Update package file inventory is invalid.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                int unixType = (entry.ExternalAttributes >> 16) & 0xf000;
                if (!manifest.Files.ContainsKey(entry.FullName) || !seen.Add(entry.FullName) ||
                    entry.Name != entry.FullName || entry.FullName.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 ||
                    (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0 || (unixType != 0 && unixType != 0x8000))
                    throw Invalid("Update package contains an unexpected file.");
                if (entry.Length <= 0 || entry.Length > MaximumPackageBytes || entry.CompressedLength <= 0 ||
                    entry.CompressedLength > MaximumPackageBytes || entry.Length / entry.CompressedLength > 200)
                    throw Invalid("Update package expands beyond its limit.");
                total += entry.Length;
                if (total > MaximumPackageBytes) throw Invalid("Update package expands beyond its limit.");
            }
        }

        private static bool TryVersion(string value, out Version result)
        {
            result = null;
            return value != null && value.Length <= 32 && ThreePartVersion.IsMatch(value) && Version.TryParse(value, out result);
        }

        private static bool TryCurrentVersion(string value, out Version result)
        {
            result = null;
            if (value == null) return false;
            Version parsed;
            if (TryVersion(value, out parsed)) { result = parsed; return true; }
            if (value.EndsWith(".0", StringComparison.Ordinal) && TryVersion(value.Substring(0, value.Length - 2), out parsed))
            { result = parsed; return true; }
            return false;
        }

        private static T ReadJson<T>(byte[] bytes, string message)
        {
            try
            {
                // Reject malformed UTF-8 instead of allowing replacement characters in signed content.
                ValidateJsonDocument(StrictUtf8.GetString(bytes));
                using (var reader = JsonReaderWriterFactory.CreateJsonReader(bytes, XmlDictionaryReaderQuotas.Max))
                {
                    T result = (T)new DataContractJsonSerializer(typeof(T), new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true, MaxItemsInObjectGraph = 128 }).ReadObject(reader);
                    if (reader.Read()) throw new SerializationException();
                    return result;
                }
            }
            catch (Exception error) when (error is SerializationException || error is XmlException || error is ArgumentException || error is InvalidOperationException)
            {
                throw Invalid(message);
            }
        }

        private static byte[] DecodeBase64(string value, int maximumBytes)
        {
            if (string.IsNullOrEmpty(value) || value.Length > ((maximumBytes + 2) / 3) * 4 ||
                value.IndexOfAny(new[] { ' ', '\t', '\r', '\n' }) >= 0) throw new FormatException();
            byte[] bytes = Convert.FromBase64String(value);
            if (bytes.Length > maximumBytes || Convert.ToBase64String(bytes) != value) throw new FormatException();
            return bytes;
        }

        internal static void EnsureNoReparsePoints(string path)
        {
            for (string item = path; !string.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            {
                if ((File.Exists(item) || Directory.Exists(item)) && (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0)
                    throw Invalid("Update staging location is unsafe.");
            }
        }

        private static void ValidateJsonDocument(string value)
        {
            var nesting = new Stack<char>();
            bool quoted = false;
            bool started = false;
            bool finished = false;
            for (int index = 0; index < value.Length; index++)
            {
                char character = value[index];
                if (quoted)
                {
                    if (character == '\\') { if (++index >= value.Length) throw new SerializationException(); }
                    else if (character == '"') quoted = false;
                    else if (character < 0x20) throw new SerializationException();
                    continue;
                }
                if (character == ' ' || character == '\t' || character == '\r' || character == '\n') continue;
                if (finished) throw new SerializationException();
                if (!started)
                {
                    if (character != '{') throw new SerializationException();
                    started = true;
                }
                if (character == '"') quoted = true;
                else if (character == '{' || character == '[')
                {
                    nesting.Push(character);
                    if (nesting.Count > 16) throw new SerializationException();
                }
                else if (character == '}' || character == ']')
                {
                    if (nesting.Count == 0 || nesting.Pop() != (character == '}' ? '{' : '[')) throw new SerializationException();
                    if (nesting.Count == 0) finished = true;
                }
            }
            if (!started || !finished || quoted) throw new SerializationException();
        }

        private static string Get(Dictionary<string, string> values, string key) { string value; return values.TryGetValue(key, out value) ? value : null; }
        private static string Hash(Stream stream) { using (var hash = SHA256.Create()) return ToHex(hash.ComputeHash(stream)); }
        private static string ToHex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        private static bool EqualHash(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            int difference = 0;
            for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }
        private static InvalidDataException Invalid(string message) { return new InvalidDataException(message); }
    }
}
