# Location720

**Private Life360 Alternative for Home Assistant**

A complete Home Assistant integration for family location tracking with historical routes, timeline playback, crash detection, and SOS alerts - all running locally with zero cloud dependencies.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![HACS](https://img.shields.io/badge/HACS-Integration-orange)

## Features

| Feature | Description |
|---------|-------------|
| 🗺️ **Real-time Tracking** | Live location updates for all family members |
| 📍 **Auto-Follow** | Map smoothly pans to keep selected person in view |
| 🛤️ **Historical Routes** | View movement paths for up to 30 days |
| ⏱️ **Timeline Playback** | Scrub through history with playback controls |
| 🚨 **Crash Detection** | Automatic alerts on rapid deceleration |
| 🆘 **SOS Button** | One-tap emergency alert to family |
| 📊 **Analytics** | Distance, duration, zone time breakdown |
| ⚙️ **UI Configuration** | Everything configurable in browser - no YAML |
| 🔒 **100% Local** | No cloud, no external APIs, works over VPN |

## Installation

### HACS (Recommended)

1. Open HACS → Integrations → ⋮ (menu) → Custom repositories
2. Add URL: `https://github.com/yourusername/Location720`
3. Category: **Integration**
4. Click "Add"
5. Find "Location720" and click Install
6. Restart Home Assistant

### Manual Installation

1. Download this repository
2. Copy `custom_components/location720` to your `config/custom_components/`
3. Restart Home Assistant

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for "Location720"
3. Follow the setup wizard:
   - Name your tracker group (e.g., "Family")
   - Select device trackers to monitor
   - Assign display names and colors
4. Done! Sensors are automatically created.

## Configuration

All settings are managed through the UI:

**Settings → Devices & Services → Location720 → Configure**

| Section | Settings |
|---------|----------|
| **Tracked Devices** | Add/remove trackers, names, colors |
| **Map Settings** | Zoom, update interval, auto-follow person |
| **History** | Retention days, coordinate precision |
| **Crash Detection** | Enable, speed thresholds, timing, notifications |
| **SOS Button** | Enable, hold duration, notification targets |
| **Filters** | GPS accuracy thresholds |

## Dashboard Card

Add the Location720 card to any dashboard:

```yaml
type: custom:location720-card
```

### Card Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | Location720 | Card title |
| `history_days` | number | 7 | Days of history (1-30) |
| `show_routes` | boolean | true | Show route lines |
| `show_zones` | boolean | true | Show zone circles |
| `auto_follow` | string | off | Auto-pan to person: "off", "all", or person name |

## How It Works

```
Phone GPS → HA Companion App → device_tracker entity
                                      ↓
                              Location720 Integration
                                      ↓
                              sensor.location720_*_coords
                              (state = "lat,lng")
                                      ↓
                              HA Recorder logs every change
                                      ↓
                              Location720 Card displays routes
```

The key insight: Home Assistant's recorder only logs **state changes**, not attribute changes. By making coordinates the sensor's state value, every GPS update becomes a logged event.

## Crash Detection (Beta)

Monitors GPS data for rapid deceleration patterns that may indicate a vehicle crash.

**How it works:**
1. Monitors speed changes from GPS history
2. Detects sudden stops (e.g., 60 km/h → 0 in 5 seconds)
3. Shows countdown allowing "I'm OK" cancellation
4. Sends notifications to configured targets if not cancelled

⚠️ **Beta**: GPS data can be inaccurate. Adjust thresholds for your use case.

## SOS Button

Manual emergency alert button on the map card.

1. Hold the SOS button for configured duration
2. Confirm in popup dialog
3. All configured contacts receive immediate notification with location

## Privacy & Security

- ✅ All data stored locally in Home Assistant
- ✅ No external API calls (except map tiles from OSM)
- ✅ No cloud services or accounts required
- ✅ No analytics or telemetry
- ✅ Works fully offline (with cached map tiles)
- ✅ VPN-friendly for remote access

Your location data never leaves your network.

## Requirements

- Home Assistant 2023.1 or newer
- Device trackers with GPS coordinates (HA Companion App)
- HACS (for easy installation)

## Support

- [GitHub Issues](https://github.com/yourusername/Location720/issues)
- [Documentation](https://github.com/yourusername/Location720/wiki)

## License

MIT License - See [LICENSE](LICENSE)

## Credits

- Map tiles: [OpenStreetMap](https://www.openstreetmap.org/)
- Map library: [Leaflet](https://leafletjs.com/)
- Inspired by Life360 (but private!)
