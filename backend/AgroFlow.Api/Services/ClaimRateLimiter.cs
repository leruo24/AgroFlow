using System.Collections.Concurrent;

namespace AgroFlow.Api.Services;

// Rate-limits FAILED device claims, per source IP.
//
// WHY THIS IS NEEDED NOW AND WAS NOT BEFORE
// -----------------------------------------
// POST /api/devices/claim used to sit behind the shared X-Api-Key gate, so
// only something holding the fleet key could even attempt a code. v1.3.0
// removes that deliberately: the one-time enrollment code IS the
// authorisation, and requiring a compiled-in shared secret alongside it is
// what the whole token change exists to get away from.
//
// That leaves the code itself as the only secret on an endpoint anyone can
// reach. The codes are 8 characters from a 31-character alphabet - about
// 8.5e11 combinations - and they expire in 24 hours, so brute force is not
// remotely practical at human speed. It is practical at machine speed if the
// endpoint will answer unlimited guesses, and a successful guess claims
// someone else's kit onto an attacker's board.
//
// So: unlimited SUCCESSFUL claims (an install day is a burst of them from one
// office IP, and a kit that will not enrol is a real support cost), and a
// hard ceiling on consecutive failures from one address.
//
// WHY IN-MEMORY AND NOT A TABLE
// -----------------------------
// This has to be cheap on the request path and it has to survive nothing. A
// restart clearing the counters is acceptable - the attacker gains one
// window's worth of guesses, which against 8.5e11 combinations is noise -
// and it saves a write per failed attempt on a free-tier database. It is also
// per-instance, which on a single Railway container is the whole fleet.
public sealed class ClaimRateLimiter
{
    // Generous enough to absorb an engineer mistyping a code with an O for a
    // 0 a few times (the alphabet excludes both, but the sticker is read by a
    // human), and far below anything useful for searching the space.
    public const int MaxFailuresPerWindow = 10;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private sealed class Attempts
    {
        public int Failures;
        public DateTimeOffset WindowStartedAt;
    }

    private readonly ConcurrentDictionary<string, Attempts> _byAddress = new();
    private readonly ILogger<ClaimRateLimiter> _logger;

    // Bounds memory against an attacker rotating source addresses, which
    // would otherwise make this dictionary the vulnerability. Well above any
    // plausible number of real installer locations.
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
            // Drop everything whose window has already closed rather than
            // refusing to track anything new.
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

    // A successful claim clears the address. An installer who finally gets
    // the right code should not stay blocked for the rest of the window.
    public void RecordSuccess(string? address)
    {
        if (string.IsNullOrEmpty(address)) return;

        _byAddress.TryRemove(address!, out _);
    }

    // Prefers the proxy header, because on Railway every request arrives from
    // the platform's own edge and RemoteIpAddress would be the same value for
    // the entire internet - which would make this a global kill switch rather
    // than a per-IP limit. Falls back to the socket address locally, where
    // there is no proxy.
    public static string? ResolveAddress(HttpContext context)
    {
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();

        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            // Left-most entry is the original client; the rest are proxies.
            var first = forwarded.Split(',')[0].Trim();
            if (first.Length > 0) return first;
        }

        return context.Connection.RemoteIpAddress?.ToString();
    }
}
