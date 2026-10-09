using System.Security.Cryptography;

namespace AgroFlow.Api.Services;

// One generator for every temporary password (onboarding, the Telegram bot, admin
// resets), so "temporary password" means one thing.
// Security: the password is never stored. It goes to Supabase Auth, is shown or sent
// once, and is forgotten, so "show it again" always means a reset.
public static class TemporaryPasswordGenerator
{
    public static string Generate()
    {
        // No I/O/0/1, because these are read off a screen and typed into a phone.
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
