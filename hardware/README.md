# AgroFlow hardware

Firmware for every physical device in the AgroFlow platform.

## Structure

```
hardware/
├── shared/                           Cross-device docs/conventions (not tied to one sketch)
│   └── MQTT_TOPICS.md                MQTT topic structure + payload shapes, used by every device type
└── esp32/                            Devices built on the ESP32 (Arduino core)
    └── AgroFlowIrrigationNode/       One sketch folder per device type
        ├── AgroFlowIrrigationNode.ino
        └── README.md                Device-specific setup - see this before flashing
```

Each device type gets its own sketch folder, grouped under its MCU family
(`esp32/`, and any future `<mcu-family>/` sibling for a different platform).
Anything that applies *across* device types — like the MQTT topic
convention — lives in `shared/`, not inside any one device's folder.

## Arduino IDE constraint

A sketch's folder name must exactly match its `.ino` filename
(`AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino`) - the Arduino IDE
won't open it otherwise. Keep this in mind for any future device folder.

## Adding a new device type

1. Create `hardware/<mcu-family>/<DeviceType>/<DeviceType>.ino` (same MCU
   family → reuse the existing `esp32/` folder; a genuinely different
   platform → new top-level folder alongside it).
2. Add a `README.md` next to it, matching the shape of
   `esp32/AgroFlowIrrigationNode/README.md` (what it does, required
   libraries, board selection, config placeholders).
3. If it talks MQTT, follow the topic convention in
   `shared/MQTT_TOPICS.md` rather than inventing a new one - extend that
   doc if the new device type needs a new channel segment.
4. Link the new device's README from the table below.

## Devices

| Device | Sketch | What it is |
|---|---|---|
| Irrigation node | [`esp32/AgroFlowIrrigationNode/`](esp32/AgroFlowIrrigationNode/README.md) | Soil moisture sensor + relay-controlled pump, one per irrigation zone |
