using System.Collections.Concurrent;

namespace AgroFlow.Api.Services;

// Item 6c: a ceiling on public enquiries per source IP.
//
// The enquiry form is the one write anyone on the internet can make. A real
// person sends one; a family sharing a phone might send two or three. Far
// above that is a script, and every enquiry pings the admins on Telegram.
// In-memory and per-instance, like ClaimRateLimiter: a restart resets it,
// which costs one window's worth of spam at most.
public sealed class EnquiryRateLimiter
{
    public const int MaxPerWindow = 5;
    public static readonly TimeSpan Window = TimeSpan.FromHours(1);
    private const int MaxTrackedAddresses = 10_000;

    private sealed class Counter
    {
        public int Count;
        public DateTimeOffset WindowStartedAt;
    }

    private readonly ConcurrentDictionary<string, Counter> _byAddress = new();

    /// Counts this attempt; false when the address is over the limit.
    public bool TryTake(string? address, DateTimeOffset now)
    {
        var key = string.IsNullOrEmpty(address) ? "unknown" : address!;

        if (_byAddress.Count > MaxTrackedAddresses)
        {
            foreach (var pair in _byAddress)
            {
                if (now - pair.Value.WindowStartedAt > Window) _byAddress.TryRemove(pair.Key, out _);
            }
        }

        var counter = _byAddress.GetOrAdd(key, _ => new Counter { WindowStartedAt = now });
        lock (counter)
        {
            if (now - counter.WindowStartedAt > Window)
            {
                counter.Count = 0;
                counter.WindowStartedAt = now;
            }

            if (counter.Count >= MaxPerWindow) return false;
            counter.Count++;
            return true;
        }
    }
}
