using System;
using System.Text.Json;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The live web retest of 23 October 2026 (docs/audit/AgroFlow-Web-Journey-Retest-2026-10-23.pdf):
// RET-02 (no acceptance of a draft), RET-06 (the confidence reason as a message code) and RET-10
// (account, details and installation apart), as rules without a database.
public class RetestLogicTests
{
    private static Journey.Facts F(bool account = true, bool pw = true, bool terms = false, bool termsRequired = true, int tasks = 0) =>
        new(false, true, account, true, pw, terms, tasks, 0, null, null, false, 1, 0, 0, 0, 0, 5, null, termsRequired);

    [Fact]
    public void RET02_while_acceptance_is_off_the_terms_are_not_part_of_an_active_account()
    {
        Assert.False(Journey.AccountActiveNow(F(terms: false, termsRequired: true)));
        Assert.True(Journey.AccountActiveNow(F(terms: false, termsRequired: false)));
        Assert.Equal(Journey.AccountActive, Journey.StageOf(F(termsRequired: false)));
        // The farmer is not told to accept anything while it is off.
        var next = Journey.Describe(F(pw: false, termsRequired: false)).NextAction;
        Assert.DoesNotContain("terms", next);
    }

    [Fact]
    public void RET02_a_draft_is_never_open_for_acceptance_whatever_the_setting()
    {
        Assert.True(LegalDocuments.AnyDraft);   // 0.1-draft today
        Assert.False(LegalDocuments.AcceptanceOpen(settingOn: false));
        Assert.False(LegalDocuments.AcceptanceOpen(settingOn: true));
    }

    [Theory]
    [InlineData("true", null)]
    [InlineData("false", null)]
    [InlineData("1", "Use true (on) or false (off).")]
    [InlineData("\"yes\"", "Use true (on) or false (off).")]
    public void RET02_the_setting_is_true_or_false(string json, string? problem)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(problem, AppSettingsStore.Validate(AppSettingsStore.TermsAcceptanceKey, doc.RootElement));
    }

    [Fact]
    public void RET10_the_account_has_its_own_status()
    {
        Assert.Equal("not_created", Journey.AccountStatus(F(account: false)));
        Assert.Equal("needs_password", Journey.AccountStatus(F(pw: false)));
        Assert.Equal("needs_terms", Journey.AccountStatus(F(terms: false, termsRequired: true)));
        Assert.Equal("active", Journey.AccountStatus(F(terms: false, termsRequired: false)));
        Assert.Equal("active", Journey.AccountStatus(F(terms: true, termsRequired: true)));
    }

    [Theory]
    [InlineData(Journey.Enquiry, "not_booked")]
    [InlineData(Journey.Details, "not_booked")]
    [InlineData(Journey.ServiceAgreed, "not_booked")]
    [InlineData(Journey.AccountActive, "not_booked")]   // the retest's "Installation: account active"
    [InlineData(Journey.ReadyForInstallation, "waiting_for_booking")]
    [InlineData(Journey.VisitBooked, "visit_booked")]
    [InlineData(Journey.Installing, "installing")]
    [InlineData(Journey.Commissioned, "commissioned")]
    public void RET10_the_installation_never_shows_an_account_stage(string stage, string status)
    {
        Assert.Equal(status, Journey.InstallationStatus(stage));
    }

    [Fact]
    public void RET06_every_confidence_reason_has_a_message_code_and_its_args()
    {
        Assert.Equal("no_crop", ConfidenceRules.For(new ZoneSetupState { WeatherAvailable = true }).Code);
        Assert.Equal("no_weather", ConfidenceRules.For(new ZoneSetupState { CropKnown = true }).Code);

        var all = new ZoneSetupState { CropKnown = true, PlantingDateKnown = true, SoilSet = true, AreaSet = true, FlowRateSet = true,
            Calibrated = true, HasKit = true, ReadingFresh = true, WeatherAvailable = true };
        Assert.Equal("all_agree", ConfidenceRules.For(all).Code);

        all.ReadingFresh = false;
        all.LastReadingAtUtc = new DateTime(2026, 9, 17, 6, 0, 0, DateTimeKind.Utc);
        var quiet = ConfidenceRules.For(all);
        Assert.Equal("partial", quiet.Code);
        Assert.Equal("weather", quiet.Args["basis"]);
        Assert.Equal("kit_quiet", quiet.Args["because"]);
        Assert.Equal("17 Sep", quiet.Args["date"]);

        all.LastReadingAtUtc = null;
        Assert.Equal("kit_never", ConfidenceRules.For(all).Args["because"]);

        var noKit = new ZoneSetupState { CropKnown = true, PlantingDateKnown = true, SoilSet = true, AreaSet = true, FlowRateSet = true,
            Calibrated = true, WeatherAvailable = true };
        Assert.Equal("no_readings", ConfidenceRules.For(noKit).Args["because"]);

        var missingDate = new ZoneSetupState { CropKnown = true, WeatherAvailable = true, ManualCheckFresh = true };
        var c = ConfidenceRules.For(missingDate);
        Assert.Equal("own_check", c.Args["basis"]);
        Assert.Equal("planting_date", c.Args["because"]);
        // The English stays as it was, for staff and the reports.
        Assert.StartsWith("Low: based on the weather and your own soil check; the planting date is missing", c.Reason);
    }
}
