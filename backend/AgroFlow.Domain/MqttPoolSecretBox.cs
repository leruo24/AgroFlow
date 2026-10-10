#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // Security: encrypts the pooled HiveMQ passwords at rest (migration 0029).
    // Encrypted, not hashed: unlike the device token (DeviceToken.cs), the board uses
    // this password to log in to HiveMQ, so GET /api/devices/mqtt-credentials must return
    // the plain text. The key is Mqtt:PoolEncryptionKey (a Railway variable, never in the
    // repo), so a leaked database dump alone reveals nothing.
    // AES-GCM is authenticated: a tampered row fails with an exception we can log,
    // instead of silently giving the board a wrong password.
    // Format: base64( nonce(12) || ciphertext(n) || tag(16) ). The nonce is not secret;
    // it only must never repeat under the same key, which RandomNumberGenerator ensures.
    // There is no version prefix: if the scheme changes, the admin can re-paste the few
    // pool rows from the HiveMQ console.
    public static class MqttPoolSecretBox
    {
        public const int NonceBytes = 12;   // AES-GCM standard, and what AesGcm.NonceByteSizes prefers
        public const int TagBytes = 16;     // 128-bit tag, the maximum and the default

        // AES-256: the configured key must decode to exactly this many bytes.
        public const int KeyBytes = 32;

        public static string Encrypt(string plaintext, byte[] key)
        {
            if (plaintext == null) throw new ArgumentNullException(nameof(plaintext));
            ValidateKey(key);

            var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
            var plainBytes = Encoding.UTF8.GetBytes(plaintext);
            var cipherBytes = new byte[plainBytes.Length];
            var tag = new byte[TagBytes];

            using (var aes = new AesGcm(key, TagBytes))
            {
                aes.Encrypt(nonce, plainBytes, cipherBytes, tag);
            }

            var packed = new byte[NonceBytes + cipherBytes.Length + TagBytes];
            Buffer.BlockCopy(nonce, 0, packed, 0, NonceBytes);
            Buffer.BlockCopy(cipherBytes, 0, packed, NonceBytes, cipherBytes.Length);
            Buffer.BlockCopy(tag, 0, packed, NonceBytes + cipherBytes.Length, TagBytes);

            return Convert.ToBase64String(packed);
        }

        // Throws on a wrong key, a truncated row or a tampered one. Callers catch and log
        // "could not decrypt pool entry N" instead of giving the board bytes that cannot work.
        public static string Decrypt(string encoded, byte[] key)
        {
            if (string.IsNullOrWhiteSpace(encoded))
            {
                throw new ArgumentException("No ciphertext to decrypt.", nameof(encoded));
            }

            ValidateKey(key);

            byte[] packed;
            try
            {
                packed = Convert.FromBase64String(encoded);
            }
            catch (FormatException ex)
            {
                throw new CryptographicException(
                    "Stored MQTT pool password is not valid base64 - the row is corrupt.", ex);
            }

            if (packed.Length < NonceBytes + TagBytes)
            {
                throw new CryptographicException(
                    "Stored MQTT pool password is too short to contain a nonce and a tag - the row is corrupt.");
            }

            var cipherLength = packed.Length - NonceBytes - TagBytes;

            var nonce = new byte[NonceBytes];
            var cipherBytes = new byte[cipherLength];
            var tag = new byte[TagBytes];

            Buffer.BlockCopy(packed, 0, nonce, 0, NonceBytes);
            Buffer.BlockCopy(packed, NonceBytes, cipherBytes, 0, cipherLength);
            Buffer.BlockCopy(packed, NonceBytes + cipherLength, tag, 0, TagBytes);

            var plainBytes = new byte[cipherLength];

            using (var aes = new AesGcm(key, TagBytes))
            {
                // Throws AuthenticationTagMismatchException (a
                // CryptographicException) on a wrong key or a tampered row.
                aes.Decrypt(nonce, cipherBytes, tag, plainBytes);
            }

            return Encoding.UTF8.GetString(plainBytes);
        }

        // Turns Mqtt:PoolEncryptionKey into key bytes. Accepts base64 (44 characters for 32
        // bytes) or hex (64 characters), as copied from a key generator.
        // Security: anything else, including a passphrase, is rejected; hashing a short
        // human-chosen string would make a weak key look strong.
        public static byte[] ParseKey(string? configured)
        {
            if (string.IsNullOrWhiteSpace(configured))
            {
                throw new InvalidOperationException(
                    "Mqtt:PoolEncryptionKey is not set. Generate one with " +
                    "`openssl rand -base64 32` and set Mqtt__PoolEncryptionKey on Railway. " +
                    "Without it, pooled MQTT passwords cannot be stored or read.");
            }

            var trimmed = configured!.Trim();
            byte[]? key = null;

            if (trimmed.Length == KeyBytes * 2 && IsHex(trimmed))
            {
                key = new byte[KeyBytes];
                for (var i = 0; i < KeyBytes; i++)
                {
                    key[i] = Convert.ToByte(trimmed.Substring(i * 2, 2), 16);
                }
            }
            else
            {
                try
                {
                    key = Convert.FromBase64String(trimmed);
                }
                catch (FormatException)
                {
                    key = null;
                }
            }

            if (key == null || key.Length != KeyBytes)
            {
                throw new InvalidOperationException(
                    "Mqtt:PoolEncryptionKey must decode to exactly " + KeyBytes +
                    " bytes (AES-256) - base64 or hex. Generate one with `openssl rand -base64 32`. " +
                    "A passphrase is not accepted: stretching one here would make a weak key look strong.");
            }

            return key;
        }

        private static void ValidateKey(byte[] key)
        {
            if (key == null) throw new ArgumentNullException(nameof(key));

            if (key.Length != KeyBytes)
            {
                throw new ArgumentException(
                    "MQTT pool encryption key must be " + KeyBytes + " bytes (AES-256).", nameof(key));
            }
        }

        private static bool IsHex(string value)
        {
            foreach (var c in value)
            {
                var ok = (c >= '0' && c <= '9')
                      || (c >= 'a' && c <= 'f')
                      || (c >= 'A' && c <= 'F');
                if (!ok) return false;
            }

            return true;
        }
    }

    // Which MQTT login a board gets, and why. Kept apart from the SQL so the "empty pool
    // falls back to the shared login" rule can be tested; it decides whether a claim
    // works or a kit arrives dead.
    public enum MqttCredentialSource
    {
        // The board has its own pool entry (the normal case).
        Pool,

        // The pool was empty when this board claimed, or the board is older than the pool.
        // It uses the shared Mqtt:Username/Mqtt:Password.
        Shared,

        // Neither is available: the pool is empty and no shared login is configured. The
        // board cannot reach the broker, and the response says so instead of sending blanks.
        None,
    }

    public static class MqttCredentialResolution
    {
        // assignedUsername/assignedPassword are the board's pool entry (null if none).
        // sharedUsername/sharedPassword come from Mqtt:Username / Mqtt:Password.
        public static MqttCredentialSource Resolve(
            string? assignedUsername,
            string? assignedPassword,
            string? sharedUsername,
            string? sharedPassword)
        {
            if (!string.IsNullOrWhiteSpace(assignedUsername) && !string.IsNullOrWhiteSpace(assignedPassword))
            {
                return MqttCredentialSource.Pool;
            }

            if (!string.IsNullOrWhiteSpace(sharedUsername) && !string.IsNullOrWhiteSpace(sharedPassword))
            {
                return MqttCredentialSource.Shared;
            }

            return MqttCredentialSource.None;
        }

        // The warning an empty pool must raise: a board on the shared login stops working
        // as soon as that password changes, so the admin must be told.
        public const string PoolEmptyAlert = "MQTT login pool empty.";

        // Below this many free entries the admin page warns. Three is two spare kits plus
        // one, about the time it takes to create a new batch by hand.
        public const int LowPoolWarningThreshold = 3;

        public static bool PoolIsRunningLow(int freeCount)
        {
            return freeCount < LowPoolWarningThreshold;
        }
    }

    // The broker address given to a board by GET /api/devices/mqtt-credentials.
    // A bad address is worse than none: with none the board uses its compiled-in
    // MQTT_HOST, but with "" or port 0 it retries forever, so unusable values count as
    // "not configured".
    // This is how every board moves broker without a reflash (HiveMQ Cloud Serverless
    // retires on 31 December 2026); a typo in Mqtt__Host should leave them on the old address.
    public static class MqttBrokerAddress
    {
        // Ports are 1-65535. 0 means unset and is also what a failed int.TryParse leaves, so
        // it is never sent as a real port.
        public const int MinPort = 1;
        public const int MaxPort = 65535;

        public static string? ResolveHost(string? configuredHost)
        {
            return string.IsNullOrWhiteSpace(configuredHost) ? null : configuredHost!.Trim();
        }

        // Takes the raw config string and parses it here, so the "what is valid" rule is in
        // one place.
        public static int? ResolvePort(string? configuredPort)
        {
            if (string.IsNullOrWhiteSpace(configuredPort)) return null;

            if (!int.TryParse(configuredPort.Trim(), out var port)) return null;

            return port >= MinPort && port <= MaxPort ? port : (int?)null;
        }

        // A host without a usable port is still useful (the board uses its compiled-in 8883,
        // right for TLS brokers). A port without a host is not, so it is dropped.
        public static (string? Host, int? Port) Resolve(string? configuredHost, string? configuredPort)
        {
            var host = ResolveHost(configuredHost);

            return host is null ? (null, null) : (host, ResolvePort(configuredPort));
        }
    }
}
