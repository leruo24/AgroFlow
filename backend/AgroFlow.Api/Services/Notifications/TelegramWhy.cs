using System.Globalization;
using System.Text;
using System.Text.Json;
using AgroFlow.Business.Agronomy.RuleBook;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// "Why am I seeing this?" for Telegram.
// A message that leaves the app saves its explanation (table `explanation`,
// migration 0039) and has a button whose callback data is only that row's id. A tap
// or "/why <id>" gets the full explanation.
// Security: only a chat linked to someone on that farm gets an answer; everyone
// else gets a polite refusal and nothing about the farm.

public sealed record StoredExplanation(long Id, long FarmId, Explanation Explanation);

public interface IExplanationStore
{
    // Null when the table is missing (0039 not applied) or the write failed: the message
    // then goes without a button, but it still goes.
    Task<long?> SaveAsync(long farmId, long? zoneId, string kind, Explanation explanation, CancellationToken cancellationToken);

    Task<StoredExplanation?> GetAsync(long id, CancellationToken cancellationToken);
}

public interface IChatFarmAccess
{
    // The farms the profile linked to this chat owns or is a member of.
    Task<IReadOnlySet<long>> FarmsForChatAsync(long chatId, CancellationToken cancellationToken);
}

public interface ITelegramReplies
{
    Task SendAsync(long chatId, string text, CancellationToken cancellationToken);
    Task AnswerCallbackAsync(string callbackQueryId, string? text, CancellationToken cancellationToken);
}

public sealed class TelegramWhyHandler
{
    public const string NotYours = "That explanation isn't available in this chat.";
    public const string Usage = "Send /why followed by the number from the message, for example: /why 42";

    private readonly IExplanationStore _store;
    private readonly IChatFarmAccess _access;
    private readonly ITelegramReplies _replies;

    public TelegramWhyHandler(IExplanationStore store, IChatFarmAccess access, ITelegramReplies replies)
    {
        _store = store;
        _access = access;
        _replies = replies;
    }

    // Callback data is "why:<id>". Anything else is not ours to answer.
    public static long? ParseCallback(string? data)
    {
        if (data is null || !data.StartsWith(TelegramClient.WhyCallbackPrefix, StringComparison.Ordinal)) return null;
        return long.TryParse(data[TelegramClient.WhyCallbackPrefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var id) && id > 0
            ? id : null;
    }

    public async Task HandleCallbackAsync(string callbackQueryId, long chatId, string? data, CancellationToken cancellationToken)
    {
        var id = ParseCallback(data);
        if (id is null)
        {
            await _replies.AnswerCallbackAsync(callbackQueryId, null, cancellationToken);
            return;
        }

        var text = await ExplainForChatAsync(chatId, id.Value, cancellationToken);
        if (text is null)
        {
            await _replies.AnswerCallbackAsync(callbackQueryId, NotYours, cancellationToken);
            return;
        }

        await _replies.AnswerCallbackAsync(callbackQueryId, null, cancellationToken);
        await _replies.SendAsync(chatId, text, cancellationToken);
    }

    public async Task HandleWhyCommandAsync(long chatId, string? argument, CancellationToken cancellationToken)
    {
        if (!long.TryParse(argument?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
        {
            await _replies.SendAsync(chatId, Usage, cancellationToken);
            return;
        }

        var text = await ExplainForChatAsync(chatId, id, cancellationToken);
        await _replies.SendAsync(chatId, text ?? NotYours, cancellationToken);
    }

    // Security: null when the explanation does not exist or belongs to a farm this chat
    // is not on. Both look the same, so ids cannot be probed.
    private async Task<string?> ExplainForChatAsync(long chatId, long id, CancellationToken cancellationToken)
    {
        var stored = await _store.GetAsync(id, cancellationToken);
        if (stored is null) return null;

        var farms = await _access.FarmsForChatAsync(chatId, cancellationToken);
        if (!farms.Contains(stored.FarmId)) return null;

        return Format(stored.Explanation);
    }

    // The full plain explanation as a Telegram message, never the technical part (that
    // is for admins and the report appendix).
    public static string Format(Explanation e)
    {
        var sb = new StringBuilder();
        sb.Append("Why am I seeing this?\n\n").Append(e.Summary).Append('\n');

        if (e.Facts.Count > 0)
        {
            sb.Append("\nWhat we used:\n");
            foreach (var f in e.Facts) sb.Append("- ").Append(f.Label).Append(": ").Append(f.Value).Append(" (").Append(f.Source).Append(")\n");
        }

        if (!string.IsNullOrWhiteSpace(e.Rule)) sb.Append("\nThe rule: ").Append(e.Rule).Append('\n');
        if (!string.IsNullOrWhiteSpace(e.Confidence)) sb.Append("\nHow sure: ").Append(e.Confidence).Append('\n');
        if (!string.IsNullOrWhiteSpace(e.WhatWouldChangeIt)) sb.Append("\nWhat would change it: ").Append(e.WhatWouldChangeIt).Append('\n');

        return sb.ToString().TrimEnd();
    }
}

// Database implementations

public sealed class ExplanationStore : IExplanationStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<ExplanationStore> _logger;

    public ExplanationStore(NpgsqlDataSource dataSource, ILogger<ExplanationStore> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task<long?> SaveAsync(long farmId, long? zoneId, string kind, Explanation explanation, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand(
                "insert into explanation (farm_id, zone_id, kind, explanation) values ($1, $2, $3, $4::jsonb) returning id",
                connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue((object?)zoneId ?? DBNull.Value);
            command.Parameters.AddWithValue(kind);
            command.Parameters.AddWithValue(JsonSerializer.Serialize(explanation, Json));
            return await command.ExecuteScalarAsync(cancellationToken) as long?;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not save a {Kind} explanation for farm {FarmId}; the message goes without a Why button.", kind, farmId);
            return null;
        }
    }

    public async Task<StoredExplanation?> GetAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("select farm_id, explanation::text from explanation where id = $1", connection);
            command.Parameters.AddWithValue(id);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return null;

            var explanation = JsonSerializer.Deserialize<Explanation>(reader.GetString(1), Json);
            return explanation is null ? null : new StoredExplanation(id, reader.GetInt64(0), explanation);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not read explanation {Id}.", id);
            return null;
        }
    }
}

public sealed class ChatFarmAccess : IChatFarmAccess
{
    private readonly NpgsqlDataSource _dataSource;

    public ChatFarmAccess(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    // chat -> profile -> farms it owns or is a member of: the same rule
    // app_can_access_farm uses for signed-in users.
    public async Task<IReadOnlySet<long>> FarmsForChatAsync(long chatId, CancellationToken cancellationToken)
    {
        const string sql =
            """
            select f.farm_id from farm f join profile p on p.id = f.owner_id where p.telegram_chat_id = $1
            union
            select fm.farm_id from farm_member fm join profile p on p.id = fm.profile_id where p.telegram_chat_id = $1
            """;

        var farms = new HashSet<long>();
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(chatId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) farms.Add(reader.GetInt64(0));
        return farms;
    }
}

public sealed class TelegramReplies : ITelegramReplies
{
    private readonly TelegramClient _client;

    public TelegramReplies(TelegramClient client) => _client = client;

    public Task SendAsync(long chatId, string text, CancellationToken cancellationToken) =>
        _client.SendMessageAsync(chatId, text, cancellationToken);

    public Task AnswerCallbackAsync(string callbackQueryId, string? text, CancellationToken cancellationToken) =>
        _client.AnswerCallbackQueryAsync(callbackQueryId, text, cancellationToken);
}
