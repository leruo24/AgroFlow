/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL: string;
  /** Supabase anon/publishable key. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Base URL of the AgroFlow.Api host (backend/AgroFlow.Api), no trailing slash. */
  readonly VITE_AGROFLOW_API_BASE: string;
  /** Optional landing-page download links; each button is hidden when empty. */
  readonly VITE_DOWNLOADS_ANDROID_APK_URL?: string;
  readonly VITE_DOWNLOADS_WEB_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
