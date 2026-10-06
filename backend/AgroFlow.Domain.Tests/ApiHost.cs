using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AgroFlow.Domain.Tests;

// Part 2: the real API - its real routes, filters and middleware - in memory,
// with every outside address pointing nowhere.
//
// SAFETY: environment "Testing" (user secrets load only in Development), the
// database, JWKS and broker are unroutable local addresses, every background
// service is removed, and sign-in is a header the test sets. Nothing here can
// reach the live database, Supabase, Telegram, HiveMQ or Storage.
public sealed class ApiHost : WebApplicationFactory<Program>
{
    public const string DeadDb = "Host=127.0.0.1;Port=9;Database=none;Username=none;Password=none;Timeout=1;Command Timeout=1;Pooling=false";
    public const string ApiKey = "test-api-key";

    public static readonly Guid Admin = Guid.Parse("00000000-0000-4000-8000-0000000000ad");
    public static readonly Guid Farmer = Guid.Parse("00000000-0000-4000-8000-0000000000fa");

    private static readonly Dictionary<string, string> Settings = new()
    {
        ["ConnectionStrings:Supabase"] = DeadDb,
        ["ApiKey"] = ApiKey,
        ["Supabase:JwksUrl"] = "http://127.0.0.1:9/jwks.json",
        ["Supabase:Url"] = "http://127.0.0.1:9",
        ["Supabase:ServiceRoleKey"] = "none",
        ["Telegram:BotToken"] = "",
        ["Mqtt:Host"] = "127.0.0.1",
        ["Mqtt:Port"] = "9",
    };

    static ApiHost()
    {
        // Environment variables too, so nothing set on this machine can win.
        foreach (var (key, value) in Settings)
        {
            Environment.SetEnvironmentVariable(key.Replace(":", "__"), value);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        foreach (var (key, value) in Settings) builder.UseSetting(key, value);

        builder.ConfigureLogging(l => l.ClearProviders());
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IHostedService>();
            services.RemoveAll<IProfileRoles>();
            services.AddSingleton<IProfileRoles, FakeRoles>();

            services.AddAuthentication(o =>
                {
                    o.DefaultScheme = TestAuth.Scheme;
                    o.DefaultAuthenticateScheme = TestAuth.Scheme;
                    o.DefaultChallengeScheme = TestAuth.Scheme;
                    o.DefaultForbidScheme = TestAuth.Scheme;
                })
                .AddScheme<AuthenticationSchemeOptions, TestAuth>(TestAuth.Scheme, _ => { });
        });
    }

    /// The admin is an admin; everyone else is a farmer.
    private sealed class FakeRoles : IProfileRoles
    {
        public Task<string?> RoleOfAsync(Guid profileId, CancellationToken ct) =>
            Task.FromResult<string?>(profileId == Admin ? "admin" : "farm_user");
    }

    /// "X-Test-User: {guid}" signs in as that profile; no header, not signed in.
    public sealed class TestAuth : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string Scheme = "Test";
        public const string Header = "X-Test-User";

        public TestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder) { }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue(Header, out var value) || !Guid.TryParse(value, out var id))
                return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity(new[] { new Claim("sub", id.ToString()) }, Scheme);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme)));
        }
    }
}
