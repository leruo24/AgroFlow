/**
 * Re-export shim. The canonical admin mock dataset now lives in the shared
 * database package: packages/database/admin/mock.ts
 *
 * Kept so existing `@/data/mock` imports across the admin app resolve unchanged.
 */
export * from "@db/admin/mock";
