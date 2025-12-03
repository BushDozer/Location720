"""Config flow for Location720 integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector
from homeassistant.helpers.entity_registry import async_get as async_get_entity_registry

from .const import (
    DOMAIN,
    CONF_TRACKED_DEVICES,
    CONF_DEVICE_TRACKER,
    CONF_DISPLAY_NAME,
    CONF_COLOR,
    CONF_DEFAULT_ZOOM,
    CONF_AUTO_FOLLOW,
    CONF_UPDATE_INTERVAL,
    CONF_HISTORY_DAYS,
    CONF_COORD_PRECISION,
    CONF_CRASH_ENABLED,
    CONF_CRASH_MIN_SPEED_BEFORE,
    CONF_CRASH_MAX_SPEED_AFTER,
    CONF_CRASH_TIME_WINDOW,
    CONF_CRASH_CONFIRMATION_DELAY,
    CONF_CRASH_COOLDOWN,
    CONF_CRASH_MIN_ACCURACY,
    CONF_CRASH_NOTIFY_TARGETS,
    CONF_SOS_ENABLED,
    CONF_SOS_HOLD_DURATION,
    CONF_SOS_NOTIFY_TARGETS,
    CONF_MIN_GPS_ACCURACY,
    DEFAULT_UPDATE_INTERVAL,
    DEFAULT_HISTORY_DAYS,
    DEFAULT_COORD_PRECISION,
    DEFAULT_ZOOM,
    DEFAULT_CRASH_MIN_SPEED_BEFORE,
    DEFAULT_CRASH_MAX_SPEED_AFTER,
    DEFAULT_CRASH_TIME_WINDOW,
    DEFAULT_CRASH_CONFIRMATION_DELAY,
    DEFAULT_CRASH_COOLDOWN,
    DEFAULT_CRASH_MIN_ACCURACY,
    DEFAULT_SOS_HOLD_DURATION,
    DEFAULT_MIN_GPS_ACCURACY,
    DEFAULT_COLORS,
)

_LOGGER = logging.getLogger(__name__)


def get_device_trackers(hass: HomeAssistant) -> list[str]:
    """Get all device_tracker entities with GPS coordinates."""
    trackers = []
    for entity_id in hass.states.async_entity_ids("device_tracker"):
        state = hass.states.get(entity_id)
        if state and state.attributes.get("latitude") is not None:
            trackers.append(entity_id)
    return sorted(trackers)


def get_notify_services(hass: HomeAssistant) -> list[str]:
    """Get all available notify services."""
    services = []
    for service in hass.services.async_services().get("notify", {}):
        services.append(f"notify.{service}")
    return sorted(services)


class Location720ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Location720."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._data: dict[str, Any] = {}
        self._selected_trackers: list[str] = []

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step - instance name."""
        errors: dict[str, str] = {}

        if user_input is not None:
            self._data["title"] = user_input["title"]
            return await self.async_step_select_trackers()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required("title", default="Family"): str,
            }),
            description_placeholders={
                "title": "Give this tracker group a name (e.g., 'Family', 'Kids')"
            },
        )

    async def async_step_select_trackers(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle tracker selection step."""
        errors: dict[str, str] = {}
        trackers = get_device_trackers(self.hass)

        if not trackers:
            return self.async_abort(reason="no_trackers")

        if user_input is not None:
            selected = user_input.get("trackers", [])
            if not selected:
                errors["base"] = "no_selection"
            else:
                self._selected_trackers = selected
                return await self.async_step_configure_persons()

        return self.async_show_form(
            step_id="select_trackers",
            data_schema=vol.Schema({
                vol.Required("trackers"): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(value=t, label=t)
                            for t in trackers
                        ],
                        multiple=True,
                        mode=selector.SelectSelectorMode.LIST,
                    ),
                ),
            }),
            errors=errors,
        )

    async def async_step_configure_persons(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure display names and colors for each tracker."""
        errors: dict[str, str] = {}

        if user_input is not None:
            tracked_devices = []
            for i, tracker in enumerate(self._selected_trackers):
                name_key = f"name_{i}"
                color_key = f"color_{i}"
                
                display_name = user_input.get(name_key, tracker.split(".")[-1])
                color = user_input.get(color_key, DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
                
                tracked_devices.append({
                    CONF_DEVICE_TRACKER: tracker,
                    CONF_DISPLAY_NAME: display_name,
                    CONF_COLOR: color,
                })
            
            self._data[CONF_TRACKED_DEVICES] = tracked_devices
            
            # Set defaults for other settings
            self._data[CONF_UPDATE_INTERVAL] = DEFAULT_UPDATE_INTERVAL
            self._data[CONF_HISTORY_DAYS] = DEFAULT_HISTORY_DAYS
            self._data[CONF_DEFAULT_ZOOM] = DEFAULT_ZOOM
            self._data[CONF_CRASH_ENABLED] = False
            self._data[CONF_SOS_ENABLED] = True
            
            return self.async_create_entry(
                title=self._data["title"],
                data=self._data,
            )

        # Build schema dynamically for each tracker
        schema_dict = {}
        for i, tracker in enumerate(self._selected_trackers):
            default_name = tracker.split(".")[-1].replace("_", " ").title()
            default_color = DEFAULT_COLORS[i % len(DEFAULT_COLORS)]
            
            schema_dict[vol.Required(f"name_{i}", default=default_name)] = str
            schema_dict[vol.Required(f"color_{i}", default=default_color)] = selector.ColorRGBSelector()

        return self.async_show_form(
            step_id="configure_persons",
            data_schema=vol.Schema(schema_dict),
            errors=errors,
            description_placeholders={
                "trackers": ", ".join(self._selected_trackers)
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Get the options flow for this handler."""
        return Location720OptionsFlow(config_entry)


class Location720OptionsFlow(config_entries.OptionsFlow):
    """Handle Location720 options."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry
        self._data = dict(config_entry.data)
        self._options = dict(config_entry.options)

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage options - main menu."""
        return self.async_show_menu(
            step_id="init",
            menu_options=[
                "tracked_devices",
                "map_settings",
                "history_settings",
                "crash_detection",
                "sos_settings",
                "filters",
            ],
        )

    async def async_step_tracked_devices(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage tracked devices."""
        if user_input is not None:
            # Update tracked devices
            return self.async_create_entry(title="", data=self._options)

        current_devices = self._data.get(CONF_TRACKED_DEVICES, [])
        trackers = get_device_trackers(self.hass)

        schema_dict = {}
        for i, device in enumerate(current_devices):
            schema_dict[vol.Required(
                f"name_{i}", 
                default=device.get(CONF_DISPLAY_NAME, "")
            )] = str
            schema_dict[vol.Required(
                f"color_{i}", 
                default=device.get(CONF_COLOR, DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
            )] = selector.ColorRGBSelector()

        return self.async_show_form(
            step_id="tracked_devices",
            data_schema=vol.Schema(schema_dict),
        )

    async def async_step_map_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure map settings."""
        if user_input is not None:
            self._options.update(user_input)
            return self.async_create_entry(title="", data=self._options)

        current_devices = self._data.get(CONF_TRACKED_DEVICES, [])
        person_names = ["off"] + [d[CONF_DISPLAY_NAME] for d in current_devices]

        return self.async_show_form(
            step_id="map_settings",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_DEFAULT_ZOOM,
                    default=self._options.get(CONF_DEFAULT_ZOOM, DEFAULT_ZOOM)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=1, max=19, mode="slider")
                ),
                vol.Required(
                    CONF_UPDATE_INTERVAL,
                    default=self._options.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=5, max=300, unit_of_measurement="seconds")
                ),
                vol.Required(
                    CONF_AUTO_FOLLOW,
                    default=self._options.get(CONF_AUTO_FOLLOW, "off")
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=person_names,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ),
            }),
        )

    async def async_step_history_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure history settings."""
        if user_input is not None:
            self._options.update(user_input)
            return self.async_create_entry(title="", data=self._options)

        return self.async_show_form(
            step_id="history_settings",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_HISTORY_DAYS,
                    default=self._options.get(CONF_HISTORY_DAYS, DEFAULT_HISTORY_DAYS)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=1, max=30, unit_of_measurement="days")
                ),
                vol.Required(
                    CONF_COORD_PRECISION,
                    default=self._options.get(CONF_COORD_PRECISION, DEFAULT_COORD_PRECISION)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=4, max=8)
                ),
            }),
        )

    async def async_step_crash_detection(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure crash detection."""
        if user_input is not None:
            self._options.update(user_input)
            return self.async_create_entry(title="", data=self._options)

        notify_services = get_notify_services(self.hass)

        return self.async_show_form(
            step_id="crash_detection",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_CRASH_ENABLED,
                    default=self._options.get(CONF_CRASH_ENABLED, False)
                ): bool,
                vol.Required(
                    CONF_CRASH_MIN_SPEED_BEFORE,
                    default=self._options.get(CONF_CRASH_MIN_SPEED_BEFORE, DEFAULT_CRASH_MIN_SPEED_BEFORE)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=20, max=150, unit_of_measurement="km/h")
                ),
                vol.Required(
                    CONF_CRASH_MAX_SPEED_AFTER,
                    default=self._options.get(CONF_CRASH_MAX_SPEED_AFTER, DEFAULT_CRASH_MAX_SPEED_AFTER)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=0, max=30, unit_of_measurement="km/h")
                ),
                vol.Required(
                    CONF_CRASH_TIME_WINDOW,
                    default=self._options.get(CONF_CRASH_TIME_WINDOW, DEFAULT_CRASH_TIME_WINDOW)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=1, max=30, unit_of_measurement="seconds")
                ),
                vol.Required(
                    CONF_CRASH_CONFIRMATION_DELAY,
                    default=self._options.get(CONF_CRASH_CONFIRMATION_DELAY, DEFAULT_CRASH_CONFIRMATION_DELAY)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=10, max=120, unit_of_measurement="seconds")
                ),
                vol.Required(
                    CONF_CRASH_COOLDOWN,
                    default=self._options.get(CONF_CRASH_COOLDOWN, DEFAULT_CRASH_COOLDOWN)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=1, max=60, unit_of_measurement="minutes")
                ),
                vol.Optional(
                    CONF_CRASH_NOTIFY_TARGETS,
                    default=self._options.get(CONF_CRASH_NOTIFY_TARGETS, [])
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=notify_services,
                        multiple=True,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ) if notify_services else str,
            }),
        )

    async def async_step_sos_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure SOS settings."""
        if user_input is not None:
            self._options.update(user_input)
            return self.async_create_entry(title="", data=self._options)

        notify_services = get_notify_services(self.hass)

        return self.async_show_form(
            step_id="sos_settings",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_SOS_ENABLED,
                    default=self._options.get(CONF_SOS_ENABLED, True)
                ): bool,
                vol.Required(
                    CONF_SOS_HOLD_DURATION,
                    default=self._options.get(CONF_SOS_HOLD_DURATION, DEFAULT_SOS_HOLD_DURATION)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=1, max=10, unit_of_measurement="seconds")
                ),
                vol.Optional(
                    CONF_SOS_NOTIFY_TARGETS,
                    default=self._options.get(CONF_SOS_NOTIFY_TARGETS, [])
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=notify_services,
                        multiple=True,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ) if notify_services else str,
            }),
        )

    async def async_step_filters(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure filters."""
        if user_input is not None:
            self._options.update(user_input)
            return self.async_create_entry(title="", data=self._options)

        return self.async_show_form(
            step_id="filters",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_MIN_GPS_ACCURACY,
                    default=self._options.get(CONF_MIN_GPS_ACCURACY, DEFAULT_MIN_GPS_ACCURACY)
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(min=10, max=500, unit_of_measurement="meters")
                ),
            }),
        )
