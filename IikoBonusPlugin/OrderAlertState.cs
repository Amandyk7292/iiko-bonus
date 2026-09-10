using System;

namespace Resto.Front.Api.IikoBonusPlugin
{
    // Accessed under OnlineOrderInbox.gate. Failed or deferred UI attempts do not
    // count as showing an alert; the next poll must retry them immediately.
    internal sealed class OrderAlertState
    {
        private int total;
        private long newest, presentedNumber;
        private string fallbackKey = "", presentedFallbackKey = "";
        private DateTime closedAt = DateTime.MinValue;

        internal void Observe(int count, long newestOrderNumber, string firstOrderId)
        {
            total = count; newest = newestOrderNumber;
            fallbackKey = count == 0 ? "" : firstOrderId + ":" + count;
            if (count == 0) presentedFallbackKey = "";
        }

        internal bool IsDue(DateTime now, bool windowOpen) => total > 0 &&
            ((newest > 0 ? newest > presentedNumber : fallbackKey != presentedFallbackKey) ||
             (!windowOpen && now - closedAt >= TimeSpan.FromSeconds(30)));

        internal bool HasPending => total > 0;
        internal void Presented()
        {
            presentedNumber = Math.Max(presentedNumber, newest);
            presentedFallbackKey = fallbackKey;
        }
        internal void Closed(DateTime now) { closedAt = now; }
    }
}
