#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // Security: creates and checks the per-board device tokens (migration 0028).
    // POST /api/devices/claim creates 32 random bytes, returns them once and stores only
    // the SHA-256 hash. The board keeps the token in flash and sends it as
    // X-Device-Token, so revoking one board cuts off only that board, with no reflash.
    // SHA-256, not bcrypt/argon2: those slow down guessing of weak passwords, but this is
    // 32 random bytes (2^256 possibilities), and the hash runs on every device request
    // (every 30 seconds per board).
    // Pure, so it can be tested directly.
    public static class DeviceToken
    {
        // 32 bytes = 256 bits, as URL-safe base64: 43 characters, no padding, safe in an HTTP
        // header and small enough for the ESP32's NVS.
        public const int TokenBytes = 32;

        // Hex SHA-256: always 64 lowercase characters, which keeps the comparison below
        // constant-time.
        public const int HashHexLength = 64;

        public static string Generate()
        {
            var bytes = RandomNumberGenerator.GetBytes(TokenBytes);

            // Base64Url: '+' and '/' are not safe in every header or URL, and '=' padding invites
            // trimming bugs.
            return Convert.ToBase64String(bytes)
                .Replace('+', '-')
                .Replace('/', '_')
                .TrimEnd('=');
        }

        // Lowercase hex, so hardware.device_token_hash has one form and a lookup is a plain
        // equality match on an indexed column.
        public static string Hash(string token)
        {
            if (token == null) throw new ArgumentNullException(nameof(token));

            var digest = SHA256.HashData(Encoding.UTF8.GetBytes(token));

            var hex = new StringBuilder(HashHexLength);
            foreach (var b in digest)
            {
                hex.Append(b.ToString("x2"));
            }

            return hex.ToString();
        }

        // Rejects anything that cannot be a token before it is hashed and looked up. A
        // missing header is common (a legacy board or a stranger) and should cost one check,
        // not a database round trip.
        public static bool LooksLikeToken(string? token)
        {
            if (string.IsNullOrWhiteSpace(token)) return false;

            // Base64url of 32 bytes is 43 characters. The range is wider than that so a future
            // token length does not reject every live board.
            if (token!.Length < 20 || token.Length > 128) return false;

            foreach (var c in token)
            {
                var ok = (c >= 'A' && c <= 'Z')
                      || (c >= 'a' && c <= 'z')
                      || (c >= '0' && c <= '9')
                      || c == '-' || c == '_';
                if (!ok) return false;
            }

            return true;
        }

        // Security: fixed-time comparison of two hex hashes. Both are hashes of a 256-bit
        // secret, so a timing leak would help little, but this is the auth path and it costs
        // nothing.
        public static bool HashesMatch(string? a, string? b)
        {
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;

            return CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(a),
                Encoding.UTF8.GetBytes(b));
        }
    }

    // Why a device request was refused. The endpoints turn each into a bare 401; the
    // reason is only useful in our log (the board reacts the same, and after three in a
    // row it wipes its credentials).
    public enum DeviceAuthFailure
    {
        // No X-Device-Token header, or one that could not have been minted.
        MissingOrMalformed,

        // Well-formed, but no hardware row has this hash: a token from a reset database, or a guess.
        UnknownToken,

        // Found, but token_revoked_at is set: an admin cut this board off.
        RevokedToken,
    }

    // The decision part of device authentication, kept apart from the database lookup so
    // it can be tested without one.
    public static class DeviceAuthPolicy
    {
        // rowFound is whether the hash lookup matched a row.
        public static DeviceAuthFailure? Evaluate(string? presentedToken, DateTimeOffset? revokedAt, bool rowFound)
        {
            if (!DeviceToken.LooksLikeToken(presentedToken)) return DeviceAuthFailure.MissingOrMalformed;
            if (!rowFound) return DeviceAuthFailure.UnknownToken;
            if (revokedAt.HasValue) return DeviceAuthFailure.RevokedToken;

            return null;
        }
    }
}
