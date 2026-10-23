#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace AgroFlow.Business
{
    /// <summary>What the public "Get a call back" form sends.</summary>
    public sealed class EnquiryForm
    {
        public string? FullName { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Province { get; set; }
        public string? Town { get; set; }
        public double? FarmSizeHa { get; set; }
        public string[]? Crops { get; set; }
        public string? CropsOther { get; set; }
        public string? BestTime { get; set; }
        public string? Notes { get; set; }
        public bool Consent { get; set; }

        /// <summary>Honeypot: hidden from people, filled in by bots.</summary>
        public string? Website { get; set; }
    }

    // The rules behind the public enquiry form and the call log. Pure, so every check is
    // tested without a database.
    public static class EnquiryRules
    {
        public static readonly string[] Provinces =
        {
            "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
            "Mpumalanga", "North West", "Northern Cape", "Western Cape",
        };

        /// <summary>The crops the engine has figures for, plus "other".</summary>
        public static readonly string[] Crops = { "maize", "potato", "tomato", "dry_beans", "citrus", "leafy_veg", "cucumber", "spinach", "other" };

        public static readonly string[] BestTimes = { "morning", "afternoon", "evening" };

        /// <summary>Outcomes of one call.</summary>
        public static readonly string[] Outcomes = { "wants", "callback", "no_answer", "not_interested" };

        /// <summary>Why someone said no. "other" needs words.</summary>
        public static readonly IReadOnlyDictionary<string, string> Reasons = new Dictionary<string, string>
        {
            ["too_expensive"] = "Too expensive",
            ["no_internet"] = "No reliable internet or WiFi",
            ["no_electricity"] = "No electricity at the farm",
            ["not_farming"] = "Not farming right now",
            ["has_system"] = "Already have an irrigation system",
            ["not_right_time"] = "Not the right time",
            ["thinking"] = "Wants to think about it",
            ["other"] = "Other",
        };

        /// <summary>DATA RULE: after this many unanswered calls, suggest closing.</summary>
        public const int NoAnswerLimit = 3;

        /// <summary>
        /// A South African number as +27XXXXXXXXX, or null. Accepts the ways
        /// people write it: 082 000 0000, 0820000000, +27 82 000 0000,
        /// 27820000000, with spaces, dashes or brackets.
        /// </summary>
        public static string? NormalisePhone(string? phone)
        {
            if (string.IsNullOrWhiteSpace(phone)) return null;
            var trimmed = phone.Trim();
            if (!Regex.IsMatch(trimmed, @"^\+?[\d\s\-()]+$")) return null;

            var digits = new string(trimmed.Where(char.IsDigit).ToArray());
            string national;
            if (digits.StartsWith("27") && digits.Length == 11) national = digits.Substring(2);
            else if (digits.StartsWith("0") && digits.Length == 10) national = digits.Substring(1);
            else return null;

            // National numbers start 1-8 (landlines 1-5, mobiles 6-8), so 000 000 0000 fails here.
            if (national[0] < '1' || national[0] > '8') return null;
            // One digit repeated (082 222 2222 aside, 011 111 1111) is a placeholder, not a number.
            if (national.Distinct().Count() == 1) return null;
            return "+27" + national;
        }

        /// <summary>Null when the form is fine; otherwise one plain sentence.</summary>
        public static string? Check(EnquiryForm f)
        {
            var name = f.FullName?.Trim() ?? "";
            if (name.Length < 2 || name.Length > 100) return "Please give your full name.";
            if (NormalisePhone(f.Phone) is null) return "Please give a South African phone number, for example 082 123 4567.";

            var email = f.Email?.Trim();
            if (!string.IsNullOrEmpty(email) &&
                (email!.Length > 200 || !Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$")))
                return "That email address does not look right. It is optional - you can leave it out.";

            if (f.Province is null || !Provinces.Contains(f.Province)) return "Please choose your province.";
            var town = f.Town?.Trim() ?? "";
            if (town.Length < 2 || town.Length > 100) return "Please give your town.";

            if (f.FarmSizeHa is { } ha && (ha <= 0 || ha > 100_000)) return "Farm size must be more than 0 hectares.";

            var crops = f.Crops ?? Array.Empty<string>();
            if (crops.Length == 0) return "Please choose at least one crop.";
            if (crops.Any(c => !Crops.Contains(c))) return "Please choose crops from the list.";
            if (crops.Contains("other") && string.IsNullOrWhiteSpace(f.CropsOther)) return "Please say which other crop.";
            if ((f.CropsOther?.Length ?? 0) > 100) return "Please keep the other crop short.";

            if (f.BestTime is null || !BestTimes.Contains(f.BestTime)) return "Please choose the best time to call.";
            if ((f.Notes?.Length ?? 0) > 1000) return "Please keep the notes under 1000 characters.";
            if (!f.Consent) return "Please tick the box to agree that we may contact you about this enquiry.";
            return null;
        }

        public static bool IsBot(EnquiryForm f) => !string.IsNullOrWhiteSpace(f.Website);

        private static readonly IReadOnlyDictionary<string, string> CropLabels = new Dictionary<string, string>
        {
            ["potato"] = "potato", ["tomato"] = "tomato", ["citrus"] = "citrus",
            ["leafy_veg"] = "leafy vegetables", ["maize"] = "maize", ["dry_beans"] = "dry beans",
            ["cucumber"] = "cucumber", ["spinach"] = "spinach",
        };

        public static string CropsText(IEnumerable<string> crops, string? other) =>
            string.Join(", ", crops.Select(c => c == "other" ? (other?.Trim() ?? "other") : CropLabels.TryGetValue(c, out var l) ? l : c));

        /// <summary>"New enquiry: Thandi Nkosi, Ceres, potato, maize, call in the morning".</summary>
        public static string AdminMessage(string name, string town, IEnumerable<string> crops, string? other, string bestTime) =>
            $"New enquiry: {name.Trim()}, {town.Trim()}, {CropsText(crops, other)}, call in the {bestTime}";

        /// <summary>Null when one logged call is complete; otherwise what is missing.</summary>
        public static string? CheckCall(string? outcome, string? reason, string? reasonOther, DateTimeOffset? callbackAt, DateTimeOffset now)
        {
            if (outcome is null || !Outcomes.Contains(outcome)) return "Choose how the call went.";
            if (outcome == "not_interested")
            {
                if (reason is null || !Reasons.ContainsKey(reason)) return "Choose why they are not interested.";
                if (reason == "other" && string.IsNullOrWhiteSpace(reasonOther)) return "Say why, in a few words.";
            }
            if (outcome == "callback")
            {
                if (callbackAt is null) return "Choose when to call back.";
                if (callbackAt <= now) return "The call-back time must be in the future.";
            }
            return null;
        }

        /// <summary>After this call, should the console suggest closing it?</summary>
        public static bool SuggestClosing(int noAnswerCount) => noAnswerCount >= NoAnswerLimit;
    }
}
