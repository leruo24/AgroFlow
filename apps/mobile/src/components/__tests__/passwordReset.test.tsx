/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Part F: signing in with an easy temporary password, Forgot password with a Telegram code,
 * and the one-tap sign-in link. The real screens, with Supabase, the API and navigation faked. */

import type { ReactNode } from 'react';

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
const mockSignInWithPassword = jest.fn();
const mockVerifyOtp = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: {
    signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
    verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
  } },
}));
const mockReplace = jest.fn();
jest.mock('@/lib/router', () => ({
  router: { push: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() },
}));
let mockParams: Record<string, string | string[] | undefined> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
let mockAuth: Record<string, unknown> = {};
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/services/agroFlowApi', () => ({
  requestPasswordReset: jest.fn(() => Promise.resolve('server words')),
  resetPasswordWithCode: jest.fn(() => Promise.resolve({ message: 'Your password was changed.' })),
  redeemOneTap: jest.fn(() => Promise.resolve({ email: 'thandi@example.org', tokenHash: 'hash-1' })),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import ForgotPasswordScreen from '@/app/forgot-password';
import OneTapSignInScreen from '@/app/signin';
import LoginScreen from '@/app/login';
import { loginUser } from '@/services/authService';
import { resetLanguageForTests, setLanguage } from '@/i18n';
import {
  TEMP_PASSWORD_ALPHABET,
  looksTemporary,
  normaliseResetCode,
  normaliseTemporaryPassword,
  passwordsToTry,
  tokenFromParams,
} from '@/lib/signInHelp';

const mocked = api as jest.Mocked<typeof api>;
const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  jest.clearAllMocks();
  resetLanguageForTests();
  mockParams = {};
  mockAuth = {};
});

beforeAll(async () => {
  await render(<ForgotPasswordScreen />);   // warm the renderer outside the 5 s limit
});

