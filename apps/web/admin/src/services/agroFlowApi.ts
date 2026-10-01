/*
 * Calls AgroFlow.Api's admin-only farmer onboarding endpoints.
 * Both endpoints require a real Supabase Auth session (JWT bearer + a
 * profile.role='admin' check server-side) - see
 * backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs. app/auth.ts's sign-in gate
 * (main.ts) means this only ever runs while such a session exists, but the
 * check below stays as a defensive fallback rather than assuming that.
 */

import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

async function postAuthorized<T = void>(path: string, body: unknown): Promise<T> {
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

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }

  // 204s and empty bodies are normal here (several of these endpoints only
  // acknowledge), so parsing is attempted rather than assumed.
  const text = await response.text();

  return (text ? JSON.parse(text) : undefined) as T;
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

/* What /onboard hands back now that there is no welcome email.

   temporaryPassword is shown ONCE and is never stored server-side. There is
   no endpoint that can fetch it again - "show it again" is a reset that mints
   a new one (resetTemporaryPassword below).

   telegramDeepLink is what the handover screen renders as a QR code. It can
   be null while Telegram:BotUsername is unset on the server; onboarding still
   succeeded, and the password is then the whole handover. */
export type FarmerOnboardedResult = {
  message: string;
  profileId: string;
  email: string;
  temporaryPassword: string;
  telegramDeepLink: string | null;
  telegramCode: string | null;
  telegramCodeExpiresAt: string | null;
  warning: string | null;
};

export async function onboardFarmer(input: {
  farmer: {
    fullName: string;
    email: string;
    phone: string;
  };
  farm: {
    farmName: string;
    location: string;
    sizeHectares: number;
    zones: {
      name: string;
      sizeHectares: number;
      cropType: string;
    }[];
  };
}): Promise<FarmerOnboardedResult> {
  return postAuthorized<FarmerOnboardedResult>("/api/farmers/onboard", input);
}

export type TelegramCodeResult = {
  code: string;
  deepLink: string | null;
  expiresAt: string;
};

/* "Regenerate code" - for a QR that expired or a farmer who lost it.
   Issuing a new code invalidates the farmer's previous unused one, so an old
   printout stops working immediately. */
export async function regenerateTelegramCode(
  profileId: string,
): Promise<TelegramCodeResult> {
  return postAuthorized<TelegramCodeResult>(
    `/api/telegram/admin/codes/${profileId}`,
    {},
  );
}

/* Sends a NEW temporary password to the farmer's own Telegram chat - the same
   thing they would get from "Forgot password?" in the app, triggered by an
   administrator for a farmer who phones in instead.

   Different from resetTemporaryPassword below: this one never shows the
   password to the admin, so the credential only ever reaches the account's
   owner. It fails if the farmer has no Telegram connected, which is when the
   read-it-out version below is the right tool. */
export async function sendTemporaryPasswordViaTelegram(
  profileId: string,
): Promise<{ message: string }> {
  return postAuthorized<{ message: string }>(
    `/api/telegram/admin/password/${profileId}/send`,
    {},
  );
}

/* The fallback for a farmer with no Telegram at all, and the only possible
   answer to "what was their password again?" - AgroFlow never stored it, so
   this mints a new one and returns it once. */
export async function resetTemporaryPassword(
  profileId: string,
): Promise<{ temporaryPassword: string; notice: string }> {
  return postAuthorized<{ temporaryPassword: string; notice: string }>(
    `/api/telegram/admin/password/${profileId}`,
    {},
  );
}
export async function registerFarm(input: {
  ownerId: string;
  farm: {
    farmName: string;
    location: string;
    sizeHectares: number;
    zones: {
      name: string;
      sizeHectares: number;
      cropType: string;
    }[];
  };
}): Promise<void> {
  await postAuthorized("/api/farms/register", input);
}
export type FarmerOption = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

export async function getFarmers(): Promise<FarmerOption[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(
    `${API_BASE}/api/users/farmers`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }

  return await response.json() as FarmerOption[];
}
export async function deleteFarmerUser(id: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(
    `${API_BASE}/api/users/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }
}

export async function deleteFarm(id: number): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(
    `${API_BASE}/api/farms/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }
}