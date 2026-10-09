using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Services;

// A start-up report that answers: when a setting does not arrive, is the container
// not given it, or is our code not reading it? "Telegram polling is off" alone looks
// the same in every case, and the fixes are opposite.
// Security: never logs a secret value. Tokens and passwords show as "present, N
// characters"; the bot username (public anyway) and the polling flag are printed in full.
public static class StartupConfigurationDiagnostics
{
    public static void Log(IConfiguration configuration, IOptions<TelegramOptions> telegramOptions, ILogger logger)
    {
        var options = telegramOptions.Value;

        logger.LogInformation(
            "Configuration check: Telegram__BotToken {TokenEnv}; Telegram__BotUsername {UsernameEnv}; " +
            "Telegram__EnablePolling {PollingEnv}.",
            DescribeSecretEnvironmentVariable("Telegram__BotToken"),
            DescribePlainEnvironmentVariable("Telegram__BotUsername"),
            DescribePlainEnvironmentVariable("Telegram__EnablePolling"));

        // Which provider supplied each key: separates "the environment variable is missing"
        // from "appsettings.json won".
        logger.LogInformation(
            "Configuration check: Telegram:BotToken resolved {Token}; Telegram:BotUsername resolved {Username}; " +
            "Telegram:EnablePolling resolved {Polling}.",
            DescribeResolvedSecret(configuration, "Telegram:BotToken"),
            DescribeResolvedPlain(configuration, "Telegram:BotUsername"),
            DescribeResolvedPlain(configuration, "Telegram:EnablePolling"));

        logger.LogInformation(
            "Configuration check: bound TelegramOptions has BotToken {Token}, BotUsername '{Username}', EnablePolling {Polling}.",
            options.IsConfigured ? $"present ({options.BotToken!.Length} characters)" : "ABSENT",
            options.BotUsername ?? "(null)",
            options.EnablePolling);

        // A comparison: these two are known to work on Railway, so if they differ from the
        // Telegram keys the problem is on the Railway side.
        logger.LogInformation(
            "Configuration check (known-good comparison): ConnectionStrings__Supabase {Connection}; Mqtt__Password {Mqtt}.",
            DescribeSecretEnvironmentVariable("ConnectionStrings__Supabase"),
            DescribeSecretEnvironmentVariable("Mqtt__Password"));

        if (!options.IsConfigured)
        {
            logger.LogWarning(
                "No Telegram bot token is configured, so farmer notifications are disabled. " +
                "If Telegram__BotToken is reported ABSENT above, the container is not being given the " +
                "variable - check it is set on THIS Railway service and environment, and that the service " +
                "has been redeployed since. If it is reported present but the resolved value is ABSENT, " +
                "the variable name is wrong (it must be exactly Telegram__BotToken, two underscores).");
        }
        else if (!options.EnablePolling)
        {
            logger.LogWarning(
                "A Telegram bot token is configured but polling is off, so this instance sends messages " +
                "and receives none - farmers scanning an onboarding QR code will get no reply. " +
                "Set Telegram__EnablePolling=true on exactly one running instance.");
        }
    }

    private static string DescribeSecretEnvironmentVariable(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);

        return value is null
            ? "is ABSENT from the container environment"
            : $"is present in the container environment ({value.Length} characters)";
    }

    private static string DescribePlainEnvironmentVariable(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);

        return value is null
            ? "is ABSENT from the container environment"
            : $"is present in the container environment with value '{value}'";
    }

    private static string DescribeResolvedSecret(IConfiguration configuration, string key)
    {
        var value = configuration[key];

        return value is null
            ? "ABSENT"
            : $"({value.Length} characters) from {DescribeProvider(configuration, key)}";
    }

    private static string DescribeResolvedPlain(IConfiguration configuration, string key)
    {
        var value = configuration[key];

        return value is null
            ? "ABSENT"
            : $"as '{value}' from {DescribeProvider(configuration, key)}";
    }

    // Providers are checked in reverse order, so the last one with a key wins. Walking
    // backwards and stopping at the first hit names the winner.
    private static string DescribeProvider(IConfiguration configuration, string key)
    {
        if (configuration is not IConfigurationRoot root)
        {
            return "an unknown provider";
        }

        foreach (var provider in root.Providers.Reverse())
        {
            if (provider.TryGet(key, out _))
            {
                return provider.GetType().Name;
            }
        }

        return "an unknown provider";
    }
}
