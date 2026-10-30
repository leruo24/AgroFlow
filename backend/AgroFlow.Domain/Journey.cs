#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business;

// The enquiry-to-installation journey (Part B, B3-03): where a farm's case is, what is done, what
// happens next, who acts next and the known date. Worked out from facts the database already
// holds, never typed in, so the farmer's Home and the staff case always say the same thing.
// docs/audit/ui-contracts.md lists the words.
public static class Journey
{
    // The stages, in the order a case moves through them.
    public const string Enquiry = "enquiry";
    public const string Details = "details";
    public const string ServiceAgreed = "service_agreed";
    public const string AccountActive = "account_active";
    public const string ReadyForInstallation = "ready_for_installation";
    public const string VisitBooked = "visit_booked";
    public const string Installing = "installing";
    public const string Commissioned = "commissioned";

    public static readonly IReadOnlyList<string> Stages = new[]
    {
        Enquiry, Details, ServiceAgreed, AccountActive, ReadyForInstallation, VisitBooked, Installing, Commissioned,
    };

    public static string Label(string stage) => stage switch
    {
        Enquiry => "Enquiry",
        Details => "Details",
        ServiceAgreed => "Service agreed",
        AccountActive => "Account active",
        ReadyForInstallation => "Ready for installation",
        VisitBooked => "Visit booked",
        Installing => "Installing",
        _ => "Commissioned / Live",
    };

    // Who acts next, in the words the screens use.
    public const string You = "you";
    public const string Staff = "agroflow_staff";
    public const string Installer = "installer";

    public const int FarmerTaskCount = 4;
    public static readonly IReadOnlyList<string> FarmerTasks = new[] { "preferences", "farm", "water", "crops" };

    public sealed record Facts(
        bool HasEnquiry,
        bool HasFarm,
        bool HasFarmerAccount,
        bool ServiceAgreed,
        bool PasswordChanged,
        bool TermsAccepted,
        int FarmerTasksDone,
        int OpenHelpRequests,
        DateTimeOffset? NextVisitAt,
        string? NextVisitInstaller,
        bool VisitInProgress,
        int ZonesTotal,
        int ZonesCommissioned,
        int ZonesLegacy,
        int ActiveKits,
        int ChecklistDone,
        int ChecklistTotal,
        string? OwnerName,
        // RET-02: whether accepting the terms is part of an active account. False while staff have
        // acceptance switched off or a document is still a draft (LegalDocuments.AcceptanceOpen).
        bool TermsRequired = true);

    public sealed record Step(string Key, string Label, bool Done);

    public sealed record View(
        string Stage,
        string StageLabel,
        int StageNumber,
        int StageCount,
        IReadOnlyList<Step> Steps,
        IReadOnlyList<string> Done,
        IReadOnlyList<string> StillToDo,
        string NextAction,
        string WhoActsNext,
        DateTimeOffset? KnownDate,
        string DateLabel,
        bool Live);

    public static bool AccountActiveNow(Facts f) => f.HasFarmerAccount && f.PasswordChanged && (f.TermsAccepted || !f.TermsRequired);

    // RET-10: the account on its own, apart from the installation. "active" is the farmer's own
    // password (and accepted terms, when acceptance is switched on).
    public const string AccountNotCreated = "not_created";
    public const string AccountNeedsPassword = "needs_password";
    public const string AccountNeedsTerms = "needs_terms";
    public const string AccountActiveStatus = "active";

    public static string AccountStatus(Facts f) =>
        !f.HasFarmerAccount ? AccountNotCreated
        : !f.PasswordChanged ? AccountNeedsPassword
        : f.TermsRequired && !f.TermsAccepted ? AccountNeedsTerms
        : AccountActiveStatus;

    // RET-10: the installation on its own: the account stages are all "not booked yet".
    public static string InstallationStatus(string stage) => stage switch
    {
        ReadyForInstallation => "waiting_for_booking",
        VisitBooked => "visit_booked",
        Installing => "installing",
        Commissioned => "commissioned",
        _ => "not_booked",
    };

    // A farm whose zones all existed before the journey (legacy) and that has a working kit is
    // already live: it is never sent back to "Ready for installation".
    public static bool IsLive(Facts f) =>
        f.ZonesTotal > 0 && (
            f.ZonesCommissioned + f.ZonesLegacy == f.ZonesTotal && f.ZonesCommissioned > 0
            || f.ZonesLegacy == f.ZonesTotal && f.ActiveKits > 0);

    public static string StageOf(Facts f)
    {
        if (IsLive(f)) return Commissioned;
        if (f.VisitInProgress || f.ChecklistDone > 0) return Installing;
        if (f.NextVisitAt is not null) return VisitBooked;
        if (AccountActiveNow(f) && f.FarmerTasksDone >= FarmerTaskCount) return ReadyForInstallation;
        if (AccountActiveNow(f)) return AccountActive;
        if (f.ServiceAgreed) return ServiceAgreed;
        if (f.HasFarm || f.HasFarmerAccount) return Details;
        return Enquiry;
    }

