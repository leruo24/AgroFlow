using System;
using System.IO;
using System.Linq;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Drought mode, community alerts and locations: the pure rules (docs/drought-community.md).
public class DroughtCommunityRulesTests
{
    private static readonly DroughtSettings D = DroughtSettings.Defaults;
    private static readonly CommunitySettings C = CommunitySettings.Defaults;

    private static DroughtInputs Dry(double? tank = 0.20, bool soilLow = false, double rain = 2, double? eto = 6, double? usual = 5, string? manual = null) =>
        new(tank, soilLow, rain, eto, usual, manual);

    // ---- Drought: when it turns on -------------------------------------------------------

    [Fact]
    public void Drought_mode_needs_a_low_tank_a_dry_week_and_high_crop_water_use_together()
    {
        Assert.True(DroughtRules.Decide(Dry(), D).Active);
        Assert.False(DroughtRules.Decide(Dry(tank: 0.30), D).Active);    // tank not low
        Assert.False(DroughtRules.Decide(Dry(rain: 5.0), D).Active);     // 5 mm is meaningful rain
        Assert.False(DroughtRules.Decide(Dry(eto: 4.0), D).Active);      // below the farm's own usual
        Assert.False(DroughtRules.Decide(Dry(eto: null), D).Active);     // not known: never on by guess
    }

    [Fact]
    public void Without_a_tank_the_soil_decides_and_by_hand_always_wins()
    {
        Assert.True(DroughtRules.Decide(Dry(tank: null, soilLow: true), D).Active);
        Assert.False(DroughtRules.Decide(Dry(tank: null, soilLow: false), D).Active);
        var on = DroughtRules.Decide(Dry(tank: 0.9, rain: 40, manual: "on"), D);
        Assert.True(on.Active);
        Assert.False(on.Automatic);
        Assert.False(DroughtRules.Decide(Dry(manual: "off"), D).Active);
    }

    [Fact]
    public void Every_threshold_is_a_setting()
    {
        var strict = D with { TankLowFraction = 0.10, RainSumMm = 1 };
        Assert.False(DroughtRules.Decide(Dry(tank: 0.20), strict).Active);
        Assert.False(DroughtRules.Decide(Dry(tank: 0.05, rain: 2), strict).Active);
        Assert.True(DroughtRules.Decide(Dry(tank: 0.05, rain: 0.5), strict).Active);
    }

