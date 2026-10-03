using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 7 / step 10: "Each Telegram message sends once per request per status."
//
// The send-once guarantee has two halves. The database half is the unique
// index in migration 0032. The half that can be tested here is the KEY: if
// two different events produced the same key, the ledger would suppress a
// message that should have been sent, and if the same event produced two keys
// it would send twice. Both are silent failures, which is why they are
// pinned.
public class FarmRequestMessagesTests
{
    // ---- The copy ----------------------------------------------------------
    //
    // Pinned because these are the words a farmer reads on a phone, in a
    // field. A copy edit should have to come through here.

    [Fact]
    public void TheSubmittedMessageNamesTheKindAndThePlace_AndSaysAKitIsComing()
    {
        var message = FarmRequestMessages.Submitted("new_zone", "Stellenbosch");

        Assert.Equal(
            "🌱 AgroFlow: we've received your request for a new zone at Stellenbosch. " +
            "A hardware kit is on the way - we'll message you when your installation is booked.",
            message);
    }

    [Fact]
    public void ANewFarmRequest_SaysFarmAndNotZone()
    {
        Assert.Contains("a new farm at", FarmRequestMessages.Submitted("new_farm", "Paarl"));
    }

    [Fact]
    public void TheScheduledMessageSaysTheKitIsBooked()
    {
        Assert.Equal(
            "📦 AgroFlow: your hardware kit is booked for installation. Our team will see you then.",
            FarmRequestMessages.Scheduled(null));
    }

    // service_request (0021) has NO date column, so this clause never
    // appears today. Tested so that adding one later is a change here and
    // nowhere else.
    [Fact]
    public void AScheduledDate_IsNamedWhenThereIsOne()
    {
        var message = FarmRequestMessages.Scheduled(new DateOnly(2026, 11, 14));

        Assert.Contains("installation on 14 November 2026.", message);
    }

    [Fact]
    public void TheCompletedMessagePointsTheFarmerAtTheApp()
    {
        Assert.Equal(
            "✅ AgroFlow: your new zone is set up. Open the app to see it.",
            FarmRequestMessages.Completed("new_zone"));
    }

    [Fact]
    public void TheAdminNoticeNamesTheFarmerAndThePlace()
    {
        Assert.Equal(
            "New farm request from Thandi Mokoena at Paarl.",
            FarmRequestMessages.AdminSubmitted("Thandi Mokoena", "new_farm", "Paarl"));
    }

    // A new_zone request carries no location of its own, and the farm's may
    // be blank too. The sentence must still read, with no gap in it.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AMissingLocation_FallsBackRatherThanLeavingAGap(string? location)
    {
        var message = FarmRequestMessages.Submitted("new_zone", location);

        Assert.Contains("at your farm.", message);
        Assert.DoesNotContain(" at .", message);
    }

    [Fact]
    public void AMissingFarmerName_StillReadsAsASentence()
    {
        Assert.Equal(
            "New zone request from a farmer at Worcester.",
            FarmRequestMessages.AdminSubmitted(null, "new_zone", "Worcester"));
    }

    [Fact]
    public void SurroundingWhitespaceIsTrimmedFromThePlace()
    {
        Assert.Contains("at Ceres.", FarmRequestMessages.Submitted("new_farm", "  Ceres  "));
    }

    // ---- Which status sends what ------------------------------------------

    [Theory]
    [InlineData("pending", FarmRequestStage.Submitted)]
    [InlineData("scheduled", FarmRequestStage.Scheduled)]
    [InlineData("completed", FarmRequestStage.Completed)]
    public void TheThreeStatuses0021AllowsEachMapToAMessage(string status, FarmRequestStage expected)
    {
        Assert.Equal(expected, FarmRequestMessages.StageFor(status));
    }

    [Theory]
    [InlineData("PENDING")]
    [InlineData("Scheduled")]
    [InlineData("  completed  ")]
    public void CasingAndWhitespaceDoNotChangeTheStage(string status)
    {
        Assert.NotNull(FarmRequestMessages.StageFor(status));
    }

    // Anything the admin dashboard might send that is not one of the three.
    // Null means "say nothing", which is the right answer - the farmer does
    // not need to hear about a status with no meaning to them.
    [Theory]
    [InlineData("rejected")]
    [InlineData("on_the_way")]
    [InlineData("")]
    [InlineData(null)]
    public void AnythingElseSendsNothing(string? status)
    {
        Assert.Null(FarmRequestMessages.StageFor(status));
    }

    // ---- The send-once keys ------------------------------------------------

