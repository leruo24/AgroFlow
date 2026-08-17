//imitates a backend authentication service for the Agroflow mobile app. It provides a mock implementation of user login, returning a hardcoded access token and user information for a specific email and password combination. The service simulates network latency with a delay and throws an error for invalid credentials. This allows the app to test authentication flows without needing a real backend server during development.
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
  accessToken: string;
  user: AuthUser;
};

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        700
      )
  );

  const normalisedEmail =
    email
      .trim()
      .toLowerCase();

  if (
    normalisedEmail !==
      'farmer@agroflow.co.za' ||
    password !==
      'demo123'
  ) {
    throw new Error(
      'Invalid email address or password.'
    );
  }

  return {
    accessToken:
      'agroflow-development-token',

    user: {
      id: 'USR001',
      firstName: 'Suyon',
      lastName: 'Tyobeka',
      email:
        'farmer@agroflow.co.za',
      phone: '',
      role: 'Farmer',
      initials: 'ST',
    },
  };
}
//password is demo123
//email is farmer@agroflow.co.za