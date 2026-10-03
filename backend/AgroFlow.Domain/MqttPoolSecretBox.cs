#nullable enable
using System;
using System.Security.Cryptography;
using System.Text;

namespace AgroFlow.Business
{
    // Encrypts the pooled HiveMQ passwords at rest (migration 0029).
    //
    // WHY ENCRYPTED AND NOT HASHED
    // ----------------------------
    // The device token in DeviceToken.cs is hashed, because the server only
    // ever needs to RECOGNISE it. This is the opposite case: the board
    // authenticates to HiveMQ with this password, not to us, so
    // GET /api/devices/mqtt-credentials has to hand the plaintext back on
    // every boot. A hash cannot do that.
    //
    // So it is encrypted under a key that lives in configuration
    // (Mqtt:PoolEncryptionKey - a Railway variable, never in the repo) rather
    // than in the database. A leaked database dump on its own then yields
    // nothing: the ciphertext is useless without the key, and the key is not
    // in the dump.
    //
    // WHY AES-GCM
    // -----------
    // Authenticated encryption. A password decrypted from a tampered row must
    // FAIL, not silently come back as different bytes - a board handed a
    // corrupted password would simply be unable to reach the broker, and the
    // cause would be invisible. GCM's tag turns that into a thrown exception
    // at the point of decryption, where it can be logged.
    //
    // FORMAT
    // ------
    // base64( nonce(12) || ciphertext(n) || tag(16) )
    //
    // The nonce is stored alongside the ciphertext, which is normal and not a
    // secret - it must only never repeat under the same key, which
    // RandomNumberGenerator guarantees far better than any counter this code
    // could keep across container restarts.
    //
    // A version prefix was considered and left out: if the scheme ever
    // changes, the pool is a handful of rows that the admin can re-paste from
    // the HiveMQ console in a minute, which is a cheaper migration than a
    // format negotiation that would exist forever to serve one event.
    public static class MqttPoolSecretBox
    {
        public const int NonceBytes = 12;   // AES-GCM standard, and what AesGcm.NonceByteSizes prefers
        public const int TagBytes = 16;     // 128-bit tag, the maximum and the default

        // AES-256. The configured key must decode to exactly this many bytes.
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

        // Throws on a wrong key, a truncated row or a tampered one. Callers
        // catch and log "could not decrypt pool entry N" rather than handing
        // the board bytes that cannot work - see the note on GCM above.
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

        // Turns the configured Mqtt:PoolEncryptionKey into key bytes.
        //
        // Accepts base64 (44 characters for 32 bytes) or hex (64
        // characters), because both are what a person reasonably pastes out
        // of a key generator. Anything else - including a passphrase - is
        // rejected rather than stretched: silently hashing a short
        // human-chosen string into a key would make a weak key look like a
        // strong one.
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

    // Which MQTT login a board should be given, and why.
    //
    // Separated from the SQL so the "empty pool falls back to the shared
    // credential" rule can be tested without a database - it is the rule that
    // decides whether a claim succeeds or a kit arrives dead on a farm.
    public enum MqttCredentialSource
    {
        // The board has its own pool entry. The normal case.
        Pool,

        // The pool was empty when this board claimed, or it predates the
        // pool. It uses the shared Mqtt:Username/Mqtt:Password, exactly as
        // every board did before 0029.
        Shared,

        // Neither is available: the pool is empty AND no shared credential is
        // configured. The board cannot reach the broker at all, and the
        // response says so rather than handing over blanks.
        None,
    }

    public static class MqttCredentialResolution
    {
        // assignedUsername/assignedPassword are the board's pool entry, null
        // when it has none. sharedUsername/sharedPassword come from
        // Mqtt:Username / Mqtt:Password.
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

        // The warning an empty pool must raise. A claim that silently falls
        // back is a kit that works today and stops working the moment the
        // shared password is rotated, so the admin has to be told.
        public const string PoolEmptyAlert = "MQTT login pool empty.";

        // Fewer than this many free entries and the admin page warns. Three
        // is two spare kits plus one, which is roughly the lead time on
        // creating a batch by hand in the HiveMQ console.
        public const int LowPoolWarningThreshold = 3;

        public static bool PoolIsRunningLow(int freeCount)
        {
            return freeCount < LowPoolWarningThreshold;
        }
    }

    // The broker address handed to a board by GET /api/devices/mqtt-credentials
    // (firmware v1.4.0).
    //
    // WHY THIS IS A RULE AND NOT TWO CONFIG READS
    // -------------------------------------------
    // A board that is given a BAD address is worse off than one given none:
    // with none it falls back to its compiled-in MQTT_HOST and keeps working,
    // but with "" or port 0 it tries, fails, and retries forever. So an
    // unusable value has to come back as "not configured" rather than as
    // itself, and that decision is worth stating once and testing.
    //
    // This matters for the thing it exists for: HiveMQ Cloud Serverless is
    // retired on 31 December 2026, and this is the switch that moves every
    // board to a new broker without a reflash. A typo in Mqtt__Host on the
    // day of that move should leave the fleet on the old address, not strand
    // it between two.
    public static class MqttBrokerAddress
    {
        // Ports are 1-65535. 0 is "unset" in the config and is also what
        // int.TryParse leaves behind on a failed parse, so it can never be
        // sent as a real port.
        public const int MinPort = 1;
        public const int MaxPort = 65535;

        public static string? ResolveHost(string? configuredHost)
        {
            return string.IsNullOrWhiteSpace(configuredHost) ? null : configuredHost!.Trim();
        }

        // Accepts the raw config string, because that is what IConfiguration
        // hands back - parsing here keeps the "what counts as valid" decision
        // in one place rather than at the call site.
        public static int? ResolvePort(string? configuredPort)
        {
            if (string.IsNullOrWhiteSpace(configuredPort)) return null;

            if (!int.TryParse(configuredPort.Trim(), out var port)) return null;

            return port >= MinPort && port <= MaxPort ? port : (int?)null;
        }

        // A host with no usable port is still useful: the board falls back to
        // its own compiled-in port, which is 8883 and almost certainly right
        // for any TLS broker. A port with no host is not - there is nothing
        // to connect it to - so it is dropped rather than sent on its own.
        public static (string? Host, int? Port) Resolve(string? configuredHost, string? configuredPort)
        {
            var host = ResolveHost(configuredHost);

            return host is null ? (null, null) : (host, ResolvePort(configuredPort));
        }
    }
}
