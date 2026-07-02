using System;
using System.Reflection;
using System.Linq;
using Resto.Front.Api;

class Program
{
    static void Main()
    {
        Console.WriteLine("\n--- INotificationService methods ---");
        foreach(var m in typeof(INotificationService).GetMethods())
        {
            var p = string.Join(", ", m.GetParameters().Select(x => x.ParameterType.Name + " " + x.Name));
            Console.WriteLine($"{m.Name}({p})");
        }
    }
}
