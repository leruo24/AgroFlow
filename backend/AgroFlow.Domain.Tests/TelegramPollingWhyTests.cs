using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business.Agronomy.RuleBook;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Follow-up 1: the "Why am I seeing this?" tap, end to end through the
// polling service (no webhook) - a real Telegram-shaped update in, the Bot API
// calls out. Every HTTP call is captured in memory; nothing reaches Telegram.
public class TelegramPollingWhyTests
{
    private const long OwnerChat = 111;
    private const long StrangerChat = 999;
    private const long FarmA = 7;

    private sealed record Call(string Method, JsonElement Body);

    private sealed class FakeTelegram : HttpMessageHandler
    {
        public readonly List<Call> Calls = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(ct);
            var method = request.RequestUri!.Segments.Last();
            Calls.Add(new Call(method, JsonDocument.Parse(body).RootElement.Clone()));
            var result = method == "getUpdates" ? "[]" : "true";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"ok\":true,\"result\":" + result + "}", Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed class Factory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public Factory(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new(_h, disposeHandler: false);
    }

    private sealed class Store : IExplanationStore
    {
        public Task<long?> SaveAsync(long farmId, long? zoneId, string kind, Explanation e, CancellationToken ct) => Task.FromResult<long?>(42);
        public Task<StoredExplanation?> GetAsync(long id, CancellationToken ct) =>
            Task.FromResult(id == 42 ? new StoredExplanation(42, FarmA, new Explanation
            {
                Summary = "Frost is expected on Tuesday.",
                Rule = "We warn when the forecast low is 2 °C or colder.",
                Confidence = "Medium: forecasts change.",
                Technical = "SECRET-TECHNICAL WeatherAlertService Frost",
            }) : null);
    }

    private sealed class Access : IChatFarmAccess
    {
        public Task<IReadOnlySet<long>> FarmsForChatAsync(long chatId, CancellationToken ct) =>
            Task.FromResult<IReadOnlySet<long>>(chatId == OwnerChat ? new HashSet<long> { FarmA } : new HashSet<long>());
    }

    private static (TelegramPollingService Polling, FakeTelegram Telegram) Make()
    {
        var telegram = new FakeTelegram();
        var options = Options.Create(new TelegramOptions { BotToken = "test-token" });
        var client = new TelegramClient(new Factory(telegram), options, NullLogger<TelegramClient>.Instance);
        var why = new TelegramWhyHandler(new Store(), new Access(), new TelegramReplies(client));
        // The callback path needs none of onboarding, notifications, Supabase or
        // the database; null stands in so any use of them would throw.
        var polling = new TelegramPollingService(client, null!, null!, null!, null!, why, options,
            NullLogger<TelegramPollingService>.Instance);
        return (polling, telegram);
    }

    /// An update exactly as getUpdates returns it for a button tap.
    private static TelegramUpdate Tap(long? chatId, string data, string queryId = "cbq-1")
    {
        var message = chatId is { } c ? $",\"message\":{{\"message_id\":5,\"chat\":{{\"id\":{c},\"type\":\"private\"}},\"text\":\"Frost expected\"}}" : "";
        var json = $"{{\"update_id\":900,\"callback_query\":{{\"id\":\"{queryId}\",\"from\":{{\"id\":{chatId ?? 1},\"first_name\":\"Thandi\"}}{message},\"data\":\"{data}\"}}}}";
        return JsonSerializer.Deserialize<TelegramUpdate>(json)!;
    }

    [Fact]
    public async Task A_tap_in_the_owning_chat_is_answered_then_explained_there_in_plain_words()
    {
        var (polling, telegram) = Make();
        await polling.HandleUpdateAsync(Tap(OwnerChat, "why:42"), CancellationToken.None);

        Assert.Equal(new[] { "answerCallbackQuery", "sendMessage" }, telegram.Calls.Select(c => c.Method));
        Assert.Equal("cbq-1", telegram.Calls[0].Body.GetProperty("callback_query_id").GetString());

        var send = telegram.Calls[1].Body;
        Assert.Equal(OwnerChat, send.GetProperty("chat_id").GetInt64());
        var text = send.GetProperty("text").GetString()!;
        Assert.Contains("Frost is expected on Tuesday.", text);
        Assert.DoesNotContain("SECRET-TECHNICAL", text);          // never the technical line
        Assert.False(send.TryGetProperty("parse_mode", out _));   // plain text
    }

    [Fact]
    public async Task A_tap_in_any_other_chat_stops_the_spinner_and_sends_nothing()
    {
        var (polling, telegram) = Make();
        await polling.HandleUpdateAsync(Tap(StrangerChat, "why:42"), CancellationToken.None);

        var only = Assert.Single(telegram.Calls);
        Assert.Equal("answerCallbackQuery", only.Method);
        Assert.Equal(TelegramWhyHandler.NotYours, only.Body.GetProperty("text").GetString());
        Assert.DoesNotContain(telegram.Calls, c => c.Method == "sendMessage");
    }

    [Theory]
    [InlineData("why:7777")]      // no such explanation
    [InlineData("something-else")] // not ours
    public async Task An_unknown_tap_is_answered_and_nothing_is_sent(string data)
    {
        var (polling, telegram) = Make();
        await polling.HandleUpdateAsync(Tap(OwnerChat, data), CancellationToken.None);
        Assert.Equal("answerCallbackQuery", Assert.Single(telegram.Calls).Method);
    }

    [Fact]
    public async Task A_tap_with_no_chat_is_still_answered()
    {
        var (polling, telegram) = Make();
        await polling.HandleUpdateAsync(Tap(null, "why:42"), CancellationToken.None);
        Assert.Equal("answerCallbackQuery", Assert.Single(telegram.Calls).Method);
    }

    [Fact]
    public async Task Polling_asks_Telegram_for_button_taps()
    {
        var telegram = new FakeTelegram();
        var client = new TelegramClient(new Factory(telegram),
            Options.Create(new TelegramOptions { BotToken = "test-token" }), NullLogger<TelegramClient>.Instance);
        await client.GetUpdatesAsync(0, CancellationToken.None);

        var allowed = telegram.Calls.Single().Body.GetProperty("allowed_updates").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("callback_query", allowed);
        Assert.Contains("message", allowed);
    }
}
