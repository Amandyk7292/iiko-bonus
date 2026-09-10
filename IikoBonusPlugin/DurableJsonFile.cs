using System.IO;
using System.Runtime.Serialization.Json;
namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class DurableJsonFile
    {
        internal static T Read<T>(string path) where T:new()
        {
            if(!File.Exists(path)) return new T();
            using(var stream=File.OpenRead(path)) return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
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
