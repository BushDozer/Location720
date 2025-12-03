"""Location720 - Private Life360 Alternative for Home Assistant."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.frontend import add_extra_js_url

from .const import (
    DOMAIN,
    PLATFORMS,
    CONF_TRACKED_DEVICES,
    CONF_SOS_NOTIFY_TARGETS,
    CONF_CRASH_NOTIFY_TARGETS,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
)
from .coordinator import Location720Coordinator

_LOGGER = logging.getLogger(__name__)

FRONTEND_SCRIPT_URL = "/location720/location720.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up Location720 domain - registers frontend."""
    await _async_register_frontend(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Location720 from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    coordinator = Location720Coordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    
    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
        "config": entry.data,
    }
    
    # Register device
    device_registry = dr.async_get(hass)
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        name=entry.title,
        manufacturer="Location720",
        model="Family Tracker",
        sw_version="1.0.0",
    )
    
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    
    # Register services
    await _async_register_services(hass, entry)
    
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    
    _LOGGER.info("Location720 setup complete for %s", entry.title)
    return True


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Register the frontend resources."""
    www_path = Path(__file__).parent / "www"
    
    if not www_path.exists():
        _LOGGER.error("Location720 www directory not found at %s", www_path)
        return
    
    # Register static path for serving the JS file
    await hass.http.async_register_static_paths([
        StaticPathConfig("/location720", str(www_path), cache_headers=False)
    ])
    
    # Register as extra JS module so it loads automatically
    add_extra_js_url(hass, FRONTEND_SCRIPT_URL)
    
    _LOGGER.info("Location720 frontend registered at %s", FRONTEND_SCRIPT_URL)


async def _async_register_services(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register Location720 services."""
    
    async def handle_trigger_sos(call: ServiceCall) -> None:
        """Handle SOS trigger service."""
        person = call.data.get("person")
        data = hass.data[DOMAIN][entry.entry_id]
        coordinator = data["coordinator"]
        
        # Get person's current location
        person_data = coordinator.data.get(person, {})
        lat = person_data.get(ATTR_LATITUDE, 0)
        lng = person_data.get(ATTR_LONGITUDE, 0)
        
        _LOGGER.info("SOS triggered for %s at %s, %s", person, lat, lng)
        
        # Send notifications
        notify_targets = entry.options.get(CONF_SOS_NOTIFY_TARGETS, [])
        for target in notify_targets:
            try:
                await hass.services.async_call(
                    "notify",
                    target.replace("notify.", ""),
                    {
                        "title": "🆘 SOS ALERT",
                        "message": f"SOS from {person}!\n\nLocation: {lat}, {lng}\n\nThey need help immediately!",
                    },
                )
            except Exception as e:
                _LOGGER.error("Failed to send SOS notification: %s", e)

    async def handle_clear_sos(call: ServiceCall) -> None:
        """Handle SOS clear service."""
        _LOGGER.info("SOS cleared")

    async def handle_clear_crash(call: ServiceCall) -> None:
        """Handle crash clear service."""
        person = call.data.get("person")
        _LOGGER.info("Crash alert cleared for %s", person)

    # Register services
    hass.services.async_register(DOMAIN, "trigger_sos", handle_trigger_sos)
    hass.services.async_register(DOMAIN, "clear_sos", handle_clear_sos)
    hass.services.async_register(DOMAIN, "clear_crash", handle_clear_crash)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        _LOGGER.info("Location720 unloaded: %s", entry.title)
    
    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate old entry versions."""
    _LOGGER.debug("Migrating from version %s", entry.version)
    
    if entry.version == 1:
        # Future migration logic here
        pass
    
    return True