    [Fact]
    public void The_reason_says_what_the_farm_data_shows_and_claims_no_prediction()
    {
        var r = DroughtRules.Decide(Dry(), D).Reason;
        Assert.Equal("Drought mode on: tank about 20% full (drought line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry); crop water use 6 mm a day forecast against 5 mm usual for this farm.", r);
        Assert.DoesNotContain("predict", r, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("declar", r, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Water budget -------------------------------------------------------------------

    [Fact]
    public void The_water_budget_counts_whole_days_at_normal_and_at_drought_watering()
    {
        var b = DroughtRules.Budget(1000, 200, 120)!.Value;
        Assert.Equal((5, 8), b);
        Assert.Equal("You have about 1 000 L. At normal watering that lasts 5 days; in drought mode it lasts 8 days.", DroughtRules.BudgetText(1000, b));
        Assert.Null(DroughtRules.Budget(1000, 0, 0));                          // nothing known about use
        Assert.Equal((2, 2), DroughtRules.Budget(500, 200, 400));              // drought never uses more
        Assert.Equal("You have about 50 L. At normal watering that lasts 1 day; in drought mode it lasts a long time.",
            DroughtRules.BudgetText(50, DroughtRules.Budget(50, 40, 0)!.Value));
    }

    // ---- Zone priorities, from FAO-66 ---------------------------------------------------

    [Fact]
    public void Yield_response_factors_are_the_published_FAO_values()
    {
        // FAO Irrigation and Drainage Paper 66, ch. 2, Table 2 (FAO columns) and Table 1.
        Assert.Equal(0.40, YieldResponse.For("maize", GrowthStage.Initial));
        Assert.Equal(1.50, YieldResponse.For("maize", GrowthStage.Development));
        Assert.Equal(0.50, YieldResponse.For("maize", GrowthStage.MidSeason));
        Assert.Equal(0.20, YieldResponse.For("maize", GrowthStage.LateSeason));
        Assert.Equal(0.20, YieldResponse.For("dry_beans", GrowthStage.Initial));
        Assert.Equal(1.10, YieldResponse.For("dry_beans", GrowthStage.Development));
        Assert.Equal(0.75, YieldResponse.For("dry_beans", GrowthStage.MidSeason));
        Assert.Equal(0.20, YieldResponse.For("dry_beans", GrowthStage.LateSeason));
        Assert.Equal(0.60, YieldResponse.For("potato", GrowthStage.Initial));
        Assert.Equal(1.10, YieldResponse.For("potato", GrowthStage.Development));   // no stage value: seasonal
        Assert.False(YieldResponse.HasStageValue("potato", GrowthStage.Development));
        Assert.Equal(0.70, YieldResponse.For("potato", GrowthStage.MidSeason));
        Assert.Equal(1.05, YieldResponse.For("tomato", GrowthStage.MidSeason));     // seasonal only
        Assert.Null(YieldResponse.For("citrus", GrowthStage.MidSeason));            // not in the tables
        Assert.Null(YieldResponse.For("leafy_veg", GrowthStage.MidSeason));         // lettuce: not in the tables
        Assert.Contains("FAO Irrigation and Drainage Paper 66", YieldResponse.Source);
    }

    [Fact]
    public void Sensitive_stages_get_full_water_tolerant_ones_half_and_ripening_skips_a_day()
    {
        var full = DroughtPriorities.For(1, "Zone 1", "maize", GrowthStage.Development, 200, D);
        Assert.Equal((DroughtPriority.Full, 1.0, 200.0), (full.Priority, full.Fraction, full.DroughtLitres!.Value));
        var half = DroughtPriorities.For(2, "Zone 2", "maize", GrowthStage.MidSeason, 200, D);
        Assert.Equal((DroughtPriority.Reduced, 0.5, 100.0), (half.Priority, half.Fraction, half.DroughtLitres!.Value));
        Assert.Contains("expected yield loss is about 25%", half.Why);                 // 0.50 x 50%
        var skip = DroughtPriorities.For(3, "Zone 3", "maize", GrowthStage.LateSeason, 200, D);
        Assert.Equal((DroughtPriority.Skip, 0.0, 0.0), (skip.Priority, skip.Fraction, skip.DroughtLitres!.Value));
        var trees = DroughtPriorities.For(4, "Orchard", "citrus", GrowthStage.MidSeason, 300, D);
        Assert.Equal((DroughtPriority.NoFactor, 1.0), (trees.Priority, trees.Fraction));
        Assert.Equal(DroughtPriority.Skip, DroughtPriorities.For(5, "New bed", "tomato", GrowthStage.NotYetPlanted, 50, D).Priority);

        Assert.Equal("Drought mode on: water Zone 1 fully, Zone 2 at half, skip Zone 3 today.",
            DroughtPriorities.Summary(new[] { full, half, skip }));
    }

    [Fact]
    public void Drought_mode_is_a_layer_and_never_touches_the_engine_or_the_primary_action()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "backend", "AgroFlow.Domain"))) dir = dir.Parent;
        var agronomy = Path.Combine(dir!.FullName, "backend", "AgroFlow.Domain", "IrrigationControl", "Agronomy");
        foreach (var file in new[] { "Fao56Engine.cs", Path.Combine("RuleBook", "TodayRules.cs"), "IrrigationAdvisor.cs", "SoilWaterBalance.cs" })
        {
            var src = File.ReadAllText(Path.Combine(agronomy, file));
            Assert.DoesNotContain("Drought", src);
            Assert.DoesNotContain("ApplicationEfficiency", src);
        }
    }

    // ---- Irrigation type -----------------------------------------------------------------

    [Fact]
    public void Application_efficiency_is_FAO_Table_8_and_only_turns_net_into_gross()
    {
        // Brouwer, Prins & Heibloem (1989), FAO Training manual 4, Annex I Table 8.
        Assert.Equal(0.90, ApplicationEfficiency.For("drip"));
        Assert.Equal(0.75, ApplicationEfficiency.For("sprinkler"));
        Assert.Equal(0.75, ApplicationEfficiency.For("centre_pivot"));
        Assert.Equal(0.75, ApplicationEfficiency.For("micro_sprinkler"));
        Assert.Equal(0.60, ApplicationEfficiency.For("surface"));
        Assert.Null(ApplicationEfficiency.For("hand"));
        Assert.Equal(100.0, ApplicationEfficiency.Gross(90, "drip"));
        Assert.Equal(150.0, ApplicationEfficiency.Gross(90, "surface"));
        Assert.Equal(90.0, ApplicationEfficiency.Gross(90, "hand"));
        Assert.Contains("about 90% of the water reaches the roots", ApplicationEfficiency.Explain("drip"));
        Assert.Contains("no published efficiency figure", ApplicationEfficiency.Explain("hand"));
    }

    // ---- Community: the report limit -----------------------------------------------------

    [Fact]
    public void Two_reports_per_36_hours_then_the_next_is_allowed_once_the_oldest_leaves_the_window()
    {
        var now = DateTimeOffset.Parse("2026-10-20T10:00:00+02:00");
        Assert.Null(CommunityRules.NextAllowedAt(Array.Empty<DateTimeOffset>(), now, C));
        Assert.Null(CommunityRules.NextAllowedAt(new[] { now.AddHours(-10) }, now, C));
        var two = new[] { now.AddHours(-10), now.AddHours(-1) };
        var next = CommunityRules.NextAllowedAt(two, now, C);
        Assert.Equal(now.AddHours(26), next);                                   // -10 h + 36 h
        Assert.Null(CommunityRules.NextAllowedAt(two, now.AddHours(26), C));     // allowed again
        Assert.Null(CommunityRules.NextAllowedAt(new[] { now.AddHours(-40), now.AddHours(-37) }, now, C));
        Assert.Equal("You can add up to 2 reports every 36 hours. You can add another after Wednesday 21 October, 12:00.",
            CommunityRules.LimitMessage(next, C, TimeSpan.FromHours(2)));
    }

    // ---- Community: where and who --------------------------------------------------------

    private const double MahikengLat = -25.86522, MahikengLon = 25.64421;     // Open-Meteo, 2026-10-20
    private const double OttoshoopLat = -25.74916, OttoshoopLon = 25.96766;

    [Fact]
    public void Points_are_rounded_to_about_a_kilometre_and_distances_are_real()
    {
        Assert.Equal(-25.87, CommunityRules.Round(MahikengLat));
        Assert.Equal(25.64, CommunityRules.Round(MahikengLon));
        var d = CommunityRules.DistanceKm(MahikengLat, MahikengLon, OttoshoopLat, OttoshoopLon);
        Assert.InRange(d, 33, 37);
        Assert.Equal("about 35 km from your farm", CommunityRules.DistanceText(d));
        Assert.Equal("about 1 km from your farm", CommunityRules.DistanceText(0.4));
    }

    [Fact]
    public void Farms_within_the_category_radius_are_told_except_the_reporter_and_those_who_opted_out()
    {
        var farms = new[]
        {
            new FarmPoint(1, MahikengLat, MahikengLon, true),          // the reporter
            new FarmPoint(2, OttoshoopLat, OttoshoopLon, true),        // about 35 km
            new FarmPoint(3, OttoshoopLat, OttoshoopLon, false),       // opted out
            new FarmPoint(4, -26.5, 27.5, true),                       // far away
        };
        var pest = CommunityMatching.Targets("pest", MahikengLat, MahikengLon, 1, false, null, farms, C);   // 50 km
        Assert.Equal(new long[] { 2 }, pest.Select(t => t.FarmId));
        var water = CommunityMatching.Targets("water", MahikengLat, MahikengLon, 1, false, null, farms, C); // 20 km
        Assert.Empty(water);
    }

    [Fact]
    public void A_fire_reaches_downwind_farms_first_out_to_one_and_a_half_times_its_radius_inside_a_45_degree_cone()
    {
        var s = C with { RadiusKm = new System.Collections.Generic.Dictionary<string, double>(C.RadiusKm) { ["fire"] = 30 } };
        var farms = new[] { new FarmPoint(2, OttoshoopLat, OttoshoopLon, true) };   // ~35 km, bearing ~68 deg
        var bearing = CommunityRules.BearingDeg(MahikengLat, MahikengLon, OttoshoopLat, OttoshoopLon);
        Assert.InRange(bearing, 60, 75);

        // Wind from the west (270) blows towards the east (90): Ottoshoop is in the cone.
        var west = CommunityMatching.Targets("fire", MahikengLat, MahikengLon, null, false, 270, farms, s);
        Assert.True(Assert.Single(west).Downwind);
        // Wind from the east blows away: 35 km is outside the 30 km radius, so nobody.
        Assert.Empty(CommunityMatching.Targets("fire", MahikengLat, MahikengLon, null, false, 90, farms, s));
        // No wind known: radius only.
        Assert.Empty(CommunityMatching.Targets("fire", MahikengLat, MahikengLon, null, false, null, farms, s));
        // Escalated (3 confirmations) radius 30 x 1.5 = 45 km: told, but not marked downwind.
        Assert.True(CommunityRules.Escalates(3, s));
        Assert.False(CommunityRules.Escalates(2, s));
        Assert.Equal(45, CommunityRules.RadiusFor("fire", true, s));
        Assert.False(Assert.Single(CommunityMatching.Targets("fire", MahikengLat, MahikengLon, null, true, 90, farms, s)).Downwind);
    }

    [Fact]
    public void Reports_of_the_same_kind_nearby_within_48_hours_are_one_group()
    {
        var t = DateTimeOffset.Parse("2026-10-20T08:00:00Z");
        Assert.True(CommunityMatching.SameGroup("pest", MahikengLat, MahikengLon, t, "pest", OttoshoopLat, OttoshoopLon, t.AddHours(30), C));
        Assert.False(CommunityMatching.SameGroup("pest", MahikengLat, MahikengLon, t, "pest", OttoshoopLat, OttoshoopLon, t.AddHours(49), C));
        Assert.False(CommunityMatching.SameGroup("pest", MahikengLat, MahikengLon, t, "fire", OttoshoopLat, OttoshoopLon, t, C));
        Assert.False(CommunityMatching.SameGroup("water", MahikengLat, MahikengLon, t, "water", OttoshoopLat, OttoshoopLon, t, C));  // 35 > 20 km
    }

    [Fact]
    public void Reports_expire_by_category()
    {
        var t = DateTimeOffset.Parse("2026-10-20T08:00:00Z");
        Assert.Equal(t.AddDays(7), CommunityRules.ExpiresAt("pest", t, C));
        Assert.Equal(t.AddDays(7), CommunityRules.ExpiresAt("disease", t, C));
        Assert.Equal(t.AddDays(3), CommunityRules.ExpiresAt("water", t, C));
        Assert.Equal(t.AddHours(24), CommunityRules.ExpiresAt("weather", t, C));
        Assert.Equal(t.AddHours(48), CommunityRules.ExpiresAt("fire", t, C));
    }

    // ---- Community: the words ------------------------------------------------------------

    [Fact]
    public void Every_message_says_unverified_gives_distance_only_and_fires_say_what_to_do()
    {
        var pest = CommunityMessages.Report("pest", "fall_armyworm", "moderate", 18.2, false, 3, "In the maize rows", C);
        Assert.Equal("Fall armyworm reported about 18 km from your farm.\nSeverity: Moderate.\n\"In the maize rows\"\n3 nearby farms have reported similar activity.\nThis is a community report and has not been independently verified.", pest);

        var fire = CommunityMessages.Report("fire", "veld_fire", "high", 18.2, true, 0, null, C);
        Assert.StartsWith("Fire reported about 18 km away — the wind is blowing towards your farm.", fire);
        Assert.Contains("estimate from current wind data, not a prediction", fire);
        Assert.Contains(CommunityRules.Unverified, fire);
        Assert.EndsWith("If you're in danger, leave and call your local emergency number (112 from a mobile phone).", fire);

        var update = CommunityMessages.FireUpdate("spreading", "north-east", 12, true, C);
        Assert.StartsWith("Update: the fire reported about 12 km from your farm is spreading towards the north-east.", update);
        Assert.DoesNotContain("If you're in danger", CommunityMessages.FireUpdate("out", null, 12, false, C));
        Assert.Contains("If you're in danger, leave and call 10177", CommunityMessages.Report("fire", "veld_fire", "high", 5, false, 0, null, C with { EmergencyText = "10177" }));
    }

    [Theory]
    [InlineData("pest", "locusts", "high", null, null)]
    [InlineData("fire", "smoke_nearby", "low", "Smoke from the east", null)]
    [InlineData("unknown", "locusts", "high", null, "Choose what you are reporting.")]
    [InlineData("pest", "veld_fire", "high", null, "Choose what you are seeing.")]
    [InlineData("water", "borehole_dry", "extreme", null, "Choose how serious it is: low, moderate or high.")]
    public void A_report_is_checked_before_it_is_saved(string category, string subtype, string severity, string? description, string? problem) =>
        Assert.Equal(problem, CommunityCategories.Validate(category, subtype, severity, description));

    // ---- Locations -----------------------------------------------------------------------

    [Fact]
    public void Nine_provinces_and_coordinates_inside_South_Africa_only()
    {
        Assert.Equal(9, LocationRules.Provinces.Count);
        Assert.True(LocationRules.IsProvince("North West"));
        Assert.False(LocationRules.IsProvince("Gaborone"));
        Assert.Null(LocationRules.ValidateCoordinates(MahikengLat, MahikengLon));
        Assert.NotNull(LocationRules.ValidateCoordinates(-24.6, 25.9 + 10));    // Mozambique side
        Assert.NotNull(LocationRules.ValidateCoordinates(25.86, 25.64));         // sign flipped
        Assert.NotNull(LocationRules.ValidateCoordinates(null, 25.64));
        Assert.Equal("Mahikeng, Ngaka Modiri Molema District Municipality, North West",
            LocationRules.Display("Mahikeng", "Ngaka Modiri Molema District Municipality", "North West"));
    }

    [Fact]
    public void A_misspelt_town_still_ranks_its_real_name_first()
    {
        Assert.True(LocationRules.Similarity("Mafeking", "Mafikeng") > LocationRules.Similarity("Mafeking", "Mafatle"));
        Assert.Equal(1.0, LocationRules.Similarity("Mahik", "Mahikeng"));
        // The former name's current one first (B3-01), then prefixes up to 6 letters.
        Assert.Equal(new[] { "Mahikeng", "Mafeki", "Mafek", "Mafe", "Maf" }, LocationRules.QueriesFor("Mafeking").Skip(1));
        Assert.Equal(1, LocationRules.Levenshtein("polokwne", "polokwane"));
    }
}
