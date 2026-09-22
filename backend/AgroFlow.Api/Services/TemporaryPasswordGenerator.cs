using System.Security.Cryptography;

namespace AgroFlow.Api.Services;

// Lifted verbatim out of FarmerOnboardingEndpoints, which is no longer the
// only thing that needs it: the Telegram bot issues a fresh temporary
// password when a farmer redeems their onboarding code, and the admin screen
// can reset one for a farmer who never links the bot. Same generator
// everywhere, so "temporary password" means one thing across AgroFlow.
//
// The generated password is NEVER persisted by AgroFlow. It is handed to
// Supabase Auth, shown or sent once, and forgotten. Every "show me the
// temporary password again" path is therefore a reset that mints a new one,
// not a lookup.
public static class TemporaryPasswordGenerator
{
    public static string Generate()
    {
        // I/O/0/1 are left out of the alphabets: these get read off a screen
        // in a field and typed into a phone.
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const string lower = "abcdefghijkmnopqrstuvwxyz";
        const string numbers = "23456789";
        const string symbols = "!@#$%";

        const string all =
            upper +
            lower +
            numbers +
            symbols;

        var passwordChars = new char[16];

        // Guarantee at least one character from each category.
        passwordChars[0] =
            upper[RandomNumberGenerator.GetInt32(upper.Length)];

        passwordChars[1] =
            lower[RandomNumberGenerator.GetInt32(lower.Length)];

        passwordChars[2] =
            numbers[RandomNumberGenerator.GetInt32(numbers.Length)];

        passwordChars[3] =
            symbols[RandomNumberGenerator.GetInt32(symbols.Length)];

        // Fill the remaining characters securely.
        for (var i = 4; i < passwordChars.Length; i++)
        {
            passwordChars[i] =
                all[RandomNumberGenerator.GetInt32(all.Length)];
        }

        // Securely shuffle the characters so the required character
        // categories are not always in predictable positions.
        for (var i = passwordChars.Length - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);

            (passwordChars[i], passwordChars[j]) =
                (passwordChars[j], passwordChars[i]);
        }

        return new string(passwordChars);
    }
}
