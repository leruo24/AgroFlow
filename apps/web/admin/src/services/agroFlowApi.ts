/* Calls AgroFlow.Api's admin-only farmer onboarding endpoints.
   Both endpoints require a real Supabase Auth session (JWT bearer + a
   profile.role='admin' check server-side) - see
   backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs. This dashboard has no login
   flow yet, so there is no session to authorize with until one exists -
   these calls will fail with "not signed in" until that's built. */

import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

async function postAuthorized(path: string, body: unknown): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error(
      "Not signed in — the admin dashboard has no login flow yet, so there's no Supabase session to authorize this with."
    );
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status}).`);
  }
}

export async function createFarmer(input: {
  email: string;
  temporaryPassword: string;
  farmId: number;
  name?: string;
}): Promise<void> {
  await postAuthorized("/api/farmers/create", input);
}

export async function inviteFarmer(input: {
  email: string;
  farmId: number;
  name?: string;
}): Promise<void> {
  await postAuthorized("/api/farmers/invite", input);
}
