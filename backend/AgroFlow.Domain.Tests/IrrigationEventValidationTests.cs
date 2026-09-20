using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Proves the fix for the IrrigationEventEndpoints bug: negative runtime and
// negative water values were accepted and subtracted from zone.water_used_total.
public class IrrigationEventValidationTests
{
    private static string? Validate(
        long zoneId = 1,
        int runtimeSeconds = 1800,
        float estimatedLitres = 600f,
        string? triggerSource = "auto",
        string? syncStatus = "synced")
        => IrrigationEventValidation.Validate(zoneId, runtimeSeconds, estimatedLitres, triggerSource, syncStatus);

    [Fact]
    public void ARealisticEvent_IsAccepted()
    {
        Assert.Null(Validate());
    }

    // ---- THE BUG -------------------------------------------------------------

    [Fact]
    public void NegativeLitres_IsRejected_ThisIsTheBug()
    {
        // Before the fix this reached Zone.AddWaterUsage and subtracted 600 L
        // from the zone's running total, permanently.
        var error = Validate(estimatedLitres: -600f);
        Assert.NotNull(error);
        Assert.Contains("estimatedLitres cannot be negative", error);
    }

    [Fact]
    public void NegativeRuntime_IsRejected_ThisIsTheBug()
    {
        var error = Validate(runtimeSeconds: -1800);
        Assert.NotNull(error);
        Assert.Contains("runtimeSeconds cannot be negative", error);
    }

    [Fact]
    public void NaNLitres_IsRejected()
    {
        // NaN slips past "< 0" because every comparison with NaN is false, and
        // would poison water_used_total forever: NaN + anything stays NaN.
        var error = Validate(estimatedLitres: float.NaN);
        Assert.NotNull(error);
        Assert.Contains("finite", error);
    }

    [Theory]
    [InlineData(float.PositiveInfinity)]
    [InlineData(float.NegativeInfinity)]
    public void InfiniteLitres_IsRejected(float litres)
    {
        Assert.NotNull(Validate(estimatedLitres: litres));
    }

    // ---- Absurd durations ----------------------------------------------------

    [Fact]
    public void ExactlySixHours_IsStillAccepted()
    {
        // The bound is inclusive: a long but legitimate flood-irrigation run
        // must not be rejected.
        Assert.Null(Validate(runtimeSeconds: 21600, estimatedLitres: 7200f));
    }

    [Fact]
    public void LongerThanSixHours_IsRejected()
    {
        var error = Validate(runtimeSeconds: 21601, estimatedLitres: 100f);
        Assert.NotNull(error);
        Assert.Contains("6 hour", error);
    }

    [Fact]
    public void AbsurdRuntime_LikeAnIntegerOverflowValue_IsRejected()
    {
        Assert.NotNull(Validate(runtimeSeconds: int.MaxValue, estimatedLitres: 1f));
    }

    // ---- Internal consistency ------------------------------------------------

    [Fact]
    public void ZeroRuntimeWithZeroLitres_IsAccepted()
    {
        // A cycle that was commanded and immediately stopped. Harmless.
        Assert.Null(Validate(runtimeSeconds: 0, estimatedLitres: 0f));
    }

    [Fact]
    public void ZeroRuntimeWithWaterDelivered_IsRejected()
    {
        var error = Validate(runtimeSeconds: 0, estimatedLitres: 500f);
        Assert.NotNull(error);
        Assert.Contains("water cannot be delivered in no time", error);
    }

    [Fact]
    public void ImplausibleImpliedFlowRate_IsRejected()
    {
        // 60 000 L in 60 s = 60 000 L/min. Runtime and litres disagree, so
        // neither is trustworthy.
        var error = Validate(runtimeSeconds: 60, estimatedLitres: 60000f);
        Assert.NotNull(error);
        Assert.Contains("L/min", error);
    }

    [Fact]
    public void AHighButPlausibleFlowRate_IsAccepted()
    {
        // 600 L in 60 s = 600 L/min - big, but under the bound.
        Assert.Null(Validate(runtimeSeconds: 60, estimatedLitres: 600f));
    }

    // ---- The checks that already existed, kept working -----------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NonPositiveZoneId_IsRejected(long zoneId)
    {
        Assert.NotNull(Validate(zoneId: zoneId));
    }

    [Theory]
    [InlineData("auto")]
    [InlineData("manual")]
    [InlineData("scheduled")]
    [InlineData("unknown")]
    public void EveryDocumentedTriggerSource_IsAccepted(string source)
    {
        Assert.Null(Validate(triggerSource: source));
    }

    [Theory]
    [InlineData("nonsense")]
    [InlineData("")]
    [InlineData(null)]
    public void UnknownTriggerSource_IsRejected(string? source)
    {
        Assert.NotNull(Validate(triggerSource: source));
    }

    [Theory]
    [InlineData("synced")]
    [InlineData("offline_queued")]
    public void EveryDocumentedSyncStatus_IsAccepted(string status)
    {
        Assert.Null(Validate(syncStatus: status));
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("")]
    [InlineData(null)]
    public void UnknownSyncStatus_IsRejected(string? status)
    {
        Assert.NotNull(Validate(syncStatus: status));
    }

    [Fact]
    public void EveryRejection_ExplainsWhichFieldFailed()
    {
        // The reason string goes into the 400 body, so a device developer can
        // see what was wrong rather than guessing at "Invalid request".
        var errors = new[]
        {
            Validate(estimatedLitres: -1f),
            Validate(runtimeSeconds: -1),
            Validate(zoneId: 0),
            Validate(triggerSource: "nope"),
            Validate(syncStatus: "nope"),
        };

        Assert.All(errors, e =>
        {
            Assert.NotNull(e);
            Assert.True(e!.Length > 20, $"unhelpfully short rejection message: {e}");
        });
    }
}