    [Fact]
    public void EachStatusOfOneRequest_GetsItsOwnKey()
    {
        var keys = new[]
        {
            FarmRequestMessages.FarmerLedgerKey(7, "pending"),
            FarmRequestMessages.FarmerLedgerKey(7, "scheduled"),
            FarmRequestMessages.FarmerLedgerKey(7, "completed"),
        };

        Assert.Equal(3, keys.Distinct().Count());
    }

    // Two open requests on one farm are two events, each needing its own
    // three messages.
    [Fact]
    public void TwoRequestsAtTheSameStatus_GetDifferentKeys()
    {
        Assert.NotEqual(
            FarmRequestMessages.FarmerLedgerKey(7, "scheduled"),
            FarmRequestMessages.FarmerLedgerKey(8, "scheduled"));
    }

    // The farmer's message and the admin's notice are different messages
    // about the same event, so claiming one must not suppress the other.
    [Fact]
    public void TheFarmerAndAdminKeysNeverCollide()
    {
        Assert.NotEqual(
            FarmRequestMessages.FarmerLedgerKey(7, "pending"),
            FarmRequestMessages.AdminLedgerKey(7, "pending"));
    }

    // THE DUPLICATE CASE: an admin sets Scheduled, changes their mind, sets
    // it back, and forwards again. The second attempt must produce the SAME
    // key, so the ledger recognises it and the farmer is not told twice.
    [Fact]
    public void TheSameStatusTwice_ProducesTheSameKey_SoTheLedgerCatchesIt()
    {
        Assert.Equal(
            FarmRequestMessages.FarmerLedgerKey(7, "scheduled"),
            FarmRequestMessages.FarmerLedgerKey(7, "Scheduled "));
    }

    // Keys from differently-cased statuses must not diverge, or one event
    // would be claimed twice under two names and send twice.
    [Fact]
    public void CasingDoesNotCreateASecondKeyForTheSameEvent()
    {
        var keys = new[] { "pending", "PENDING", "Pending", " pending " }
            .Select(s => FarmRequestMessages.FarmerLedgerKey(7, s))
            .Distinct();

        Assert.Single(keys);
    }
}

// The webhook's only gate. A forged "/start <code>" would attach the caller's
// own chat to a farmer's account, so this is the check that matters on that
// route.
public class TelegramWebhookAuthTests
{
    private const string Secret = "a-long-random-webhook-secret-value";

    [Fact]
    public void TheRightSecret_IsAccepted()
    {
        Assert.True(TelegramWebhookAuth.IsAuthorised(Secret, Secret));
    }

    // Step 10: "a bad webhook secret gets 401."
    [Theory]
    [InlineData("wrong")]
    [InlineData("a-long-random-webhook-secret-valuX")]
    [InlineData("A-LONG-RANDOM-WEBHOOK-SECRET-VALUE")]
    public void AWrongSecret_IsRefused(string presented)
    {
        Assert.False(TelegramWebhookAuth.IsAuthorised(presented, Secret));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AMissingHeader_IsRefused(string? presented)
    {
        Assert.False(TelegramWebhookAuth.IsAuthorised(presented, Secret));
    }

    // FAIL CLOSED. An unset Telegram:WebhookSecret must refuse everything:
    // failing open would turn a missing Railway variable into an open
    // account-linking endpoint, which is far worse than a webhook that
    // visibly does not work.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnUnconfiguredSecret_RefusesEverything(string? configured)
    {
        Assert.False(TelegramWebhookAuth.IsAuthorised("anything", configured));
        Assert.False(TelegramWebhookAuth.IsAuthorised(null, configured));
    }

    // A trailing newline on a pasted Railway variable must not break the
    // webhook - the same trimming the bot token and username already get.
    [Fact]
    public void ATrailingNewlineOnTheConfiguredSecret_IsTolerated()
    {
        Assert.True(TelegramWebhookAuth.IsAuthorised(Secret, Secret + "\n"));
    }

    // The presented header is NOT trimmed: Telegram sends back exactly what
    // was registered, so whitespace in it means it is not the same secret.
    [Fact]
    public void WhitespaceInThePresentedHeader_IsNotIgnored()
    {
        Assert.False(TelegramWebhookAuth.IsAuthorised(" " + Secret, Secret));
    }

    [Fact]
    public void TheHeaderNameIsTheOneTelegramSends()
    {
        Assert.Equal("X-Telegram-Bot-Api-Secret-Token", TelegramWebhookAuth.HeaderName);
    }
}
