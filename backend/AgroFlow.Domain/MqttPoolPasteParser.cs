#nullable enable
using System;
using System.Collections.Generic;

namespace AgroFlow.Business
{
    // Turns an admin's paste from the HiveMQ console into username/password pairs.
    // The free plan has no credential API, so logins are created by hand in batches;
    // pasting two columns is faster and safer than retyping long passwords.
    // Pure and in the domain project because what it accepts is the whole behaviour: a
    // mishandled separator would store a password that silently fails on the board.
    public static class MqttPoolPasteParser
    {
        public sealed class Result
        {
            public List<MqttPoolCredential> Credentials { get; } = new();

            // Lines that were not blank or a comment but could not be read as a pair. Reported
            // to the admin, so "I pasted 10 and got 8" has an explanation.
            public int Skipped { get; set; }
        }

        // The separators a pasted table arrives with. Tab first: copying two columns from a
        // web table gives tab-separated text. Colon and semicolon for the "user:pass" habit.
        private static readonly char[] Separators = { '\t', ' ', ',', ':', ';' };

        public static Result Parse(string? pasted)
        {
            var result = new Result();

            if (string.IsNullOrWhiteSpace(pasted)) return result;

            foreach (var rawLine in pasted!.Split('\n', '\r'))
            {
                var line = rawLine.Trim();

                if (line.Length == 0) continue;

                // Lets an admin label a batch ("# created 2026-10-03, kits 11-20") without those lines
                // counting as failures.
                if (line[0] == '#') continue;

                var separatorIndex = line.IndexOfAny(Separators);

                // No separator, or nothing after it: there is no password.
                if (separatorIndex <= 0 || separatorIndex == line.Length - 1)
                {
                    result.Skipped++;
                    continue;
                }

                var username = line.Substring(0, separatorIndex).Trim();

                // Split on the first separator only and keep the rest whole: generated passwords
                // often contain these characters, and splitting on all of them would cut the
                // password short. TrimStart on separators handles "user:  pass" and aligned columns;
                // TrimEnd only trims whitespace, so a password ending in a symbol survives.
                var password = line.Substring(separatorIndex + 1)
                    .TrimStart(Separators)
                    .TrimEnd();

                if (username.Length == 0 || password.Length == 0)
                {
                    result.Skipped++;
                    continue;
                }

                result.Credentials.Add(new MqttPoolCredential(username, password));
            }

            return result;
        }
    }

    public sealed class MqttPoolCredential
    {
        public string Username { get; }
        public string Password { get; }

        public MqttPoolCredential(string username, string password)
        {
            Username = username;
            Password = password;
        }
    }
}
