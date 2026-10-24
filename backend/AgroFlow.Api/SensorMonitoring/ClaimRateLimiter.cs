using System.Collections.Concurrent;

namespace AgroFlow.Api.Services;

// Security: rate-limits failed device claims per source IP.
// POST /api/devices/claim has no shared key, so the enrollment code is the only
// secret on an endpoint anyone can reach. Codes are 8 characters from 31 (about
// 8.5e11 combinations) and expire in 24 hours, so guessing is only possible at
// machine speed; a lucky guess would claim someone else's kit.
// Successful claims are unlimited (an install day is a burst from one office);
// failures from one address have a hard limit.
// In memory, not a table: it must be cheap, and a restart only gives an attacker
// one more window of guesses. On our single Railway container it covers everything.
public sealed class ClaimRateLimiter
{
    // Enough for an installer mistyping a code a few times, far too few to search
    // the code space.
    public const int MaxFailuresPerWindow = 10;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private sealed class Attempts
    {
        public int Failures;
        public DateTimeOffset WindowStartedAt;
    }

    private readonly ConcurrentDictionary<string, Attempts> _byAddress = new();
    private readonly ILogger<ClaimRateLimiter> _logger;

    // Security: caps memory so an attacker rotating addresses cannot make this
    // dictionary the weak point.
    private const int MaxTrackedAddresses = 10_000;

    public ClaimRateLimiter(ILogger<ClaimRateLimiter> logger)
    {
        _logger = logger;
    }

    public bool IsBlocked(string? address, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(address)) return false;
        if (!_byAddress.TryGetValue(address!, out var attempts)) return false;

        lock (attempts)
        {
            if (now - attempts.WindowStartedAt > Window)
            {
                attempts.Failures = 0;
                attempts.WindowStartedAt = now;
                return false;
            }

            return attempts.Failures >= MaxFailuresPerWindow;
        }
    }

    public void RecordFailure(string? address, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(address)) return;

        if (_byAddress.Count >= MaxTrackedAddresses && !_byAddress.ContainsKey(address!))
        {
            // Drop entries whose window has closed instead of refusing new ones.
            foreach (var pair in _byAddress)
            {
                if (now - pair.Value.WindowStartedAt > Window)
                {
                    _byAddress.TryRemove(pair.Key, out _);
                }
            }
        }

        var attempts = _byAddress.GetOrAdd(address!, _ => new Attempts { WindowStartedAt = now });

        lock (attempts)
        {
            if (now - attempts.WindowStartedAt > Window)
            {
                attempts.Failures = 0;
                attempts.WindowStartedAt = now;
            }

            attempts.Failures++;

            if (attempts.Failures == MaxFailuresPerWindow)
            {
                _logger.LogWarning(
                    "Blocking device claims from {Address} for {Minutes} minutes after {Failures} failed " +
                    "enrollment codes. If this is an installer, the codes have expired or been used already - " +
                    "generate fresh ones.",
                    address, Window.TotalMinutes, attempts.Failures);
            }
        }
    }

    // A successful claim clears the address, so an installer who gets the code right
    // is not left blocked.
    public void RecordSuccess(string? address)
    {
        if (string.IsNullOrEmpty(address)) return;

        _byAddress.TryRemove(address!, out _);
    }

    // Uses the proxy header first: on Railway every request comes from the platform's
    // edge, so RemoteIpAddress would be the same for everyone and turn this into a
    // global block. Locally (no proxy) we use the socket address.
    public static string? ResolveAddress(HttpContext context)
    {
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();

        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            // The left-most entry is the original client; the rest are proxies.
            var first = forwarded.Split(',')[0].Trim();
            if (first.Length > 0) return first;
        }

        return context.Connection.RemoteIpAddress?.ToString();
    }
}
