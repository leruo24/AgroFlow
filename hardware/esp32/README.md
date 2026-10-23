# ESP32 firmware

This folder contains the irrigation-node firmware and desktop-native tests for
the firmware code that does not require a board.

## Build and flash

Open `AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` with the Arduino IDE,
install the board core and libraries listed in the
[device README](AgroFlowIrrigationNode/README.md), create the ignored local
`secrets.h` from `secrets.example.h`, select the documented ESP32 board, and
compile/upload. Do not commit compiled firmware or local credentials.

## Test

From `hardware/esp32/tests`, compile and run both C++17 programs:

```powershell
g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test
g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode run_limits_test.cpp -o run_limits_test
./offline_buffer_test
./run_limits_test
```

See [`tests/README.md`](tests/README.md) for a Windows alternative when `g++`
is unavailable.

## Main files

| Path | Purpose |
|---|---|
| `AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` | Firmware entry point, sensors, relay, networking, MQTT, and local page. |
| `AgroFlowIrrigationNode/OfflineBuffer.h` | Offline reading and irrigation-event buffer. |
| `AgroFlowIrrigationNode/RunLimits.h` | Pump run limits and connection-loss safety rules. |
| `AgroFlowIrrigationNode/secrets.example.h` | Template for the ignored local firmware configuration. |
| `tests/` | Native tests for the two plain-C++ headers. |

Pin assignments and firmware behavior are documented beside the sketch and are
not cleanup targets.
