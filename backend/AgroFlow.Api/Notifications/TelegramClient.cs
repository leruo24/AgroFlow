using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Services.Notifications;

// A thin wrapper over the two Telegram Bot API methods we use: sendMessage and
// getUpdates (long poll). Two methods do not justify a library dependency.
public sealed class TelegramClient
{
    // Telegram rejects messages over 4096 UTF-16 code units. Ours are far shorter;
    // this guard stops a very long farm or zone name from failing an alert.
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

    // Returns false instead of throwing, so callers keep the "never throws" contract.
    // Sent as plain text with no parse_mode: the welcome message contains a generated
    // password that can include _ * ` [ < &, and Markdown or HTML parsing would mangle it.
    public Task<bool> SendMessageAsync(
        long chatId,
        string text,
        CancellationToken cancellationToken) =>
        SendMessageAsync(chatId, text, whyExplanationId: null, cancellationToken);

    // Callback data for the "Why am I seeing this?" button: only the explanation row
    // id (nothing personal), well under Telegram's 64-byte limit.
    public const string WhyCallbackPrefix = "why:";
    public const string WhyButtonText = "Why am I seeing this?";

    public Task<bool> SendMessageAsync(
        long chatId,
        string text,
        long? whyExplanationId,
        CancellationToken cancellationToken) =>
        SendWithMarkupAsync(chatId, text, whyExplanationId is null ? null : new
        {
            inline_keyboard = new[]
            {
                new[] { new { text = WhyButtonText, callback_data = WhyCallbackPrefix + whyExplanationId.Value } },
            },
        }, cancellationToken);

    // A message with one button that opens a web address, e.g. "Sign in to AgroFlow".
    // Telegram only allows http(s) addresses on these buttons.
    public Task<bool> SendMessageWithLinkAsync(
        long chatId,
        string text,
        string buttonText,
        string url,
        CancellationToken cancellationToken) =>
        SendWithMarkupAsync(chatId, text, new
        {
            inline_keyboard = new[] { new[] { new { text = buttonText, url } } },
        }, cancellationToken);

    // A message with one button that answers back to the bot, e.g. "Turn on automatic watering"
    // (callback data "auto:<zoneId>", handled in TelegramPollingService).
    public const string AutoCallbackPrefix = "auto:";

    public Task<bool> SendMessageWithCallbackAsync(
        long chatId,
        string text,
        string buttonText,
        string callbackData,
        CancellationToken cancellationToken) =>
        SendWithMarkupAsync(chatId, text, new
        {
            inline_keyboard = new[] { new[] { new { text = buttonText, callback_data = callbackData } } },
        }, cancellationToken);

    private async Task<bool> SendWithMarkupAsync(
        long chatId,
        string text,
        object? replyMarkup,
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

            object payload = replyMarkup is null
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
                    reply_markup = replyMarkup,
                };

            using var response = await client.PostAsJsonAsync(
                BuildUrl("sendMessage"), payload, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return true;
            }

            var error = await response.Content.ReadAsStringAsync(cancellationToken);

            // 403 means the farmer blocked the bot or deleted the chat. That is normal, so we
            // do not log it as an error every 30 seconds.
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

    // Unlike SendMessageAsync this throws, because the polling loop needs to tell
    // "nothing happened" from "the call failed" so it can back off.
    // sendDocument, for the PDF reports: multipart, because the PDF is made in memory
    // and never stored (see migration 0034). Returns false instead of throwing, so a
    // failed delivery never undoes a report already marked ready.
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

        // Telegram's bot upload limit is 50 MB. Our reports are a few pages, so this only
        // catches a runaway render before we send it.
        const int maxBytes = 50 * 1024 * 1024;
        if (document.Length == 0 || document.Length > maxBytes)
        {
            _logger.LogWarning(
                "Refusing to send a {Bytes}-byte document to Telegram.", document.Length);

            return false;
        }

        // Telegram cuts captions over 1024 characters; ours are one line, so this only
        // guards against a very long farm name.
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
                // The body has Telegram's reason (blocked bot, bad chat id), which is the useful part.
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

        // A bit longer than the long poll, so the HTTP client never drops a connection
        // Telegram is holding open.
        client.Timeout = TimeSpan.FromSeconds(_options.LongPollSeconds + 15);

        using var response = await client.PostAsJsonAsync(
            BuildUrl("getUpdates"),
            new
            {
                offset,
                timeout = _options.LongPollSeconds,

                // Messages and button taps ("Why am I seeing this?") only; edited messages,
                // reactions and channel posts are ignored.
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

    // Stops the spinner on a tapped inline button. Never throws: a spinner is not
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

    // Security: Telegram sometimes echoes the request URL (which contains the bot token)
    // in error bodies, so anything logged from a response goes through here first.
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

// A tap on an inline button. Message is the message the button was on, so its
// chat is the chat that tapped.
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
