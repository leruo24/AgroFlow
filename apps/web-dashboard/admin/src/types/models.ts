/**
 * Re-export shim. The canonical AgroFlow domain types now live in the shared
 * database package: packages/database/admin/types.ts
 *
 * This file is kept so existing `@/types/models` imports across the admin app
 * continue to resolve unchanged.
 */
export * from "@db/admin/types";
