using System;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class DurableJsonFile
    {
        internal static T Read<T>(string path) where T:new()
        {
            return ReadValidated<T>(path, null, false);
        }
        internal static T ReadValidated<T>(string path, Func<T,bool> valid, bool recoverBackup) where T:new()
        {
            if(!File.Exists(path) && !File.Exists(path+".bak"))
            {
                var directory=Path.GetDirectoryName(path);
                if(Directory.Exists(directory) && Directory.GetFiles(directory,Path.GetFileName(path)+".corrupt-*").Length>0)
                    throw new InvalidDataException("Журнал удалён после повреждения; требуется восстановление: "+Path.GetFileName(path));
                return new T();
            }
            try { return ReadExisting(path,valid); }
            catch(Exception error) when(error is IOException || error is InvalidDataException || error is System.Runtime.Serialization.SerializationException || error is System.Xml.XmlException || error is ArgumentException)
            {
                Quarantine(path);
                if(recoverBackup)
                {
                    var recovered=ReadExisting(path+".bak",valid);
                    Write(path,recovered);
                    return recovered;
                }
                // An old automatic-receipt backup can predate CreationStarted.
                // Never use it to authorize creation of a second fiscal receipt.
                throw new InvalidDataException("Журнал требует восстановления и сверки: "+Path.GetFileName(path),error);
            }
        }
        private static T ReadExisting<T>(string path,Func<T,bool> valid)
        {
            T value;
            using(var stream=File.OpenRead(path)) value=(T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
            if(ReferenceEquals(value,null) || (valid!=null && !valid(value)))
                throw new InvalidDataException("Недопустимая структура журнала: "+Path.GetFileName(path));
            return value;
        }
        internal static void Quarantine(string path)
        {
            if(!File.Exists(path)) return;
            // Preserve the original in place: its absence must not look like a
            // fresh installation on the next tick/restart. One copy per content.
            using(var stream=File.OpenRead(path))
            using(var hash=SHA256.Create())
            {
                var suffix=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").Substring(0,16);
                var copy=path+".corrupt-"+suffix;
                if(!File.Exists(copy)) File.Copy(path,copy,false);
            }
        }
        internal static void Write<T>(string path,T value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            using(var stream=new FileStream(path+".tmp",FileMode.Create,FileAccess.Write,FileShare.None))
            { new DataContractJsonSerializer(typeof(T)).WriteObject(stream,value); stream.Flush(true); }
            if(File.Exists(path)) File.Replace(path+".tmp",path,path+".bak"); else File.Move(path+".tmp",path);
        }
    }
}
