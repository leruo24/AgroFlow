using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace AgroFlow.Domain.Tests;

// Step 10: "A Telegram failure doesn't fail the request."
//
// WHY THIS IS A REAL TEST AND NOT A FORMALITY
// -------------------------------------------
// This project has already been bitten by exactly this. The removed Resend
// email service threw on a failed send, and because the send sat inside
// farmer onboarding's try block, an EMAIL OUTAGE ROLLED BACK A COMPLETED
// ON-SITE ONBOARDING - an engineer standing on a farm, finished, and the work
// undone by a third party being down. The note on INotificationService
// records it as the contract every implementation must honour.
//
// FarmRequestNotifier is where that contract could be broken again, because
// unlike the notification services it also talks to Postgres: the send-once
// claim in migration 0032 is a database write, and a database write can throw
// on a path that INotificationService's "never throws" promise does not
// cover.
//
// So this exercises the real object with everything around it broken at once:
// an unreachable database AND a notification service that throws on every
// call. NotifyAsync must still return normally.
public class FarmRequestNotifierResilienceTests
{
    // Port 1 with a one-second timeout: nothing listens there, so every
    // command fails fast rather than making the suite wait.
    private static NpgsqlDataSource UnreachableDatabase() =>
        NpgsqlDataSource.Create(
            "Host=127.0.0.1;Port=1;Database=nope;Username=nope;Password=nope;" +
            "Timeout=1;Command Timeout=1");

    // Throws on every method, which is precisely what an implementation is
    // forbidden from doing - so if any of this leaks, the test fails.
    private sealed class ThrowingNotificationService : INotificationService
    {
        public Task NotifyFarmerWelcomeAsync(
            Guid profileId, FarmerWelcomeNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyPasswordResetAsync(
            Guid profileId, string temporaryPassword, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyZoneCriticalAsync(
            long zoneId, float moisture, ZoneCriticalReason reason, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyWeatherAsync(
            long farmId, WeatherAlertNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifySystemFailureAsync(
            long farmId, SystemFailureNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyRequestStatusAsync(
            Guid profileId, RequestStatusNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyFarmRequestAsync(
            Guid profileId, FarmRequestNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");

        public Task NotifyAdminsOfFarmRequestAsync(
            FarmRequestAdminNotification notification, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Telegram is down.");
    }

    private static FarmRequestNotifier Build(NpgsqlDataSource dataSource) =>
        new(dataSource,
            new ThrowingNotificationService(),
            NullLogger<FarmRequestNotifier>.Instance);

    [Fact]
    public async Task AnUnreachableDatabaseAndADeadTelegram_DoNotThrow()
    {
        await using var dataSource = UnreachableDatabase();
        var notifier = Build(dataSource);

        // The assertion IS that this returns. A throw here would, in
        // production, be a submitted farm request rejected because a message
        // could not be sent.
        await notifier.NotifyAsync(requestId: 1);
    }

    [Fact]
    public async Task ItIsSafeToCallRepeatedly_AsTheAdminStatusPathDoes()
    {
        await using var dataSource = UnreachableDatabase();
        var notifier = Build(dataSource);

        for (var i = 0; i < 3; i++)
        {
            await notifier.NotifyAsync(requestId: 42);
        }
    }

    // A cancelled request must not surface as an unhandled exception out of
    // the notifier either - the farmer's HTTP request has gone, and the row
    // is already committed.
    [Fact]
    public async Task ACancelledTokenDoesNotEscapeAsAFailure()
    {
        await using var dataSource = UnreachableDatabase();
        var notifier = Build(dataSource);

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        try
        {
            await notifier.NotifyAsync(requestId: 7, cts.Token);
        }
        catch (OperationCanceledException)
        {
            // Acceptable: cancellation is the caller's own signal, not a
            // notification failure, and ASP.NET treats it as a client
            // disconnect rather than a 500. What must never happen is a
            // DIFFERENT exception type escaping, which this catch does not
            // swallow.
        }
    }

    // Guards the contract itself. If a method is ever added to
    // INotificationService without FarmRequestNotifier being considered, this
    // file stops compiling - which is the earliest possible warning.
    [Fact]
    public void TheThrowingDoubleStillSatisfiesTheInterface()
    {
        Assert.IsAssignableFrom<INotificationService>(new ThrowingNotificationService());
    }
}
