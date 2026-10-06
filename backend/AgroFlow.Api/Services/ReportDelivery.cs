namespace AgroFlow.Api.Services;

// Item 4: how a finished report reaches Telegram.
//
// A failed send is tried ONCE more after a short wait - a blip on Telegram's
// side or the container's network is the common case - and if that fails too,
// the caller raises an admin alert rather than letting a farmer quietly miss
// their report. Never more than one retry: a farmer who blocked the bot will
// keep refusing, and hammering is how a bot gets rate-limited for everyone.
internal static class ReportDelivery
{
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(20);

    /// True when the report got through on the first or the second try.
    public static async Task<bool> SendWithOneRetryAsync(
        Func<Task<bool>> send, TimeSpan retryDelay, CancellationToken ct)
    {
        if (await send()) return true;

        try
        {
            await Task.Delay(retryDelay, ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }

        return await send();
    }

    /// Everyone this report goes to: the farmer, plus - for automatic reports,
    /// when the schedule asks - the admin who set it up and the admin group
    /// chat. Distinct, so an admin who is also the farmer gets one copy.
    public static List<long> Recipients(
        long? farmerChat, bool automatic, bool sendToHandler, long? handlerChat,
        bool adminChatEnabled, long? adminGroupChat)
    {
        var chats = new List<long>();
        if (farmerChat is { } f) chats.Add(f);
        if (automatic && sendToHandler && handlerChat is { } h) chats.Add(h);
        if (automatic && adminChatEnabled && adminGroupChat is { } g) chats.Add(g);
        return chats.Distinct().ToList();
    }
}
