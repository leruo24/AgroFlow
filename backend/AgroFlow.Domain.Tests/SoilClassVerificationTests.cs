using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Step 6c: confirm the soil values the engine uses match the spec.
//
// These three pairs of numbers decide how much water every zone is told it
// needs. A wrong one is not a visible bug - the engine keeps running and
// keeps producing confident advice - it just quietly waters the wrong
// amount, for the whole season, on every farm with that soil type. Nothing
// else in the system would notice.
//
// So they are pinned here against the spec, with the FAO-56 Table 19 source
// for each, rather than only confirmed by reading the file once.
public class SoilClassVerificationTests
{
    [Fact]
    public void Sandy_IsTheFaoSandClass()
    {
        var soil = Fao56EngineReference.TryResolveSoil("sandy");

        Assert.NotNull(soil);

        // Table 19 "Sand": theta_FC 0.07-0.17, theta_WP 0.02-0.07. Midpoints.
        Assert.Equal(0.12, soil!.ThetaFieldCapacity, 3);
        Assert.Equal(0.045, soil.ThetaWiltingPoint, 3);
        Assert.Equal(1.05, soil.PFactor, 3);

        // FAO's Sand, deliberately, not sandy loam - so it differs clearly
        // from loam rather than sitting almost on top of it.
        Assert.Equal("Sand", soil.Table19Class);
    }

    [Fact]
    public void Loam_IsTheMiddleAndTheDefault()
    {
        var soil = Fao56EngineReference.TryResolveSoil("loam");

        Assert.NotNull(soil);

        // Table 19 "Loam": theta_FC 0.20-0.30, theta_WP 0.07-0.17. Midpoints.
        Assert.Equal(0.25, soil!.ThetaFieldCapacity, 3);
        Assert.Equal(0.12, soil.ThetaWiltingPoint, 3);
        Assert.Equal(1.00, soil.PFactor, 3);
    }

    [Fact]
    public void Clay_HoldsTheMostAndIsTheMostCautious()
    {
        var soil = Fao56EngineReference.TryResolveSoil("clay");

        Assert.NotNull(soil);

        // Table 19 "Clay": theta_FC 0.32-0.40, theta_WP 0.20-0.24. Midpoints.
        Assert.Equal(0.36, soil!.ThetaFieldCapacity, 3);
        Assert.Equal(0.22, soil.ThetaWiltingPoint, 3);
        Assert.Equal(0.95, soil.PFactor, 3);
    }

    // The three are only useful if they are actually different. A copy-paste
    // that left two classes with the same numbers would make the soil-type
    // screen a control that changes nothing.
    [Fact]
    public void TheThreeSoilsAreGenuinelyDifferent()
    {
        var sandy = Fao56EngineReference.TryResolveSoil("sandy")!;
        var loam = Fao56EngineReference.TryResolveSoil("loam")!;
        var clay = Fao56EngineReference.TryResolveSoil("clay")!;

        // Available water (FC - WP) rises from sand to clay, which is the
        // whole physical point of the classification.
        var sandyAvailable = sandy.ThetaFieldCapacity - sandy.ThetaWiltingPoint;   // 0.075
        var loamAvailable = loam.ThetaFieldCapacity - loam.ThetaWiltingPoint;      // 0.13
        var clayAvailable = clay.ThetaFieldCapacity - clay.ThetaWiltingPoint;      // 0.14

        Assert.True(sandyAvailable < loamAvailable, "Sand must hold less available water than loam.");
        Assert.True(loamAvailable < clayAvailable, "Loam must hold less available water than clay.");
    }

    // p is allowed to rise for sand and must be cut for clay - FAO-56
    // Chapter 8. Getting the direction backwards would make clay zones run
    // drier than they should before watering, which is the soil least able
    // to recover from it.
    [Fact]
    public void ThePFactorsRunTheRightWay()
    {
        var sandy = Fao56EngineReference.TryResolveSoil("sandy")!;
        var loam = Fao56EngineReference.TryResolveSoil("loam")!;
        var clay = Fao56EngineReference.TryResolveSoil("clay")!;

        Assert.True(sandy.PFactor > loam.PFactor);
        Assert.True(clay.PFactor < loam.PFactor);
    }

    // The three keys the app sends, the database CHECK allows
    // (0027: zone_soil_type_check) and this resolves, are the same three.
    [Theory]
    [InlineData("sandy")]
    [InlineData("loam")]
    [InlineData("clay")]
    public void TheKeysMatchWhatTheAppAndTheConstraintUse(string key)
    {
        Assert.NotNull(Fao56EngineReference.TryResolveSoil(key));
    }

    // Casing must not decide whether a zone gets real soil physics or the
    // loam default.
    [Theory]
    [InlineData("Sandy")]
    [InlineData("LOAM")]
    [InlineData("Clay")]
    public void ResolvingIsCaseInsensitive(string key)
    {
        Assert.NotNull(Fao56EngineReference.TryResolveSoil(key));
    }

    [Theory]
    [InlineData("silt")]
    [InlineData("")]
    [InlineData(null)]
    public void AnUnknownSoilDoesNotResolve(string? key)
    {
        Assert.Null(Fao56EngineReference.TryResolveSoil(key));
    }

    // Loam stands in when the farmer has not chosen. Documented as the
    // assumption rather than left implicit, because a zone silently running
    // on sand's numbers when nobody picked sand would be much worse.
    [Fact]
    public void TheDefaultIsLoam()
    {
        Assert.Equal("loam", Fao56EngineReference.DefaultSoil.Key);
    }
}
