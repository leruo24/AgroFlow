namespace AgroFlow.Api.Auth;

// Who counts as AgroFlow staff, in one place, for AdminOnlyFilter. The admin console
// (apps/web/admin/src/app/auth.ts) keeps the same list.
//
// "field_officer" is listed so a field-officer role needs no code change here, but
// profile.role's check constraint (0001) only allows 'admin' and 'farm_user' today, and
// RLS grants console reads to 'admin' only. Until a migration adds the role and its
// policies, staff means admin.
public static class StaffRoles
{
    public static readonly IReadOnlyList<string> All = new[] { "admin", "field_officer" };

    public const string StaffOnlyMessage =
        "This console is for AgroFlow staff. Farmers, please use the AgroFlow app.";

    public static bool IsStaff(string? role) => role is not null && All.Contains(role);
}
