"""Constants for Location720 integration."""
from typing import Final

DOMAIN: Final = "location720"
PLATFORMS: Final = ["sensor", "binary_sensor"]

# Config keys
CONF_TRACKED_DEVICES: Final = "tracked_devices"
CONF_DEVICE_TRACKER: Final = "device_tracker"
CONF_DISPLAY_NAME: Final = "display_name"
CONF_COLOR: Final = "color"
CONF_ICON: Final = "icon"

# Map settings
CONF_DEFAULT_ZOOM: Final = "default_zoom"
CONF_AUTO_FOLLOW: Final = "auto_follow"
CONF_UPDATE_INTERVAL: Final = "update_interval"

# History settings
CONF_HISTORY_DAYS: Final = "history_days"
CONF_COORD_PRECISION: Final = "coord_precision"

# Crash detection
CONF_CRASH_ENABLED: Final = "crash_enabled"
CONF_CRASH_MIN_SPEED_BEFORE: Final = "crash_min_speed_before"
CONF_CRASH_MAX_SPEED_AFTER: Final = "crash_max_speed_after"
CONF_CRASH_TIME_WINDOW: Final = "crash_time_window"
CONF_CRASH_CONFIRMATION_DELAY: Final = "crash_confirmation_delay"
CONF_CRASH_COOLDOWN: Final = "crash_cooldown"
CONF_CRASH_MIN_ACCURACY: Final = "crash_min_accuracy"
CONF_CRASH_NOTIFY_TARGETS: Final = "crash_notify_targets"

# SOS settings
CONF_SOS_ENABLED: Final = "sos_enabled"
CONF_SOS_HOLD_DURATION: Final = "sos_hold_duration"
CONF_SOS_NOTIFY_TARGETS: Final = "sos_notify_targets"

# Geofencing
CONF_GEOFENCE_ALERTS: Final = "geofence_alerts"
CONF_GEOFENCE_ZONE: Final = "zone"
CONF_GEOFENCE_PERSON: Final = "person"
CONF_GEOFENCE_ON_ENTER: Final = "on_enter"
CONF_GEOFENCE_ON_EXIT: Final = "on_exit"
CONF_GEOFENCE_NOTIFY_TARGETS: Final = "notify_targets"

# Filters
CONF_MIN_GPS_ACCURACY: Final = "min_gps_accuracy"
CONF_IGNORE_STATIONARY: Final = "ignore_stationary"
CONF_STATIONARY_THRESHOLD: Final = "stationary_threshold"

# Defaults
DEFAULT_UPDATE_INTERVAL: Final = 30
DEFAULT_HISTORY_DAYS: Final = 7
DEFAULT_COORD_PRECISION: Final = 6
DEFAULT_ZOOM: Final = 13
DEFAULT_COLOR: Final = "#FF6B6B"

DEFAULT_CRASH_MIN_SPEED_BEFORE: Final = 50
DEFAULT_CRASH_MAX_SPEED_AFTER: Final = 5
DEFAULT_CRASH_TIME_WINDOW: Final = 5
DEFAULT_CRASH_CONFIRMATION_DELAY: Final = 30
DEFAULT_CRASH_COOLDOWN: Final = 5
DEFAULT_CRASH_MIN_ACCURACY: Final = 50

DEFAULT_SOS_HOLD_DURATION: Final = 3
DEFAULT_MIN_GPS_ACCURACY: Final = 100
DEFAULT_STATIONARY_THRESHOLD: Final = 10

# Colors for auto-assignment
DEFAULT_COLORS: Final = [
    "#FF6B6B",  # Red
    "#4ECDC4",  # Teal
    "#45B7D1",  # Blue
    "#96CEB4",  # Green
    "#FFEAA7",  # Yellow
    "#DDA0DD",  # Plum
    "#98D8C8",  # Mint
    "#F7DC6F",  # Gold
]

# Attribute keys
ATTR_LATITUDE: Final = "latitude"
ATTR_LONGITUDE: Final = "longitude"
ATTR_GPS_ACCURACY: Final = "gps_accuracy"
ATTR_BATTERY_LEVEL: Final = "battery_level"
ATTR_SPEED: Final = "speed"
ATTR_ALTITUDE: Final = "altitude"
ATTR_COURSE: Final = "course"
ATTR_SOURCE: Final = "source"
ATTR_PERSON_ID: Final = "person_id"
ATTR_LAST_SEEN: Final = "last_seen"
