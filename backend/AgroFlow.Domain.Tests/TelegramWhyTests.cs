using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business.Agronomy.RuleBook;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 2c: Telegram's "Why am I seeing this?". Fakes only - no bot, no
// database, no network.
public class TelegramWhyTests
{
    private const long OwnerChat = 111;
    private const long StrangerChat = 999;
    private const long FarmA = 7;

    private sealed class FakeStore : IExplanationStore
    {
        public readonly Dictionary<long, StoredExplanation> Rows = new();
        public Task<long?> SaveAsync(long farmId, long? zoneId, string kind, Explanation e, CancellationToken ct)
        {
            var id = Rows.Count + 1L;
            Rows[id] = new StoredExplanation(id, farmId, e);
            return Task.FromResult<long?>(id);
        }
        public Task<StoredExplanation?> GetAsync(long id, CancellationToken ct) =>
            Task.FromResult(Rows.TryGetValue(id, out var r) ? r : null);
    }

    private sealed class FakeAccess : IChatFarmAccess
    {
        public Task<IReadOnlySet<long>> FarmsForChatAsync(long chatId, CancellationToken ct) =>
            Task.FromResult<IReadOnlySet<long>>(chatId == OwnerChat ? new HashSet<long> { FarmA } : new HashSet<long>());
    }

    private sealed class FakeReplies : ITelegramReplies
    {
        public readonly List<(long Chat, string Text)> Sent = new();
        public readonly List<(string Id, string? Text)> Answers = new();
        public Task SendAsync(long chatId, string text, CancellationToken ct) { Sent.Add((chatId, text)); return Task.CompletedTask; }
        public Task AnswerCallbackAsync(string id, string? text, CancellationToken ct) { Answers.Add((id, text)); return Task.CompletedTask; }
    }

    private static Explanation Sample() => new Explanation
    {
        Summary = "Frost is expected on Tuesday.",
        Rule = "We warn when the forecast low is 2 °C or colder.",
        Confidence = "Medium: forecasts change.",
        WhatWouldChangeIt = "A warmer forecast.",
        Technical = "SECRET-TECHNICAL WeatherAlertService Frost",
    }.Fact("Forecast", "1 °C", "weather app");

    private static (TelegramWhyHandler Handler, FakeStore Store, FakeReplies Replies) Make()
    {
        var store = new FakeStore();
        var replies = new FakeReplies();
        return (new TelegramWhyHandler(store, new FakeAccess(), replies), store, replies);
    }

    [Fact]
    public async Task Callback_FromTheOwningChat_GetsTheFullExplanation()
    {
        var (h, store, replies) = Make();
        var id = await store.SaveAsync(FarmA, null, "weather_frost", Sample(), default);

        await h.HandleCallbackAsync("cb1", OwnerChat, "why:" + id, default);

        Assert.Equal(("cb1", (string?)null), replies.Answers.Single());
        var (chat, text) = replies.Sent.Single();
        Assert.Equal(OwnerChat, chat);
        Assert.Contains("Frost is expected on Tuesday.", text);
        Assert.Contains("Forecast: 1 °C (weather app)", text);
        Assert.Contains("The rule: We warn when", text);
        Assert.DoesNotContain("SECRET-TECHNICAL", text);
    }

    [Fact]
    public async Task Callback_FromAnotherChat_IsRefused_AndRevealsNothing()
    {
        var (h, store, replies) = Make();
        var id = await store.SaveAsync(FarmA, null, "weather_frost", Sample(), default);

        await h.HandleCallbackAsync("cb2", StrangerChat, "why:" + id, default);

        Assert.Empty(replies.Sent);
        Assert.Equal(TelegramWhyHandler.NotYours, replies.Answers.Single().Text);
    }

    [Fact]
    public async Task UnknownId_LooksExactlyLikeSomeoneElses()
    {
        var (h, _, replies) = Make();
        await h.HandleCallbackAsync("cb3", OwnerChat, "why:424242", default);

        Assert.Empty(replies.Sent);
        Assert.Equal(TelegramWhyHandler.NotYours, replies.Answers.Single().Text);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("why:")]
    [InlineData("why:-3")]
    [InlineData("why:abc")]
    [InlineData("other:5")]
    public async Task GarbageCallbackData_JustStopsTheSpinner(string? data)
    {
        var (h, _, replies) = Make();
        await h.HandleCallbackAsync("cb4", OwnerChat, data, default);

        Assert.Empty(replies.Sent);
        Assert.Null(replies.Answers.Single().Text);
    }

    [Fact]
    public async Task WhyCommand_Works_AndChecksTheChatToo()
    {
        var (h, store, replies) = Make();
        var id = await store.SaveAsync(FarmA, null, "weather_frost", Sample(), default);

        await h.HandleWhyCommandAsync(OwnerChat, id.ToString(), default);
        await h.HandleWhyCommandAsync(StrangerChat, id.ToString(), default);
        await h.HandleWhyCommandAsync(OwnerChat, "nonsense", default);

        Assert.Contains("Frost is expected", replies.Sent[0].Text);
        Assert.Equal((StrangerChat, TelegramWhyHandler.NotYours), replies.Sent[1]);
        Assert.Equal((OwnerChat, TelegramWhyHandler.Usage), replies.Sent[2]);
    }

