using AgroFlow.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace AgroFlow.Domain.Tests;

// Step 3: "Rate-limit failed claims per IP."
//
// This replaced a real defence. POST /api/devices/claim used to sit behind
// the shared X-Api-Key, so only something holding the fleet key could attempt
// a code at all. v1.3.0 removes that deliberately - a freshly flashed board
// has no credential until the claim answers - which leaves the 8-character
// enrollment code as the only secret on an endpoint anyone can reach.
//
// The counters live in memory, so the limit is only observable by exercising
// the real object.
public class ClaimRateLimiterTests
{
    private static ClaimRateLimiter New() => new(NullLogger<ClaimRateLimiter>.Instance);

    private static readonly DateTimeOffset Now = new(2026, 10, 3, 12, 0, 0, TimeSpan.Zero);

    private const string Address = "41.76.100.12";

    [Fact]
    public void AFreshAddressIsNotBlocked()
    {
        Assert.False(New().IsBlocked(Address, Now));
    }

    [Fact]
    public void OneWrongCode_DoesNotBlock_AnInstallerMistypes()
    {
        var limiter = New();
        limiter.RecordFailure(Address, Now);

        Assert.False(limiter.IsBlocked(Address, Now));
    }

    [Fact]
    public void JustUnderTheCeiling_IsStillAllowed()
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow - 1; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        Assert.False(limiter.IsBlocked(Address, Now));
    }

    [Fact]
    public void AtTheCeiling_TheAddressIsBlocked()
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        Assert.True(limiter.IsBlocked(Address, Now));
    }

    // Per IP, not global. One installer with stale codes must not lock out
    // every other installer in the country.
    [Fact]
    public void BlockingOneAddressDoesNotBlockAnother()
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        Assert.True(limiter.IsBlocked(Address, Now));
        Assert.False(limiter.IsBlocked("102.65.4.9", Now));
    }

    [Fact]
    public void TheBlockLiftsAfterTheWindow()
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        Assert.True(limiter.IsBlocked(Address, Now));
        Assert.False(limiter.IsBlocked(Address, Now + ClaimRateLimiter.Window + TimeSpan.FromSeconds(1)));
    }

    // An installer who finally gets the right code must not stay blocked for
    // the rest of the window.
    [Fact]
    public void ASuccessfulClaimClearsTheAddress()
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow - 1; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        limiter.RecordSuccess(Address);

        // Back to a clean slate: the full budget is available again.
        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow - 1; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        Assert.False(limiter.IsBlocked(Address, Now));
    }

    // Failures in an expired window must not carry over, or an installer who
    // mistyped a code an hour ago starts the day part-way to blocked.
    [Fact]
    public void FailuresFromAnExpiredWindowAreNotCountedAgainstTheNewOne()
    {
        var limiter = New();
        var later = Now + ClaimRateLimiter.Window + TimeSpan.FromMinutes(1);

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow; i++)
        {
            limiter.RecordFailure(Address, Now);
        }

        limiter.RecordFailure(Address, later);

        Assert.False(limiter.IsBlocked(Address, later));
    }

    // A request with no resolvable address must not be able to create a
    // shared bucket that blocks everyone whose address could not be read.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AnUnknownAddressIsNeverBlocked(string? address)
    {
        var limiter = New();

        for (var i = 0; i < ClaimRateLimiter.MaxFailuresPerWindow * 3; i++)
        {
            limiter.RecordFailure(address, Now);
        }

        Assert.False(limiter.IsBlocked(address, Now));
    }

    // The ceiling has to be generous enough for a human reading a sticker and
    // far below anything useful for searching 31^8 combinations.
    [Fact]
    public void TheCeilingIsGenerousForHumansAndUselessForBruteForce()
    {
        Assert.InRange(ClaimRateLimiter.MaxFailuresPerWindow, 5, 25);
        Assert.InRange(ClaimRateLimiter.Window, TimeSpan.FromMinutes(5), TimeSpan.FromHours(1));
    }
}
