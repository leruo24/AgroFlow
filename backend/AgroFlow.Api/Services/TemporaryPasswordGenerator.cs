using AgroFlow.Business;

namespace AgroFlow.Api.Services;

// Every temporary password AgroFlow hands out (onboarding, the bot's welcome, an admin
// reset): 8 easy characters, see AgroFlow.Business.EasyPassword. Stored and set without the
// space; shown and sent as "KX7P 4MRT" (EasyPassword.Display).
public static class TemporaryPasswordGenerator
{
    public static string Generate() => EasyPassword.Generate();
}
