# Changelog

All notable changes to Location720 will be documented in this file.

## [1.0.0] - 2024-12-03

### Added
- **Full Home Assistant Integration** - No more YAML configuration
- **UI Setup Wizard** - Configure everything through the browser
- **Options Flow** - All settings manageable in Settings → Integrations
- **Auto-Follow** - Map smoothly pans to keep selected person in view
- **Auto-Discover Sensors** - Card automatically finds Location720 sensors
- **Crash Detection** - Configurable speed thresholds, timing, notifications
- **SOS Button** - Emergency alerts with location to configured contacts
- **Coordinate Sensors** - Automatic creation for proper history logging
- **Multi-Instance Support** - Track multiple family groups separately

### Changed
- Complete rewrite as proper HA integration
- Card now auto-discovers sensors (no manual configuration needed)
- All crash/SOS settings moved to integration options
- Improved history recording via coord sensor states

### Removed
- Manual YAML template sensor configuration (now automatic)
- Hardcoded coordinates and personal data
- Standalone card-only installation option

## [0.5.0] - Previous (card-only version)
- Beta crash detection
- SOS button
- Route history and playback
- Zone analytics

## [0.4.0] - Previous
- Visual card editor
- Trip detection
- Driving stats

## [0.3.0] - Previous
- Zone analytics
- Timeline playback

## [0.2.0] - Previous
- Historical routes
- Basic tracking

## [0.1.0] - Initial
- Basic map with person markers
