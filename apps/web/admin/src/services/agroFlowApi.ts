
/* Calls AgroFlow.Api's admin-only farmer onboarding endpoints.
   Both endpoints require a real Supabase Auth session (JWT bearer + a
   profile.role='admin' check server-side) - see
   backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs. app/auth.ts's sign-in gate
   (main.ts) means this only ever runs while such a session exists, but the
   check below stays as a defensive fallback rather than assuming that. */

import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

async function postAuthorized(path: string, body: unknown): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
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

export async function onboardFarmer(input: {
  farmer: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
  };
  farm: {
    farmName: string;
    location: string;
    sizeHectares: number;
    zones: {
      name: string;
      sizeHectares: number;
    }[];
  };
}): Promise<void> {
  await postAuthorized("/api/farmers/onboard", input);
}

