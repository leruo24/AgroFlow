using System.Security.Cryptography;
using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 4 / step 10: "Pool passwords are stored encrypted" and "An empty pool
// falls back to the shared login."
//
// Unlike the device token, this password has to come BACK in plaintext - the
// board authenticates to HiveMQ with it - so it is encrypted rather than
// hashed, and what has to be proven is that the stored form is useless on its
// own and that tampering fails loudly rather than silently.
public class MqttPoolSecretBoxTests
{
    private static byte[] Key() => RandomNumberGenerator.GetBytes(MqttPoolSecretBox.KeyBytes);

    [Fact]
    public void APasswordSurvivesARoundTrip()
    {
        var key = Key();
        var password = "hunter2-but-from-the-hivemq-console";

        Assert.Equal(password, MqttPoolSecretBox.Decrypt(MqttPoolSecretBox.Encrypt(password, key), key));
    }

    // THE POINT: what lands in mqtt_credential_pool.password_encrypted must
    // not be the password.
    [Fact]
    public void TheStoredValueDoesNotContainThePassword()
    {
        var key = Key();
        var password = "a-very-distinctive-password-value";

        var stored = MqttPoolSecretBox.Encrypt(password, key);

        Assert.DoesNotContain(password, stored);
        Assert.NotEqual(password, stored);
    }

    // A fresh nonce per call, so two boards given the same password do not
    // produce identical rows - which would leak "these two are the same" to
    // anyone reading the table.
    [Fact]
    public void EncryptingTheSamePasswordTwice_ProducesDifferentCiphertext()
    {
        var key = Key();

        Assert.NotEqual(
            MqttPoolSecretBox.Encrypt("same", key),
            MqttPoolSecretBox.Encrypt("same", key));
    }

    [Fact]
    public void AWrongKeyCannotDecrypt_ThisIsWhyALeakedDumpIsNotEnough()
    {
        var stored = MqttPoolSecretBox.Encrypt("secret", Key());

        Assert.ThrowsAny<CryptographicException>(() => MqttPoolSecretBox.Decrypt(stored, Key()));
    }

    // AES-GCM's tag. A tampered row must FAIL rather than decrypt to
    // different bytes - a board handed a silently corrupted password would
    // just be unable to reach the broker, with no visible cause.
    [Fact]
    public void ATamperedRow_FailsRatherThanDecryptingToGarbage()
    {
        var key = Key();
        var stored = MqttPoolSecretBox.Encrypt("secret", key);

        var bytes = Convert.FromBase64String(stored);
        bytes[^1] ^= 0xFF;
        var tampered = Convert.ToBase64String(bytes);

        Assert.ThrowsAny<CryptographicException>(() => MqttPoolSecretBox.Decrypt(tampered, key));
    }

    [Fact]
    public void ATruncatedRow_FailsCleanly()
    {
        var key = Key();

        Assert.ThrowsAny<CryptographicException>(
            () => MqttPoolSecretBox.Decrypt(Convert.ToBase64String(new byte[4]), key));
    }

    [Fact]
    public void NonBase64_FailsCleanly()
    {
        Assert.ThrowsAny<CryptographicException>(() => MqttPoolSecretBox.Decrypt("not base64 !!!", Key()));
    }

    [Fact]
    public void AnEmptyPasswordStillRoundTrips()
    {
        var key = Key();

        Assert.Equal("", MqttPoolSecretBox.Decrypt(MqttPoolSecretBox.Encrypt("", key), key));
    }

    [Fact]
    public void NonAsciiSurvives()
    {
        var key = Key();
        var password = "pässwörd-ünïcode-✓";

        Assert.Equal(password, MqttPoolSecretBox.Decrypt(MqttPoolSecretBox.Encrypt(password, key), key));
    }

    // ---- Key parsing -------------------------------------------------------

    [Fact]
    public void ABase64Key_IsAccepted()
    {
        var key = MqttPoolSecretBox.ParseKey(Convert.ToBase64String(Key()));

        Assert.Equal(MqttPoolSecretBox.KeyBytes, key.Length);
    }

    [Fact]
    public void AHexKey_IsAccepted()
    {
        var hex = Convert.ToHexString(Key()).ToLowerInvariant();

        Assert.Equal(MqttPoolSecretBox.KeyBytes, MqttPoolSecretBox.ParseKey(hex).Length);
    }

