"""Binary sensor platform for Location720."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorEntity,
    BinarySensorDeviceClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    DOMAIN,
    CONF_TRACKED_DEVICES,
    CONF_DISPLAY_NAME,
    CONF_CRASH_ENABLED,
    CONF_CRASH_MIN_SPEED_BEFORE,
    CONF_CRASH_MAX_SPEED_AFTER,
    CONF_CRASH_TIME_WINDOW,
    CONF_CRASH_CONFIRMATION_DELAY,
    CONF_CRASH_COOLDOWN,
    CONF_CRASH_MIN_ACCURACY,
    CONF_CRASH_NOTIFY_TARGETS,
    CONF_SOS_ENABLED,
    CONF_SOS_NOTIFY_TARGETS,
    CONF_MIN_GPS_ACCURACY,
    DEFAULT_CRASH_MIN_SPEED_BEFORE,
    DEFAULT_CRASH_MAX_SPEED_AFTER,
    DEFAULT_CRASH_TIME_WINDOW,
    DEFAULT_CRASH_CONFIRMATION_DELAY,
    DEFAULT_CRASH_COOLDOWN,
    DEFAULT_CRASH_MIN_ACCURACY,
    DEFAULT_MIN_GPS_ACCURACY,
    ATTR_SPEED,
    ATTR_GPS_ACCURACY,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
)
from .coordinator import Location720Coordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Location720 binary sensors from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    coordinator: Location720Coordinator = data["coordinator"]
    
    tracked_devices = entry.data.get(CONF_TRACKED_DEVICES, [])
    crash_enabled = entry.options.get(CONF_CRASH_ENABLED, False)
    
    entities = []
    
    # Create crash detection sensor for each tracked person
    if crash_enabled:
        for device_config in tracked_devices:
            entities.append(
                Location720CrashSensor(
                    coordinator=coordinator,
                    entry=entry,
                    display_name=device_config[CONF_DISPLAY_NAME],
                    hass=hass,
                )
            )
    
    # Create single SOS active sensor for the integration
    if entry.options.get(CONF_SOS_ENABLED, True):
        entities.append(
            Location720SOSSensor(
                coordinator=coordinator,
                entry=entry,
            )
        )
    
    async_add_entities(entities)
    _LOGGER.info("Added %d Location720 binary sensors", len(entities))


class Location720CrashSensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor for crash detection."""

    _attr_has_entity_name = True
    _attr_device_class = BinarySensorDeviceClass.SAFETY

    def __init__(
        self,
        coordinator: Location720Coordinator,
        entry: ConfigEntry,
        display_name: str,
        hass: HomeAssistant,
    ) -> None:
        """Initialize the crash sensor."""
        super().__init__(coordinator)
        
        self._hass = hass
        self._display_name = display_name
        self._entry = entry
        self._person_id = display_name.lower().replace(" ", "_")
        
        self._attr_unique_id = f"{entry.entry_id}_{self._person_id}_crash"
        self._attr_name = f"{display_name} Crash Detected"
        self._attr_icon = "mdi:car-emergency"
        
        # Crash detection state
        self._is_on = False
        self._speed_history: list[dict] = []
        self._last_alert_time: datetime | None = None
        self._pending_crash: datetime | None = None
        self._crash_location: tuple[float, float] | None = None

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
        )

    @property
    def is_on(self) -> bool:
        """Return true if crash detected."""
        return self._is_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional attributes."""
        attrs = {
            "person": self._display_name,
            "last_alert": self._last_alert_time.isoformat() if self._last_alert_time else None,
        }
        if self._crash_location:
            attrs["crash_latitude"] = self._crash_location[0]
            attrs["crash_longitude"] = self._crash_location[1]
        return attrs

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        if not self.coordinator.data:
            return
            
        person_data = self.coordinator.data.get(self._display_name)
        if not person_data:
            return
        
        # Get crash detection settings
        opts = self._entry.options
        min_speed_before = opts.get(CONF_CRASH_MIN_SPEED_BEFORE, DEFAULT_CRASH_MIN_SPEED_BEFORE)
        max_speed_after = opts.get(CONF_CRASH_MAX_SPEED_AFTER, DEFAULT_CRASH_MAX_SPEED_AFTER)
        time_window = opts.get(CONF_CRASH_TIME_WINDOW, DEFAULT_CRASH_TIME_WINDOW)
        min_accuracy = opts.get(CONF_CRASH_MIN_ACCURACY, DEFAULT_CRASH_MIN_ACCURACY)
        cooldown = opts.get(CONF_CRASH_COOLDOWN, DEFAULT_CRASH_COOLDOWN)
        
        # Check GPS accuracy
        accuracy = person_data.get(ATTR_GPS_ACCURACY, 999)
        if accuracy > min_accuracy:
            return
        
        # Record speed
        speed = person_data.get(ATTR_SPEED, 0) or 0
        # Convert m/s to km/h if needed (HA Companion reports m/s)
        if speed < 100:  # Likely m/s
            speed = speed * 3.6
        
        now = datetime.now()
        self._speed_history.append({
            "speed": speed,
            "time": now,
            "lat": person_data.get(ATTR_LATITUDE),
            "lng": person_data.get(ATTR_LONGITUDE),
        })
        
        # Trim old history (keep last 60 seconds)
        cutoff = now - timedelta(seconds=60)
        self._speed_history = [h for h in self._speed_history if h["time"] > cutoff]
        
        # Check for crash pattern
        self._check_for_crash(
            min_speed_before, max_speed_after, time_window, cooldown
        )
        
        self.async_write_ha_state()

    def _check_for_crash(
        self,
        min_speed_before: float,
        max_speed_after: float,
        time_window: int,
        cooldown: int,
    ) -> None:
        """Check speed history for crash pattern."""
        if len(self._speed_history) < 2:
            return
        
        now = datetime.now()
        
        # Check cooldown
        if self._last_alert_time:
            if (now - self._last_alert_time).total_seconds() < cooldown * 60:
                return
        
        # Get readings in time window
        window_start = now - timedelta(seconds=time_window)
        recent = [h for h in self._speed_history if h["time"] > window_start]
        
        if len(recent) < 2:
            return
        
        # Check for rapid deceleration
        max_speed = max(h["speed"] for h in recent)
        current_speed = recent[-1]["speed"]
        
        if max_speed >= min_speed_before and current_speed <= max_speed_after:
            self._is_on = True
            self._crash_location = (recent[-1]["lat"], recent[-1]["lng"])
            self._last_alert_time = now
            _LOGGER.warning(
                "Crash detected for %s: %.1f km/h → %.1f km/h",
                self._display_name, max_speed, current_speed
            )
            
            # Send notifications
            self._hass.async_create_task(self._send_crash_notifications(max_speed, current_speed))

    async def _send_crash_notifications(self, speed_before: float, speed_after: float) -> None:
        """Send crash detection notifications."""
        notify_targets = self._entry.options.get(CONF_CRASH_NOTIFY_TARGETS, [])
        if not notify_targets:
            return
        
        lat, lng = self._crash_location or (0, 0)
        message = (
            f"🚨 POSSIBLE CRASH DETECTED\n\n"
            f"{self._display_name} may have been in an accident.\n\n"
            f"Speed: {speed_before:.0f} → {speed_after:.0f} km/h\n"
            f"Location: {lat:.6f}, {lng:.6f}\n"
            f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"Check on them immediately!"
        )
        
        for target in notify_targets:
            try:
                await self._hass.services.async_call(
                    "notify",
                    target.replace("notify.", ""),
                    {"title": "🚨 Crash Alert", "message": message},
                )
            except Exception as e:
                _LOGGER.error("Failed to send crash notification to %s: %s", target, e)

    def clear_crash(self) -> None:
        """Clear crash state (called by 'I\'m OK' action)."""
        self._is_on = False
        self._crash_location = None
        self.async_write_ha_state()


class Location720SOSSensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor for SOS active state."""

    _attr_has_entity_name = True
    _attr_device_class = BinarySensorDeviceClass.SAFETY

    def __init__(
        self,
        coordinator: Location720Coordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the SOS sensor."""
        super().__init__(coordinator)
        
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_sos_active"
        self._attr_name = "SOS Active"
        self._attr_icon = "mdi:alert-octagon"
        
        self._is_on = False
        self._triggered_by: str | None = None
        self._triggered_at: datetime | None = None
        self._location: tuple[float, float] | None = None

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
        )

    @property
    def is_on(self) -> bool:
        """Return true if SOS is active."""
        return self._is_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional attributes."""
        attrs = {
            "triggered_by": self._triggered_by,
            "triggered_at": self._triggered_at.isoformat() if self._triggered_at else None,
        }
        if self._location:
            attrs["latitude"] = self._location[0]
            attrs["longitude"] = self._location[1]
        return attrs

    def trigger_sos(self, person: str, lat: float, lng: float) -> None:
        """Trigger SOS alert."""
        self._is_on = True
        self._triggered_by = person
        self._triggered_at = datetime.now()
        self._location = (lat, lng)
        self.async_write_ha_state()
        _LOGGER.warning("SOS triggered by %s at %f, %f", person, lat, lng)

    def clear_sos(self) -> None:
        """Clear SOS state."""
        self._is_on = False
        self._triggered_by = None
        self._triggered_at = None
        self._location = None
        self.async_write_ha_state()
