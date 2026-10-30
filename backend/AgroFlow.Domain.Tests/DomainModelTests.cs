using System.Collections.Generic;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The analysis model's object-oriented parts: an abstract User with Admin and FarmUser, a
// Hardware hierarchy whose subclasses override ReadValue and IsWorking, and a Farm composed of Zones.
public class DomainModelTests
{
    [Fact]
    public void Each_kind_of_user_goes_to_its_own_dashboard_through_the_same_call()
    {
        var people = new List<User> { new Admin(1, "Staff member", "staff@example.org"), new FarmUser(2, "Farmer", "farmer@example.org") };
        Assert.Equal("/admin/dashboard", people[0].GetDashboardRoute());
        Assert.Equal("/farm/dashboard", people[1].GetDashboardRoute());
    }

    [Fact]
    public void Each_kind_of_hardware_reads_its_value_its_own_way()
    {
        var sensor = new Sensor { Reading = 41.5f };
        var board = new ESP32 { ConnectionStatus = "Connected" };
        var pump = new Pump { FlowRate = 6f, IsRunning = true };
        var devices = new List<Hardware> { sensor, board, pump };

        Assert.Equal(new[] { 41.5f, 1f, 6f }, devices.ConvertAll(d => d.ReadValue()));
        pump.IsRunning = false;
        Assert.Equal(0f, ((Hardware)pump).ReadValue());
    }

    [Fact]
    public void A_pump_counts_as_working_when_online_or_running_other_hardware_only_when_online()
    {
        var pump = new Pump { Status = "Running" };
        var sensor = new Sensor { Status = "Running" };
        Assert.True(pump.IsWorking());
        Assert.False(sensor.IsWorking());
        sensor.Status = "Online";
        Assert.True(sensor.IsWorking());
    }

    [Fact]
    public void A_farm_is_composed_of_its_zones()
    {
        var farm = new Farm(1, "Demo farm", "Mahikeng", 0.5f);
        Assert.Empty(farm.Zones);
        farm.AddZone(new Zone(1, "maize"));
        farm.AddZone(new Zone(2, "spinach"));
        Assert.Equal(2, farm.Zones.Count);
    }
}
