using System;
using System.Collections.ObjectModel;
using AgroFlow.Business;

namespace AgroFlow.Presentation
{
    // Demonstrates DYNAMIC POLYMORPHISM (Notes 2.4) the same way the workshop's
    // waitering system does with Role.Payment(): one base-class collection holding
    // different concrete subclasses, one method call, different runtime behaviour.
    public class Program
    {
        public static void Main()
        {
            // A Collection of the BASE type, holding three different DERIVED types.
            Collection<Hardware> devices = new Collection<Hardware>();

            Sensor soilSensor = new Sensor();
            soilSensor.DeviceName = "Zone1-SoilMoisture";
            soilSensor.SensorTypeName = "SoilMoisture";
            soilSensor.Reading = 42.5f;
            soilSensor.Status = "Online";

            Pump waterPump = new Pump();
            waterPump.DeviceName = "Zone1-Pump";
            // Display-only, for the polymorphism demo below: Pump.ReadValue()
            // reports a pump's rated flow while running. This is NOT used to
            // value any irrigation event - that is zone.flow_rate_lpm's job.
            // Set to the measured test pump (500 ml in 20 s = 1.5 L/min) so the
            // demo does not print a number that contradicts the database.
            waterPump.FlowRate = 1.5f;
            waterPump.IsRunning = true;
            waterPump.Status = "Running";

            ESP32 board = new ESP32();
            board.DeviceName = "Zone1-Board";
            board.ConnectionStatus = "Connected";
            board.Status = "Online";

            devices.Add(soilSensor);
            devices.Add(waterPump);
            devices.Add(board);

            // The SAME ReadValue() call resolves to a different override on each object,
            // decided at runtime - this is the polymorphism the class diagram's
            // Hardware hierarchy exists to provide.
            foreach (Hardware device in devices)
            {
                Console.WriteLine(
                    device.DeviceName + " (" + device.GetHardwareType + ")" +
                    " -> ReadValue() = " + device.ReadValue() +
                    ", IsWorking() = " + device.IsWorking());
            }
        }
    }
}
