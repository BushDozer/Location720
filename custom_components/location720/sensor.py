"""Sensor platform for Location720."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    CONF_TRACKED_DEVICES,
    CONF_DEVICE_TRACKER,
    CONF_DISPLAY_NAME,
    CONF_COLOR,
    CONF_COORD_PRECISION,
    DEFAULT_COORD_PRECISION,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
    ATTR_GPS_ACCURACY,
    ATTR_BATTERY_LEVEL,
    ATTR_SPEED,
    ATTR_ALTITUDE,
    ATTR_COURSE,
    ATTR_PERSON_ID,
    ATTR_SOURCE,
)
from .coordinator import Location720Coordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Location720 sensors from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    coordinator: Location720Coordinator = data["coordinator"]
    
    tracked_devices = entry.data.get(CONF_TRACKED_DEVICES, [])
    precision = entry.options.get(CONF_COORD_PRECISION, DEFAULT_COORD_PRECISION)
    
    entities = []
    for device_config in tracked_devices:
        entities.append(
            Location720CoordSensor(
                coordinator=coordinator,
                entry=entry,
                device_tracker=device_config[CONF_DEVICE_TRACKER],
                display_name=device_config[CONF_DISPLAY_NAME],
                color=device_config[CONF_COLOR],
                precision=precision,
            )
        )
    
    async_add_entities(entities)
    _LOGGER.info("Added %d Location720 coordinate sensors", len(entities))


class Location720CoordSensor(CoordinatorEntity, SensorEntity):
    """Sensor that logs coordinates as state for history recording."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:crosshairs-gps"

    def __init__(
        self,
        coordinator: Location720Coordinator,
        entry: ConfigEntry,
        device_tracker: str,
        display_name: str,
        color: str,
        precision: int,
    ) -> None:
        """Initialize the coordinate sensor."""
        super().__init__(coordinator)
        
        self._device_tracker = device_tracker
        self._display_name = display_name
        self._color = color
        self._precision = precision
        self._entry = entry
        
        # Create a sanitized ID from display name
        self._person_id = display_name.lower().replace(" ", "_")
        
        self._attr_unique_id = f"{entry.entry_id}_{self._person_id}_coords"
        self._attr_name = f"{display_name} Coordinates"

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=self._entry.title,
            manufacturer="Location720",
            model="Family Tracker",
        )

    @property
    def native_value(self) -> str | None:
        """Return coordinates as state string for history logging."""
        if not self.coordinator.data:
            return None
            
        person_data = self.coordinator.data.get(self._display_name)
        if not person_data:
            return None
        
        lat = person_data.get(ATTR_LATITUDE)
        lng = person_data.get(ATTR_LONGITUDE)
        
        if lat is None or lng is None:
            return None
        
        # Round to configured precision
        lat_str = f"{lat:.{self._precision}f}"
        lng_str = f"{lng:.{self._precision}f}"
        
        return f"{lat_str},{lng_str}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional attributes."""
        if not self.coordinator.data:
            return {}
            
        person_data = self.coordinator.data.get(self._display_name, {})
        
        return {
            ATTR_LATITUDE: person_data.get(ATTR_LATITUDE),
            ATTR_LONGITUDE: person_data.get(ATTR_LONGITUDE),
            ATTR_GPS_ACCURACY: person_data.get(ATTR_GPS_ACCURACY),
            ATTR_BATTERY_LEVEL: person_data.get(ATTR_BATTERY_LEVEL),
            ATTR_SPEED: person_data.get(ATTR_SPEED),
            ATTR_ALTITUDE: person_data.get(ATTR_ALTITUDE),
            ATTR_COURSE: person_data.get(ATTR_COURSE),
            ATTR_PERSON_ID: self._person_id,
            ATTR_SOURCE: self._device_tracker,
            "color": self._color,
            "display_name": self._display_name,
        }

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        if not self.coordinator.data:
            return False
        return self._display_name in self.coordinator.data
