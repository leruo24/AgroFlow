// Connects the mobile app to Supabase Authentication: signs farmers in with email and
// password and converts the Supabase user into the app's AuthUser.

import type {
  Session,
  User,
} from '@supabase/supabase-js';

import {
  supabase,
} from '@/lib/supabase';

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: 'Farmer';
  initials: string;
};

export type LoginResponse = {
  session: Session;
  accessToken: string;
  user: AuthUser;
};

export type UpdateProfileInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

function createInitials(
  firstName: string,
  lastName: string
) {
  const firstInitial =
    firstName
      .trim()
      .charAt(0)
      .toUpperCase();

  const lastInitial =
    lastName
      .trim()
      .charAt(0)
      .toUpperCase();

  return `${firstInitial}${lastInitial}`;
}

function getMetadataValue(
  value: unknown
) {
  if (
    typeof value === 'string'
  ) {
    return value;
  }

  return '';
}

// Converts the Supabase user into the AuthUser structure the app uses.
export function mapSupabaseUser(
  user: User
): AuthUser {
  const firstName =
    getMetadataValue(
      user.user_metadata
        .first_name
    ) ||
    getMetadataValue(
      user.user_metadata
        .firstName
    );

  const lastName =
    getMetadataValue(
      user.user_metadata
        .last_name
    ) ||
    getMetadataValue(
      user.user_metadata
        .lastName
    );

  const phone =
    getMetadataValue(
      user.user_metadata
        .phone
    );

  const generatedInitials =
    createInitials(
      firstName,
      lastName
    );

  const fallbackInitial =
    user.email
      ?.trim()
      .charAt(0)
      .toUpperCase() ??
    '';

  return {
    id:
      user.id,

    firstName,

    lastName,

    email:
      user.email ?? '',

    phone,

    role:
      'Farmer',

    initials:
      generatedInitials ||
      fallbackInitial,
  };
}

// Sends the farmer's login details to Supabase, which checks them.
export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  const normalisedEmail =
    email
      .trim()
      .toLowerCase();

  const {
    data,
    error,
  } =
    await supabase.auth
      .signInWithPassword({
        email:
          normalisedEmail,

        password,
      });

  if (
    error
  ) {
    throw new Error(
      error.message
    );
  }

  if (
    !data.session ||
    !data.user
  ) {
    throw new Error(
      'Supabase did not return a valid authentication session.'
    );
  }

  return {
    session:
      data.session,

    accessToken:
      data.session
        .access_token,

    user:
      mapSupabaseUser(
        data.user
      ),
  };
}

// Updates the signed-in farmer's Supabase auth details and profile metadata.
export async function updateAuthenticatedUser(
  profile: UpdateProfileInput
): Promise<AuthUser> {
  const firstName =
    profile.firstName.trim();

  const lastName =
    profile.lastName.trim();

  const email =
    profile.email
      .trim()
      .toLowerCase();

  const phone =
    profile.phone.trim();

  const {
    data: currentUserData,
    error: currentUserError,
  } =
    await supabase.auth
      .getUser();

  if (
    currentUserError
  ) {
    throw new Error(
      currentUserError.message
    );
  }

  if (
    !currentUserData.user
  ) {
    throw new Error(
      'No authenticated farmer was found.'
    );
  }

  const emailChanged =
    currentUserData.user
      .email !== email;

  const {
    data,
    error,
  } =
    await supabase.auth
      .updateUser({
        ...(emailChanged
          ? {
              email,
            }
          : {}),

        data: {
          first_name:
            firstName,

          last_name:
            lastName,

          phone,

          initials:
            createInitials(
              firstName,
              lastName
            ),
        },
      });

  if (
    error
  ) {
    throw new Error(
      error.message
    );
  }

  return mapSupabaseUser(
    data.user
  );
}

// Ends the Supabase session and removes the saved session from the device.
export async function logoutUser() {
  const {
    error,
  } =
    await supabase.auth
      .signOut();

  if (
    error
  ) {
    throw new Error(
      error.message
    );
  }
}