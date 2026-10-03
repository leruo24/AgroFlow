using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 3 / step 10: the claim stores only a hash, and a revoked token gets 401.
//
// The claim endpoint's own storage is one line - it writes DeviceToken.Hash(t)
// and never t - so the thing worth testing is the property that line relies
// on: that the hash is not the token and cannot be turned back into it.
public class DeviceTokenTests
{
    [Fact]
    public void AGeneratedToken_IsLongEnoughToBeUnguessable()
    {
        var token = DeviceToken.Generate();

        // base64url of 32 bytes, unpadded, is exactly 43 characters.
        Assert.Equal(43, token.Length);
    }

    [Fact]
    public void TwoGeneratedTokens_AreNeverTheSame()
    {
        var tokens = new HashSet<string>();

        for (var i = 0; i < 500; i++)
        {
            Assert.True(tokens.Add(DeviceToken.Generate()), "DeviceToken.Generate() repeated a value.");
        }
    }

    // The token travels in an HTTP header and is stored in the ESP32's NVS,
    // so the alphabet has to be safe in both.
    [Fact]
    public void AGeneratedToken_IsUrlAndHeaderSafe()
    {
        for (var i = 0; i < 100; i++)
        {
            foreach (var c in DeviceToken.Generate())
            {
                var ok = char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_';
                Assert.True(ok, $"Unexpected character '{c}' in a device token.");
            }
        }
    }

    // ---- THE POINT OF THE WHOLE CHANGE -------------------------------------

    [Fact]
    public void TheHashIsNotTheToken_ThisIsWhatTheClaimStores()
    {
        var token = DeviceToken.Generate();
        var hash = DeviceToken.Hash(token);

        Assert.NotEqual(token, hash);
        Assert.DoesNotContain(token, hash);
        Assert.Equal(DeviceToken.HashHexLength, hash.Length);
    }

    [Fact]
    public void TheHashIsLowercaseHex_SoTheStoredValueHasOneCanonicalForm()
    {
        var hash = DeviceToken.Hash(DeviceToken.Generate());

        Assert.All(hash, c => Assert.True(
            (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
            $"Hash contained '{c}', which is not lowercase hex."));
    }

    // Lookup is an equality match on an indexed column, so the same token must
    // always produce the same hash.
    [Fact]
    public void HashingIsDeterministic_SoTheLookupWorksOnEveryRequest()
    {
        var token = DeviceToken.Generate();

        Assert.Equal(DeviceToken.Hash(token), DeviceToken.Hash(token));
    }

    [Fact]
    public void DifferentTokens_HashDifferently()
    {
        Assert.NotEqual(
            DeviceToken.Hash(DeviceToken.Generate()),
            DeviceToken.Hash(DeviceToken.Generate()));
    }

    // A known SHA-256 value, so a future refactor cannot quietly change the
    // algorithm and invalidate every token already in the field.
    [Fact]
    public void TheHashIsSha256Hex_PinnedAgainstAKnownValue()
    {
        Assert.Equal(
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            DeviceToken.Hash("test"));
    }

    // ---- Cheap rejection before the database round trip --------------------

    [Fact]
    public void AGeneratedToken_IsAcceptedByTheShapeCheck()
    {
        Assert.True(DeviceToken.LooksLikeToken(DeviceToken.Generate()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("short")]
    [InlineData("has spaces in it and is long enough otherwise")]
    [InlineData("has+plus+and/slash+characters+that+we+never+mint")]
    [InlineData("padded==================================")]
    public void AnythingThatCouldNotHaveBeenMinted_IsRejectedWithoutALookup(string? candidate)
    {
        Assert.False(DeviceToken.LooksLikeToken(candidate));
    }

    [Fact]
    public void AnAbsurdlyLongHeader_IsRejected()
    {
        Assert.False(DeviceToken.LooksLikeToken(new string('a', 500)));
    }

    // ---- Comparison --------------------------------------------------------

    [Fact]
    public void IdenticalHashes_Match()
    {
        var hash = DeviceToken.Hash("anything");

        Assert.True(DeviceToken.HashesMatch(hash, hash));
    }

    [Fact]
    public void DifferentHashes_DoNotMatch()
    {
        Assert.False(DeviceToken.HashesMatch(
            DeviceToken.Hash("one"), DeviceToken.Hash("two")));
    }

    [Fact]
    public void NullsNeverMatch()
    {
        Assert.False(DeviceToken.HashesMatch(null, null));
        Assert.False(DeviceToken.HashesMatch(DeviceToken.Hash("x"), null));
        Assert.False(DeviceToken.HashesMatch(null, DeviceToken.Hash("x")));
    }
}

// The 401 decision itself, separated from the database lookup so the three
// different reasons a device request is refused can be checked directly.
public class DeviceAuthPolicyTests
{
    private static readonly string GoodToken = DeviceToken.Generate();

    [Fact]
    public void AKnownLiveToken_IsAccepted()
    {
        Assert.Null(DeviceAuthPolicy.Evaluate(GoodToken, revokedAt: null, rowFound: true));
    }

    // Step 10: "A revoked token gets 401."
    [Fact]
    public void ARevokedToken_IsRefused_ThisIsTheRevokeStory()
    {
        var failure = DeviceAuthPolicy.Evaluate(
            GoodToken, revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1), rowFound: true);

        Assert.Equal(DeviceAuthFailure.RevokedToken, failure);
    }

    // A token revoked in the future is still revoked - the column is set, and
    // nothing in the revoke path writes a future timestamp. Treating it as
    // live because of clock skew would un-revoke a stolen board.
    [Fact]
    public void ATokenRevokedWithAFutureTimestamp_IsStillRefused()
    {
        var failure = DeviceAuthPolicy.Evaluate(
            GoodToken, revokedAt: DateTimeOffset.UtcNow.AddHours(1), rowFound: true);

        Assert.Equal(DeviceAuthFailure.RevokedToken, failure);
    }

    [Fact]
    public void AnUnknownToken_IsRefused()
    {
        Assert.Equal(
            DeviceAuthFailure.UnknownToken,
            DeviceAuthPolicy.Evaluate(GoodToken, revokedAt: null, rowFound: false));
    }

    [Fact]
    public void AMissingToken_IsRefusedBeforeAnythingIsLookedUp()
    {
        Assert.Equal(
            DeviceAuthFailure.MissingOrMalformed,
            DeviceAuthPolicy.Evaluate(null, revokedAt: null, rowFound: true));
    }

    [Fact]
    public void AMalformedToken_IsRefusedEvenIfARowSomehowMatched()
    {
        Assert.Equal(
            DeviceAuthFailure.MissingOrMalformed,
            DeviceAuthPolicy.Evaluate("nope", revokedAt: null, rowFound: true));
    }
}
