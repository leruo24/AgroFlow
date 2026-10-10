using System;
using System.Collections.ObjectModel;
using AgroFlow.Business;

namespace AgroFlow.Presentation
{
    // Shows dynamic polymorphism (Notes 2.4), like Role.Payment() in the workshop:
    // one base-class collection, one method call, different behaviour per subclass.
    public class Program
    {
        public static void Main()
        {
            // A collection of the base type holding three different derived types.
            Collection<Hardware> devices = new Collection<Hardware>();

            Sensor soilSensor = new Sensor();
            soilSensor.DeviceName = "Zone1-SoilMoisture";
            soilSensor.SensorTypeName = "SoilMoisture";
            soilSensor.Reading = 42.5f;
            soilSensor.Status = "Online";

            Pump waterPump = new Pump();
            waterPump.DeviceName = "Zone1-Pump";
            // Display only, for the demo below. Irrigation events use zone.flow_rate_lpm,
            // not this. 1.5 L/min is the measured test pump (500 ml in 20 s).
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

            // The same ReadValue() call runs a different override on each object,
            // chosen at runtime.
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