describe('temporary password rules', () => {
  it('uses the same alphabet as the server: no 0, O, 1, I or L', () => {
    expect(TEMP_PASSWORD_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (const c of '0O1IL') expect(TEMP_PASSWORD_ALPHABET).not.toContain(c);
  });

  it('accepts one with or without the space, in any case', () => {
    expect(normaliseTemporaryPassword('kx7p 4mrt')).toBe('KX7P4MRT');
    expect(normaliseTemporaryPassword(' KX7P-4MRT ')).toBe('KX7P4MRT');
    expect(looksTemporary('kx7p 4mrt')).toBe(true);
    expect(looksTemporary('KX7P4MR0')).toBe(false);
    expect(looksTemporary('my own password')).toBe(false);
  });

  it('tries what was typed first, then the tidied form, and never changes an own password', () => {
    expect(passwordsToTry('kx7p 4mrt')).toEqual(['kx7p 4mrt', 'KX7P4MRT']);
    expect(passwordsToTry('KX7P4MRT')).toEqual(['KX7P4MRT']);
    expect(passwordsToTry('Sunflower 2026')).toEqual(['Sunflower 2026']);
  });

  it('reads a reset code with or without a space, and a one-tap token from the link', () => {
    expect(normaliseResetCode(' 482 913 ')).toBe('482913');
    expect(normaliseResetCode('48291')).toBeNull();
    expect(normaliseResetCode('48291a')).toBeNull();
    expect(tokenFromParams(TOKEN)).toBe(TOKEN);
    expect(tokenFromParams([TOKEN, 'x'])).toBe(TOKEN);
    expect(tokenFromParams('short')).toBeNull();
    expect(tokenFromParams(undefined)).toBeNull();
  });
});

describe('signing in', () => {
  const session = { access_token: 't', user: { id: 'u1', email: 'thandi@example.org', user_metadata: {} } };
  const ok = { data: { session, user: session.user }, error: null };
  const wrong = { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };

  it('signs in with "kx7p 4mrt" when the password is KX7P4MRT', async () => {
    mockSignInWithPassword.mockResolvedValueOnce(wrong).mockResolvedValueOnce(ok);
    const res = await loginUser(' Thandi@Example.org ', 'kx7p 4mrt');
    expect(res.user.email).toBe('thandi@example.org');
    expect(mockSignInWithPassword.mock.calls.map(c => (c[0] as { password: string }).password)).toEqual(['kx7p 4mrt', 'KX7P4MRT']);
  });

  it('does not retry an own password or a network failure', async () => {
    mockSignInWithPassword.mockResolvedValue(wrong);
    await expect(loginUser('thandi@example.org', 'Sunflower 2026')).rejects.toThrow('Invalid login credentials');
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    mockSignInWithPassword.mockReset().mockResolvedValue({ data: {}, error: { message: 'Network request failed' } });
    await expect(loginUser('thandi@example.org', 'kx7p 4mrt')).rejects.toThrow('Network request failed');
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('explains temporary passwords when one is refused (it may have passed 72 hours)', async () => {
    mockAuth = { signIn: jest.fn(() => Promise.reject(new Error('Invalid login credentials'))) };
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText(/example/i), 'thandi@example.org');
    await fireEvent.changeText(screen.getByPlaceholderText('Enter your password'), 'kx7p 4mrt');
    const buttons = screen.getAllByText('Sign In');
    await fireEvent.press(buttons[buttons.length - 1]!);
    expect(await screen.findByText(/Temporary passwords are 8 letters and numbers, like KX7P 4MRT/)).toBeTruthy();
    expect(screen.getByText(/After 72 hours one stops working/)).toBeTruthy();
  });
});

describe('Forgot password', () => {
  async function askForCode(email = 'Thandi@Example.org') {
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('forgot-email'), email);
    await fireEvent.press(screen.getByTestId('forgot-send'));
  }

  it('checks the email first, then says the same thing whatever the email', async () => {
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('forgot-send'));
    expect(screen.getByTestId('forgot-error').props.children).toBe('Enter the email address you sign in with.');
    expect(mocked.requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText('No Telegram? Ask your AgroFlow field officer to reset it.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'Thandi@Example.org ');
    await fireEvent.press(screen.getByTestId('forgot-send'));
    expect(mocked.requestPasswordReset).toHaveBeenCalledWith('thandi@example.org');
    expect(screen.getByTestId('forgot-sent').props.children)
      .toBe("If this account has Telegram linked, we've sent a code. It works for 10 minutes.");
    expect(screen.getByText('Send a new code')).toBeTruthy();
  });

  it('checks the code and the new password before sending them', async () => {
    await askForCode();
    const press = async () => { await fireEvent.press(screen.getByTestId('forgot-change')); };

    await fireEvent.changeText(screen.getByTestId('forgot-code'), '12');
    await press();
    expect(screen.getByTestId('forgot-error').props.children).toBe('Enter the 6-digit code from Telegram.');

    await fireEvent.changeText(screen.getByTestId('forgot-code'), '482 913');
    await fireEvent.changeText(screen.getByTestId('forgot-password'), 'short');
    await press();
    expect(screen.getByTestId('forgot-error').props.children).toBe('Use at least 8 characters.');

    await fireEvent.changeText(screen.getByTestId('forgot-password'), 'a-long-password');
    await fireEvent.changeText(screen.getByTestId('forgot-again'), 'a-different-one');
    await press();
    expect(screen.getByTestId('forgot-error').props.children).toBe('The two passwords are not the same.');
    expect(mocked.resetPasswordWithCode).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('forgot-again'), 'a-long-password');
    await press();
    expect(mocked.resetPasswordWithCode).toHaveBeenCalledWith('thandi@example.org', '482913', 'a-long-password');
    expect(screen.getByText('Your password was changed. Sign in with your new password.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('forgot-to-login'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it("shows the server's plain words for a wrong or expired code", async () => {
    mocked.resetPasswordWithCode.mockRejectedValueOnce(new Error('That code is not right, or it has expired. Check it, or ask for a new one.'));
    await askForCode();
    await fireEvent.changeText(screen.getByTestId('forgot-code'), '111111');
    await fireEvent.changeText(screen.getByTestId('forgot-password'), 'a-long-password');
    await fireEvent.changeText(screen.getByTestId('forgot-again'), 'a-long-password');
    await fireEvent.press(screen.getByTestId('forgot-change'));
    expect(screen.getByTestId('forgot-error').props.children).toBe('That code is not right, or it has expired. Check it, or ask for a new one.');
    expect(screen.getByTestId('forgot-change')).toBeTruthy();   // can try again
  });

  it('follows the language setting', async () => {
    await act(async () => { await setLanguage('af'); });
    await render(<ForgotPasswordScreen />);
    expect(screen.getByText('Wagwoord vergeet')).toBeTruthy();
    expect(screen.getByText('Stuur kode')).toBeTruthy();
  });
});

describe('one-tap sign-in', () => {
  it('swaps the token once, signs in and opens the setup wizard', async () => {
    mockParams = { token: TOKEN };
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
    const view = await render(<OneTapSignInScreen />);
    expect(screen.getByTestId('onetap-busy')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/setup'));
    expect(mocked.redeemOneTap).toHaveBeenCalledWith(TOKEN);
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-1', type: 'magiclink' });
    await view.rerender(<OneTapSignInScreen />);
    expect(mocked.redeemOneTap).toHaveBeenCalledTimes(1);
  });

  it('a used or expired link says so and offers the password instead', async () => {
    mockParams = { token: TOKEN };
    mocked.redeemOneTap.mockRejectedValueOnce(new Error('expired'));
    await render(<OneTapSignInScreen />);
    expect(await screen.findByText('This sign-in link has expired or was already used. Sign in with your temporary password instead.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onetap-login'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('no token in the link: straight to the explanation, nothing sent', async () => {
    await render(<OneTapSignInScreen />);
    expect(screen.getByTestId('onetap-failed')).toBeTruthy();
    expect(mocked.redeemOneTap).not.toHaveBeenCalled();
  });
});
