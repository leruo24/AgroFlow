#nullable enable
using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // The rules for signing a farmer in without email: easy temporary passwords, 6-digit
    // reset codes sent over Telegram, and single-use sign-in links. Pure, so they are tested
    // without a database; the API stores and sends (Services/PasswordReset*).

    // A temporary password a farmer can read off a screen or a Telegram message and type into
    // a phone: 8 characters, capitals and digits only, never 0/O, 1/I/L (they look alike).
    // Shown as two groups of four ("KX7P 4MRT"); typed with or without the space, in any case.
    // It must be changed at first sign-in, and stops working after 72 hours.
    public static class EasyPassword
    {
        public const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        public const int Length = 8;
        public static readonly TimeSpan Lifetime = TimeSpan.FromHours(72);

        // Always at least one letter and one digit, so it also passes Supabase's "Letters and
        // digits" password rule. (Drawing again is rare: about 1 in 8 tries.)
        public static string Generate()
        {
            var chars = new char[Length];
            do
            {
                for (var i = 0; i < Length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
            }
            while (!chars.Any(char.IsDigit) || !chars.Any(char.IsLetter));
            return new string(chars);
        }

        // "KX7P4MRT" -> "KX7P 4MRT", the way it is shown and sent.
        public static string Display(string password) =>
            password.Length == Length ? password[..4] + " " + password[4..] : password;

        // What the farmer typed, as it is stored: spaces and dashes gone, capitals.
        public static string Normalise(string? typed) =>
            new string((typed ?? "").Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray()).ToUpperInvariant();

        // Could this be one of ours? (Then the app retries the sign-in with the normalised form.)
        public static bool LooksTemporary(string? typed)
        {
            var n = Normalise(typed);
            return n.Length == Length && n.All(c => Alphabet.Contains(c));
        }

        public static DateTimeOffset ExpiresAt(DateTimeOffset issuedAt) => issuedAt + Lifetime;

        public static bool HasExpired(bool mustChange, DateTimeOffset? expiresAt, DateTimeOffset now) =>
            mustChange && expiresAt is { } at && now >= at;
    }

    public enum CodeCheck
    {
        Ok,
        Wrong,
        Expired,
        Used,
        TooManyAttempts,
        None,
    }

    // The 6-digit code the bot sends for "Forgot password?": valid 10 minutes, once, 5 tries,
    // at most 3 asked for per account per hour. Stored only as a salted SHA-256 hash.
    public static class ResetCode
    {
        public const int Digits = 6;
        public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
        public const int MaxAttempts = 5;
        public const int MaxRequestsPerHour = 3;

        public static string Generate() =>
            RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

        public static string NewSalt() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

        public static string Hash(string code, string salt) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt + ":" + Normalise(code))));

        // "123 456" and " 123456 " are the same code.
        public static string Normalise(string? typed) =>
            new string((typed ?? "").Where(char.IsDigit).ToArray());

        public static bool CanRequest(int requestsInLastHour) => requestsInLastHour < MaxRequestsPerHour;

        // In order: is there one, was it used, did it run out of time or tries, is it right.
        public static CodeCheck Check(
            string? storedHash, string? salt, DateTimeOffset? expiresAt, DateTimeOffset? usedAt, int attempts,
            string? typed, DateTimeOffset now)
        {
            if (storedHash is null || salt is null || expiresAt is null) return CodeCheck.None;
            if (usedAt is not null) return CodeCheck.Used;
            if (now >= expiresAt.Value) return CodeCheck.Expired;
            if (attempts >= MaxAttempts) return CodeCheck.TooManyAttempts;
            var typedHash = Hash(typed ?? "", salt);
            return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(typedHash), Encoding.ASCII.GetBytes(storedHash))
                ? CodeCheck.Ok
                : CodeCheck.Wrong;
        }
    }

    // The "Sign in to AgroFlow" button in the welcome message: a random token, good once,
    // for 24 hours. Only its SHA-256 hash is stored.
    public static class SignInLink
    {
        public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

        public static string NewToken() =>
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        public static string Hash(string token) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));

        public static bool Usable(DateTimeOffset? expiresAt, DateTimeOffset? usedAt, DateTimeOffset now) =>
            expiresAt is { } at && usedAt is null && now < at;
    }
}
