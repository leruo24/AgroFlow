using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Item 6: every crop the apps OFFER has to be a crop the engine can RESOLVE.
//
// WHAT THIS GUARDS AGAINST, AND WHY IT IS WORTH A TEST
// The admin console's crop list offered "Grapes", "Wheat" and "Apples". None
// of the three resolve in Fao56EngineReference, so a zone created with one got
// no crop coefficient, no season lengths and therefore no irrigation advice -
// and nothing anywhere complained. The farmer simply never received a
// recommendation for that zone, and there was no error to go looking for.
//
// That is the failure mode this file exists to make loud: adding a crop to a
// picker is a one-line change in a list, and nothing about that line tells you
// it has to exist in the reference tables too. These tests fail the build
// instead.
//
// The two lists are duplicated by hand here on purpose. Importing them would
// make the test pass automatically whenever a list changed, which is exactly
// the moment it needs to be checked - the point is that somebody adding a crop
// has to come here and say so.
public class OfferedCropsResolveTests
{
    // apps/mobile/src/app/request.tsx — cropOptions. What a farmer can ask for.
    private static readonly string[] MobileRequestCrops =
    {
        "potato", "tomato", "citrus", "leafy_veg", "maize", "dry_beans",
    };

    // apps/web/admin/src/data/referenceData.ts — ZONE_CROPS. What an admin can
    // put on a zone. A superset of the mobile list: cucumber and spinach are
    // first-class engine crops that the request form happens not to offer.
    private static readonly string[] AdminZoneCrops =
    {
        "maize", "potato", "tomato", "dry_beans", "citrus", "leafy_veg",
        "cucumber", "spinach",
    };

    [Fact]
    public void EveryCropAFarmerCanRequest_Resolves()
    {
        foreach (var crop in MobileRequestCrops)
        {
            Assert.NotNull(Fao56EngineReference.TryResolveCrop(crop));
        }
    }

    [Fact]
    public void EveryCropAnAdminCanPutOnAZone_Resolves()
    {
        foreach (var crop in AdminZoneCrops)
        {
            Assert.NotNull(Fao56EngineReference.TryResolveCrop(crop));
        }
    }

    [Fact]
    public void TheAdminListCoversEveryCropAFarmerCanRequest()
    {
        // Otherwise a farmer requests a crop the admin cannot then select
        // when building their zone, and the zone silently gets a different
        // one - or none.
        foreach (var crop in MobileRequestCrops)
        {
            Assert.Contains(crop, AdminZoneCrops);
        }
    }

    [Theory]
    [InlineData("Grapes")]
    [InlineData("Wheat")]
    [InlineData("Apples")]
    public void TheCropsTheAdminListUsedToOffer_StillDoNotResolve(string crop)
    {
        // Not a wish: this records WHY those three were removed rather than
        // renamed. If support for one is ever added to the reference tables,
        // this test fails and whoever added it can put it back in the picker -
        // which is the right order for that change to happen in.
        Assert.Null(Fao56EngineReference.TryResolveCrop(crop));
    }

    [Fact]
    public void ResolutionIsSpellingTolerant_BecauseOldZonesHaveOldSpellings()
    {
        // Zones created before the pickers existed hold free text. The engine
        // normalises underscores and case, which is what lets "dry_beans" from
        // a form and "Dry Beans" typed by hand land on the same crop.
        Assert.NotNull(Fao56EngineReference.TryResolveCrop("Dry Beans"));
        Assert.NotNull(Fao56EngineReference.TryResolveCrop("dry beans"));
        Assert.NotNull(Fao56EngineReference.TryResolveCrop("DRY_BEANS"));
    }

    [Fact]
    public void NothingResolves_ForAbsentOrEmptyInput()
    {
        // A zone with no crop set must yield null rather than a default crop:
        // advising on maize for a zone growing something else is worse than
        // advising nothing.
        Assert.Null(Fao56EngineReference.TryResolveCrop(null));
        Assert.Null(Fao56EngineReference.TryResolveCrop(""));
        Assert.Null(Fao56EngineReference.TryResolveCrop("   "));
    }
}
