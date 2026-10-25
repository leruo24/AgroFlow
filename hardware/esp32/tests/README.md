# Native firmware tests

Tests for the parts of the irrigation node that do not need a board. They build
with any desktop C++17 compiler; nothing from Arduino is included.

| Test | Covers |
|---|---|
| `run_limits_test.cpp` | `AgroFlowIrrigationNode/RunLimits.h`: a run lasts min(asked, the zone's maximum), 5 minutes when no maximum is sent, never over 120 minutes; a server-started run stops after 3 minutes without the server, the offline fallback and local page do not, and the count survives `millis()` wrapping. |
| `command_ids_test.cpp` | `AgroFlowIrrigationNode/CommandIds.h`: a repeated command ID is acknowledged again with its first time and never carried out again; the last 32 IDs are kept (oldest forgotten first); they survive a reboot through the flash blob, and a blob of another layout or a torn write is ignored. |
| `setup_portal_test.cpp` | `AgroFlowIrrigationNode/SetupPortal.h` (1.7.2): a wrong Wi-Fi password and a network the kit cannot see (5 GHz) give different sentences; every claim refusal (expired, used, wrong code, kit linked to another farm, too many tries, AgroFlow not reachable) has its own; a typed code is 6 to 8 letters or digits with spaces and dashes ignored, and never overflows. |
| `offline_buffer_test.cpp` | `AgroFlowIrrigationNode/OfflineBuffer.h`: the buffer fills in order, the oldest is dropped when full, replay goes oldest first and stops at the first failure, nothing is sent twice (randomised failures, new readings and reboots through the flash blob), the blob round-trip refuses a mismatched layout, and a reading taken before the clock was set is timed only within the same boot. |

```bash
cd hardware/esp32/tests
g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test
./offline_buffer_test        # prints "N checks, 0 failed"; exit code 0 = pass
```

On Windows without g++, the `ziglang` Python package gives a clang++ that works
the same way: `pip install ziglang`, then
`python -m ziglang c++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test.exe`.
