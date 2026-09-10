/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API. Empty string = use mock data. */
  readonly VITE_API_BASE?: string;
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL: string;
  /** Supabase anon/publishable key. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Base URL of the AgroFlow.Api host (backend/AgroFlow.Api), no trailing slash. */
  readonly VITE_AGROFLOW_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
