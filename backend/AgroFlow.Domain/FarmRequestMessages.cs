#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // The exact words sent to a farmer about a new-farm / new-zone request,
    // and the send-once keys that stop them repeating.
    //
    // WHY THE COPY LIVES HERE
    // ----------------------
    // Same reasoning as the mobile app's helpContent.ts: the wording is the
    // part that a non-programmer has to be able to review, so it sits in one
    // file instead of being spread through the endpoints that send it. It is
    // also the part that has to be TESTED - "each message sends once per
    // request per status" is a claim about this logic, not about Telegram.
    //
    // COPY RULES (the same ones the in-app help follows)
    // Plain words. A farmer reads this on a phone, in a field, possibly in
    // their second language. Say what happened and what happens next.
    public static class FarmRequestMessages
    {
        // service_request.request_type -> the word the farmer uses.
        public static string DescribeSubject(string? requestType)
        {
            return requestType == "new_farm" ? "farm" : "zone";
        }

        // On submit, to the farmer who sent it.
        public static string Submitted(string? requestType, string? location)
        {
            return "🌱 AgroFlow: we've received your request for a new " +
                   DescribeSubject(requestType) + " at " + Place(location) +
                   ". A hardware kit is on the way - we'll message you when your installation is booked.";
        }

        // On Scheduled.
        //
        // service_request has no date column (0021), so the optional
        // " on <date>" clause is simply never produced. The parameter exists
        // so that adding such a column later is a one-line change here and
        // nothing at the call sites.
        public static string Scheduled(DateOnly? scheduledFor)
        {
            var whenClause = scheduledFor.HasValue
                ? " on " + scheduledFor.Value.ToString("d MMMM yyyy")
                : string.Empty;

            return "📦 AgroFlow: your hardware kit is booked for installation" + whenClause +
                   ". Our team will see you then.";
        }

        // On Completed.
        public static string Completed(string? requestType)
        {
            return "✅ AgroFlow: your new " + DescribeSubject(requestType) +
                   " is set up. Open the app to see it.";
        }

        // On submit, to every admin who has a chat id. Deliberately terse:
        // this is a work queue notice, not farmer-facing copy.
        public static string AdminSubmitted(string? farmerName, string? requestType, string? location)
        {
            var name = string.IsNullOrWhiteSpace(farmerName) ? "a farmer" : farmerName!.Trim();

            return "New " + DescribeSubject(requestType) + " request from " + name +
                   " at " + Place(location) + ".";
        }

        // A new_zone request carries no location of its own - it belongs to an
        // existing farm - so the caller passes the farm's location and this
        // falls back only when there is genuinely nothing to say. Never an
        // empty gap in the sentence.
        private static string Place(string? location)
        {
            return string.IsNullOrWhiteSpace(location) ? "your farm" : location!.Trim();
        }

        // ---- Send-once ---------------------------------------------------
        //
        // Why this needs a ledger at all: the admin dashboard can set a
        // request to Scheduled, change its mind, set it back to pending and
        // forward again - and a farmer who gets "your kit is booked" three
        // times stops reading the channel, which is how the frost warning
        // gets missed. NotificationLedger already exists for exactly this
        // (migration 0026, built for the forecast repeating the same storm
        // ~20 times); these are its keys for the request lifecycle.
        //
        // The ledger is keyed (farm_id, alert_type, subject_date). Request
        // identity goes into the alert_type string because the request id is
        // what has to be unique here, not the farm - one farm can have
        // several open requests, and each needs its own three messages.
        public static string FarmerLedgerKey(long requestId, string status)
        {
            return "request-" + requestId + "-" + Normalise(status);
        }

        public static string AdminLedgerKey(long requestId, string status)
        {
            return "request-admin-" + requestId + "-" + Normalise(status);
        }

        // The status values 0021's CHECK allows, normalised so that a casing
        // difference between the admin dashboard and this code cannot send a
        // message twice under two keys.
        public static string Normalise(string? status)
        {
            return string.IsNullOrWhiteSpace(status) ? "unknown" : status!.Trim().ToLowerInvariant();
        }

        // Which of the three messages a status change should send, if any.
        // Returns null for a status with nothing to say - the farmer does not
        // need to hear that their request went back to pending.
        public static FarmRequestStage? StageFor(string? status)
        {
            switch (Normalise(status))
            {
                case "pending": return FarmRequestStage.Submitted;
                case "scheduled": return FarmRequestStage.Scheduled;
                case "completed": return FarmRequestStage.Completed;
                default: return null;
            }
        }
    }

    public enum FarmRequestStage
    {
        Submitted,
        Scheduled,
        Completed,
    }

    // Authenticates Telegram's webhook calls.
    //
    // POST /api/telegram/webhook is necessarily anonymous - Telegram's
    // servers hold no AgroFlow credential - so the ONLY thing standing
    // between that route and anyone who finds the URL is the secret token
    // Telegram echoes back in X-Telegram-Bot-Api-Secret-Token. Without this
    // check, a stranger could post a forged "/start <code>" and link their
    // own chat to a farmer's account.
    public static class TelegramWebhookAuth
    {
        public const string HeaderName = "X-Telegram-Bot-Api-Secret-Token";

        // Fixed-time comparison. Unlike the device token, this secret is
        // chosen by whoever registers the webhook and may well be shorter and
        // less random than 32 bytes, so a timing side channel is worth
        // closing properly rather than on principle.
        //
        // An unconfigured secret refuses EVERYTHING. Failing closed is the
        // only safe default here: failing open would turn a missing Railway
        // variable into an open account-linking endpoint, which is far worse
        // than a webhook that visibly does not work.
        public static bool IsAuthorised(string? presentedHeader, string? configuredSecret)
        {
            if (string.IsNullOrWhiteSpace(configuredSecret)) return false;
            if (string.IsNullOrEmpty(presentedHeader)) return false;

            var a = Encoding.UTF8.GetBytes(presentedHeader!);
            var b = Encoding.UTF8.GetBytes(configuredSecret!.Trim());

            // FixedTimeEquals requires equal lengths; comparing the lengths
            // first leaks only the length, which Telegram's own documentation
            // treats as public (the secret's length is chosen by the
            // registrant, not derived from anything).
            if (a.Length != b.Length) return false;

            return CryptographicOperations.FixedTimeEquals(a, b);
        }
    }
}
