#nullable enable
using System;

namespace AgroFlow.Business
{
    // When a kit could not reach the server it keeps its readings (firmware v1.5.0,
    // OfflineBuffer.h) and sends them later with "recordedAt". This rule decides what a
    // reading may still do, from how old it is when it arrives.
    //
    //   Live     - no recordedAt, or taken within MaxLiveAge: stored, and it may update
    //              the zone's health and start or stop automatic watering as before.
    //   Late     - older than MaxLiveAge: stored with its own time (history, charts and
    //              the water balance use it), but it never changes the health status,
    //              raises an alert or sends a pump command. The soil may be quite
    //              different by now; acting on an old dry reading could flood a zone.
    //   Rejected - from too far back (MaxBackfillAge) or too far in the future (a kit
    //              with a wrong clock): not stored at all.
    //
    // Safety: the only path to a pump command is Live, and Live needs a fresh reading.
    public enum ReadingTiming
    {
        Live,
        Late,
        Rejected,
    }

    public static class ReadingAge
    {
        // A kit reports every 30 s, so 10 minutes is many missed reports: whatever the
        // reading says, it is not the soil right now.
        public static readonly TimeSpan MaxLiveAge = TimeSpan.FromMinutes(10);

        // The current ring holds about 30 minutes. A week also covers older firmware
        // and is how far back a farmer can log by hand (ManualLogEndpoints).
        public static readonly TimeSpan MaxBackfillAge = TimeSpan.FromDays(7);

        // Clocks drift; a kit a minute or two ahead is still a live reading.
        public static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

        public static ReadingTiming Classify(DateTimeOffset? recordedAt, DateTimeOffset receivedAt)
        {
            if (recordedAt is null) return ReadingTiming.Live;

            var age = receivedAt - recordedAt.Value;
            if (age < -MaxClockSkew) return ReadingTiming.Rejected;   // in the future
            if (age <= MaxLiveAge) return ReadingTiming.Live;
            if (age <= MaxBackfillAge) return ReadingTiming.Late;
            return ReadingTiming.Rejected;
        }

        // The time to store: the kit's own when it gave one (never later than arrival, so a
        // clock slightly ahead does not put a reading in the future), else arrival.
        public static DateTimeOffset StoredTime(DateTimeOffset? recordedAt, DateTimeOffset receivedAt) =>
            recordedAt is { } at && at < receivedAt ? at : receivedAt;

        // Only a live reading may change health, alerts or the pump.
        public static bool MayDriveLiveDecisions(ReadingTiming timing) => timing == ReadingTiming.Live;
    }
}
