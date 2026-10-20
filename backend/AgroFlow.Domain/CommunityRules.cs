#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business
{
    // Community alerts (docs/drought-community.md, Part 2): farmers warn nearby farms about
    // pests, disease, fire, water problems and severe weather. Reports are from other farmers
    // and are never verified by AgroFlow; every message says so. A report's place is the
    // reporting farm's saved location (set by staff), rounded to about 1 km; the phone is never
    // tracked and the reporter is never named.

    public static class CommunityCategories
    {
        public static readonly IReadOnlyDictionary<string, string[]> Subtypes = new Dictionary<string, string[]>
        {
            ["pest"] = new[] { "locusts", "fall_armyworm", "aphids", "unusual_insects" },
            ["disease"] = new[] { "suspected_crop_disease" },
            ["fire"] = new[] { "veld_fire", "smoke_nearby" },
            ["water"] = new[] { "canal_not_flowing", "borehole_dry", "low_water", "burst_pipe", "possible_contamination" },
            ["weather"] = new[] { "hail", "flooding", "frost", "extreme_wind", "very_heavy_rain" },
        };

        public static readonly IReadOnlyList<string> Severities = new[] { "low", "moderate", "high" };

        public static string Label(string subtype) => subtype switch
        {
            "locusts" => "Locusts",
            "fall_armyworm" => "Fall armyworm",
            "aphids" => "Aphids",
            "unusual_insects" => "Unusual insects",
            "suspected_crop_disease" => "Suspected crop disease",
            "veld_fire" => "Veld fire",
            "smoke_nearby" => "Smoke nearby",
            "canal_not_flowing" => "Canal not flowing",
            "borehole_dry" => "Borehole dry",
            "low_water" => "Low water",
            "burst_pipe" => "Burst pipe",
            "possible_contamination" => "Possible water contamination",
            "hail" => "Hail",
            "flooding" => "Flooding",
            "frost" => "Frost",
            "extreme_wind" => "Extreme wind",
            "very_heavy_rain" => "Very heavy rain",
            _ => subtype,
        };

        public static string? Validate(string? category, string? subtype, string? severity, string? description)
        {
            if (category is null || !Subtypes.TryGetValue(category, out var allowed)) return "Choose what you are reporting.";
            if (subtype is null || !allowed.Contains(subtype)) return "Choose what you are seeing.";
            if (severity is null || !Severities.Contains(severity)) return "Choose how serious it is: low, moderate or high.";
            if (description is { Length: > 280 }) return "Keep the description under 280 characters.";
            return null;
        }
    }

    // The settings behind community alerts (app_setting rows, migration 0054).
    public sealed record CommunitySettings(
        int ReportLimit,
        int ReportWindowHours,
        IReadOnlyDictionary<string, double> RadiusKm,
        IReadOnlyDictionary<string, int> ExpiryHours,
        int GroupHours,
        double FireDownwindFactor,
        double FireConeDegrees,
        int FireEscalateConfirmations,
        double FireEscalateFactor,
        string EmergencyText)
    {
        public static readonly CommunitySettings Defaults = new(
            2, 36,
            new Dictionary<string, double> { ["pest"] = 50, ["disease"] = 25, ["fire"] = 50, ["water"] = 20, ["weather"] = 30 },
            new Dictionary<string, int> { ["pest"] = 168, ["disease"] = 168, ["fire"] = 48, ["water"] = 72, ["weather"] = 24 },
            48, 1.5, 45, 3, 1.5, "your local emergency number (112 from a mobile phone)");
    }

    public static class CommunityRules
    {
        public const string Unverified = "This is a community report and has not been independently verified.";

        // Max ReportLimit new reports per farmer in any rolling ReportWindowHours. Confirming
        // someone else's report and updating your own do not count (they are other tables).
        // Returns null when allowed, otherwise when the next report is allowed.
        public static DateTimeOffset? NextAllowedAt(IEnumerable<DateTimeOffset> myReportTimes, DateTimeOffset now, CommunitySettings s)
        {
            var window = TimeSpan.FromHours(s.ReportWindowHours);
            var recent = myReportTimes.Where(t => t > now - window).OrderBy(t => t).ToList();
            if (recent.Count < s.ReportLimit) return null;
            // The oldest report in the window has to leave it before another is allowed.
            return recent[recent.Count - s.ReportLimit] + window;
        }

        public static string LimitMessage(DateTimeOffset? nextAllowed, CommunitySettings s, TimeSpan sastOffset)
        {
            var rule = $"You can add up to {s.ReportLimit} reports every {s.ReportWindowHours} hours.";
            if (nextAllowed is not { } at) return rule;
            var local = at.ToOffset(sastOffset);
            return $"{rule} You can add another after {local.ToString("dddd d MMMM, HH:mm", CultureInfo.InvariantCulture)}.";
        }

        // About 1 km: 2 decimal places of a degree (0.01 degree of latitude is about 1.1 km).
        public static double Round(double coordinate) => Math.Round(coordinate, 2, MidpointRounding.AwayFromZero);

        // Great-circle distance (haversine), mean Earth radius 6371 km.
        public static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
        {
            const double R = 6371.0;
            double Rad(double d) => d * Math.PI / 180.0;
            var dLat = Rad(lat2 - lat1);
            var dLon = Rad(lon2 - lon1);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                    Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
            return 2 * R * Math.Asin(Math.Min(1, Math.Sqrt(a)));
        }

        // Initial compass bearing from point 1 to point 2, degrees 0-360 (0 = north, 90 = east).
        public static double BearingDeg(double lat1, double lon1, double lat2, double lon2)
        {
            double Rad(double d) => d * Math.PI / 180.0;
            var y = Math.Sin(Rad(lon2 - lon1)) * Math.Cos(Rad(lat2));
            var x = Math.Cos(Rad(lat1)) * Math.Sin(Rad(lat2)) - Math.Sin(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Cos(Rad(lon2 - lon1));
            return (Math.Atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
        }

        public static double AngleBetween(double a, double b)
        {
            var d = Math.Abs(a - b) % 360.0;
            return d > 180 ? 360 - d : d;
        }

        public static string DistanceText(double km) =>
            km < 1.5 ? "about 1 km from your farm" : $"about {Math.Round(km):0} km from your farm";

        public static string Compass(double deg)
        {
            var names = new[] { "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west" };
            return names[(int)Math.Round(((deg % 360) + 360) % 360 / 45.0) % 8];
        }

        public static double RadiusFor(string category, bool escalated, CommunitySettings s)
        {
            var r = s.RadiusKm.TryGetValue(category, out var v) ? v : 25;
            return category == "fire" && escalated ? r * s.FireEscalateFactor : r;
        }

        public static DateTimeOffset ExpiresAt(string category, DateTimeOffset created, CommunitySettings s) =>
            created + TimeSpan.FromHours(s.ExpiryHours.TryGetValue(category, out var h) ? h : 48);

        public static bool Escalates(int confirmations, CommunitySettings s) => confirmations >= s.FireEscalateConfirmations;
    }

    // A farm that may hear about a report.
    public sealed record FarmPoint(long FarmId, double Latitude, double Longitude, bool OptedIn);

    public sealed record CommunityTarget(long FarmId, double DistanceKm, bool Downwind);

    public static class CommunityMatching
    {
        // Who hears about a report: opted-in farms within its radius, except the reporter's own
        // farm. For a fire with a known wind, farms downwind (inside the +/- cone around where
        // the wind blows TO, within downwind factor x radius) are included even beyond the
        // radius and are marked first. Wind direction is where the wind comes FROM
        // (meteorological, as Open-Meteo reports it), so it blows towards from + 180.
        public static IReadOnlyList<CommunityTarget> Targets(
            string category, double reportLat, double reportLon, long? reporterFarmId, bool escalated,
            double? windFromDeg, IEnumerable<FarmPoint> farms, CommunitySettings s)
        {
            var radius = CommunityRules.RadiusFor(category, escalated, s);
            var result = new List<CommunityTarget>();
            foreach (var f in farms)
            {
                if (!f.OptedIn || f.FarmId == reporterFarmId) continue;
                var d = CommunityRules.DistanceKm(reportLat, reportLon, f.Latitude, f.Longitude);
                var downwind = false;
                if (category == "fire" && windFromDeg is { } from && d <= radius * s.FireDownwindFactor)
                {
                    var towards = (from + 180.0) % 360.0;
                    var bearing = CommunityRules.BearingDeg(reportLat, reportLon, f.Latitude, f.Longitude);
                    downwind = CommunityRules.AngleBetween(bearing, towards) <= s.FireConeDegrees;
                }
                if (d <= radius || downwind) result.Add(new CommunityTarget(f.FarmId, Math.Round(d, 1), downwind));
            }
            // Downwind farms first, then nearest first.
            return result.OrderByDescending(t => t.Downwind).ThenBy(t => t.DistanceKm).ToList();
        }

        // Reports of the same category within the radius and GroupHours are one group.
        public static bool SameGroup(string catA, double latA, double lonA, DateTimeOffset atA,
            string catB, double latB, double lonB, DateTimeOffset atB, CommunitySettings s) =>
            catA == catB &&
            (atA - atB).Duration() <= TimeSpan.FromHours(s.GroupHours) &&
            CommunityRules.DistanceKm(latA, lonA, latB, lonB) <= CommunityRules.RadiusFor(catA, false, s);
    }

    public static class CommunityMessages
    {
        public static string Severity(string s) => s switch { "high" => "High", "moderate" => "Moderate", _ => "Low" };

        public static string Report(string category, string subtype, string severity, double distanceKm, bool downwind,
            int similarFarms, string? description, CommunitySettings s)
        {
            var lines = new List<string>();
            if (category == "fire")
            {
                lines.Add(downwind
                    ? $"Fire reported {CommunityRules.DistanceText(distanceKm).Replace(" from your farm", "")} away — the wind is blowing towards your farm."
                    : $"Fire reported {CommunityRules.DistanceText(distanceKm)}.");
                if (downwind) lines.Add("This is an estimate from current wind data, not a prediction of where the fire will go.");
            }
            else
            {
                lines.Add($"{CommunityCategories.Label(subtype)} reported {CommunityRules.DistanceText(distanceKm)}.");
            }
            lines.Add($"Severity: {Severity(severity)}.");
            if (!string.IsNullOrWhiteSpace(description)) lines.Add($"\"{description.Trim()}\"");
            if (similarFarms >= 2) lines.Add($"{similarFarms} nearby farms have reported similar activity.");
            lines.Add(CommunityRules.Unverified);
            if (category == "fire") lines.Add($"If you're in danger, leave and call {s.EmergencyText}.");
            return string.Join("\n", lines);
        }

        public static string FireUpdate(string kind, string? direction, double distanceKm, bool downwind, CommunitySettings s)
        {
            var what = kind switch
            {
                "still_burning" => "is still burning",
                "spreading" => direction is null ? "is spreading" : $"is spreading towards the {direction}",
                "under_control" => "is under control",
                "out" => "is out",
                _ => "has an update",
            };
            var lines = new List<string> { $"Update: the fire reported {CommunityRules.DistanceText(distanceKm)} {what}." };
            if (downwind && kind != "out") lines.Add("The wind is blowing towards your farm. This is an estimate from current wind data, not a prediction.");
            lines.Add(CommunityRules.Unverified);
            if (kind != "out") lines.Add($"If you're in danger, leave and call {s.EmergencyText}.");
            return string.Join("\n", lines);
        }
    }

    // Easier locations (Part 3): province -> town search -> map pin -> coordinates.
    public static class LocationRules
    {
        public static readonly IReadOnlyList<string> Provinces = new[]
        {
            "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
            "Mpumalanga", "North West", "Northern Cape", "Western Cape",
        };

        // The rectangle around mainland South Africa: about 22.1-34.9 S, 16.4-32.9 E (Prince
        // Edward Islands left out). It catches typed mistakes such as a flipped sign; parts of
        // Botswana, Namibia, Zimbabwe and Mozambique fall inside it, so the province, the town
        // search and the map pin are what really place a farm.
        public const double MinLat = -35.0, MaxLat = -22.0, MinLon = 16.0, MaxLon = 33.0;

        public static string? ValidateCoordinates(double? latitude, double? longitude)
        {
            if (latitude is not { } lat || longitude is not { } lon || !double.IsFinite(lat) || !double.IsFinite(lon))
                return "Enter both latitude and longitude.";
            if (lat < MinLat || lat > MaxLat || lon < MinLon || lon > MaxLon)
                return "That point is outside South Africa. Latitude is between -35 and -22, longitude between 16 and 33.";
            return null;
        }

        public static bool IsProvince(string? p) => p is not null && Provinces.Contains(p);

        // "Town, District/Municipality, Province"
        public static string Display(string name, string? district, string? province) =>
            string.Join(", ", new[] { name, district, province }.Where(x => !string.IsNullOrWhiteSpace(x)));

        // Search tolerant of misspellings: the provider is asked for the typed name, then for
        // shorter prefixes of it when that finds nothing in the province; results are ranked by
        // how close the name (or its local municipality, e.g. "Mafikeng") is to what was typed.
        public static IEnumerable<string> QueriesFor(string typed)
        {
            var t = typed.Trim();
            yield return t;
            for (var n = Math.Min(t.Length - 1, 6); n >= 3; n--) yield return t[..n];
        }

        public static double Similarity(string typed, string candidate)
        {
            var a = typed.Trim().ToLowerInvariant();
            var b = candidate.Trim().ToLowerInvariant();
            if (a.Length == 0 || b.Length == 0) return 0;
            if (b.StartsWith(a)) return 1.0;
            var d = Levenshtein(a, b.Length > a.Length + 3 ? b[..(a.Length + 3)] : b);
            return 1.0 - (double)d / Math.Max(a.Length, b.Length);
        }

        public static int Levenshtein(string a, string b)
        {
            var prev = new int[b.Length + 1];
            var cur = new int[b.Length + 1];
            for (var j = 0; j <= b.Length; j++) prev[j] = j;
            for (var i = 1; i <= a.Length; i++)
            {
                cur[0] = i;
                for (var j = 1; j <= b.Length; j++)
                    cur[j] = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                (prev, cur) = (cur, prev);
            }
            return prev[b.Length];
        }
    }
}
