# Native firmware tests

Tests for the parts of the irrigation node that do not need a board. They build
with any desktop C++17 compiler; nothing from Arduino is included.

| Test | Covers |
|---|---|
| `offline_buffer_test.cpp` | `AgroFlowIrrigationNode/OfflineBuffer.h`: the buffer fills in order, the oldest is dropped when full, replay goes oldest first and stops at the first failure, nothing is sent twice (randomised failures, new readings and reboots through the flash blob), the blob round-trip refuses a mismatched layout, and a reading taken before the clock was set is timed only within the same boot. |

```bash
cd hardware/esp32/tests
g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test
./offline_buffer_test        # prints "N checks, 0 failed"; exit code 0 = pass
```

On Windows without g++, the `ziglang` Python package gives a clang++ that works
the same way: `pip install ziglang`, then
`python -m ziglang c++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test.exe`.
