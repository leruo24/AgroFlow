using System;
using System.Collections.Generic;
using System.Text.Json;
using AgroFlow.Api.Endpoints;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 6c (part 1): Mark complete with a note; Add zones for a "new zone" request.
public class RequestCompletionTests
{
    private static readonly DateOnly Today = new DateOnly(2026, 10, 6);

    private static FarmEndpoints.RegisterFarmZone Zone(string name, double ha = 0.1, string crop = "tomato") =>
        new(name, ha, crop, "loam", 0.2);

    [Fact]
    public void New_zones_must_fit_the_farm_and_not_repeat_a_name()
    {
        var existing = new List<string> { "Tub 1" };

        Assert.Null(FarmZoneEndpoints.CheckNewZones(new[] { Zone("Tub 2") }, 1, 0.5, existing, Today));
        Assert.NotNull(FarmZoneEndpoints.CheckNewZones(new FarmEndpoints.RegisterFarmZone[0], 1, 0, existing, Today));
        Assert.NotNull(FarmZoneEndpoints.CheckNewZones(null, 1, 0, existing, Today));
        Assert.Contains("already has a zone called", FarmZoneEndpoints.CheckNewZones(new[] { Zone(" tub 1 ") }, 1, 0, existing, Today));
        Assert.Contains("already has a zone called", FarmZoneEndpoints.CheckNewZones(new[] { Zone("A"), Zone("a") }, 1, 0, existing, Today));
        Assert.Contains("more than the farm's", FarmZoneEndpoints.CheckNewZones(new[] { Zone("Tub 2", 0.6) }, 1, 0.5, existing, Today));
        Assert.NotNull(FarmZoneEndpoints.CheckNewZones(new[] { Zone("Tub 2", 0) }, 1, 0, existing, Today));
        Assert.NotNull(FarmZoneEndpoints.CheckNewZones(new[] { Zone("Tub 2", 0.1, "") }, 1, 0, existing, Today));
        // The same setup checks as registering a farm.
        Assert.NotNull(FarmZoneEndpoints.CheckNewZones(
            new[] { new FarmEndpoints.RegisterFarmZone("Tub 2", 0.1, "tomato", "peat") }, 1, 0, existing, Today));
    }

    [Fact]
    public void The_status_body_takes_an_optional_note_and_no_actor()
    {
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        // An older console sends only a status - still accepted.
        var old = JsonSerializer.Deserialize<UpdateRequestStatusRequest>("{\"status\":\"completed\"}", options)!;
        Assert.Equal("completed", old.Status);
        Assert.Null(old.Note);

        var withNote = JsonSerializer.Deserialize<UpdateRequestStatusRequest>("{\"status\":\"completed\",\"note\":\"Done on site\"}", options)!;
        Assert.Equal("Done on site", withNote.Note);

        // Who completed it comes from the login: the body has nowhere to say.
        var props = typeof(UpdateRequestStatusRequest).GetProperties();
        Assert.DoesNotContain(props, p => p.Name.Contains("By", StringComparison.Ordinal) || p.Name.Contains("Actor", StringComparison.Ordinal));
    }
}
