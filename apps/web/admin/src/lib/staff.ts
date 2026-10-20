/* AgroFlow staff roles (admin, field_officer), in step with backend/AgroFlow.Api/Auth/StaffRoles.cs.
 * In lib/ so the data layer can use it without importing app/auth.ts. Staff run the console
 * and never use Telegram (docs/telegram-farmers-only.md). */
export const STAFF_ROLES: readonly string[] = ["admin", "field_officer"];

export function isStaffRole(role: string | null | undefined): boolean {
  return role != null && STAFF_ROLES.includes(role);
}
