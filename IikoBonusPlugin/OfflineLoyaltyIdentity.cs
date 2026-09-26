using System;
using System.Runtime.Serialization;
using System.Text.RegularExpressions;

namespace Resto.Front.Api.IikoBonusPlugin
{
    internal static class OfflineLoyaltyIdentity
    {
        // The server verifies the HMAC before crediting a paid receipt.
        // Shape/freshness checks here never authorize an offline write-off.
        internal static bool CanCapture(string code, DateTime scannedAtUtc)
        {
            if (string.IsNullOrWhiteSpace(code) || code.Length > 160) return false;
            var otp = Regex.Match(code, @"^BULKA-OTP-(\d{10,15})-(\d+)-[0-9a-fA-F]{16}$");
            if (otp.Success)
            {
                long window;
                var current = (long)(scannedAtUtc.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds / 300;
                return long.TryParse(otp.Groups[2].Value, out window) && Math.Abs(current - window) <= 1;
            }
            return Regex.IsMatch(code, @"^CARD-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{16}$");
        }

        internal static bool IsEarnOperation(string operation)
        {
            return string.IsNullOrWhiteSpace(operation) || operation == "apply" || operation == "commit" || operation == "offline-earn";
        }
    }

    [DataContract]
    public sealed class OfflineLoyaltyEarnRequest
    {
        [DataMember] public string customerCode { get; set; }
        [DataMember] public string scannedAtUtc { get; set; }
        [DataMember] public string paidAtUtc { get; set; }
        [DataMember] public string orderId { get; set; }
        [DataMember] public decimal orderTotal { get; set; }
        [DataMember] public OrderItemData[] items { get; set; }
    }
}
