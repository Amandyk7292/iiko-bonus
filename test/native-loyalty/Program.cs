using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Resto.Front.Api.IikoBonusPlugin;

internal static class Program
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Main()
    {
        var assembly = typeof(LoyaltyApplyQueueItem).Assembly;
        var identity = assembly.GetType("Resto.Front.Api.IikoBonusPlugin.OfflineLoyaltyIdentity");
        var capture = identity.GetMethod("CanCapture", BindingFlags.Static | BindingFlags.NonPublic);
        var earn = identity.GetMethod("IsEarnOperation", BindingFlags.Static | BindingFlags.NonPublic);
        var now = new DateTime(2026, 9, 22, 10, 0, 0, DateTimeKind.Utc);
        var window = (long)(now - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds / 300;
        var code = "BULKA-OTP-77000000001-" + window + "-0123456789abcdef";
        Check((bool)capture.Invoke(null, new object[] { code, now }), "current QR must be captured");
        Check(!(bool)capture.Invoke(null, new object[] { code, now.AddMinutes(15) }), "already expired QR must be rejected locally");
        Check(!(bool)capture.Invoke(null, new object[] { "2101430000016", now }), "product EAN must not become loyalty identity");
        Check(!(bool)capture.Invoke(null, new object[] { "+77000000001", now }), "unverified phone must not be captured as QR");
        foreach (var operation in new[] { "apply", "commit", "offline-earn" })
            Check((bool)earn.Invoke(null, new object[] { operation }), "paid accrual must survive retry exhaustion");

        var directory = Path.Combine(Path.GetTempPath(), "bulka-offline-loyalty-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        Environment.SetEnvironmentVariable("IIKO_LOYALTY_DATA_DIR", directory);
        var path = Path.Combine(directory, "queue.json");
        var storage = typeof(LoyaltyFlow);
        var write = storage.GetMethod("WriteSerializedFileAtomically", BindingFlags.Static | BindingFlags.NonPublic).MakeGenericMethod(typeof(List<LoyaltyApplyQueueItem>));
        var read = storage.GetMethod("ReadSerializedFile", BindingFlags.Static | BindingFlags.NonPublic).MakeGenericMethod(typeof(List<LoyaltyApplyQueueItem>));
        var pending = new List<LoyaltyApplyQueueItem> { new LoyaltyApplyQueueItem {
            operation = "offline-earn", customerCode = code, scannedAtUtc = now.ToString("o"),
            paidAtUtc = now.AddMinutes(2).ToString("o"), orderId = Guid.NewGuid().ToString(), orderTotal = 1000,
            discountAmount = 0, attempts = 1000, items = new[] { new OrderItemData {
                productId = "test", productName = "Булочка", amount = 2, price = 500, total = 1000 } }
        } };
        write.Invoke(null, new object[] { path, pending });
        pending = null;
        var restored = (List<LoyaltyApplyQueueItem>)read.Invoke(null, new object[] { path });
        Check(restored.Count == 1 && restored[0].customerCode == code, "QR must survive restart");
        Check(restored[0].paidAtUtc == now.AddMinutes(2).ToString("o") && restored[0].items[0].total == 1000,
            "paid time and receipt contents must survive restart");
        Check(restored[0].discountAmount == 0, "offline path never reserves a write-off");
        File.Delete(path);
        Directory.Delete(directory);
        Console.WriteLine("Offline loyalty: capture, expiry, EAN isolation, retry policy and durable receipt round-trip passed.");
    }
}
