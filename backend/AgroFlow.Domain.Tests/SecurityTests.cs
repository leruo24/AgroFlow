using System.Collections.Generic;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 2: logins and device keys.
public class SecurityTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public SecurityTests(ApiHost host) { _host = host; }

    [Fact]
    public void The_real_JWT_check_refuses_expired_unsigned_and_wrong_audience_tokens()
    {
        // The API's own JwtBearer settings, as Program.cs configures them.
        _host.CreateClient().Dispose();
        var options = _host.Services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(JwtBearerDefaults.AuthenticationScheme);
        var p = options.TokenValidationParameters;

        Assert.True(p.ValidateLifetime);            // an expired token is a 401
        Assert.True(p.RequireExpirationTime);
        Assert.True(p.ValidateIssuerSigningKey);    // a forged one is a 401
        Assert.True(p.RequireSignedTokens);
        Assert.True(p.ValidateAudience);
        Assert.Equal("authenticated", p.ValidAudience);
        Assert.False(options.MapInboundClaims);     // "sub" stays "sub" - the actor the API reads
    }

    private static DeviceAuthService Auth(string? legacyFlag)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Devices:LegacyApiKeyEnabled"] = legacyFlag })
            .Build();
        // No database: every path tested here answers before needing one.
        return new DeviceAuthService(null!, config, NullLogger<DeviceAuthService>.Instance);
    }

    [Theory]
    [InlineData(null, true)]      // unset: on (two v1.1.0 boards still need it)
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("nonsense", true)]
    public void The_legacy_device_key_follows_its_switch(string? flag, bool expected)
    {
        Assert.Equal(expected, Auth(flag).LegacyApiKeyEnabled);
    }

    [Fact]
    public async Task With_the_legacy_key_switched_off_a_board_without_a_token_is_refused()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Api-Key"] = ApiHost.ApiKey;   // even the right shared key
        context.Request.Path = "/api/irrigation-events";
        Assert.Null(await Auth("false").AuthenticateAsync(context));
    }
}
