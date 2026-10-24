#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace AgroFlow.Business.Agronomy
{
    // Typed access to Agronomy/fao56-crop-knowledge.json, the cited extract of FAO-56
    // Tables 11, 12 and 22. The JSON is the source of truth and this file only reads it,
    // so retuning for another region is a JSON edit and a rebuild.
    // The JSON is an embedded resource, so it always ships inside the assembly.

    public sealed class Fao56StageLengths
    {
        public int InitialDays { get; }
        public int DevelopmentDays { get; }
        public int MidSeasonDays { get; }
        public int LateSeasonDays { get; }

        // The planting date and region of the Table 11 row these lengths come from, shown to
        // the farmer, because "125-day maize" means nothing without knowing which maize row.
        public string PlantDate { get; }
        public string Region { get; }

        public Fao56StageLengths(int initial, int development, int midSeason, int lateSeason, string plantDate, string region)
        {
            InitialDays = initial;
            DevelopmentDays = development;
            MidSeasonDays = midSeason;
            LateSeasonDays = lateSeason;
            PlantDate = plantDate;
            Region = region;
        }

        public int TotalDays
        {
            get { return InitialDays + DevelopmentDays + MidSeasonDays + LateSeasonDays; }
        }

        // First day-after-planting of each stage, on the convention that the
        // planting day itself is day 0.
        public int DevelopmentStartsAtDap { get { return InitialDays; } }
        public int MidSeasonStartsAtDap { get { return InitialDays + DevelopmentDays; } }
        public int LateSeasonStartsAtDap { get { return InitialDays + DevelopmentDays + MidSeasonDays; } }
    }

    public sealed class Fao56Kc
    {
        public double Initial { get; }
        public double MidSeason { get; }
        public double End { get; }

        // Set when FAO-56 gives a second Kc_end for another management choice (maize:
        // field-dried grain; potato: vine kill). Null when the table has one value.
        public double? EndAlternate { get; }
        public string? EndAlternateCondition { get; }

        // True when Table 12 gives a range for Kc_end instead of one value (tomato's
        // "0.70-0.90"). End is then the midpoint, and the advice says so.
        public bool EndIsMidpointOfPublishedRange { get; }
        public double? EndRangeMin { get; }
        public double? EndRangeMax { get; }

        public double MaxHeightM { get; }

        public Fao56Kc(
            double initial, double midSeason, double end,
            double? endAlternate, string? endAlternateCondition,
            bool endIsMidpointOfPublishedRange, double? endRangeMin, double? endRangeMax,
            double maxHeightM)
        {
            Initial = initial;
            MidSeason = midSeason;
            End = end;
            EndAlternate = endAlternate;
            EndAlternateCondition = endAlternateCondition;
            EndIsMidpointOfPublishedRange = endIsMidpointOfPublishedRange;
            EndRangeMin = endRangeMin;
            EndRangeMax = endRangeMax;
            MaxHeightM = maxHeightM;
        }
    }

    public sealed class Fao56Soil
    {
        public double RootDepthMinM { get; }
        public double RootDepthMaxM { get; }

        // Table 22's p: the share of available soil water a crop can use before it starts
        // suffering stress. Tabulated at ETc ~ 5 mm/day; see AdjustDepletionFractionForEtc.
        public double DepletionFractionP { get; }

        public Fao56Soil(double rootDepthMinM, double rootDepthMaxM, double depletionFractionP)
        {
            RootDepthMinM = rootDepthMinM;
            RootDepthMaxM = rootDepthMaxM;
            DepletionFractionP = depletionFractionP;
        }
    }

    public sealed class Fao56Crop
    {
        public string Key { get; }

        // Short farmer-facing name ("maize", "leafy veg (lettuce)"). Fao56Name is the full
        // table entry, which reads badly inside a sentence.
        public string DisplayName { get; }

        public string Fao56Name { get; }
        public string Fao56Group { get; }
        public Fao56StageLengths StageLengths { get; }
        public string StageLengthsCite { get; }
        public string StageSelectionReason { get; }
        public Fao56Kc Kc { get; }
        public string KcCite { get; }
        public Fao56Soil Soil { get; }
        public string SoilCite { get; }

        // Only set where FAO-56 says something specific about this crop that changes how
        // the numbers should be read. Null otherwise; no note is better than a made-up one.
        public string? MappingNote { get; }
        public string? KcShapeWarning { get; }
        public string? KcEndFootnote { get; }
        public string? KcEndFootnoteCite { get; }
        public string? KcEndNote { get; }

        public Fao56Crop(
            string key, string displayName, string fao56Name, string fao56Group,
            Fao56StageLengths stageLengths, string stageLengthsCite, string stageSelectionReason,
            Fao56Kc kc, string kcCite, Fao56Soil soil, string soilCite,
            string? mappingNote, string? kcShapeWarning,
            string? kcEndFootnote, string? kcEndFootnoteCite, string? kcEndNote)
        {
            Key = key;
            DisplayName = displayName;
            Fao56Name = fao56Name;
            Fao56Group = fao56Group;
            StageLengths = stageLengths;
            StageLengthsCite = stageLengthsCite;
            StageSelectionReason = stageSelectionReason;
            Kc = kc;
            KcCite = kcCite;
            Soil = soil;
            SoilCite = soilCite;
            MappingNote = mappingNote;
            KcShapeWarning = kcShapeWarning;
            KcEndFootnote = kcEndFootnote;
            KcEndFootnoteCite = kcEndFootnoteCite;
            KcEndNote = kcEndNote;
        }
    }

    public static class Fao56Knowledge
    {
        private const string ResourceName = "AgroFlow.Domain.Agronomy.fao56-crop-knowledge.json";

        private static readonly Lazy<IReadOnlyDictionary<string, Fao56Crop>> LazyCrops =
            new Lazy<IReadOnlyDictionary<string, Fao56Crop>>(LoadCrops);

        public static IReadOnlyDictionary<string, Fao56Crop> Crops
        {
            get { return LazyCrops.Value; }
        }

        // Free-text zone.crop_type -> knowledge key.
        // The admin dashboard's crop list (referenceData.ts) offers Maize, Grapes, Citrus,
        // Wheat, Potatoes and Apples. Grapes, Wheat and Apples are not in this knowledge base
        // and return null on purpose, so the advice falls back to moisture only instead of
        // using a wrong Kc curve. Matching the two lists is a team decision (see
        // docs/OVERNIGHT_REPORT.md).
        private static readonly Dictionary<string, string> CropAliases =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "maize", "maize" },
                { "corn", "maize" },
                { "mielies", "maize" },
                { "field maize", "maize" },
                { "grain maize", "maize" },

                { "potato", "potato" },
                { "potatoes", "potato" },
                { "aartappel", "potato" },

                { "tomato", "tomato" },
                { "tomatoes", "tomato" },

                { "citrus", "citrus" },
                { "orange", "citrus" },
                { "oranges", "citrus" },
                { "lemon", "citrus" },
                { "lemons", "citrus" },
                { "naartjie", "citrus" },

                { "leafy veg", "leafy_veg" },
                { "leafy vegetables", "leafy_veg" },
                { "leafy_veg", "leafy_veg" },
                { "lettuce", "leafy_veg" },
                { "spinach", "leafy_veg" },
                { "salad greens", "leafy_veg" },

                { "dry beans", "dry_beans" },
                { "dry_beans", "dry_beans" },
                { "beans", "dry_beans" },
                { "pulses", "dry_beans" },
                { "droëbone", "dry_beans" },
            };

        // Returns null, never a guess, when the crop is not one of the six.
        public static Fao56Crop? TryResolve(string? cropType)
        {
            if (string.IsNullOrWhiteSpace(cropType)) return null;

            var normalised = cropType.Trim();
            string? key;
            if (!CropAliases.TryGetValue(normalised, out key)) return null;

            Fao56Crop? crop;
            return Crops.TryGetValue(key, out crop) ? crop : null;
        }

        // FAO-56 p. 162: "p = pTable 22 + 0.04 (5 - ETc) where the adjusted p is limited to
        // 0.1 <= p <= 0.8 and ETc is in mm/day."
        // On a hot day with high ETc the crop tolerates less depletion, so the same soil
        // reading is more urgent than in mild weather.
        public static double AdjustDepletionFractionForEtc(double tabulatedP, double etcMmPerDay)
        {
            var adjusted = tabulatedP + 0.04 * (5.0 - etcMmPerDay);
            if (adjusted < 0.1) return 0.1;
            if (adjusted > 0.8) return 0.8;
            return adjusted;
        }

        private static IReadOnlyDictionary<string, Fao56Crop> LoadCrops()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException(
                        "Embedded resource '" + ResourceName + "' not found. " +
                        "Agronomy/fao56-crop-knowledge.json must be declared as an EmbeddedResource in AgroFlow.Domain.csproj.");
                }

                using (var document = JsonDocument.Parse(stream))
                {
                    var result = new Dictionary<string, Fao56Crop>(StringComparer.OrdinalIgnoreCase);
                    foreach (var cropProperty in document.RootElement.GetProperty("crops").EnumerateObject())
                    {
                        result[cropProperty.Name] = ParseCrop(cropProperty.Name, cropProperty.Value);
                    }
                    return result;
                }
            }
        }

        private static Fao56Crop ParseCrop(string key, JsonElement crop)
        {
            var stageLengthsElement = crop.GetProperty("stageLengths");
            var selectedRow = stageLengthsElement.GetProperty("allPublishedRows")
                .EnumerateArray()
                .FirstOrDefault(row =>
                {
                    JsonElement selected;
                    return row.TryGetProperty("selected", out selected) && selected.GetBoolean();
                });

            if (selectedRow.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidOperationException(
                    "Crop '" + key + "' has no Table 11 row marked \"selected\": true in fao56-crop-knowledge.json. " +
                    "Exactly one published row must be selected - the engine will not pick one for you.");
            }

            var stageLengths = new Fao56StageLengths(
                selectedRow.GetProperty("lIni").GetInt32(),
                selectedRow.GetProperty("lDev").GetInt32(),
                selectedRow.GetProperty("lMid").GetInt32(),
                selectedRow.GetProperty("lLate").GetInt32(),
                GetStringOrEmpty(selectedRow, "plantDate"),
                GetStringOrEmpty(selectedRow, "region"));

            var kcElement = crop.GetProperty("kc");
            var kcEndElement = kcElement.GetProperty("kcEnd");

            var kc = new Fao56Kc(
                kcElement.GetProperty("kcIni").GetProperty("value").GetDouble(),
                kcElement.GetProperty("kcMid").GetProperty("value").GetDouble(),
                kcEndElement.GetProperty("value").GetDouble(),
                GetNullableDouble(kcEndElement, "alternateValue"),
                GetNullableString(kcEndElement, "footnote"),
                GetBoolOrFalse(kcEndElement, "isMidpointOfPublishedRange"),
                GetNullableDouble(kcEndElement, "valueMin"),
                GetNullableDouble(kcEndElement, "valueMax"),
                kcElement.GetProperty("maxHeightM").GetProperty("value").GetDouble());

            var soilElement = crop.GetProperty("soil");
            var rootDepth = soilElement.GetProperty("maxRootDepthM");
            var soil = new Fao56Soil(
                rootDepth.GetProperty("min").GetDouble(),
                rootDepth.GetProperty("max").GetDouble(),
                soilElement.GetProperty("depletionFractionP").GetProperty("value").GetDouble());

            return new Fao56Crop(
                key,
                GetStringOrEmpty(crop, "displayName"),
                GetStringOrEmpty(crop, "fao56CropName"),
                GetStringOrEmpty(crop, "fao56Group"),
                stageLengths,
                GetStringOrEmpty(stageLengthsElement, "cite"),
                GetStringOrEmpty(stageLengthsElement, "selectionReason"),
                kc,
                GetStringOrEmpty(kcElement, "cite"),
                soil,
                GetStringOrEmpty(soilElement, "cite"),
                GetNullableString(crop, "mappingNote"),
                GetNullableString(kcElement, "kcShapeWarning"),
                GetNullableString(kcEndElement, "footnote"),
                GetNullableString(kcEndElement, "footnoteCite"),
                GetNullableString(kcElement, "kcEndNote"));
        }

        private static string GetStringOrEmpty(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? string.Empty
                : string.Empty;
        }

        private static string? GetNullableString(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        }

        private static double? GetNullableDouble(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.Number
                ? value.GetDouble()
                : (double?)null;
        }

        private static bool GetBoolOrFalse(JsonElement element, string name)
        {
            JsonElement value;
            return element.TryGetProperty(name, out value)
                   && (value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False)
                   && value.GetBoolean();
        }

        // Formats a number for the advice text, with InvariantCulture so every locale and
        // the tests see the same string.
        internal static string Format(double value, int decimals)
        {
            return value.ToString("F" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        }
    }
}
