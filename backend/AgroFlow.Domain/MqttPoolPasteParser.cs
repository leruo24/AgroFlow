#nullable enable
using System;
using System.Collections.Generic;

namespace AgroFlow.Business
{
    // Turns an admin's copy-and-paste out of the HiveMQ console into
    // username/password pairs.
    //
    // WHY A PASTE BOX AND NOT A FORM
    // ------------------------------
    // HiveMQ Cloud's credential management API needs the paid Starter plan, so
    // the logins are created BY HAND in their console, a batch at a time. A
    // one-pair-at-a-time form would mean re-typing a long random password per
    // kit, which is exactly where transcription errors come from. Copying two
    // columns out of the console and pasting them is both faster and more
    // accurate.
    //
    // Pure and side-effect free, in AgroFlow.Domain rather than beside the
    // endpoint, because what it accepts is the whole behaviour: a separator it
    // mishandles silently stores a password that will not work, and the board
    // it is handed to just fails to reach the broker with no visible cause.
    public static class MqttPoolPasteParser
    {
        public sealed class Result
        {
            public List<MqttPoolCredential> Credentials { get; } = new();

            // Lines that were neither blank nor a comment but could not be
            // read as a pair. Reported back to the admin rather than dropped,
            // so "I pasted 10 and got 8" has an explanation.
            public int Skipped { get; set; }
        }

        // The separators a pasted console table actually arrives with.
        //
        // Tab first and unambiguous: copying two columns out of a web table
        // gives tab-separated text. Colon and semicolon are supported because
        // "user:pass" is the habitual shorthand.
        private static readonly char[] Separators = { '\t', ' ', ',', ':', ';' };

        public static Result Parse(string? pasted)
        {
            var result = new Result();

            if (string.IsNullOrWhiteSpace(pasted)) return result;

            foreach (var rawLine in pasted!.Split('\n', '\r'))
            {
                var line = rawLine.Trim();

                if (line.Length == 0) continue;

                // Lets an admin label a batch - "# created 2026-10-03, kits
                // 11-20" - without those lines counting as failures.
                if (line[0] == '#') continue;

                var separatorIndex = line.IndexOfAny(Separators);

                // No separator at all, or one with nothing after it. Either
                // way there is no password.
                if (separatorIndex <= 0 || separatorIndex == line.Length - 1)
                {
                    result.Skipped++;
                    continue;
                }

                var username = line.Substring(0, separatorIndex).Trim();

                // Split on the FIRST separator only, and take the remainder
                // whole. A generated password routinely contains one of these
                // characters, and splitting on all of them would silently
                // truncate it - storing a password that cannot work, with no
                // visible cause on the board that receives it.
                //
                // TrimStart on the separators absorbs "user:  pass" and
                // aligned columns. TrimEnd takes only whitespace, so a
                // password ending in a symbol survives.
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
