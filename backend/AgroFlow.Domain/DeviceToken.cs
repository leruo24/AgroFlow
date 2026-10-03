#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // Mints and verifies the per-board device tokens introduced with firmware
    // v1.3.0 (migration 0028).
    //
    // WHAT REPLACED WHAT
    // ------------------
    // Every board used to present the same compiled-in X-Api-Key. One
    // dismantled kit handed over the credential for the whole fleet, and the
    // only remedy was to rotate the key and reflash every board by hand.
    //
    // Now POST /api/devices/claim mints 32 random bytes, returns them once,
    // and stores ONLY the SHA-256 hash. The board keeps the token in flash
    // and sends it as X-Device-Token. Revoking one board cuts off that board
    // alone, immediately, with nothing to reflash.
    //
    // WHY SHA-256 AND NOT A PASSWORD KDF
    // ----------------------------------
    // bcrypt/argon2 exist to make GUESSING feasible-length passwords slow.
    // There is nothing to guess here: the token is 32 bytes from a CSPRNG, so
    // the search space is 2^256 and a slow hash buys nothing. What it would
    // cost is real - this hash is computed on every device request, and the
    // boards report every 30 seconds.
    //
    // Pure and side-effect free so it can be tested directly.
    public static class DeviceToken
    {
        // 32 bytes = 256 bits. Rendered as URL-safe base64, so it is 43
        // characters with no padding - safe in an HTTP header, and short
        // enough to sit comfortably in the ESP32's NVS alongside the WiFi
        // credentials.
        public const int TokenBytes = 32;

        // Hex SHA-256: 64 lowercase characters. Fixed width, which is what
        // makes the comparison below constant-time without extra work.
        public const int HashHexLength = 64;

        public static string Generate()
        {
            var bytes = RandomNumberGenerator.GetBytes(TokenBytes);

            // Base64Url: '+' and '/' are not safe in every header/URL path a
            // token might travel through, and padding '=' invites trimming
            // bugs at both ends.
            return Convert.ToBase64String(bytes)
                .Replace('+', '-')
                .Replace('/', '_')
                .TrimEnd('=');
        }

        // Lowercase hex, so the value stored in hardware.device_token_hash is
        // one canonical form and a lookup is a plain equality match on an
        // indexed column.
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

        // Rejects anything that cannot be a token before it is hashed and
        // used as a database lookup key. An empty or absent header is the
        // common case (a legacy board, or a stranger who found the URL), and
        // it should cost one string check rather than a round trip.
        public static bool LooksLikeToken(string? token)
        {
            if (string.IsNullOrWhiteSpace(token)) return false;

            // Base64url of 32 bytes is exactly 43 characters. Anything else
            // was not minted by Generate(). Bounded rather than exact so a
            // future token length does not silently reject every live board.
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

        // Fixed-time comparison of two hex hashes.
        //
        // Both values here are already hashes of a 256-bit random secret, so
        // a timing leak is of very little use to an attacker - but this is on
        // the authentication path, it costs nothing, and the alternative is
        // explaining in a code review why ordinary string equality is fine.
        public static bool HashesMatch(string? a, string? b)
        {
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;

            return CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(a),
                Encoding.UTF8.GetBytes(b));
        }
    }

    // Why a device request was refused. The endpoints turn every one of these
    // into a bare 401 with no detail - which of the three it was is useful in
    // the server log and useless to the board, which reacts identically to
    // all of them (three in a row and it wipes its own credentials).
    public enum DeviceAuthFailure
    {
        // No X-Device-Token header, or one that could not have been minted.
        MissingOrMalformed,

        // Well-formed, but no hardware row has this hash. Either a token from
        // a database that has since been reset, or a guess.
        UnknownToken,

        // Found, but token_revoked_at is set. The admin cut this board off.
        RevokedToken,
    }

    // The decision half of device authentication, separated from the database
    // lookup so it can be tested without one.
    public static class DeviceAuthPolicy
    {
        // tokenRow is what the hash lookup found: null when nothing matched.
        public static DeviceAuthFailure? Evaluate(string? presentedToken, DateTimeOffset? revokedAt, bool rowFound)
        {
            if (!DeviceToken.LooksLikeToken(presentedToken)) return DeviceAuthFailure.MissingOrMalformed;
            if (!rowFound) return DeviceAuthFailure.UnknownToken;
            if (revokedAt.HasValue) return DeviceAuthFailure.RevokedToken;

            return null;
        }
    }
}