    [Fact]
    public void SurroundingWhitespace_IsToleratedBecausePastedValuesCarryIt()
    {
        var encoded = "  " + Convert.ToBase64String(Key()) + "\n";

        Assert.Equal(MqttPoolSecretBox.KeyBytes, MqttPoolSecretBox.ParseKey(encoded).Length);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnUnsetKey_IsRefusedWithAnActionableMessage(string? configured)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => MqttPoolSecretBox.ParseKey(configured));

        Assert.Contains("Mqtt:PoolEncryptionKey", ex.Message);
    }

    // A passphrase must be refused rather than stretched: hashing a short
    // human-chosen string into a key would make a weak key look strong.
    [Theory]
    [InlineData("correct horse battery staple")]
    [InlineData("tooshort")]
    public void APassphrase_IsRefusedRatherThanStretched(string configured)
    {
        Assert.Throws<InvalidOperationException>(() => MqttPoolSecretBox.ParseKey(configured));
    }

    [Fact]
    public void AKeyOfTheWrongLength_IsRefused()
    {
        var sixteenBytes = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));

        Assert.Throws<InvalidOperationException>(() => MqttPoolSecretBox.ParseKey(sixteenBytes));
    }

    [Fact]
    public void EncryptingWithAWrongSizedKey_IsRefused()
    {
        Assert.Throws<ArgumentException>(
            () => MqttPoolSecretBox.Encrypt("x", RandomNumberGenerator.GetBytes(16)));
    }
}

// Which login a board is given. The rule that decides whether a kit arrives
// on a farm working or dead.
public class MqttCredentialResolutionTests
{
    [Fact]
    public void ABoardWithItsOwnPoolLogin_UsesIt()
    {
        Assert.Equal(
            MqttCredentialSource.Pool,
            MqttCredentialResolution.Resolve("kit-7", "pw", "shared-user", "shared-pw"));
    }

    // Step 10: "An empty pool falls back to the shared login."
    [Fact]
    public void AnEmptyPool_FallsBackToTheSharedLogin()
    {
        Assert.Equal(
            MqttCredentialSource.Shared,
            MqttCredentialResolution.Resolve(null, null, "shared-user", "shared-pw"));
    }

    // A half-populated assignment is not a usable login. Falling back is the
    // only answer that leaves the board able to connect.
    [Theory]
    [InlineData("kit-7", null)]
    [InlineData(null, "pw")]
    [InlineData("kit-7", "")]
    [InlineData("", "pw")]
    public void AnIncompleteAssignment_FallsBackRatherThanHandingOverHalfALogin(
        string? username, string? password)
    {
        Assert.Equal(
            MqttCredentialSource.Shared,
            MqttCredentialResolution.Resolve(username, password, "shared-user", "shared-pw"));
    }

    // Nothing to hand over at all. The endpoint turns this into a 503 so the
    // board retries, rather than a 200 with blanks it would try to connect
    // with.
    [Fact]
    public void NoPoolAndNoSharedCredential_IsReportedAsNone()
    {
        Assert.Equal(
            MqttCredentialSource.None,
            MqttCredentialResolution.Resolve(null, null, null, null));
    }

    [Fact]
    public void APoolLoginWinsEvenWhenNoSharedCredentialExists()
    {
        Assert.Equal(
            MqttCredentialSource.Pool,
            MqttCredentialResolution.Resolve("kit-7", "pw", null, null));
    }

    // ---- The low-pool warning ---------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public void FewerThanThreeFreeLogins_WarnsTheAdmin(int free)
    {
        Assert.True(MqttCredentialResolution.PoolIsRunningLow(free));
    }

    [Theory]
    [InlineData(3)]
    [InlineData(10)]
    public void ThreeOrMoreFreeLogins_DoesNotWarn(int free)
    {
        Assert.False(MqttCredentialResolution.PoolIsRunningLow(free));
    }

    [Fact]
    public void TheEmptyPoolAlertWordingIsPinned_BecauseTheAdminPageAndTheLogMustMatch()
    {
        Assert.Equal("MQTT login pool empty.", MqttCredentialResolution.PoolEmptyAlert);
    }
}