    public static View Describe(Facts f)
    {
        var stage = StageOf(f);
        var steps = new List<Step>
        {
            new("enquiry", "AgroFlow has your request", f.HasEnquiry || f.HasFarm),
            new("details", "Your farm and contact details are with AgroFlow", f.HasFarm),
            new("service_agreed", "The service and its cost are agreed", f.ServiceAgreed),
            new("account_active", f.TermsRequired ? "Your account is active (own password, terms accepted)" : "Your account is active (own password)", AccountActiveNow(f)),
            new("farmer_details", $"Your details: {Math.Min(f.FarmerTasksDone, FarmerTaskCount)} of {FarmerTaskCount}", f.FarmerTasksDone >= FarmerTaskCount),
            new("visit_booked", "The installation visit is booked", f.NextVisitAt is not null || f.VisitInProgress || f.ChecklistDone > 0 || IsLive(f)),
            new("installing", f.ChecklistTotal > 0 ? $"Installer checks: {f.ChecklistDone} of {f.ChecklistTotal}" : "Installer checks", f.ChecklistTotal > 0 && f.ChecklistDone >= f.ChecklistTotal || IsLive(f)),
            new("commissioned", "Your kit is connected and tested", IsLive(f)),
        };

        var done = steps.Where(s => s.Done).Select(s => s.Label).ToList();
        // Gaps behind the current stage are still listed (a visit booked before the service was
        // agreed still needs the agreement), so nothing is hidden by a later step.
        var still = steps.Where(s => !s.Done).Select(s => s.Label).ToList();

        string next, who;
        DateTimeOffset? date = null;
        string dateLabel;
        switch (stage)
        {
            case Enquiry:
                next = "AgroFlow staff will call you to talk about your farm.";
                who = Staff; dateLabel = "Waiting for a call";
                break;
            case Details:
                next = "AgroFlow staff will agree the service and its cost with you.";
                who = Staff; dateLabel = "Waiting for AgroFlow staff";
                break;
            case ServiceAgreed:
                next = f.TermsRequired ? "Sign in, choose your own password and accept the terms." : "Sign in and choose your own password.";
                who = You; dateLabel = "Whenever you are ready";
                break;
            case AccountActive:
                next = f.OpenHelpRequests > 0
                    ? $"Finish your details ({f.FarmerTasksDone} of {FarmerTaskCount}). AgroFlow staff are helping with {f.OpenHelpRequests} question(s)."
                    : $"Finish your details: {f.FarmerTasksDone} of {FarmerTaskCount} done.";
                who = You; dateLabel = "Whenever you are ready";
                break;
            case ReadyForInstallation:
                next = "AgroFlow staff will book your installation visit.";
                who = Staff; dateLabel = "Waiting for booking";
                break;
            case VisitBooked:
                next = f.NextVisitInstaller is { Length: > 0 } name
                    ? $"{name} will install your kit."
                    : "Your installer will install your kit.";
                who = Installer; date = f.NextVisitAt; dateLabel = "Visit booked";
                break;
            case Installing:
                next = f.ChecklistTotal > 0
                    ? $"Your installer is setting up and testing the kit ({f.ChecklistDone} of {f.ChecklistTotal} checks done)."
                    : "Your installer is setting up and testing the kit.";
                who = Installer; date = f.NextVisitAt; dateLabel = date is null ? "Installation under way" : "Visit booked";
                break;
            default:
                next = "Your kit is connected. Check your fields, water and stop from the app, and ask for help any time.";
                who = You; dateLabel = "Live";
                break;
        }

        return new View(stage, Label(stage), Stages.ToList().IndexOf(stage) + 1, Stages.Count,
            steps, done, still, next, who, date, dateLabel, IsLive(f));
    }
}

// One zone's commissioning (Part B decision): kit linked, a real wet/dry calibration, a measured
// flow and a test start/stop the kit acknowledged. The run limit is on the installer's checklist
// too, but is not one of the four (it always has a safe default). Only a commissioned zone is
// offered automatic watering.
public static class Commissioning
{
    public const string KitLinked = "kit_linked";
    public const string Calibration = "calibration";
    public const string FlowMeasured = "flow_measured";
    public const string RunLimit = "run_limit";
    public const string TestStartStop = "test_start_stop";

    public static readonly IReadOnlyList<string> ChecklistItems = new[] { KitLinked, Calibration, FlowMeasured, RunLimit, TestStartStop };
    public static readonly IReadOnlyList<string> Required = new[] { KitLinked, Calibration, FlowMeasured, TestStartStop };

    public static string Label(string item) => item switch
    {
        KitLinked => "Kit linked to this zone",
        Calibration => "Wet/dry soil calibration",
        FlowMeasured => "Flow measured",
        RunLimit => "Longest run (run limit) set",
        _ => "Test start and stop, acknowledged by the kit",
    };

    public sealed record ZoneFacts(
        bool HasActiveKit,
        bool HasWetReading,
        bool HasDryReading,
        bool FlowRecordedAsMeasured,
        bool RunLimitConfirmed,
        bool TestAcknowledged);

    public static bool Done(string item, ZoneFacts z) => item switch
    {
        KitLinked => z.HasActiveKit,
        Calibration => z.HasWetReading && z.HasDryReading,
        FlowMeasured => z.FlowRecordedAsMeasured,
        RunLimit => z.RunLimitConfirmed,
        _ => z.TestAcknowledged,
    };

    public static bool IsCommissioned(ZoneFacts z) => Required.All(i => Done(i, z));

    // "Turn on automatic watering?" is asked once, after commissioning, and never for an older
    // (legacy) zone, whose mode stays what it was.
    public static bool OfferAutomatic(string commissionState, string? answer) =>
        commissionState == "commissioned" && answer is null;

    // A farmer may only turn on automatic watering once the zone is commissioned (or for a zone
    // that existed before the journey). Staff can always switch it.
    public static string? FarmerMayChooseMode(string mode, string commissionState) =>
        mode == "automatic" && commissionState == "pending"
            ? "Automatic watering can be turned on once your installer has commissioned this zone (kit, soil calibration, measured flow and a test run)."
            : null;
}
