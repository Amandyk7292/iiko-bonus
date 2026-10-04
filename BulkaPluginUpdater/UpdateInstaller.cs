using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

namespace Bulka.PluginUpdater
{
    [DataContract]
    internal sealed class BackupRecord
    {
        [DataMember] public string Name { get; set; }
        [DataMember] public bool Existed { get; set; }
        [DataMember] public string Sha256 { get; set; }
        [DataMember] public string CandidateSha256 { get; set; }
    }

    [DataContract]
    internal sealed class PendingTransaction
    {
        [DataMember] public string TargetDirectory { get; set; }
        [DataMember] public string RequestPath { get; set; }
    }

    [DataContract]
    internal sealed class TransactionJournal
    {
        [DataMember] public string TargetDirectory { get; set; }
        [DataMember] public string StagingDirectory { get; set; }
        [DataMember] public string State { get; set; }
        [DataMember] public List<BackupRecord> Files { get; set; }
    }

    internal sealed class UpdateInstaller
    {
        private readonly UpdateRequest request;
        private readonly string journalPath;
        private readonly string backupDirectory;
        private readonly string candidateDirectory;
        private readonly string pendingPath;
        internal bool Restored { get; private set; }
        internal bool RecoveryRequired { get; private set; }
        internal string BackupDirectory => backupDirectory;
        internal string RecoveryRequestPath { get; private set; }
        internal string RecoveryBackupDirectory => Path.Combine(Path.GetDirectoryName(RecoveryRequestPath), "backup");
        internal bool HasInterruptedTransaction
        {
            get
            {
                if (File.Exists(pendingPath))
                {
                    var pending = ReadPending();
                    RecoveryRequestPath = pending.RequestPath;
                    var oldRequest = UpdateRequest.Read(pending.RequestPath);
                    if (!string.Equals(oldRequest.TargetDirectory, request.TargetDirectory, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Незавершённое обновление относится к другой папке плагина.");
                    var oldInstaller = new UpdateInstaller(oldRequest);
                    var previous = oldInstaller.ReadJournal();
                    if (previous.State == "installed" || previous.State == "rolled-back")
                    {
                        oldInstaller.ValidateTargets(previous, previous.State == "installed" ? TargetState.Candidate : TargetState.Original);
                        oldInstaller.ClearPending();
                    }
                    else return true;
                }
                if (!File.Exists(journalPath)) return false;
                var state = ReadJournal().State;
                return state == "prepared" || state == "installing";
            }
        }

        internal UpdateInstaller(UpdateRequest request)
        {
            this.request = request;
            journalPath = Path.Combine(request.StagingDirectory, "transaction.json");
            backupDirectory = Path.Combine(request.StagingDirectory, "backup");
            candidateDirectory = Path.Combine(request.StagingDirectory, "candidate");
            pendingPath = Path.Combine(request.TargetDirectory, ".bulka-update-transaction.json");
            RecoveryRequestPath = Path.Combine(request.StagingDirectory, "request.json");
        }

        // Candidate is already cryptographically verified by the shared package validator.
        internal void Install(Action<int> afterReplacement = null, Action beforeCommit = null, Action afterJournalCommit = null)
        {
            SafePaths.RejectReparsePoints(request.StagingDirectory);
            SafePaths.RejectReparsePoints(candidateDirectory);
            if (HasInterruptedTransaction) throw new InvalidOperationException("Предыдущее обновление этой кассы требует восстановления.");
            if (File.Exists(journalPath))
            {
                var previous = ReadJournal();
                if (previous.State == "installed") throw new InvalidOperationException("Это обновление уже установлено.");
                if (previous.State == "installing") throw new InvalidOperationException("Незавершённое обновление требует восстановления.");
                throw new InvalidOperationException("Папка обновления уже использовалась. Проверьте обновления заново.");
            }
            // The version and identity checks belong to the same snapshot boundary as the backup.
            SafePaths.ValidateInstalled(request, true);
            SafePaths.CheckWriteAccess(request.TargetDirectory, true);
            if (Directory.Exists(backupDirectory)) throw new InvalidDataException("Папка резервной копии уже существует.");
            Directory.CreateDirectory(backupDirectory);
            SafePaths.RejectReparsePoints(backupDirectory);
            var journal = new TransactionJournal
            {
                TargetDirectory = request.TargetDirectory,
                StagingDirectory = request.StagingDirectory,
                State = "prepared",
                Files = new List<BackupRecord>()
            };
            foreach (var name in SafePaths.InstalledFiles)
            {
                var source = Path.Combine(request.TargetDirectory, name);
                var candidate = Path.Combine(candidateDirectory, name);
                SafePaths.RejectReparsePoints(source);
                SafePaths.RejectReparsePoints(candidate);
                if (!File.Exists(candidate)) throw new FileNotFoundException("Файл обновления отсутствует: " + name);
                var record = new BackupRecord { Name = name, Existed = File.Exists(source), CandidateSha256 = SafePaths.Hash(candidate) };
                if (record.Existed)
                {
                    var backup = Path.Combine(backupDirectory, name);
                    CopyDurably(source, backup);
                    record.Sha256 = SafePaths.Hash(backup);
                    if (SafePaths.Hash(source) != record.Sha256) throw new IOException("Файлы плагина изменились во время подготовки резервной копии.");
                }
                journal.Files.Add(record);
            }
            SafePaths.ValidateInstalled(request, true);
            ValidateTargets(journal, TargetState.Original);
            WriteJournal(journal);
            beforeCommit?.Invoke();
            SafePaths.ValidateInstalled(request, true);
            ValidateTargets(journal, TargetState.Original);
            WritePending();
            journal.State = "installing";
            try
            {
                WriteJournal(journal);
                var completed = 0;
                foreach (var record in journal.Files)
                {
                    ValidateTarget(record, TargetState.Original);
                    var candidate = Path.Combine(candidateDirectory, record.Name);
                    if (SafePaths.Hash(candidate) != record.CandidateSha256) throw new InvalidDataException("Файлы обновления изменились после проверки.");
                    ReplaceFrom(candidate, Path.Combine(request.TargetDirectory, record.Name));
                    afterReplacement?.Invoke(++completed);
                }
                ValidateTargets(journal, TargetState.Candidate);
                journal.State = "installed";
                WriteJournal(journal);
                afterJournalCommit?.Invoke();
            }
            catch (Exception original)
            {
                try { Restore(journal); Restored = true; }
                catch (Exception recovery)
                {
                    RecoveryRequired = true;
                    throw new IOException("Установка остановлена; автоматическое восстановление не завершилось. Резервная копия: " + backupDirectory + ". Причина: " + recovery.Message, original);
                }
                throw new IOException("Обновление не установлено. Предыдущая версия восстановлена. " + original.Message, original);
            }
            // A completed durable journal is authoritative if marker cleanup is interrupted.
            // Cleanup failures must not turn a fully committed installation into a rollback.
            ClearPending();
        }

        internal void Recover()
        {
            if (File.Exists(pendingPath) && !string.Equals(ReadPending().RequestPath, Path.Combine(request.StagingDirectory, "request.json"), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Для этой кассы есть другое незавершённое обновление. Откройте его восстановление.");
            var journal = ReadJournal();
            if (journal.State == "installed") throw new InvalidOperationException("Установка завершена; восстановление не требуется.");
            if (journal.State == "rolled-back") { ValidateTargets(journal, TargetState.Original); ClearPending(); Restored = true; return; }
            SafePaths.CheckWriteAccess(request.TargetDirectory, true);
            try { Restore(journal); Restored = true; }
            catch { RecoveryRequired = true; throw; }
        }

        private void Restore(TransactionJournal journal)
        {
            ValidateJournal(journal);
            SafePaths.RejectReparsePoints(request.TargetDirectory);
            // Validate every backup before changing anything during recovery.
            foreach (var record in journal.Files)
            {
                var backup = Path.Combine(backupDirectory, record.Name);
                SafePaths.RejectReparsePoints(backup);
                if (record.Existed && (!File.Exists(backup) || SafePaths.Hash(backup) != record.Sha256))
                    throw new InvalidDataException("Резервная копия повреждена: " + record.Name);
            }
            SafePaths.ValidateInstalled(new UpdateRequest { TargetDirectory = backupDirectory, CurrentVersion = request.CurrentVersion }, true);
            // A stale journal must never replace a later healthy installation. Validate ALL
            // current bytes before the first restore, then recheck each replacement boundary.
            ValidateTargets(journal, TargetState.Recoverable);
            var failures = new List<string>();
            foreach (var record in journal.Files)
            {
                try
                {
                    var target = Path.Combine(request.TargetDirectory, record.Name);
                    ValidateTarget(record, TargetState.Recoverable);
                    if (record.Existed)
                    {
                        // Untouched files need no write and may still be locked by another program.
                        if (!File.Exists(target) || SafePaths.Hash(target) != record.Sha256)
                            ReplaceFrom(Path.Combine(backupDirectory, record.Name), target);
                    }
                    else if (File.Exists(target)) File.Delete(target);
                }
                catch (Exception error) { failures.Add(record.Name + ": " + error.Message); }
            }
            if (failures.Count != 0) throw new IOException(string.Join("; ", failures));
            journal.State = "rolled-back";
            WriteJournal(journal);
            ClearPending();
        }

        private enum TargetState { Original, Candidate, Recoverable }

        private void ValidateTargets(TransactionJournal journal, TargetState state)
        {
            foreach (var record in journal.Files) ValidateTarget(record, state);
        }

        private void ValidateTarget(BackupRecord record, TargetState state)
        {
            var target = Path.Combine(request.TargetDirectory, record.Name);
            SafePaths.RejectReparsePoints(target);
            if (Directory.Exists(target)) throw new InvalidDataException("Файлы плагина изменены другим обновлением: " + record.Name);
            var exists = File.Exists(target);
            var hash = exists ? SafePaths.Hash(target) : null;
            var original = record.Existed ? exists && hash == record.Sha256 : !exists;
            var candidate = exists && hash == record.CandidateSha256;
            if (!(state == TargetState.Original ? original : state == TargetState.Candidate ? candidate : original || candidate))
                throw new InvalidDataException("Файлы плагина изменены другим обновлением. Восстановление остановлено: " + record.Name);
        }

        private PendingTransaction ReadPending()
        {
            SafePaths.RejectReparsePoints(pendingPath);
            if (new FileInfo(pendingPath).Length > 16384) throw new InvalidDataException("Указатель незавершённого обновления повреждён.");
            PendingTransaction pending;
            using (var file = File.OpenRead(pendingPath))
                pending = (PendingTransaction)new DataContractJsonSerializer(typeof(PendingTransaction)).ReadObject(file);
            if (pending == null || !string.Equals(pending.TargetDirectory, request.TargetDirectory, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Указатель незавершённого обновления не соответствует плагину.");
            pending.RequestPath = SafePaths.FullPath(pending.RequestPath);
            SafePaths.RejectReparsePoints(pending.RequestPath);
            if (Path.GetFileName(pending.RequestPath) != "request.json") throw new InvalidDataException("Некорректный запрос восстановления.");
            return pending;
        }

        private void WritePending()
        {
            var ownRequest = Path.Combine(request.StagingDirectory, "request.json");
            var persistedRequest = UpdateRequest.Read(ownRequest);
            if (persistedRequest.TargetDirectory != request.TargetDirectory || persistedRequest.CurrentVersion != request.CurrentVersion)
                throw new InvalidDataException("Запрос обновления изменился во время установки.");
            SafePaths.RejectReparsePoints(pendingPath);
            var temporary = pendingPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    new DataContractJsonSerializer(typeof(PendingTransaction)).WriteObject(file,
                        new PendingTransaction { TargetDirectory = request.TargetDirectory, RequestPath = ownRequest });
                    file.Flush(true);
                }
                File.Move(temporary, pendingPath);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private void ClearPending()
        {
            if (!File.Exists(pendingPath)) return;
            var pending = ReadPending();
            if (!string.Equals(pending.RequestPath, Path.Combine(request.StagingDirectory, "request.json"), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Указатель установки изменился; сохранена резервная копия.");
            File.Delete(pendingPath);
        }

        private static void ReplaceFrom(string source, string target)
        {
            SafePaths.RejectReparsePoints(source);
            SafePaths.RejectReparsePoints(target);
            var temporary = target + ".bulka-update-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                CopyDurably(source, temporary);
                if (File.Exists(target)) File.Replace(temporary, target, null);
                else File.Move(temporary, target);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static void CopyDurably(string source, string destination)
        {
            using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { input.CopyTo(output); output.Flush(true); }
        }

        private TransactionJournal ReadJournal()
        {
            SafePaths.RejectReparsePoints(journalPath);
            if (new FileInfo(journalPath).Length > 16384) throw new InvalidDataException("Журнал установки повреждён.");
            TransactionJournal journal;
            using (var file = File.OpenRead(journalPath))
                journal = (TransactionJournal)new DataContractJsonSerializer(typeof(TransactionJournal)).ReadObject(file);
            ValidateJournal(journal);
            return journal;
        }

        private void ValidateJournal(TransactionJournal journal)
        {
            if (journal == null || journal.TargetDirectory != request.TargetDirectory || journal.StagingDirectory != request.StagingDirectory ||
                journal.Files == null || journal.Files.Count != SafePaths.InstalledFiles.Length ||
                (journal.State != "prepared" && journal.State != "installing" && journal.State != "installed" && journal.State != "rolled-back"))
                throw new InvalidDataException("Журнал установки не соответствует этому обновлению.");
            for (var index = 0; index < SafePaths.InstalledFiles.Length; index++)
            {
                var record = journal.Files[index];
                if (record == null || record.Name != SafePaths.InstalledFiles[index] ||
                    (record.Existed && !IsHash(record.Sha256)) || !IsHash(record.CandidateSha256))
                    throw new InvalidDataException("Некорректная резервная копия в журнале установки.");
            }
        }

        private static bool IsHash(string value) => value != null && value.Length == 64 && IsHex(value);

        private static bool IsHex(string value)
        {
            foreach (var character in value) if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'))) return false;
            return true;
        }

        private void WriteJournal(TransactionJournal journal)
        {
            SafePaths.RejectReparsePoints(journalPath);
            var temporary = journalPath + ".tmp";
            SafePaths.RejectReparsePoints(temporary);
            using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            { new DataContractJsonSerializer(typeof(TransactionJournal)).WriteObject(file, journal); file.Flush(true); }
            if (File.Exists(journalPath)) File.Replace(temporary, journalPath, null);
            else File.Move(temporary, journalPath);
        }
    }
}
