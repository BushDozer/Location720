"""Data coordinator for Location720."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN

from .const import (
    DOMAIN,
    CONF_TRACKED_DEVICES,
    CONF_DEVICE_TRACKER,
    CONF_DISPLAY_NAME,
    CONF_UPDATE_INTERVAL,
    DEFAULT_UPDATE_INTERVAL,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
    ATTR_GPS_ACCURACY,
    ATTR_BATTERY_LEVEL,
    ATTR_SPEED,
    ATTR_ALTITUDE,
    ATTR_COURSE,
)

_LOGGER = logging.getLogger(__name__)


class Location720Coordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to manage Location720 data updates."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.entry = entry
        self.tracked_devices: list[dict] = entry.data.get(CONF_TRACKED_DEVICES, [])
        
        update_interval = entry.options.get(
            CONF_UPDATE_INTERVAL, 
            entry.data.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL)
        )
        
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=update_interval),
        )
        
        self._unsub_state_changes: list = []

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from device trackers."""
        data: dict[str, Any] = {}
        
        for device_config in self.tracked_devices:
            entity_id = device_config[CONF_DEVICE_TRACKER]
            display_name = device_config[CONF_DISPLAY_NAME]
            
            state = self.hass.states.get(entity_id)
            
            if state is None:
                _LOGGER.warning("Entity %s not found", entity_id)
                continue
                
            if state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
                _LOGGER.debug("Entity %s unavailable", entity_id)
                continue
            
            attrs = state.attributes
            lat = attrs.get(ATTR_LATITUDE)
            lng = attrs.get(ATTR_LONGITUDE)
            
            if lat is None or lng is None:
                _LOGGER.debug("No coordinates for %s", entity_id)
                continue
            
            data[display_name] = {
                "entity_id": entity_id,
                "state": state.state,
                ATTR_LATITUDE: lat,
                ATTR_LONGITUDE: lng,
                ATTR_GPS_ACCURACY: attrs.get(ATTR_GPS_ACCURACY, 0),
                ATTR_BATTERY_LEVEL: attrs.get(ATTR_BATTERY_LEVEL),
                ATTR_SPEED: attrs.get(ATTR_SPEED, 0),
                ATTR_ALTITUDE: attrs.get(ATTR_ALTITUDE),
                ATTR_COURSE: attrs.get(ATTR_COURSE),
                "last_changed": state.last_changed.isoformat(),
                "last_updated": state.last_updated.isoformat(),
            }
        
        return data

    async def async_setup(self) -> None:
        """Set up state change listeners for immediate updates."""
        entity_ids = [d[CONF_DEVICE_TRACKER] for d in self.tracked_devices]
        
        @callback
        def _async_state_changed(event) -> None:
            """Handle state changes."""
            self.async_set_updated_data(self.data)
            self.hass.async_create_task(self.async_request_refresh())
        
        self._unsub_state_changes.append(
            async_track_state_change_event(
                self.hass,
                entity_ids,
                _async_state_changed,
            )
        )

    async def async_shutdown(self) -> None:
        """Shut down the coordinator."""
        for unsub in self._unsub_state_changes:
            unsub()
        self._unsub_state_changes.clear()
