using AgroFlow.Business;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Api.Ml;

// Where training examples come from. Every example carries Simulated = true/false.
public static class MoistureTrainingData
{
    // The two simulated demo farms (migration 0047): their coordinates, and the
    // crop of each farm's demo zone. Each is simulated on all three soils and with
    // three planting dates so every soil type and growth stage appears in training.
    public sealed record SimulatedSite(string Key, string File, string Crop, double Latitude);

    public static readonly SimulatedSite[] Sites =
    {
        new("rustlers-valley", "rustlers-valley-archive.json", "citrus", -28.872),
        new("brits", "brits-archive.json", "tomato", -25.63473),
    };

    public static readonly string[] Soils = { "sandy", "loam", "clay" };
    public static readonly int[] PlantingOffsetsDays = { 0, 45, 90 };

    // Simulated-farm history from saved Open-Meteo weather (see training-weather/).
    public static List<MoistureExample> SimulatedFromWeatherFiles(string weatherDir, List<string> sources)
    {
        var examples = new List<MoistureExample>();
        foreach (var site in Sites)
        {
            var path = Path.Combine(weatherDir, site.File);
            if (!File.Exists(path)) throw new FileNotFoundException("Training weather file missing.", path);

            var weather = OpenMeteoDailyParser.Parse(File.ReadAllText(path), DateOnly.MaxValue, treatAllAsActuals: true)
                .Where(r => r.HasUsableTemperatures)
                .Select(r => new ZoneWeatherDay
                {
                    Date = r.Date,
                    TMinC = r.TMinC,
                    TMaxC = r.TMaxC,
                    RainMm = r.PrecipitationMm,
                    RhMeanPct = r.HumidityMean,
                    RhMinPct = r.RhMinPct,
                    RhMaxPct = r.RhMaxPct,
                    WindMs = r.WindMs,
                    WindHeightM = r.WindHeightM,
                    IsForecast = false,
                })
                .OrderBy(w => w.Date)
                .ToList();
            if (weather.Count == 0) continue;

            var siteCount = 0;
            for (var s = 0; s < Soils.Length; s++)
            {
                for (var o = 0; o < PlantingOffsetsDays.Length; o++)
                {
                    // Negative keys can never collide with a real zone id.
                    long zoneKey = -(1000 * (Array.IndexOf(Sites, site) + 1) + 10 * s + o);
                    var history = MoistureHistorySimulator.Simulate(
                        zoneKey, site.Crop, Soils[s], site.Latitude,
                        weather[0].Date.AddDays(PlantingOffsetsDays[o]), weather);
                    var built = MoistureForecastRules.BuildExamples(
                        site.Key + "/" + Soils[s] + "/+" + PlantingOffsetsDays[o] + "d", Soils[s], history);
                    siteCount += built.Count;
                    examples.AddRange(built);
                }
            }

            sources.Add($"Simulated: {site.Key} ({site.Crop}), Open-Meteo archive weather "
                        + $"{weather[0].Date:yyyy-MM-dd} to {weather[^1].Date:yyyy-MM-dd}, {siteCount} examples");
        }
        return examples;
    }

    // Rows already in the database: simulated farms' generated readings and real
    // farms' sensor readings, each marked by sensor_reading.simulated / farm.is_simulated.
    public static List<MoistureExample> FromDatabase(MoistureMlController controller, List<string> sources)
    {
        var examples = new List<MoistureExample>();
        foreach (var (zoneKey, soil, days) in controller.TrainingHistory())
            examples.AddRange(MoistureForecastRules.BuildExamples(zoneKey, soil, days));
        sources.Add($"Database: {examples.Count(e => e.Simulated)} simulated and {examples.Count(e => !e.Simulated)} real examples");
        return examples;
    }
}