    [Fact]
    public void CallbackData_IsShortAndCarriesOnlyTheId()
    {
        var data = TelegramClient.WhyCallbackPrefix + long.MaxValue;
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(data) <= 64, "Telegram limits callback data to 64 bytes");
        Assert.Equal(long.MaxValue, TelegramWhyHandler.ParseCallback(data));
    }

    // ---- the explanations alerts carry ------------------------------------

    private static readonly Regex Jargon = new(@"\b(ETc|ETo|Kc|RAW|TAW|moisture_threshold)\b|\d{4}-\d{2}-\d{2}");

    public static IEnumerable<object[]> AlertExplanationCases()
    {
        var weather = new WeatherAlertOptions();
        var device = new DeviceMonitorOptions();
        var day = new DateOnly(2026, 10, 7);

        foreach (var kind in Enum.GetValues<WeatherAlertKind>())
            yield return new object[] { kind.ToString(), AlertExplanations.Weather(new WeatherAlertNotification(kind, day, 1.5, "Green Farm"), weather) };
        foreach (var kind in Enum.GetValues<SystemFailureKind>())
            yield return new object[] { kind.ToString(), AlertExplanations.SystemFailure(new SystemFailureNotification(kind, "Tub 1", "Green Farm", "about 3 hours ago"), device) };
        foreach (var reason in Enum.GetValues<AgroFlow.Api.Services.Notifications.ZoneCriticalReason>())
            yield return new object[] { reason.ToString(), AlertExplanations.ZoneCritical("Tub 1", 12.5f, reason) };
    }

    [Theory]
    [MemberData(nameof(AlertExplanationCases))]
    public void EveryAlertExplanation_IsCompleteAndPlain(string kind, Explanation e)
    {
        Assert.False(string.IsNullOrWhiteSpace(e.Summary), kind);
        Assert.False(string.IsNullOrWhiteSpace(e.Rule), kind);
        Assert.False(string.IsNullOrWhiteSpace(e.Confidence), kind);
        Assert.False(string.IsNullOrWhiteSpace(e.WhatWouldChangeIt), kind);
        Assert.NotEmpty(e.Facts);

        foreach (var text in new[] { e.Summary, e.Rule, e.Confidence, e.WhatWouldChangeIt! }.Concat(e.Facts.SelectMany(f => new[] { f.Label, f.Value, f.Source })))
        {
            Assert.False(Jargon.IsMatch(text), $"{kind}: jargon in \"{text}\"");
            Assert.DoesNotContain("%", text);
        }
    }

    [Fact]
    public void AlertExplanations_QuoteTheConfiguredThresholds()
    {
        var weather = new WeatherAlertOptions { FrostMinC = 3, HeavyRainMm = 25 };
        var frost = AlertExplanations.Weather(new WeatherAlertNotification(WeatherAlertKind.Frost, new DateOnly(2026, 10, 7), 1, "F"), weather);
        var rain = AlertExplanations.Weather(new WeatherAlertNotification(WeatherAlertKind.HeavyRain, new DateOnly(2026, 10, 7), 40, "F"), weather);
        var offline = AlertExplanations.SystemFailure(new SystemFailureNotification(SystemFailureKind.DeviceOffline, "Kit 1", "F", null), new DeviceMonitorOptions { OfflineAfterMinutes = 45 });

        Assert.Contains("3 °C", frost.Rule);
        Assert.Contains("25 mm", rain.Rule);
        Assert.Contains("45 minutes", offline.Rule);
    }

    // ---- the wire format --------------------------------------------------

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public readonly List<string> Bodies = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(request.Content == null ? "" : await request.Content.ReadAsStringAsync(ct));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"ok\":true,\"result\":[]}") };
        }
    }

    private sealed class Factory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public Factory(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new HttpClient(_h, disposeHandler: false);
    }

    [Fact]
    public async Task TheButton_CarriesWhyAndTheId_AndPollingAsksForButtonTaps()
    {
        var handler = new CapturingHandler();
        var client = new TelegramClient(new Factory(handler),
            Options.Create(new TelegramOptions { BotToken = "test-token" }), NullLogger<TelegramClient>.Instance);

        await client.SendMessageAsync(5, "Frost expected", whyExplanationId: 42, default);
        await client.SendMessageAsync(5, "No button", default);
        await client.GetUpdatesAsync(0, default);

        Assert.Contains("\"callback_data\":\"why:42\"", handler.Bodies[0]);
        Assert.Contains(TelegramClient.WhyButtonText, handler.Bodies[0]);
        Assert.DoesNotContain("reply_markup", handler.Bodies[1]);
        Assert.Contains("callback_query", handler.Bodies[2]);
    }
}
