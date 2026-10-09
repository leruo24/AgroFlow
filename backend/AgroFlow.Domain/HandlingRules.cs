#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business
{
    public enum HandlingOutcome
    {
        Claimed,
        AlreadyYours,
        HeldByOther,
        TakenOver,
        ReasonRequired,
        NothingToTakeOver,
        Released,
        NotYours,
        NothingToRelease,
    }

    // Security: whoever acts is on the record.
    // Nobody can assign work in someone else's name. "I'll handle this" uses the caller's
    // own name; a second admin can only take over with a reason, and both names go in the
    // timeline; only the handler can let it go. The caller is always the logged-in user,
    // never read from the request body.
    public static class HandlingRules
    {
        // DATA RULE: a take-over reason must say something. Three characters blocks "." and " "
        // without rejecting a short honest reason like "sick".
        public const int MinReasonLength = 3;

        public static HandlingOutcome Claim(Guid? currentHandler, Guid caller)
        {
            if (currentHandler is null) return HandlingOutcome.Claimed;
            return currentHandler == caller ? HandlingOutcome.AlreadyYours : HandlingOutcome.HeldByOther;
        }

        public static HandlingOutcome TakeOver(Guid? currentHandler, Guid caller, string? reason)
        {
            if (currentHandler is null) return HandlingOutcome.NothingToTakeOver;
            if (currentHandler == caller) return HandlingOutcome.AlreadyYours;
            if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < MinReasonLength) return HandlingOutcome.ReasonRequired;
            return HandlingOutcome.TakenOver;
        }

        public static HandlingOutcome Release(Guid? currentHandler, Guid caller)
        {
            if (currentHandler is null) return HandlingOutcome.NothingToRelease;
            return currentHandler == caller ? HandlingOutcome.Released : HandlingOutcome.NotYours;
        }

        /// The older PUT /api/admin/requests/{id}/assign: still works, but can only name the
        /// caller or nobody.
        public static bool AssignAllowed(Guid? target, Guid caller) => target is null || target == caller;

        // The actions each kind of item has. Request status changes keep their own route
        // (it also messages the farmer); here a request only takes a note.
        private static readonly Dictionary<string, string[]> Actions = new Dictionary<string, string[]>
        {
            ["requests"] = new[] { "note" },
            ["alerts"] = new[] { "note", "resolve", "close", "reopen", "escalate" },
            ["maintenance"] = new[] { "note", "schedule", "complete" },
        };

        public static bool IsKind(string? kind) => kind != null && Actions.ContainsKey(kind);

        public static bool ActionAllowed(string? kind, string? action) =>
            kind != null && action != null && Actions.TryGetValue(kind, out var allowed) && allowed.Contains(action);

        public static IReadOnlyList<string> ActionsFor(string kind) =>
            Actions.TryGetValue(kind, out var allowed) ? allowed : Array.Empty<string>();
    }
}
