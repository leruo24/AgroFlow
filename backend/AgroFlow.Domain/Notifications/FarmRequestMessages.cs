#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // The exact words sent to a farmer about a new-farm / new-zone request, and the
    // send-once keys that stop them repeating.
    // The wording is in one file so someone who does not code can review it, and so the
    // "each message sends once per request per status" logic can be tested.
    // Plain words: a farmer reads this on a phone in a field, maybe in a second
    // language. Say what happened and what happens next.
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

        // On Scheduled. service_request has no date column (0021), so the " on <date>" part is
        // never produced; the parameter means adding a date later is a one-line change here.
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

        // On submit, to every admin with a chat id. Short, because it is a work-queue notice.
        public static string AdminSubmitted(string? farmerName, string? requestType, string? location)
        {
            var name = string.IsNullOrWhiteSpace(farmerName) ? "a farmer" : farmerName!.Trim();

            return "New " + DescribeSubject(requestType) + " request from " + name +
                   " at " + Place(location) + ".";
        }

        // A new_zone request has no location of its own, so the caller passes the farm's,
        // and we only fall back when there is nothing at all, so the sentence never has a gap.
        private static string Place(string? location)
        {
            return string.IsNullOrWhiteSpace(location) ? "your farm" : location!.Trim();
        }

        // Send-once keys.
        // An admin can set a request to Scheduled, back to pending and forward again, and a
        // farmer told "your kit is booked" three times stops reading (and misses the frost
        // warning). NotificationLedger (0026) handles exactly this; these are its keys for
        // requests. The ledger is keyed (farm_id, alert_type, subject_date), so the request id
        // goes into alert_type: one farm can have several open requests, each with its own
        // three messages.
        public static string FarmerLedgerKey(long requestId, string status)
        {
            return "request-" + requestId + "-" + Normalise(status);
        }

        public static string AdminLedgerKey(long requestId, string status)
        {
            return "request-admin-" + requestId + "-" + Normalise(status);
        }

        // The status values 0021's CHECK allows, normalised so different casing between the
        // dashboard and this code cannot send a message twice under two keys.
        public static string Normalise(string? status)
        {
            return string.IsNullOrWhiteSpace(status) ? "unknown" : status!.Trim().ToLowerInvariant();
        }

        // Which of the three messages a status change sends, if any. Null for a status with
        // nothing to say (the farmer does not need to hear it went back to pending).
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

    // Security: authenticates Telegram's webhook calls.
    // POST /api/telegram/webhook has to be anonymous, so the only protection is the secret
    // token Telegram sends back in X-Telegram-Bot-Api-Secret-Token. Without this check a
    // stranger could post a forged "/start <code>" and link their chat to a farmer's account.
    public static class TelegramWebhookAuth
    {
        public const string HeaderName = "X-Telegram-Bot-Api-Secret-Token";

        // Security: fixed-time comparison, because this secret is chosen by whoever registers
        // the webhook and may be short and not very random.
        // An unset secret refuses everything (fails closed), so a missing Railway variable
        // gives a visibly broken webhook, not an open account-linking endpoint.
        public static bool IsAuthorised(string? presentedHeader, string? configuredSecret)
        {
            if (string.IsNullOrWhiteSpace(configuredSecret)) return false;
            if (string.IsNullOrEmpty(presentedHeader)) return false;

            var a = Encoding.UTF8.GetBytes(presentedHeader!);
            var b = Encoding.UTF8.GetBytes(configuredSecret!.Trim());

            // FixedTimeEquals needs equal lengths. Comparing lengths first only leaks the length,
            // which Telegram treats as public.
            if (a.Length != b.Length) return false;

            return CryptographicOperations.FixedTimeEquals(a, b);
        }
    }
}
