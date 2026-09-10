using System;
using Resto.Front.Api.IikoBonusPlugin;
internal static class OrderAlertTests
{
    internal static void Run()
    {
        var now = DateTime.UtcNow;
        var state = new OrderAlertState();
        state.Observe(1, 100001, "one");
        Check(state.IsDue(now, false), "first order opens automatically");
        Check(state.IsDue(now.AddSeconds(2), false), "failed/deferred UI attempt retries without cooldown");
        state.Presented(); state.Closed(now);
        Check(!state.IsDue(now.AddSeconds(2), false), "dismissal allows work at register");
        Check(state.IsDue(now.AddSeconds(31), false), "unaccepted orders remind again");
        state.Observe(1, 100002, "two");
        Check(state.IsDue(now.AddSeconds(3), false), "next order bypasses dismissal cooldown");
        state.Presented();
        Check(!state.IsDue(now.AddSeconds(4), true), "same order does not reopen/alert on every poll");
        state.Observe(1, 100003, "three");
        Check(state.IsDue(now.AddSeconds(5), true), "new order alerts on already open board");
        state.Presented(); state.Observe(1, 100001, "one");
        Check(!state.IsDue(now.AddSeconds(6), true), "accepting newest does not replay old alert");
        state.Observe(0, 0, "");
        Check(!state.HasPending && !state.IsDue(now.AddMinutes(1), false), "acceptance elsewhere cancels pending opening");
        var legacy = new OrderAlertState(); legacy.Observe(1, 0, "old-server-order");
        Check(legacy.IsDue(now, false), "older server remains supported");
        Console.WriteLine("PASS: automatic opening, deferred retry, new-order priority, reminders and cross-register acceptance.");
    }
    private static void Check(bool condition, string name) { if (!condition) throw new Exception(name); }
}
