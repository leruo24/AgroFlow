using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part F: easy temporary passwords, Forgot password over Telegram, admin resets, the one-tap
// sign-in link and the 72-hour limit. The database, Supabase and Telegram are fakes here.
public class PasswordResetFlowTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public PasswordResetFlowTests(ApiHost host) => _host = host;

    private static readonly Guid FarmerLinked = Guid.Parse("00000000-0000-4000-8000-0000000000a1");
    private static readonly Guid FarmerNoTelegram = Guid.Parse("00000000-0000-4000-8000-0000000000a2");
    private static readonly Guid StaffNoTelegram = Guid.Parse("00000000-0000-4000-8000-0000000000a3");
    private static readonly Guid FarmerAfrikaans = Guid.Parse("00000000-0000-4000-8000-0000000000a4");

    // Fakes

    private sealed class Store : IPasswordResetStore
    {
        public readonly Dictionary<Guid, ResetAccount> Accounts = new()
        {
            [FarmerLinked] = new(FarmerLinked, "farm_user", "thandi@example.org", 111, "en", "Thandi"),
            [FarmerNoTelegram] = new(FarmerNoTelegram, "farm_user", "sipho@example.org", null, "en", "Sipho"),
            [StaffNoTelegram] = new(StaffNoTelegram, "admin", "staff@agroflow.test", null, "en", "Staff"),
            [FarmerAfrikaans] = new(FarmerAfrikaans, "farm_user", "anna@example.org", 444, "af", "Anna"),
        };
        public readonly List<(long Id, Guid Profile, string Hash, string Salt, DateTimeOffset Created, DateTimeOffset Expires, DateTimeOffset? Used, int Attempts)> Codes = new();
        public readonly Dictionary<Guid, (bool MustChange, DateTimeOffset? Expires)> Temp = new();
        public readonly List<Guid> SessionsEnded = new();
        public readonly List<(string Hash, Guid Profile, DateTimeOffset Expires, DateTimeOffset? Used)> Links = new();
        public Func<DateTimeOffset> Now = () => DateTimeOffset.UtcNow;

        public Task<ResetAccount?> FindByEmailAsync(string email, CancellationToken ct) =>
            Task.FromResult(Accounts.Values.FirstOrDefault(a => a.Email == email));
        public Task<ResetAccount?> FindByIdAsync(Guid profileId, CancellationToken ct) =>
            Task.FromResult(Accounts.TryGetValue(profileId, out var a) ? a : null);
        public Task<int> CodesSinceAsync(Guid profileId, DateTimeOffset since, CancellationToken ct) =>
            Task.FromResult(Codes.Count(c => c.Profile == profileId && c.Created > since));
        public Task SaveCodeAsync(Guid profileId, string hash, string salt, DateTimeOffset expiresAt, CancellationToken ct)
        {
            Codes.Add((Codes.Count + 1, profileId, hash, salt, Now(), expiresAt, null, 0));
            return Task.CompletedTask;
        }
        public Task<StoredCode?> LatestCodeAsync(Guid profileId, CancellationToken ct)
        {
            var c = Codes.Where(x => x.Profile == profileId).OrderByDescending(x => x.Id).FirstOrDefault();
            return Task.FromResult(c.Id == 0 ? null : new StoredCode(c.Id, c.Hash, c.Salt, c.Expires, c.Used, c.Attempts));
        }
        public Task CountAttemptAsync(long codeId, CancellationToken ct)
        {
            var i = Codes.FindIndex(c => c.Id == codeId);
            Codes[i] = Codes[i] with { Attempts = Codes[i].Attempts + 1 };
            return Task.CompletedTask;
        }
        public Task UseCodeAsync(Guid profileId, long codeId, CancellationToken ct)
        {
            for (var i = 0; i < Codes.Count; i++)
            {
                if (Codes[i].Id == codeId) Codes[i] = Codes[i] with { Used = Now() };
                else if (Codes[i].Profile == profileId && Codes[i].Used is null) Codes[i] = Codes[i] with { Expires = Now() };
            }
            return Task.CompletedTask;
        }
        public Task MarkTemporaryAsync(Guid profileId, DateTimeOffset expiresAt, CancellationToken ct)
        {
            Temp[profileId] = (true, expiresAt == DateTimeOffset.MaxValue ? null : expiresAt);
            return Task.CompletedTask;
        }
        public Task ClearTemporaryAsync(Guid profileId, CancellationToken ct)
        {
            Temp[profileId] = (false, null);
            return Task.CompletedTask;
        }
        public Task EndSessionsAsync(Guid profileId, CancellationToken ct)
        {
            SessionsEnded.Add(profileId);
            return Task.CompletedTask;
        }
        public Task SaveSignInLinkAsync(Guid profileId, string tokenHash, DateTimeOffset expiresAt, CancellationToken ct)
        {
            Links.Add((tokenHash, profileId, expiresAt, null));
            return Task.CompletedTask;
        }
        public Task<StoredSignInLink?> UseSignInLinkAsync(string tokenHash, DateTimeOffset now, CancellationToken ct)
        {
            var i = Links.FindIndex(l => l.Hash == tokenHash);
            if (i < 0 || !SignInLink.Usable(Links[i].Expires, Links[i].Used, now)) return Task.FromResult<StoredSignInLink?>(null);
            Links[i] = Links[i] with { Used = now };
            return Task.FromResult<StoredSignInLink?>(new(Links[i].Profile, Accounts[Links[i].Profile].Email, Links[i].Expires, now));
        }
        public Task<IReadOnlyList<Guid>> ExpiredTemporaryAsync(DateTimeOffset now, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Guid>>(Temp.Where(t => EasyPassword.HasExpired(t.Value.MustChange, t.Value.Expires, now)).Select(t => t.Key).ToList());
    }

    private sealed class Auth : IAuthAdmin
    {
        public readonly Dictionary<Guid, string> Passwords = new();
        public readonly List<string> RecoveryEmails = new();
        public Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct) { Passwords[userId] = password; return Task.FromResult(true); }
        public Task<string?> MagicLinkTokenHashAsync(string email, CancellationToken ct) => Task.FromResult<string?>("hashed-" + email);
        public Task SendRecoveryEmailAsync(string email, string? redirectTo, CancellationToken ct) { RecoveryEmails.Add(email); return Task.CompletedTask; }
    }

    private sealed class Bot : IResetMessenger
    {
        public readonly List<(long Chat, string Text, string? Button, string? Url)> Sent = new();
        public Task<bool> SendAsync(long chatId, string text, CancellationToken ct) { Sent.Add((chatId, text, null, null)); return Task.FromResult(true); }
        public Task<bool> SendWithLinkAsync(long chatId, string text, string buttonText, string url, CancellationToken ct) { Sent.Add((chatId, text, buttonText, url)); return Task.FromResult(true); }
    }

    private sealed class Audit : IAuditWriter
    {
        public readonly List<(string? Actor, string Action, string? Entity)> Rows = new();
        public Task WriteAsync(ClaimsPrincipal user, string action, string entityType, string? entityId = null,
            long? farmId = null, object? details = null, CancellationToken cancellationToken = default)
        { Rows.Add((user.FindFirst("sub")?.Value, action, entityId)); return Task.CompletedTask; }
    }

    private sealed class World
    {
        public DateTimeOffset Now = DateTimeOffset.Parse("2026-10-19T08:00:00Z");
        public readonly Store Store = new();
        public readonly Auth Auth = new();
        public readonly Bot Bot = new();
        public readonly Audit Audit = new();
        public readonly PasswordResetFlow Flow;
        public World(string? linkBase = "https://app.agroflow.test")
        {
            Store.Now = () => Now;
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SignIn:LinkBaseUrl"] = linkBase }).Build();
            Flow = new PasswordResetFlow(Store, Auth, Bot, Audit, config, () => Now);
        }
        public string LastCode() => Regex.Match(Bot.Sent.Last().Text, @"\b(\d{6})\b").Groups[1].Value;
    }

    private static ClaimsPrincipal Admin() => new(new ClaimsIdentity(new[] { new Claim("sub", ApiHost.Admin.ToString()) }, "test"));

    // 1a. Easy temporary passwords

    [Fact]
    public void Temporary_passwords_are_8_easy_characters_with_no_look_alikes()
    {
        Assert.Equal("ABCDEFGHJKMNPQRSTUVWXYZ23456789", EasyPassword.Alphabet);
        foreach (var lookAlike in "0O1IL") Assert.DoesNotContain(lookAlike, EasyPassword.Alphabet);
        var seen = new HashSet<string>();
        for (var i = 0; i < 2000; i++)
        {
            var p = EasyPassword.Generate();
            Assert.Equal(8, p.Length);
            Assert.All(p, c => Assert.Contains(c, EasyPassword.Alphabet));
            Assert.Contains(p, char.IsDigit);    // Supabase "Letters and digits"
            Assert.Contains(p, char.IsLetter);
            seen.Add(p);
        }
        Assert.True(seen.Count > 1990, "passwords must not repeat");
        Assert.Equal(8, TemporaryPasswordGenerator.Generate().Length);
    }

    [Theory]
    [InlineData("KX7P4MRT", "KX7P 4MRT")]
    [InlineData("ABC", "ABC")]
    public void They_are_shown_as_two_groups_of_four(string password, string shown) =>
        Assert.Equal(shown, EasyPassword.Display(password));

    [Theory]
    [InlineData("KX7P 4MRT", "KX7P4MRT", true)]
    [InlineData("kx7p4mrt", "KX7P4MRT", true)]
    [InlineData(" kx7p-4mrt ", "KX7P4MRT", true)]
    [InlineData("my own password", "MYOWNPASSWORD", false)]
    [InlineData("KX7P4MR0", "KX7P4MR0", false)]   // 0 is never in one of ours
    public void Sign_in_accepts_one_with_or_without_the_space_in_any_case(string typed, string normalised, bool looksTemporary)
    {
        Assert.Equal(normalised, EasyPassword.Normalise(typed));
        Assert.Equal(looksTemporary, EasyPassword.LooksTemporary(typed));
    }

    [Fact]
    public void A_temporary_password_expires_after_72_hours_unless_changed()
    {
        var issued = DateTimeOffset.Parse("2026-10-19T08:00:00Z");
        var expires = EasyPassword.ExpiresAt(issued);
        Assert.Equal(issued.AddHours(72), expires);
        Assert.False(EasyPassword.HasExpired(true, expires, issued.AddHours(71)));
        Assert.True(EasyPassword.HasExpired(true, expires, issued.AddHours(72)));
        Assert.False(EasyPassword.HasExpired(false, expires, issued.AddHours(100)));   // changed: no limit
    }

    [Fact]
    public async Task An_admin_reset_marks_the_password_to_be_changed_and_starts_the_72_hours()
    {
        var w = new World();
        await w.Flow.AdminResetAsync(Admin(), FarmerNoTelegram, CancellationToken.None);
        Assert.Equal((true, (DateTimeOffset?)w.Now.AddHours(72)), w.Store.Temp[FarmerNoTelegram]);
    }

    [Fact]
    public async Task After_72_hours_the_temporary_password_stops_working()
    {
        var w = new World();
        await w.Flow.AdminResetAsync(Admin(), FarmerNoTelegram, CancellationToken.None);
        var temporary = w.Auth.Passwords[FarmerNoTelegram];
        w.Now = w.Now.AddHours(71);
        Assert.Equal(0, await w.Flow.ExpireTemporaryPasswordsAsync(CancellationToken.None));
        w.Now = w.Now.AddHours(2);
        Assert.Equal(1, await w.Flow.ExpireTemporaryPasswordsAsync(CancellationToken.None));
        Assert.NotEqual(temporary, w.Auth.Passwords[FarmerNoTelegram]);         // replaced with an unknown one
        Assert.True(w.Auth.Passwords[FarmerNoTelegram].Length > 40);
        Assert.Equal(0, await w.Flow.ExpireTemporaryPasswordsAsync(CancellationToken.None));   // once only
    }

    // 2. Forgot password over Telegram

    [Fact]
    public async Task A_linked_farmer_gets_a_6_digit_code_that_is_stored_only_hashed()
    {
        var w = new World();
        await w.Flow.RequestAsync("Thandi@Example.org ", null, CancellationToken.None);
        var msg = Assert.Single(w.Bot.Sent);
        Assert.Equal(111, msg.Chat);
        var code = w.LastCode();
        Assert.Matches(@"^\d{6}$", code);
        Assert.Contains("10 minutes", msg.Text);
        Assert.Contains("If this wasn't you, ignore this and tell AgroFlow.", msg.Text);
        var stored = Assert.Single(w.Store.Codes);
        Assert.DoesNotContain(code, stored.Hash);
        Assert.Equal(ResetCode.Hash(code, stored.Salt), stored.Hash);
        Assert.Equal(w.Now.AddMinutes(10), stored.Expires);
    }

    [Fact]
    public async Task No_telegram_unknown_email_and_rate_limit_send_nothing_and_never_throw()
    {
        var w = new World();
        await w.Flow.RequestAsync("nobody@example.org", null, CancellationToken.None);
        await w.Flow.RequestAsync("sipho@example.org", null, CancellationToken.None);   // farmer, no Telegram: no email either
        await w.Flow.RequestAsync("", null, CancellationToken.None);
        Assert.Empty(w.Bot.Sent);
        Assert.Empty(w.Auth.RecoveryEmails);

        for (var i = 0; i < 5; i++) await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        Assert.Equal(ResetCode.MaxRequestsPerHour, w.Bot.Sent.Count);   // 3 an hour, not 5
        w.Now = w.Now.AddMinutes(61);
        await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        Assert.Equal(4, w.Bot.Sent.Count);
    }

    [Fact]
    public async Task Staff_with_no_telegram_get_the_email_reset_instead()
    {
        var w = new World();
        await w.Flow.RequestAsync("staff@agroflow.test", "https://admin.agroflow.test/?reset=1", CancellationToken.None);
        Assert.Equal(new[] { "staff@agroflow.test" }, w.Auth.RecoveryEmails);
        Assert.Empty(w.Bot.Sent);
    }

    [Fact]
    public async Task The_right_code_changes_the_password_once_ends_other_sessions_and_is_audited()
    {
        var w = new World();
        await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        var code = w.LastCode();

        Assert.Equal(ConfirmResult.Changed, await w.Flow.ConfirmAsync("thandi@example.org", code[..3] + " " + code[3..], "my-new-password", CancellationToken.None));
        Assert.Equal("my-new-password", w.Auth.Passwords[FarmerLinked]);
        Assert.Equal((false, (DateTimeOffset?)null), w.Store.Temp[FarmerLinked]);
        Assert.Equal(new[] { FarmerLinked }, w.Store.SessionsEnded);
        Assert.Equal("Your password was changed. If this wasn't you, tell AgroFlow straight away.", w.Bot.Sent.Last().Text);
        var row = Assert.Single(w.Audit.Rows);
        Assert.Equal(("user.password_reset_self", FarmerLinked.ToString()), (row.Action, row.Entity));

        // Single use.
        Assert.Equal(ConfirmResult.WrongOrExpired, await w.Flow.ConfirmAsync("thandi@example.org", code, "another-password", CancellationToken.None));
        Assert.Equal("my-new-password", w.Auth.Passwords[FarmerLinked]);
    }

    [Fact]
    public async Task A_code_expires_after_10_minutes()
    {
        var w = new World();
        await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        var code = w.LastCode();
        w.Now = w.Now.AddMinutes(10);
        Assert.Equal(ConfirmResult.WrongOrExpired, await w.Flow.ConfirmAsync("thandi@example.org", code, "my-new-password", CancellationToken.None));
        Assert.Empty(w.Auth.Passwords);
    }

    [Fact]
    public async Task Five_wrong_tries_end_the_code_even_for_the_right_one()
    {
        var w = new World();
        await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        var code = w.LastCode();
        var wrong = code == "000000" ? "111111" : "000000";
        for (var i = 0; i < 4; i++)
            Assert.Equal(ConfirmResult.WrongOrExpired, await w.Flow.ConfirmAsync("thandi@example.org", wrong, "my-new-password", CancellationToken.None));
        Assert.Equal(ConfirmResult.TooManyAttempts, await w.Flow.ConfirmAsync("thandi@example.org", wrong, "my-new-password", CancellationToken.None));
        Assert.Equal(ConfirmResult.TooManyAttempts, await w.Flow.ConfirmAsync("thandi@example.org", code, "my-new-password", CancellationToken.None));
        Assert.Empty(w.Auth.Passwords);
    }

    [Fact]
    public async Task A_short_new_password_or_an_unknown_email_changes_nothing()
    {
        var w = new World();
        await w.Flow.RequestAsync("thandi@example.org", null, CancellationToken.None);
        Assert.Equal(ConfirmResult.WeakPassword, await w.Flow.ConfirmAsync("thandi@example.org", w.LastCode(), "short", CancellationToken.None));
        Assert.Equal(ConfirmResult.WrongOrExpired, await w.Flow.ConfirmAsync("nobody@example.org", "123456", "my-new-password", CancellationToken.None));
        Assert.Empty(w.Auth.Passwords);
    }

    [Fact]
    public void Code_rules()
    {
        Assert.Matches(@"^\d{6}$", ResetCode.Generate());
        Assert.Equal("123456", ResetCode.Normalise(" 123 456 "));
        Assert.True(ResetCode.CanRequest(2));
        Assert.False(ResetCode.CanRequest(3));
        var salt = ResetCode.NewSalt();
        var now = DateTimeOffset.UtcNow;
        var hash = ResetCode.Hash("123456", salt);
        Assert.Equal(CodeCheck.Ok, ResetCode.Check(hash, salt, now.AddMinutes(5), null, 0, "123456", now));
        Assert.Equal(CodeCheck.Wrong, ResetCode.Check(hash, salt, now.AddMinutes(5), null, 0, "654321", now));
        Assert.Equal(CodeCheck.Used, ResetCode.Check(hash, salt, now.AddMinutes(5), now, 0, "123456", now));
        Assert.Equal(CodeCheck.Expired, ResetCode.Check(hash, salt, now, null, 0, "123456", now));
        Assert.Equal(CodeCheck.TooManyAttempts, ResetCode.Check(hash, salt, now.AddMinutes(5), null, 5, "123456", now));
        Assert.Equal(CodeCheck.None, ResetCode.Check(null, null, null, null, 0, "123456", now));
    }

    [Fact]
    public async Task Telegram_messages_follow_the_saved_language()
    {
        var w = new World();
        await w.Flow.RequestAsync("anna@example.org", null, CancellationToken.None);
        Assert.StartsWith("Jou AgroFlow-kode is ", w.Bot.Sent.Last().Text);
        await w.Flow.AdminResetAsync(Admin(), FarmerAfrikaans, CancellationToken.None);
        Assert.StartsWith("AgroFlow het vir jou 'n nuwe tydelike wagwoord gegee", w.Bot.Sent.Last().Text);
    }

    // Admin reset

    [Fact]
    public async Task Admin_reset_sends_by_telegram_when_linked_and_never_shows_it()
    {
        var w = new World();
        var r = await w.Flow.AdminResetAsync(Admin(), FarmerLinked, CancellationToken.None);
        Assert.True(r.SentByTelegram);
        Assert.Null(r.ShownOnce);
        Assert.Contains(EasyPassword.Display(w.Auth.Passwords[FarmerLinked]), w.Bot.Sent.Last().Text);
        Assert.Equal(("user.password_reset", FarmerLinked.ToString()), (w.Audit.Rows.Single().Action, w.Audit.Rows.Single().Entity));
    }

    [Fact]
    public async Task Admin_reset_with_no_telegram_shows_it_once_in_groups_of_four()
    {
        var w = new World();
        var r = await w.Flow.AdminResetAsync(Admin(), FarmerNoTelegram, CancellationToken.None);
        Assert.False(r.SentByTelegram);
        Assert.Equal(EasyPassword.Display(w.Auth.Passwords[FarmerNoTelegram]), r.ShownOnce);
        Assert.Matches(@"^[A-Z2-9]{4} [A-Z2-9]{4}$", r.ShownOnce!);
        Assert.Empty(w.Bot.Sent);
        Assert.Single(w.Audit.Rows);
    }

    // 1b. One-tap sign-in

    [Fact]
    public async Task The_welcome_has_a_one_tap_link_that_works_once_for_24_hours()
    {
        var w = new World();
        Assert.True(await w.Flow.SendWelcomeAsync(FarmerLinked, "Nkosi Farm", "Philippi", null, CancellationToken.None));
        var msg = w.Bot.Sent.Last();
        Assert.Equal("Sign in to AgroFlow", msg.Button);
        Assert.StartsWith("https://app.agroflow.test/signin?token=", msg.Url);
        Assert.Contains(EasyPassword.Display(w.Auth.Passwords[FarmerLinked]), msg.Text);   // the typed fallback
        var token = Uri.UnescapeDataString(msg.Url![(msg.Url!.IndexOf("token=", StringComparison.Ordinal) + 6)..]);
        Assert.DoesNotContain(token, w.Store.Links.Single().Hash);                         // only the hash is kept

        var first = await w.Flow.RedeemSignInLinkAsync(token, CancellationToken.None);
        Assert.Equal(("thandi@example.org", "hashed-thandi@example.org"), first);
        Assert.Null(await w.Flow.RedeemSignInLinkAsync(token, CancellationToken.None));   // once

        Assert.True(await w.Flow.SendWelcomeAsync(FarmerLinked, "Nkosi Farm", "Philippi", null, CancellationToken.None));
        var second = w.Bot.Sent.Last().Url!;
        var token2 = Uri.UnescapeDataString(second[(second.IndexOf("token=", StringComparison.Ordinal) + 6)..]);
        w.Now = w.Now.AddHours(24);
        Assert.Null(await w.Flow.RedeemSignInLinkAsync(token2, CancellationToken.None));  // 24 hours
        Assert.Null(await w.Flow.RedeemSignInLinkAsync("made-up", CancellationToken.None));
    }

    [Fact]
    public async Task Without_a_web_app_address_the_welcome_has_only_the_typed_password()
    {
        var w = new World(linkBase: null);
        Assert.True(await w.Flow.SendWelcomeAsync(FarmerLinked, "Nkosi Farm", "Philippi", null, CancellationToken.None));
        Assert.Null(w.Bot.Sent.Last().Button);
        Assert.Empty(w.Store.Links);
    }

    // The HTTP routes

    private (HttpClient Client, World World) Client()
    {
        var w = new World();
        var client = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<PasswordResetFlow>();
            s.AddSingleton(w.Flow);
        })).CreateClient();
        return (client, w);
    }

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    [Fact]
    public async Task Forgot_password_always_gives_the_same_reply()
    {
        var (client, w) = Client();
        var bodies = new List<string>();
        foreach (var email in new[] { "thandi@example.org", "sipho@example.org", "nobody@example.org", "" })
        {
            var res = await client.PostAsync("/api/auth/forgot-password", Json(new { email }));
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            bodies.Add(await res.Content.ReadAsStringAsync());
        }
        Assert.Single(bodies.Distinct());
        Assert.Contains("If this account has Telegram linked, we've sent a code.", bodies[0]);
        Assert.Single(w.Bot.Sent);   // only the linked farmer got one
    }

    [Fact]
    public async Task Reset_password_route_changes_it_with_the_right_code_only()
    {
        var (client, w) = Client();
        await client.PostAsync("/api/auth/forgot-password", Json(new { email = "thandi@example.org" }));
        var wrong = await client.PostAsync("/api/auth/reset-password", Json(new { email = "thandi@example.org", code = "999999" == w.LastCode() ? "111111" : "999999", newPassword = "my-new-password" }));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        var right = await client.PostAsync("/api/auth/reset-password", Json(new { email = "thandi@example.org", code = w.LastCode(), newPassword = "my-new-password" }));
        Assert.Equal(HttpStatusCode.OK, right.StatusCode);
        Assert.Contains("Your password was changed.", await right.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_admin_reset_route_is_staff_only()
    {
        var (client, _) = Client();
        var asFarmer = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/farmers/{FarmerNoTelegram}/reset-password");
        asFarmer.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Farmer.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(asFarmer)).StatusCode);

        var asAdmin = new HttpRequestMessage(HttpMethod.Post, $"/api/admin/farmers/{FarmerNoTelegram}/reset-password");
        asAdmin.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var res = await client.SendAsync(asAdmin);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.False(body.GetProperty("sentByTelegram").GetBoolean());
        Assert.Matches(@"^[A-Z2-9]{4} [A-Z2-9]{4}$", body.GetProperty("temporaryPassword").GetString()!);
    }

    [Fact]
    public async Task One_tap_route_refuses_a_bad_link_in_plain_words()
    {
        var (client, _) = Client();
        var res = await client.PostAsync("/api/auth/one-tap", Json(new { token = "not-a-real-token" }));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Sign in with your temporary password instead.", await res.Content.ReadAsStringAsync());
    }
}
