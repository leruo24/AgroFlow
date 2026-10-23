using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The audit fixes of 22 October 2026 (docs/audit/fix-report-2026-10-23.md) that are pure rules.
// The weather, area and phone cases come from one fixture file each in docs/audit/fixtures, which
// the app's and admin site's tests read too, so client and server cannot drift apart.
public class AuditFixTests
{
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "docs", "audit", "fixtures"))) dir = dir.Parent;
        return dir!.FullName;
    }

    private static JsonElement Cases(string file) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "docs", "audit", "fixtures", file))).RootElement.GetProperty("cases");

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    // AF-03 ---------------------------------------------------------------------------------

    [Fact]
    public void Weather_is_available_missing_or_stale_and_unknown_is_never_dry()
    {
        var now = new DateTimeOffset(2026, 10, 23, 12, 0, 0, TimeSpan.Zero);
        var checkedCases = 0;
        foreach (var c in Cases("weather-cases.json").EnumerateArray())
        {
            var age = Num(c, "ageHours");
            var status = WeatherAvailability.Evaluate(
                c.GetProperty("hasRow").GetBoolean(), Num(c, "precipitationMm"),
                age is { } h ? now - TimeSpan.FromHours(h) : null, now);
            var name = c.GetProperty("name").GetString();
            Assert.True(c.GetProperty("availability").GetString() == status.Availability, $"{name}: {status.Availability}");
            var expectedRain = c.GetProperty("rainExpected");
            Assert.True((expectedRain.ValueKind == JsonValueKind.Null ? null : (bool?)expectedRain.GetBoolean()) == status.RainExpected, $"{name}: rain {status.RainExpected}");
            Assert.Equal(c.GetProperty("reason").GetString(), status.Reason);
            // Unknown never reads as a "no rain" answer.
            if (status.Availability != WeatherAvailability.Available) Assert.Null(status.RainExpected);
            checkedCases++;
        }
        Assert.True(checkedCases >= 9);
    }

    // AF-07 ---------------------------------------------------------------------------------

    [Fact]
    public void Areas_are_never_rounded_to_zero_and_small_farms_show_square_metres()
    {
        foreach (var c in Cases("area-cases.json").EnumerateArray())
        {
            var text = c.GetProperty("text");
            Assert.Equal(text.ValueKind == JsonValueKind.Null ? null : text.GetString(), AreaFormat.Describe(Num(c, "hectares")));
        }
        Assert.Equal(0.01, AreaFormat.ToHectares(100), 10);
        Assert.Equal(200, AreaFormat.ToSquareMetres(0.02), 10);
        Assert.DoesNotContain("0 ha", AreaFormat.Describe(0.02));
    }

    // AF-20 ---------------------------------------------------------------------------------

    [Fact]
    public void Phone_numbers_are_checked_the_same_way_everywhere_and_all_zeros_fail()
    {
        foreach (var c in Cases("phone-cases.json").EnumerateArray())
        {
            var phone = c.GetProperty("phone").GetString();
            var ok = c.GetProperty("ok").GetBoolean();
            Assert.True(ok == (PhoneRules.Check(phone) is null), $"'{phone}' should be {(ok ? "accepted" : "refused")}");
        }
        Assert.Contains(PhoneRules.Example, PhoneRules.Message);
    }

    // AF-01 / B3-01 -------------------------------------------------------------------------

    [Theory]
    [InlineData("started", "location", false, false, "new_form")]
    [InlineData("failed", "farm", false, false, "new_form")]
    [InlineData("failed", "account", true, false, "retry")]
    [InlineData("farm_saved", "farm", true, false, "retry")]
    [InlineData("account_created", "account", true, true, "retry")]
    [InlineData("completed", "handover", true, true, "done")]
    public void Once_anything_is_saved_the_only_offer_is_retry_never_create_again(string status, string step, bool farm, bool account, string offer)
    {
        var view = OnboardingOperation.Describe(status, step, farm, account);
        Assert.Equal(offer, OnboardingOperation.OfferName(view.Offer));
        Assert.DoesNotContain("create again", view.Message, StringComparison.OrdinalIgnoreCase);
        if (farm) Assert.NotEqual(OnboardingOperation.Offer.NewForm, view.Offer);
    }

    // AF-18 ---------------------------------------------------------------------------------

    [Fact]
    public void Advice_says_which_crop_model_and_weather_dates_it_used_and_never_reads_the_crop_from_the_zone_name()
    {
        var today = new DateOnly(2026, 10, 22);
        var input = new ZoneEngineInput
        {
            ZoneId = 25,
            ZoneName = "Spinach field",
            CropType = "maize",
            PlantingDate = today.AddDays(-30),
            Today = today,
            Weather = new List<ZoneWeatherDay>
            {
                new() { Date = today.AddDays(-2), TMinC = 10, TMaxC = 25, RainMm = 0 },
                new() { Date = today, TMinC = 11, TMaxC = 27, RainMm = 0, IsForecast = true },
                new() { Date = today.AddDays(1), TMinC = 11, TMaxC = 27, RainMm = 3, IsForecast = true },
            },
        };
        var result = Fao56Engine.Run(input);
        var at = new DateTimeOffset(2026, 10, 22, 8, 0, 0, TimeSpan.Zero);
        var p = AdviceProvenance.From(input, result, at);

        Assert.Equal("maize", p.CropType);
        Assert.NotNull(p.CropModelLabel);
        Assert.DoesNotContain("spinach", (p.CropModelKey ?? "") + (p.CropModelLabel ?? ""), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(today.AddDays(-2), p.WeatherFrom);
        Assert.Equal(today.AddDays(-2), p.WeatherTo);
        Assert.Equal(2, p.ForecastDays);
        Assert.Equal(at, p.CalculatedAt);
        // Yesterday had no weather row: it is named, not hidden.
        Assert.Contains(today.AddDays(-1), p.MissingWeatherDays);
    }

    // AF-05 ---------------------------------------------------------------------------------

    [Theory]
    [InlineData(60, 5, 60, false)]
    [InlineData(300, 5, 300, false)]
    [InlineData(301, 5, 300, true)]
    [InlineData(1200, 5, 300, true)]
    [InlineData(1200, 0, 300, true)]   // an out-of-range stored maximum reads as the default 5
    [InlineData(7200, 120, 7200, false)]
    public void Every_run_is_capped_at_the_zones_maximum(int requested, int max, int seconds, bool capped)
    {
        var cap = IrrigationRunRules.Cap(requested, max);
        Assert.Equal(seconds, cap.Seconds);
        Assert.Equal(capped, cap.Capped);
        Assert.Equal(requested, cap.RequestedSeconds);
        if (capped) Assert.Equal($"Capped to {seconds / 60} min (this zone's limit)", cap.Message);
        else Assert.Null(cap.Message);
        Assert.Equal(5, IrrigationRunRules.EffectiveScheduleMinutes(20, 5));
        Assert.Equal(4, IrrigationRunRules.EffectiveScheduleMinutes(4, 5));
    }

    [Theory]
    [InlineData("start", "pending", 5, false, false, "request_sent")]
    [InlineData("start", "pending", 5, true, false, "waiting_for_kit")]
    [InlineData("start", "pending", 61, true, false, "no_response")]
    [InlineData("start", "executed", 30, true, false, "kit_confirmed_start")]
    [InlineData("start", "executed", 400, true, true, "finished")]
    [InlineData("stop", "pending", 5, true, false, "stop_requested")]
    [InlineData("stop", "pending", 90, true, false, "no_response")]
    [InlineData("stop", "executed", 10, true, false, "kit_confirmed_stop")]
    [InlineData("start", "failed", 9000, true, false, "failed")]
    public void A_command_is_only_confirmed_by_the_kit(string command, string status, int ageSeconds, bool published, bool finished, string phase)
    {
        var now = new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.Zero);
        var created = now.AddSeconds(-ageSeconds);
        Assert.Equal(phase, CommandPhase.Describe(command, status, created, published ? created.AddSeconds(1) : null,
            finished ? now : null, now));
        Assert.False(string.IsNullOrWhiteSpace(CommandPhase.Label(phase)));
    }

    // B3-01 ---------------------------------------------------------------------------------

    [Theory]
    [InlineData("Mafeking", "Mahikeng")]
    [InlineData("mafikeng", "Mahikeng")]
    [InlineData("Warmbaths", "Bela-Bela")]
    [InlineData("Sesobe", null)]
    public void The_town_search_also_tries_a_former_name_but_never_renames_the_farm(string typed, string? current)
    {
        Assert.Equal(current, LocationRules.AliasFor(typed));
        var queries = LocationRules.QueriesFor(typed).ToList();
        Assert.Equal(typed, queries[0]);   // what staff typed is always searched first
        if (current is not null) Assert.Contains(current, queries);
    }

    [Fact]
    public void Valid_coordinates_win_and_the_readable_name_is_what_staff_entered()
    {
        Assert.Equal("Sesobe", AgroFlow.Api.Endpoints.FarmerOnboardingEndpoints.ReadableLocation("Sesobe", "Sesobe", "North West", -25.0368, 26.4337));
        Assert.Equal("Sesobe, North West", AgroFlow.Api.Endpoints.FarmerOnboardingEndpoints.ReadableLocation("", "Sesobe", "North West", -25.0368, 26.4337));
        Assert.Equal("Coordinates: -25.0368, 26.4337", AgroFlow.Api.Endpoints.FarmerOnboardingEndpoints.ReadableLocation("", null, null, -25.0368, 26.4337));
    }

    // AF-06 ---------------------------------------------------------------------------------

    [Theory]
    [InlineData("borehole", null, null, null, "not_a_tank_farm", null)]
    [InlineData(null, null, null, null, "no_tank", "capacity")]
    [InlineData("tank", 2500.0, null, null, "level_unknown", "level")]
    [InlineData("tank", 2500.0, 1800.0, 0.0, "use_unknown", "daily_use")]
    [InlineData("tank", 2500.0, 1800.0, 150.0, "complete", null)]
    public void A_saved_tank_is_never_called_not_set_up(string? source, double? cap, double? left, double? perDay, string state, string? missing)
    {
        var view = TankSummary.Describe(source, cap, left, perDay);
        Assert.Equal(state, view.State);
        Assert.Equal(missing, view.Missing);
        if (cap is > 0) Assert.True(view.HasTank);
    }

    // Part B: the journey and commissioning --------------------------------------------------

    private static Journey.Facts F(bool agreed = false, bool pw = false, bool terms = false, int tasks = 0, DateTimeOffset? visit = null,
        bool inProgress = false, int zones = 1, int commissioned = 0, int legacy = 0, int kits = 0, int checksDone = 0) =>
        new(false, true, true, agreed, pw, terms, tasks, 0, visit, visit is null ? null : "Thabo", inProgress,
            zones, commissioned, legacy, kits, checksDone, (zones - legacy) * 5, null);

    [Fact]
    public void The_stage_moves_through_the_journey_from_the_facts()
    {
        Assert.Equal(Journey.Details, Journey.StageOf(F()));
        Assert.Equal(Journey.ServiceAgreed, Journey.StageOf(F(agreed: true)));
        Assert.Equal(Journey.ServiceAgreed, Journey.StageOf(F(agreed: true, pw: true)));          // terms not accepted yet
        Assert.Equal(Journey.AccountActive, Journey.StageOf(F(agreed: true, pw: true, terms: true, tasks: 3)));
        Assert.Equal(Journey.ReadyForInstallation, Journey.StageOf(F(agreed: true, pw: true, terms: true, tasks: 4)));
        Assert.Equal(Journey.VisitBooked, Journey.StageOf(F(agreed: true, pw: true, terms: true, tasks: 4, visit: DateTimeOffset.UtcNow.AddDays(2))));
        Assert.Equal(Journey.Installing, Journey.StageOf(F(tasks: 4, checksDone: 2)));
        Assert.Equal(Journey.Commissioned, Journey.StageOf(F(commissioned: 1, kits: 1)));
        // A farm that was already running before the journey is live, not sent back.
        Assert.Equal(Journey.Commissioned, Journey.StageOf(F(zones: 2, legacy: 2, kits: 1)));
        Assert.Equal(Journey.Details, Journey.StageOf(F(zones: 2, legacy: 2, kits: 0)));
    }

    [Fact]
    public void Where_you_are_now_names_who_acts_next_and_never_invents_a_date()
    {
        var ready = Journey.Describe(F(agreed: true, pw: true, terms: true, tasks: 4));
        Assert.Equal(Journey.Staff, ready.WhoActsNext);
        Assert.Null(ready.KnownDate);
        Assert.Equal("Waiting for booking", ready.DateLabel);
        var when = new DateTimeOffset(2026, 10, 30, 9, 0, 0, TimeSpan.FromHours(2));
        var booked = Journey.Describe(F(agreed: true, pw: true, terms: true, tasks: 4, visit: when));
        Assert.Equal(Journey.Installer, booked.WhoActsNext);
        Assert.Equal(when, booked.KnownDate);
        Assert.Contains("Thabo", booked.NextAction);
        // A gap behind the current stage is still listed.
        var early = Journey.Describe(F(visit: when));
        Assert.Contains(early.StillToDo, s => s.Contains("service"));
        Assert.Equal(Journey.Stages.Count, early.StageCount);
    }

    [Fact]
    public void A_zone_is_commissioned_by_four_things_and_only_then_offered_automatic()
    {
        var all = new Commissioning.ZoneFacts(true, true, true, true, false, true);
        Assert.True(Commissioning.IsCommissioned(all));   // the run limit is on the list but not one of the four
        Assert.False(Commissioning.IsCommissioned(all with { TestAcknowledged = false }));
        Assert.False(Commissioning.IsCommissioned(all with { HasDryReading = false }));
        Assert.False(Commissioning.IsCommissioned(all with { FlowRecordedAsMeasured = false }));
        Assert.True(Commissioning.OfferAutomatic("commissioned", null));
        Assert.False(Commissioning.OfferAutomatic("commissioned", "manual"));
        Assert.False(Commissioning.OfferAutomatic("legacy", null));
        Assert.NotNull(Commissioning.FarmerMayChooseMode("automatic", "pending"));
        Assert.Null(Commissioning.FarmerMayChooseMode("automatic", "legacy"));
        Assert.Null(Commissioning.FarmerMayChooseMode("manual", "pending"));
    }

    [Fact]
    public void The_draft_documents_are_served_with_their_version_and_marked_draft()
    {
        foreach (var d in AgroFlow.Api.Services.LegalDocuments.All)
        {
            var text = AgroFlow.Api.Services.LegalDocuments.Text(d);
            Assert.Contains("Draft – needs approval", text);
            Assert.Contains(d.Version, text);
        }
    }

    // AF-02: every advice code the server sends has a sentence in all three app dictionaries.
    [Fact]
    public void Every_advice_code_has_an_app_sentence_in_english_afrikaans_and_setswana()
    {
        var source = File.ReadAllText(Path.Combine(RepoRoot(), "backend", "AgroFlow.Domain", "Agronomy", "RuleBook", "TodayRules.cs"));
        var fixedCodes = System.Text.RegularExpressions.Regex.Matches(source, "\"((?:none|skip|kit|soon|setup)\\.[a-z_]+)\"")
            .Select(m => m.Groups[1].Value).Where(c => c != "setup.next").Distinct().ToList();
        var amounts = new[] { "minutes", "seconds", "litres", "per_m2", "mm", "usual" };
        var codes = fixedCodes.Concat(amounts.SelectMany(a => new[] { "water.now." + a, "water.reduced." + a })).ToList();
        Assert.True(codes.Count >= 25, string.Join(", ", codes));
        foreach (var lang in new[] { "en", "af", "tn" })
        {
            var dict = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "apps", "mobile", "src", "i18n", lang + ".json"))).RootElement.GetProperty("strings");
            foreach (var code in codes)
                Assert.True(dict.TryGetProperty("advice." + code, out var v) && v.GetString() is { Length: > 0 }, $"{lang}: advice.{code}");
            foreach (var field in new[] { "crop", "planting_date", "flow_rate", "area", "soil", "calibration", "kit" })
                Assert.True(dict.TryGetProperty("advice.setup." + field, out _), $"{lang}: advice.setup.{field}");
        }
    }
}
