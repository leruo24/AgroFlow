using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Services.Notifications;

// Thin wrapper over the two Telegram Bot API methods AgroFlow uses:
// sendMessage (outbound) and getUpdates (inbound long poll). Deliberately not
// a full Bot API client library - two methods is the whole surface, and a
// dependency here would be more code to audit than the code it replaces.
public sealed class TelegramClient
{
    // Telegram rejects a message over 4096 UTF-16 code units outright. Every
    // message AgroFlow sends is far under this; the guard exists so a
    // pathological farm/zone name can never turn into a failed alert.
    private const int MaxMessageLength = 4096;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly TelegramOptions _options;
    private readonly ILogger<TelegramClient> _logger;

    public TelegramClient(
        IHttpClientFactory httpClientFactory,
        IOptions<TelegramOptions> options,
        ILogger<TelegramClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured => _options.IsConfigured;

    // Returns false instead of throwing on every failure mode, so callers can
    // stay on the INotificationService "never throws" contract without
    // wrapping each call in its own try/catch.
    //
    // Messages are sent as PLAIN TEXT with no parse_mode on purpose. The
    // welcome message contains a generated password whose alphabet includes
    // the characters Markdown and HTML treat as markup (_ * ` [ < &), and a
    // password is exactly the kind of string that must arrive byte-for-byte.
    // Asking Telegram to parse it would either mangle it or fail the send.
    public Task<bool> SendMessageAsync(
        long chatId,
        string text,
        CancellationToken cancellationToken) =>
        SendMessageAsync(chatId, text, whyExplanationId: null, cancellationToken);

    // Item 2c: callback data for the "Why am I seeing this?" button. Only the
    // explanation row id - no names, no farm, nothing personal - and well
    // under Telegram's 64-byte limit.
    public const string WhyCallbackPrefix = "why:";
    public const string WhyButtonText = "Why am I seeing this?";

    public async Task<bool> SendMessageAsync(
        long chatId,
        string text,
        long? whyExplanationId,
        CancellationToken cancellationToken)
    {
        if (!_options.IsConfigured)
        {
            _logger.LogDebug("Telegram send skipped: no bot token configured.");
            return false;
        }

        if (text.Length > MaxMessageLength)
        {
            text = text[..MaxMessageLength];
        }

        try
        {
            var client = _httpClientFactory.CreateClient();

            object payload = whyExplanationId is null
                ? new
                {
                    chat_id = chatId,
                    text,
                    disable_web_page_preview = true,
                }
                : new
                {
                    chat_id = chatId,
                    text,
                    disable_web_page_preview = true,
                    reply_markup = new
                    {
                        inline_keyboard = new[]
                        {
                            new[] { new { text = WhyButtonText, callback_data = WhyCallbackPrefix + whyExplanationId.Value } },
                        },
                    },
                };

            using var response = await client.PostAsJsonAsync(
                BuildUrl("sendMessage"), payload, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return true;
            }

            var error = await response.Content.ReadAsStringAsync(cancellationToken);

            // 403 is the ordinary "this farmer blocked the bot, or deleted
            // the chat" case. It is not an incident and must not be logged as
            // an error every 30 seconds for a zone that stays Critical.
            if (response.StatusCode == HttpStatusCode.Forbidden)
            {
                _logger.LogInformation(
                    "Telegram refused delivery to chat {ChatId} (the farmer has most likely blocked the bot): {Error}",
                    chatId, Redact(error));
            }
            else
            {
                _logger.LogWarning(
                    "Telegram sendMessage to chat {ChatId} failed with {StatusCode}: {Error}",
                    chatId, response.StatusCode, Redact(error));
            }

            return false;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Telegram sendMessage to chat {ChatId} threw.", chatId);
            return false;
        }
    }

    // Unlike SendMessageAsync this DOES throw, because its only caller is the
    // polling loop, which needs to distinguish "nothing happened" from "the
    // call failed" so it can back off rather than hammer the API.
    // sendDocument, for the PDF reports.
    //
    // Multipart rather than a URL, because the PDF is generated in memory and
    // never written anywhere a URL could point at - see migration 0034 on why
    // this deployment stores no files.
    //
    // Returns false instead of throwing, like SendMessageAsync, so a failed
    // delivery can never undo a report that is already marked ready.
    public async Task<bool> SendDocumentAsync(
        long chatId,
        byte[] document,
        string fileName,
        string caption,
        CancellationToken cancellationToken)
    {
        if (!_options.IsConfigured)
        {
            _logger.LogDebug("Telegram document send skipped: no bot token configured.");
            return false;
        }

        // Telegram's own limit for a bot upload is 50 MB. An AgroFlow report
        // is a few pages, so this only ever catches a runaway render - but a
        // 50 MB POST from a small container is worth refusing locally rather
        // than discovering at the far end.
        const int maxBytes = 50 * 1024 * 1024;
        if (document.Length == 0 || document.Length > maxBytes)
        {
            _logger.LogWarning(
                "Refusing to send a {Bytes}-byte document to Telegram.", document.Length);

            return false;
        }

        // Telegram truncates a caption over 1024 characters; ours are one
        // line, so this only guards a pathological farm name.
        const int maxCaption = 1024;
        if (caption.Length > maxCaption) caption = caption[..maxCaption];

        try
        {
            var client = _httpClientFactory.CreateClient();

            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(chatId.ToString()), "chat_id");
            form.Add(new StringContent(caption), "caption");

            var file = new ByteArrayContent(document);
            file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
            form.Add(file, "document", fileName);

            using var response = await client.PostAsync(
                BuildUrl("sendDocument"), form, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                // The body carries Telegram's own reason (blocked bot, bad
                // chat id), which is the useful half.
                var body = await response.Content.ReadAsStringAsync(cancellationToken);

                _logger.LogWarning(
                    "Telegram sendDocument failed ({Status}): {Body}", response.StatusCode, body);

                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Telegram sendDocument threw; the report is still available in the app.");
            return false;
        }
    }

    public async Task<IReadOnlyList<TelegramUpdate>> GetUpdatesAsync(
        long offset,
        CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient();

        // Slightly longer than the server-side long poll so the HTTP client
        // never times out a connection Telegram is legitimately holding open.
        client.Timeout = TimeSpan.FromSeconds(_options.LongPollSeconds + 15);

        using var response = await client.PostAsJsonAsync(
            BuildUrl("getUpdates"),
            new
            {
                offset,
                timeout = _options.LongPollSeconds,

                // Messages, and button taps (item 2c's "Why am I seeing
                // this?"). Edited messages, reactions and channel posts stay
                // out of the loop entirely.
                allowed_updates = new[] { "message", "callback_query" },
            },
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(cancellationToken);

            throw new TelegramApiException(
                response.StatusCode,
                $"getUpdates failed with {(int)response.StatusCode}: {Redact(error)}");
        }

        var payload = await response.Content.ReadFromJsonAsync<TelegramUpdatesResponse>(
            cancellationToken: cancellationToken);

        return payload?.Result ?? [];
    }

    // Stops the spinner on a tapped inline button. Telegram shows it until
    // this is called. Never throws - a spinner that keeps turning is not
    // worth failing anything over.
    public async Task<bool> AnswerCallbackQueryAsync(
        string callbackQueryId,
        string? text,
        CancellationToken cancellationToken)
    {
        if (!_options.IsConfigured) return false;

        try
        {
            var client = _httpClientFactory.CreateClient();
            using var response = await client.PostAsJsonAsync(
                BuildUrl("answerCallbackQuery"),
                new { callback_query_id = callbackQueryId, text },
                cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "answerCallbackQuery failed.");
            return false;
        }
    }

    private string BuildUrl(string method) =>
        $"https://api.telegram.org/bot{_options.BotToken}/{method}";

    // Telegram echoes the request URL - which contains the bot token - in
    // some error bodies. Anything logged from a response body goes through
    // here first so the token cannot reach the Railway log stream.
    private string Redact(string text)
    {
        var token = _options.BotToken;

        return string.IsNullOrEmpty(token)
            ? text
            : text.Replace(token, "<redacted>", StringComparison.Ordinal);
    }
}

public sealed class TelegramApiException : Exception
{
    public TelegramApiException(HttpStatusCode statusCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
    }

    public HttpStatusCode StatusCode { get; }
}

public sealed record TelegramUpdatesResponse(
    [property: JsonPropertyName("result")] List<TelegramUpdate>? Result);

public sealed record TelegramUpdate(
    [property: JsonPropertyName("update_id")] long UpdateId,
    [property: JsonPropertyName("message")] TelegramMessage? Message,
    [property: JsonPropertyName("callback_query")] TelegramCallbackQuery? CallbackQuery = null);

// A tap on an inline button. Message is the message the button was on, so
// its chat is the chat that tapped.
public sealed record TelegramCallbackQuery(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("message")] TelegramMessage? Message,
    [property: JsonPropertyName("data")] string? Data);

public sealed record TelegramMessage(
    [property: JsonPropertyName("chat")] TelegramChat? Chat,
    [property: JsonPropertyName("text")] string? Text,
    [property: JsonPropertyName("from")] TelegramUser? From);

public sealed record TelegramChat(
    [property: JsonPropertyName("id")] long Id);

public sealed record TelegramUser(
    [property: JsonPropertyName("first_name")] string? FirstName);
