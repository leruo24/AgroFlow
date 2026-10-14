using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

public sealed class SimulationTests
{
    [Fact]
    public void Stored_water_balance_becomes_a_bounded_labelled_moisture_value()
    {
        Assert.Equal(75.25, SimulationRules.MoistureFromStoredBalance(25, 100, 0.25), 2);
        Assert.Equal(75.35, SimulationRules.MoistureFromStoredBalance(25, 100, 99), 2);
        Assert.InRange(Math.Abs(SimulationRules.NoiseFor(42, new DateOnly(2026, 10, 14))), 0, 0.35);
    }

    [Fact]
    public void Only_explicitly_flagged_farms_are_eligible()
    {
        Assert.True(SimulationRules.CanWrite(farmIsSimulated: true));
        Assert.False(SimulationRules.CanWrite(farmIsSimulated: false));
    }

    [Fact]
    public void Database_guards_both_target_selection_and_insert_against_real_farms()
    {
        var source = File.ReadAllText(Path.Combine(FindRepoRoot(), "backend", "AgroFlow.Domain", "SimulationXDB.cs"));
        Assert.True(source.Split("f.is_simulated = true", StringSplitOptions.None).Length >= 3,
            "Both SELECT and INSERT must independently require a simulated farm.");
        Assert.Contains("r.simulated = true", source);
        Assert.Contains("recorded_at, simulated, simulation_day", source);
        Assert.DoesNotContain("irrigation_commands", source);
        Assert.DoesNotContain("mqtt", source, StringComparison.OrdinalIgnoreCase);
    }

    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "supabase", "migrations"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Repository root not found.");
    }
}
