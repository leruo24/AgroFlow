#nullable enable
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    /// <summary>One input that was actually used, in plain words.</summary>
    public sealed class ExplanationFact
    {
        public ExplanationFact(string label, string value, string source)
        {
            Label = label;
            Value = value;
            Source = source;
        }

        [JsonPropertyName("label")] public string Label { get; }
        [JsonPropertyName("value")] public string Value { get; }

        /// <summary>Where it came from, plainly: "weather app", "your soil sensor", "this zone's setup".</summary>
        [JsonPropertyName("source")] public string Source { get; }
    }

    /// <summary>
    /// "Why am I seeing this?", built by the same rule that produced the advice, from
    /// the inputs it actually used.
    /// </summary>
    /// <remarks>
    /// Summary, facts, rule and whatWouldChangeIt are plain language: no FAO-56 symbols,
    /// no column names, no ISO timestamps (a test checks them). The FAO-56 detail is in
    /// <see cref="Technical"/>, which only admins and the report appendix show.
    /// </remarks>
    public sealed class Explanation
    {
        [JsonPropertyName("summary")] public string Summary { get; set; } = string.Empty;
        [JsonPropertyName("facts")] public List<ExplanationFact> Facts { get; set; } = new List<ExplanationFact>();
        [JsonPropertyName("rule")] public string Rule { get; set; } = string.Empty;
        [JsonPropertyName("confidence")] public string Confidence { get; set; } = string.Empty;
        [JsonPropertyName("whatWouldChangeIt")] public string? WhatWouldChangeIt { get; set; }
        [JsonPropertyName("technical")] public string Technical { get; set; } = string.Empty;

        public Explanation Fact(string label, string value, string source)
        {
            Facts.Add(new ExplanationFact(label, value, source));
            return this;
        }
    }
}
