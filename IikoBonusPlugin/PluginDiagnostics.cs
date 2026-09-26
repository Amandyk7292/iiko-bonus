using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class PluginDiagnostics
    {
        // Export only fixed event categories and timestamps, never raw log messages,
        // request bodies, config, customer data, QR values or exception text.
        internal static string SafeLogLine(string line)
        {
            var time=Regex.Match(line ?? "", @"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})");
            if(!time.Success) return null;
            var categories=new Dictionary<string,string> {
                {"CannotCreateEntityException","order_creation_rejected"},
                {"ConstraintViolationException","order_validation_rejected"},
                {"Current screen doesn't support","ui_screen_unsupported"},
                {"После сбоя не найден","receipt_reconciliation_required"},
                {"Нет связи с главной","main_register_disconnected"},
                {"дополнительная скидка","receipt_discount_mismatch"},
                {"Bulka board opened: new-order alert","new_order_window_opened"},
                {"Bulka board poll:","board_poll_failed"},
                {"Bulka receipt creation failed","receipt_creation_failed"},
                {"Initialized successfully","plugin_initialized"},
                {"Принтер не подтвердил","printer_unconfirmed"}
            };
            foreach(var pair in categories) if(line.Contains(pair.Key)) return time.Groups[1].Value+" "+pair.Value;
            return null;
        }
        private static void Add(ZipArchive zip,string name,string text)
        {
            using(var writer=new StreamWriter(zip.CreateEntry(name).Open(),new UTF8Encoding(false))) writer.Write(text);
        }
        internal static string Export()
        {
            var directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Bulka-Diagnostics");
            Directory.CreateDirectory(directory);
            var path=Path.Combine(directory,"Bulka-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8)+".zip");
            using(var file=new FileStream(path,FileMode.CreateNew))
            using(var zip=new ZipArchive(file,ZipArchiveMode.Create)) {
                Add(zip,"version.txt","Plugin: "+PosHealthSync.Version+"\nAPI: V9Preview7\nUTC: "+DateTime.UtcNow.ToString("o"));
                var ledgerPath=Path.Combine(LoyaltyFlow.DataDirectoryPath,"BulkaAutomaticReceipts.json");
                try {
                    if(File.Exists(ledgerPath) && new FileInfo(ledgerPath).Length>8*1024*1024) throw new IOException();
                    var ledger=DurableJsonFile.Read<Dictionary<string,AutomaticReceiptJob>>(ledgerPath);
                    Add(zip,"receipt-queue.txt",string.Join("\n",ledger.Values.Select(j=>
                        "order="+j.Number+" receiptLinked="+(!string.IsNullOrEmpty(j.ReceiptId))+" creationStarted="+j.CreationStarted+
                        " assemblyPrinted="+j.AssemblyPrinted+" fiscalDue="+j.FiscalDue)));
                } catch {Add(zip,"receipt-queue.txt","queue_unreadable; original preserved");}
                var logDir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"iiko","CashServer","Logs");
                if(Directory.Exists(logDir)) foreach(var log in Directory.GetFiles(logDir,"plugin-*.log")
                    .Where(p=>Path.GetFileName(p).IndexOf("Bulka",StringComparison.OrdinalIgnoreCase)>=0 || Path.GetFileName(p).IndexOf("IikoBonusPlugin",StringComparison.OrdinalIgnoreCase)>=0)
                    .OrderByDescending(File.GetLastWriteTimeUtc).Take(5).Select((p,i)=>new {Path=p,Index=i})) {
                    try {
                        var lines=new Queue<string>();
                        using(var stream=new FileStream(log.Path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
                        using(var reader=new StreamReader(stream)) {
                            if(stream.Length>8*1024*1024) {stream.Seek(-8*1024*1024,SeekOrigin.End);reader.ReadLine();}
                            string line; while((line=reader.ReadLine())!=null) {
                                var safe=SafeLogLine(line); if(safe==null) continue;
                                lines.Enqueue(safe);if(lines.Count>2000)lines.Dequeue();
                            }
                        }
                        Add(zip,"log-events-"+log.Index+".txt",string.Join("\n",lines));
                    } catch {Add(zip,"log-events-"+log.Index+".txt","log_unavailable");}
                }
                Add(zip,"README.txt","Sanitized diagnostic summary. Raw logs and configuration are intentionally excluded. No archive is uploaded automatically.");
            }
            return path;
        }
    }
}
