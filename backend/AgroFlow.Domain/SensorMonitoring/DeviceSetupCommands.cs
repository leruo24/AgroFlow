#nullable enable
using System;

namespace AgroFlow.Business
{
    // The two non-irrigation device commands, and the liveness rule that decides whether
    // sending one is worth it. Migration 0030 explains why they use irrigation_commands.
    public static class DeviceSetupCommands
    {
        // Open the board's setup page and keep its saved WiFi, for reading the kit's
        // diagnostics or fixing something other than the network.
        public const string OpenSetup = "open_setup";

        // Forget the saved WiFi and open the setup page. The board keeps its farm, zone and
        // device token, so the page only asks for WiFi (no new enrollment code), and it keeps
        // reopening until a new network is saved, even after a reboot.
        public const string ChangeWifi = "change_wifi";

        public static readonly string[] All = { OpenSetup, ChangeWifi };

        public static bool IsSetupCommand(string? command)
        {
            return command == OpenSetup || command == ChangeWifi;
        }

        // Neither takes a duration. The database enforces this too (0030), because this
        // table has three writers.
        public static bool TakesDuration(string? command)
        {
            return !IsSetupCommand(command);
        }

        // The setup network the farmer has to join.
        // The firmware builds both strings from the device ID, so these must match apName()
        // and the portal password in AgroFlowIrrigationNode.ino. They are here so the app
        // and dashboard can tell the farmer what to look for; by the time the network is up
        // the board is offline anyway.

        // "AgroFlow-Setup-XXXX" where XXXX is the last 4 characters of the
        // device ID, uppercase.
        public static string SetupNetworkName(string? deviceId)
        {
            return "AgroFlow-Setup-" + LastCharacters(deviceId, 4);
        }

        // "AF-" plus the last 6 characters of the device ID, uppercase. Also printed on the
        // kit label, for a farmer whose router died and cannot use the app.
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
    // Five minutes, not DeviceMonitor:OfflineAfterMinutes (30): that one decides when a
    // quiet kit is worth messaging the farmer about. This one asks whether a command we
    // publish now will arrive. Boards report every 30 seconds, so five minutes is ten
    // missed reports. With 30 minutes we could accept a change-wifi for a kit unplugged
    // 20 minutes ago and leave the farmer waiting for a setup network that never appears.
    public static class DeviceLiveness
    {
        public static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(5);

        // lastReadingAt is the zone's newest sensor_reading or the board's last_seen. Null
        // means it has never reported, so it is offline.
        public static bool IsOnline(DateTimeOffset? lastReadingAt, DateTimeOffset now)
        {
            if (!lastReadingAt.HasValue) return false;

            var age = now - lastReadingAt.Value;

            // A reading slightly in the future is clock skew between Postgres and this process,
            // not a quiet board.
            if (age < TimeSpan.Zero) return true;

            return age <= OnlineWindow;
        }

        // What the farmer sees when they ask for a WiFi change on a kit that is not
        // listening (the 409 body, shown on the Kit screen). The key part is "power-cycle
        // three times", which reopens setup with no app, admin or internet.
        public const string OfflineMessage =
            "Your kit is offline. Unplug and replug it 3 times quickly to open its setup network.";

        // The follow-up line underneath, for the usual cause: the farmer changed their router,
        // so the board will not come back on its own and is already counting down to open
        // its setup page.
        public const string OfflineRouterChangedHint =
            "If your router changed, your kit opens its setup network by itself after 15 minutes.";
    }

    // Security: who may confirm a command.
    // On a token call both sides come from the server: the expected device from the
    // command's zone, the caller from its credential. A body deviceId could be faked by
    // any board with the shared key, and marking a command executed stops the replay
    // sweep (see CommandReplayPolicy), so a forged ACK would hide a run that never happened.
    public static class DeviceCommandOwnership
    {
        // expectedDeviceId: the device on the command's zone, or null when the zone has no
        // active device. callerDeviceId: from the caller's token.
        public static bool MayAcknowledge(string? expectedDeviceId, string? callerDeviceId)
        {
            if (string.IsNullOrWhiteSpace(expectedDeviceId)) return false;
            if (string.IsNullOrWhiteSpace(callerDeviceId)) return false;

            // Case-insensitive: the claim path stores device_id uppercase, but other cases have
            // been seen, and a different case is not a different board.
            return string.Equals(expectedDeviceId, callerDeviceId, StringComparison.OrdinalIgnoreCase);
        }
    }
}
