#nullable enable
using System;

namespace AgroFlow.Business
{
    // The two non-irrigation device commands added with firmware v1.3.0, and
    // the liveness rule that decides whether sending one is worth anything.
    //
    // See migration 0030 for why they ride irrigation_commands rather than a
    // table of their own.
    public static class DeviceSetupCommands
    {
        // Open the board's setup page, KEEPING its saved WiFi. For reading
        // the kit's own diagnostics, or correcting something other than the
        // network.
        public const string OpenSetup = "open_setup";

        // Forget the saved WiFi and open the setup page. The board keeps its
        // farm, zone and device token, so the page asks for WiFi only - no
        // new enrollment code - and until a new network is saved the page
        // keeps reopening, including after a reboot.
        public const string ChangeWifi = "change_wifi";

        public static readonly string[] All = { OpenSetup, ChangeWifi };

        public static bool IsSetupCommand(string? command)
        {
            return command == OpenSetup || command == ChangeWifi;
        }

        // Neither takes a duration - there is nothing running for a length of
        // time. Enforced in the database too (0030), because this table has
        // three writers.
        public static bool TakesDuration(string? command)
        {
            return !IsSetupCommand(command);
        }

        // ---- The setup network the farmer has to join --------------------
        //
        // Both strings are derived from the device ID by the FIRMWARE, so
        // these two methods must stay in step with apName() and the portal
        // password in AgroFlowIrrigationNode.ino. They exist here so the app
        // and the admin dashboard can TELL the farmer what to look for
        // without a round trip to the board - which would be impossible
        // anyway, since by the time the network is up the board is off the
        // internet.

        // "AgroFlow-Setup-XXXX" where XXXX is the last 4 characters of the
        // device ID, uppercase.
        public static string SetupNetworkName(string? deviceId)
        {
            return "AgroFlow-Setup-" + LastCharacters(deviceId, 4);
        }

        // "AF-" plus the last 6 characters of the device ID, uppercase.
        // Printed on the kit label as well, because a farmer whose router
        // died cannot read it off the app either.
        public static string SetupNetworkPassword(string? deviceId)
        {
            return "AF-" + LastCharacters(deviceId, 6);
        }

        private static string LastCharacters(string? value, int count)
        {
            if (string.IsNullOrEmpty(value)) return new string('?', count);

            var upper = value!.Trim().ToUpperInvariant();

            return upper.Length <= count ? upper : upper.Substring(upper.Length - count);
        }
    }

    // Is the kit online right now?
    //
    // WHY FIVE MINUTES, AND WHY NOT DeviceMonitor:OfflineAfterMinutes
    // --------------------------------------------------------------
    // DeviceStatusMonitorService already has an offline threshold, and it
    // defaults to 30 minutes. That one answers a different question: "has
    // this kit been quiet long enough to be worth waking the farmer about?"
    // Thirty minutes is right for that, because a single missed reading or an
    // MQTT reconnect must not send a message.
    //
    // This one answers "is the board listening RIGHT NOW, so that a command
    // I publish will actually arrive?" A board reports every 30 seconds, so
    // five minutes is ten missed reports - comfortably past a blip, and short
    // enough that the answer is still true by the time the farmer taps the
    // button. Using 30 minutes here would accept a change-wifi for a kit that
    // has been unplugged for twenty minutes, publish into the void, and leave
    // the farmer waiting for a setup network that never appears.
    public static class DeviceLiveness
    {
        public static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(5);

        // lastReadingAt is the newest sensor_reading for the zone, or the
        // board's last_seen - whichever the caller has. Null means the board
        // has never reported, which is offline.
        public static bool IsOnline(DateTimeOffset? lastReadingAt, DateTimeOffset now)
        {
            if (!lastReadingAt.HasValue) return false;

            var age = now - lastReadingAt.Value;

            // A reading timestamped slightly in the future is clock skew
            // between Postgres and this process, not a board that has gone
            // quiet.
            if (age < TimeSpan.Zero) return true;

            return age <= OnlineWindow;
        }

        // What the farmer is told when they ask for a WiFi change on a kit
        // that is not listening. Returned as the 409 body, and shown on the
        // Kit screen.
        //
        // The three-power-cycles instruction is the whole point of the
        // message: it is the one route back into a board that cannot be
        // reached over the network, and it needs no app, no admin and no
        // internet.
        public const string OfflineMessage =
            "Your kit is offline. Unplug and replug it 3 times quickly to open its setup network.";

        // The follow-up shown underneath, for the specific case that caused
        // this: the farmer changed their router, so the board will never come
        // back on its own WiFi and is already counting down to opening its
        // setup page unaided.
        public const string OfflineRouterChangedHint =
            "If your router changed, your kit opens its setup network by itself after 15 minutes.";
    }

    // Who may acknowledge a command.
    //
    // THE HOLE THIS CLOSES
    // --------------------
    // POST /api/devices/commands/{id}/executed used to read a deviceId out of
    // the REQUEST BODY and compare it to the zone's hardware row. That check
    // was only ever as strong as the shared X-Api-Key behind it: any board
    // holding the fleet key could claim to be any other board.
    //
    // It matters more than it looks. Marking a command executed is what stops
    // the replay sweep redelivering it (see CommandReplayPolicy). A forged ACK
    // therefore suppresses redelivery of a pump run that never physically
    // happened - the farmer's zone reads as watered and was not.
    //
    // On a token-authenticated call both sides of this comparison are now
    // server-derived: the expected device comes from the command's zone, and
    // the caller's device comes from the credential.
    public static class DeviceCommandOwnership
    {
        // expectedDeviceId: the device on the command's zone, or null when
        // that zone has no active claimed device.
        // callerDeviceId: resolved from the caller's token.
        public static bool MayAcknowledge(string? expectedDeviceId, string? callerDeviceId)
        {
            if (string.IsNullOrWhiteSpace(expectedDeviceId)) return false;
            if (string.IsNullOrWhiteSpace(callerDeviceId)) return false;

            // Case-insensitive: device_id is stored uppercased by the claim
            // path, but the firmware's own getDeviceId() and a hand-entered
            // admin value have both been seen in other cases, and a casing
            // difference is not a different board.
            return string.Equals(expectedDeviceId, callerDeviceId, StringComparison.OrdinalIgnoreCase);
        }
    }
}
