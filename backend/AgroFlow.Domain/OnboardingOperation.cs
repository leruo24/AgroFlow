#nullable enable
using System;

namespace AgroFlow.Business;

// Where a staff onboarding attempt has got to (onboarding_request, migration 0057; AF-01,
// B3-01), and what the admin site may offer next. Pure, so the rules are tested directly.
// The point: once anything is saved, the only offer is "Retry" with the same request id,
// which continues the same farm and farmer. "Create again" is never offered.
public static class OnboardingOperation
{
    public const string Started = "started";
    public const string FarmSaved = "farm_saved";
    public const string AccountCreated = "account_created";
    public const string Completed = "completed";
    public const string Failed = "failed";

    // The step names stored in onboarding_request.last_step.
    public const string StepLocation = "location";
    public const string StepFarm = "farm";
    public const string StepAccount = "account";
    public const string StepHandover = "handover";

    // What the UI offers: retry (same request id), start a fresh form, or nothing (done).
    public enum Offer { Retry, NewForm, Done }

    public sealed record View(string Status, string? LastStep, bool FarmSaved, bool AccountCreated, Offer Offer, string Message);

    public static View Describe(string status, string? lastStep, bool hasFarm, bool hasAccount)
    {
        if (status == Completed)
            return new View(status, lastStep, true, true, Offer.Done,
                "This farmer is already onboarded. To give them a new temporary password, use Reset password.");

        if (!hasFarm)
            return new View(status, lastStep, false, false, Offer.NewForm,
                lastStep == StepLocation
                    ? "Nothing was saved: the farm's location needs fixing. Your entries are still here."
                    : "Nothing was saved yet. Your entries are still here; fix the problem and press Onboard farmer.");

        return hasAccount
            ? new View(status, lastStep, true, true, Offer.Retry,
                "The farm and the farmer's account are saved. Press Retry to finish the handover; it will not create anything new.")
            : new View(status, lastStep, true, false, Offer.Retry,
                "The farm and its zones are saved, but not the farmer's account yet. Press Retry to finish; it continues the same farm.");
    }

    public static string OfferName(Offer offer) => offer switch
    {
        Offer.Retry => "retry",
        Offer.NewForm => "new_form",
        _ => "done",
    };

    // A second submit of the same request while the first is still running.
    public static readonly TimeSpan InProgressWindow = TimeSpan.FromSeconds(60);
}
