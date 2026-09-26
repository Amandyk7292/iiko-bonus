using System;
using System.Reflection;
using Resto.Front.Api.IikoBonusPlugin;
class Program {
 static void Main() {
  var type=typeof(LoyaltyApplyQueueItem).Assembly.GetType("Resto.Front.Api.IikoBonusPlugin.PluginDiagnostics");
  var method=type.GetMethod("SafeLogLine",BindingFlags.NonPublic|BindingFlags.Static);
  var secret="Bearer super-secret-token phone=77762003590 password=0000 code=123456 BULKA-OTP-secret";
  var value=(string)method.Invoke(null,new object[]{"[2026-09-25 10:00:00,123] ERROR CannotCreateEntityException "+secret});
  if(value!="2026-09-25 10:00:00 order_creation_rejected") throw new Exception("Unsafe diagnostic log export");
  if(method.Invoke(null,new object[]{"[2026-09-25 10:00:00] "+secret})!=null) throw new Exception("Unknown text exported");
  if(method.Invoke(null,new object[]{secret})!=null) throw new Exception("Raw payload exported");
  Console.WriteLine("PASS: diagnostic output excludes tokens, phone, password, confirmation code and QR.");
 }
}
