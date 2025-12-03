
// ============================================
// CRASH DETECTION (Beta)
// ============================================

class CrashDetector {
  constructor(config = {}) {
    // User-configurable thresholds with sensible defaults
    this._config = {
      enabled: config.crash_detection?.enabled ?? false,
      
      // Speed thresholds (km/h)
      min_speed_before: config.crash_detection?.min_speed_before ?? 50,    // Must be going at least this fast
      max_speed_after: config.crash_detection?.max_speed_after ?? 5,       // Must slow to this or less
      
      // Time window (seconds)
      time_window: config.crash_detection?.time_window ?? 5,               // Deceleration must happen within this time
      
      // Confirmation delay - wait before alerting (seconds)
      // Gives time for GPS to stabilize / user to cancel
      confirmation_delay: config.crash_detection?.confirmation_delay ?? 30,
      
      // Cooldown between alerts (minutes)
      alert_cooldown: config.crash_detection?.alert_cooldown ?? 5,
      
      // Minimum GPS accuracy required (meters) - ignore poor readings
      min_gps_accuracy: config.crash_detection?.min_gps_accuracy ?? 50,
      
      // Require "driving" activity state (reduces false positives)
      require_driving_activity: config.crash_detection?.require_driving_activity ?? true,
      
      // Ignore if entering a known zone (normal arrival)
      ignore_zone_entry: config.crash_detection?.ignore_zone_entry ?? true,
      
      // Alert targets - HA notify services
      notify_services: config.crash_detection?.notify_services ?? [],
      
      // Custom message template
      message_template: config.crash_detection?.message_template ?? 
        '🚨 POSSIBLE CRASH DETECTED\n\n{person} may have been in an accident.\n\nSpeed: {speed_before} → {speed_after} km/h\nLocation: {location}\nTime: {time}\n\nCheck on them immediately!',
      
      ...config.crash_detection
    };
    
    this._lastAlert = {};  // Per-person cooldown tracking
    this._pendingAlerts = {};  // Alerts waiting for confirmation
    this._speedHistory = {};  // Recent speed readings per person
  }

  // Add a speed reading for a person
  addReading(personName, reading) {
    if (!this._config.enabled) return;
    
    const { speed, timestamp, accuracy, zone, activity } = reading;
    
    // Initialize history for person
    if (!this._speedHistory[personName]) {
      this._speedHistory[personName] = [];
    }
    
    // Filter out inaccurate readings
    if (accuracy > this._config.min_gps_accuracy) {
      return;
    }
    
    // Add to history (keep last 60 seconds of data)
    const history = this._speedHistory[personName];
    history.push({ speed, timestamp, zone, activity, accuracy });
    
    // Trim old readings
    const cutoff = Date.now() - 60000;
    this._speedHistory[personName] = history.filter(r => new Date(r.timestamp).getTime() > cutoff);
    
    // Check for crash pattern
    this._checkForCrash(personName);
  }

  _checkForCrash(personName) {
    const history = this._speedHistory[personName];
    if (history.length < 2) return;
    
    const now = Date.now();
    const latest = history[history.length - 1];
    
    // Check cooldown
    if (this._lastAlert[personName] && 
        (now - this._lastAlert[personName]) < this._config.alert_cooldown * 60000) {
      return;
    }
    
    // Skip if already pending confirmation
    if (this._pendingAlerts[personName]) {
      return;
    }
    
    // Find readings within time window
    const windowStart = now - (this._config.time_window * 1000);
    const recentReadings = history.filter(r => new Date(r.timestamp).getTime() > windowStart);
    
    if (recentReadings.length < 2) return;
    
    // Find max speed in window
    const maxSpeedReading = recentReadings.reduce((max, r) => r.speed > max.speed ? r : max, recentReadings[0]);
    
    // Check crash conditions
    const speedBefore = maxSpeedReading.speed;
    const speedAfter = latest.speed;
    
    const conditions = {
      speed_drop: speedBefore >= this._config.min_speed_before && speedAfter <= this._config.max_speed_after,
      activity_ok: !this._config.require_driving_activity || this._wasRecentlyDriving(recentReadings),
      not_zone_entry: !this._config.ignore_zone_entry || !this._isZoneEntry(history),
      gps_accurate: latest.accuracy <= this._config.min_gps_accuracy
    };
    
    // All conditions must be met
    if (Object.values(conditions).every(c => c)) {
      this._triggerPendingAlert(personName, {
        speedBefore,
        speedAfter,
        location: latest,
        conditions
      });
    }
  }

  _wasRecentlyDriving(readings) {
    // Check if any recent reading had "driving" activity
    return readings.some(r => 
      r.activity?.toLowerCase().includes('driv') || 
      r.activity?.toLowerCase().includes('vehicle') ||
      r.activity?.toLowerCase().includes('automotive')
    );
  }

  _isZoneEntry(history) {
    if (history.length < 2) return false;
    
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    
    // If we just entered a zone (was null/away, now in zone)
    return !previous.zone && latest.zone;
  }

  _triggerPendingAlert(personName, data) {
    console.warn(`Location720: Possible crash detected for ${personName}`, data);
    
    // Set pending alert with confirmation timer
    this._pendingAlerts[personName] = {
      data,
      timestamp: Date.now(),
      timer: setTimeout(() => {
        this._confirmAndSendAlert(personName);
      }, this._config.confirmation_delay * 1000)
    };
    
    // Return pending alert info for UI
    return {
      person: personName,
      pending: true,
      confirmationDelay: this._config.confirmation_delay,
      data
    };
  }

  // Call this if user cancels the alert
  cancelPendingAlert(personName) {
    const pending = this._pendingAlerts[personName];
    if (pending) {
      clearTimeout(pending.timer);
      delete this._pendingAlerts[personName];
      console.log(`Location720: Crash alert cancelled for ${personName}`);
      return true;
    }
    return false;
  }

  _confirmAndSendAlert(personName) {
    const pending = this._pendingAlerts[personName];
    if (!pending) return;
    
    // Clear pending
    delete this._pendingAlerts[personName];
    
    // Set cooldown
    this._lastAlert[personName] = Date.now();
    
    // Build alert data
    const alert = {
      person: personName,
      speedBefore: Math.round(pending.data.speedBefore),
      speedAfter: Math.round(pending.data.speedAfter),
      location: pending.data.location,
      timestamp: new Date().toISOString(),
      message: this._buildMessage(personName, pending.data)
    };
    
    console.warn(`Location720: CRASH ALERT CONFIRMED for ${personName}`, alert);
    
    // Dispatch event for HA to handle
    window.dispatchEvent(new CustomEvent('location720-crash-alert', { 
      detail: alert 
    }));
    
    return alert;
  }

  _buildMessage(personName, data) {
    return this._config.message_template
      .replace('{person}', personName)
      .replace('{speed_before}', Math.round(data.speedBefore))
      .replace('{speed_after}', Math.round(data.speedAfter))
      .replace('{location}', `${data.location.lat?.toFixed(5)}, ${data.location.lng?.toFixed(5)}`)
      .replace('{time}', new Date().toLocaleString());
  }

  // Get current status for UI
  getStatus() {
    return {
      enabled: this._config.enabled,
      config: this._config,
      pendingAlerts: Object.keys(this._pendingAlerts),
      lastAlerts: this._lastAlert
    };
  }

  // Update config at runtime
  updateConfig(newConfig) {
    this._config = { ...this._config, ...newConfig };
  }
}

// Export for use in main card
window.Location720CrashDetector = CrashDetector;
/**
 * Location720 - Private Life360 Alternative
 * HACS Lovelace Card for Home Assistant
 * Version 0.3.0 - Advanced Analytics, Zone Time, Driving Detection
 */

const CARD_VERSION = '0.5.0-beta';

// ============================================
// UTILITY FUNCTIONS
// ============================================

const GeoUtils = {
  distance(p1, p2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat/2) ** 2 + 
              Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * 
              Math.sin(dLon/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  speed(p1, p2) {
    const dist = this.distance(p1, p2);
    const timeMs = new Date(p2.timestamp) - new Date(p1.timestamp);
    if (timeMs <= 0) return 0;
    return (dist / 1000) / (timeMs / 3600000);
  },

  routeDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this.distance(points[i-1], points[i]);
    }
    return total / 1000;
  },

  inZone(point, zone) {
    return this.distance(point, { lat: zone.lat, lng: zone.lng }) <= zone.radius;
  },

  findZone(point, zones) {
    for (const [id, zone] of Object.entries(zones)) {
      if (this.inZone(point, zone)) return zone;
    }
    return null;
  },

  // Detect if moving (speed > 5 km/h) or stationary
  isMoving(speed) {
    return speed > 5;
  },

  // Detect driving (speed > 25 km/h)
  isDriving(speed) {
    return speed > 25;
  }
};

const TimeUtils = {
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0m';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds/60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },

  formatDistance(km) {
    if (!km || km < 0) return '0m';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  },

  formatSpeed(kmh) {
    if (!kmh || kmh < 0) return '0';
    return `${Math.round(kmh)}`;
  },

  formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  formatDate(date) {
    return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
  },

  formatDateTime(date) {
    return `${this.formatDate(date)} ${this.formatTime(date)}`;
  },

  formatPercent(value, total) {
    if (!total) return '0%';
    return `${Math.round((value / total) * 100)}%`;
  }
};

// ============================================
// HISTORY API CLIENT  
// ============================================

class HistoryAPI {
  constructor(hass) {
    this._hass = hass;
  }

  async fetchHistory(entityId, startDate, endDate) {
    try {
      const start = startDate.toISOString();
      const end = endDate.toISOString();
      const url = `history/period/${start}?filter_entity_id=${entityId}&end_time=${end}&minimal_response&significant_changes_only`;
      
      const response = await this._hass.callApi('GET', url);
      return response[0] || [];
    } catch (error) {
      console.error('Location720: History fetch failed', error);
      return [];
    }
  }

  processHistory(history, zones = {}) {
    let points = history
      .filter(h => h.a && h.a.latitude && h.a.longitude)
      .filter(h => Math.abs(h.a.latitude) <= 90 && Math.abs(h.a.longitude) <= 180)
      .filter(h => h.a.latitude !== 0 && h.a.longitude !== 0)
      .map(h => ({
        lat: h.a.latitude,
        lng: h.a.longitude,
        timestamp: h.lu || h.lc,
        accuracy: h.a.gps_accuracy || 999,
        battery: h.a.battery_level,
        state: h.s
      }));

    points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const filtered = [];
    let lastPoint = null;

    for (const point of points) {
      if (!lastPoint || GeoUtils.distance(lastPoint, point) > 15) {
        const zone = GeoUtils.findZone(point, zones);
        point.zone = zone ? zone.name : null;
        point.zoneId = zone ? Object.keys(zones).find(k => zones[k] === zone) : null;
        
        if (lastPoint) {
          point.speed = GeoUtils.speed(lastPoint, point);
          point.isMoving = GeoUtils.isMoving(point.speed);
          point.isDriving = GeoUtils.isDriving(point.speed);
        } else {
          point.speed = 0;
          point.isMoving = false;
          point.isDriving = false;
        }

        filtered.push(point);
        lastPoint = point;
      }
    }

    const stats = this._calculateStats(filtered, zones);
    const trips = this._detectTrips(filtered);
    const zoneVisits = this._calculateZoneTime(filtered, zones);

    return { points: filtered, stats, trips, zoneVisits };
  }

  _calculateStats(points, zones) {
    if (points.length < 2) {
      return { 
        distance: 0, duration: 0, avgSpeed: 0, maxSpeed: 0, 
        movingTime: 0, stationaryTime: 0, drivingTime: 0 
      };
    }

    const distance = GeoUtils.routeDistance(points);
    const duration = (new Date(points[points.length-1].timestamp) - new Date(points[0].timestamp)) / 1000;
    
    const speeds = points.map(p => p.speed).filter(s => s > 0 && s < 200);
    const avgSpeed = speeds.length ? speeds.reduce((a,b) => a+b, 0) / speeds.length : 0;
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;

    let movingTime = 0, stationaryTime = 0, drivingTime = 0;
    for (let i = 1; i < points.length; i++) {
      const dt = (new Date(points[i].timestamp) - new Date(points[i-1].timestamp)) / 1000;
      if (points[i].isDriving) {
        drivingTime += dt;
        movingTime += dt;
      } else if (points[i].isMoving) {
        movingTime += dt;
      } else {
        stationaryTime += dt;
      }
    }

    return { distance, duration, avgSpeed, maxSpeed, movingTime, stationaryTime, drivingTime };
  }

  _detectTrips(points) {
    const trips = [];
    let currentTrip = null;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      if (point.isMoving && !currentTrip) {
        // Start new trip
        currentTrip = {
          startTime: point.timestamp,
          startZone: points[i-1]?.zone || null,
          points: [point],
          maxSpeed: point.speed
        };
      } else if (point.isMoving && currentTrip) {
        // Continue trip
        currentTrip.points.push(point);
        if (point.speed > currentTrip.maxSpeed) {
          currentTrip.maxSpeed = point.speed;
        }
      } else if (!point.isMoving && currentTrip) {
        // End trip
        currentTrip.endTime = point.timestamp;
        currentTrip.endZone = point.zone;
        currentTrip.distance = GeoUtils.routeDistance(currentTrip.points);
        currentTrip.duration = (new Date(currentTrip.endTime) - new Date(currentTrip.startTime)) / 1000;
        
        // Only count as trip if > 100m
        if (currentTrip.distance > 0.1) {
          trips.push(currentTrip);
        }
        currentTrip = null;
      }
    }

    return trips;
  }

  _calculateZoneTime(points, zones) {
    const zoneTime = {};
    
    // Initialize all zones
    Object.values(zones).forEach(zone => {
      zoneTime[zone.name] = { duration: 0, visits: 0, lastVisit: null };
    });
    zoneTime['Away'] = { duration: 0, visits: 0, lastVisit: null };

    let lastZone = null;
    for (let i = 1; i < points.length; i++) {
      const zoneName = points[i].zone || 'Away';
      const dt = (new Date(points[i].timestamp) - new Date(points[i-1].timestamp)) / 1000;
      
      if (!zoneTime[zoneName]) {
        zoneTime[zoneName] = { duration: 0, visits: 0, lastVisit: null };
      }
      
      zoneTime[zoneName].duration += dt;
      zoneTime[zoneName].lastVisit = points[i].timestamp;

      // Count zone transitions as visits
      if (zoneName !== lastZone) {
        zoneTime[zoneName].visits++;
      }
      lastZone = zoneName;
    }

    return zoneTime;
  }
}

// ============================================
// MAIN CARD CLASS
// ============================================

class Location720Card extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._map = null;
    this._markers = {};
    this._zoneCircles = {};
    this._routeLines = {};
    this._routes = {};
    this._zones = {};
    this._historyAPI = null;
    this._selectedPerson = null;
    this._showDetails = false;
    
    this._playback = {
      playing: false,
      speed: 4,
      currentTime: null,
      animationFrame: null
    };
    
    this._timeline = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
      current: new Date()
    };
  }

  static get properties() {
    return { hass: {}, config: {} };
  }

  setConfig(config) {
    this._config = {
      title: 'Location720',
      history_days: 7,
      update_interval: 30,
      show_routes: true,
      show_zones: true,
      show_analytics: true,
      show_trips: true,
      default_zoom: 13,
      map_height: 350,
      persons: [],
      person_colors: {
      auto_follow: "off",
        person1: '#FF6B6B',
        person2: '#4ECDC4',
        person3: '#45B7D1'
      },
      ...config
    };
    
    this._timeline.start = new Date(Date.now() - this._config.history_days * 24 * 60 * 60 * 1000);
  }

  set hass(hass) {
    const firstLoad = !this._hass;
    this._hass = hass;
    this._historyAPI = new HistoryAPI(hass);
    
    if (firstLoad) {
      this._render();
      this._loadLeaflet().then(() => {
        this._initMap();
        this._loadData();
      });
    }
  }

  async _loadLeaflet() {
    if (window.L) return;
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${this._getStyles()}</style>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
      <div class="card">
        <div class="header">
          <div class="header-left">
            <h2>${this._config.title}</h2>
            <div class="subtitle" id="subtitle">Loading...</div>
          </div>
          <button class="details-toggle" id="toggle-details" title="Toggle details">
            <span id="toggle-icon">📊</span>
          </button>
        </div>
        
        <div id="map" style="height: ${this._config.map_height}px"></div>
        
        <div class="timeline-container">
          <div class="timeline-presets">
            <button class="preset-btn" data-days="1">24h</button>
            <button class="preset-btn" data-days="3">3d</button>
            <button class="preset-btn active" data-days="7">7d</button>
            <button class="preset-btn" data-days="14">14d</button>
            <button class="preset-btn" data-days="30">30d</button>
          </div>
          
          <div class="timeline-slider">
            <input type="range" id="timeline" min="0" max="1000" value="1000">
            <div class="timeline-labels">
              <span id="timeline-start"></span>
              <span id="timeline-current"></span>
              <span id="timeline-end"></span>
            </div>
          </div>
          
          <div class="playback-controls">
            <button class="playback-btn" id="btn-rewind" title="Rewind">⏮</button>
            <button class="playback-btn play-btn" id="btn-play" title="Play">▶</button>
            <button class="playback-btn" id="btn-forward" title="Forward">⏭</button>
            <select id="playback-speed">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="4" selected>4x</option>
              <option value="8">8x</option>
              <option value="16">16x</option>
              <option value="32">32x</option>
            </select>
          </div>
        </div>
        
        <div class="stats-row" id="stats-row">
          <div class="stat-item">
            <span class="stat-icon">📏</span>
            <span class="stat-value" id="stat-distance">-</span>
            <span class="stat-unit">distance</span>
          </div>
          <div class="stat-item">
            <span class="stat-icon">⏱️</span>
            <span class="stat-value" id="stat-moving">-</span>
            <span class="stat-unit">moving</span>
          </div>
          <div class="stat-item">
            <span class="stat-icon">🚗</span>
            <span class="stat-value" id="stat-driving">-</span>
            <span class="stat-unit">driving</span>
          </div>
          <div class="stat-item">
            <span class="stat-icon">⚡</span>
            <span class="stat-value" id="stat-max-speed">-</span>
            <span class="stat-unit">max km/h</span>
          </div>
        </div>

        <div class="details-panel" id="details-panel" style="display: none;">
          <div class="details-section">
            <h3>📍 Zone Time</h3>
            <div id="zone-time-list" class="zone-list"></div>
          </div>
          
          <div class="details-section">
            <h3>🚗 Recent Trips</h3>
            <div id="trips-list" class="trips-list"></div>
          </div>
        </div>
        
        <div class="legend" id="legend"></div>
      </div>
    `;

    this._bindEvents();
  }

  _getStyles() {
    return `
      :host { display: block; }
      * { box-sizing: border-box; }
      .card {
        background: var(--card-background-color, #fff);
        border-radius: var(--ha-card-border-radius, 12px);
        box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,0.1));
        overflow: hidden;
      }
      .header {
        padding: 16px;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .header-left h2 {
        margin: 0;
        font-size: 20px;
        color: var(--primary-text-color);
      }
      .subtitle {
        margin-top: 4px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .details-toggle {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 8px;
        border-radius: 50%;
        transition: background 0.2s;
      }
      .details-toggle:hover {
        background: var(--secondary-background-color);
      }
      #map { width: 100%; }
      
      /* Timeline */
      .timeline-container {
        padding: 12px 16px;
        background: var(--secondary-background-color, #f5f5f5);
        border-bottom: 1px solid var(--divider-color);
      }
      .timeline-presets {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .preset-btn {
        padding: 5px 10px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .preset-btn:hover, .preset-btn.active {
        background: var(--primary-color, #03a9f4);
        color: white;
        border-color: var(--primary-color, #03a9f4);
      }
      .timeline-slider { margin-bottom: 10px; }
      .timeline-slider input {
        width: 100%;
        cursor: pointer;
        height: 6px;
        -webkit-appearance: none;
        background: var(--divider-color);
        border-radius: 3px;
      }
      .timeline-slider input::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        background: var(--primary-color, #03a9f4);
        border-radius: 50%;
        cursor: pointer;
      }
      .timeline-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
      #timeline-current {
        font-weight: bold;
        color: var(--primary-text-color);
      }
      
      /* Playback */
      .playback-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: center;
      }
      .playback-btn {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 50%;
        background: var(--primary-color, #03a9f4);
        color: white;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.1s, opacity 0.2s;
      }
      .playback-btn:hover { opacity: 0.85; }
      .playback-btn:active { transform: scale(0.95); }
      .play-btn { width: 40px; height: 40px; font-size: 16px; }
      #playback-speed {
        padding: 5px 8px;
        border-radius: 4px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 12px;
      }
      
      /* Stats Row */
      .stats-row {
        display: flex;
        padding: 10px 16px;
        gap: 8px;
        border-bottom: 1px solid var(--divider-color);
        overflow-x: auto;
      }
      .stat-item {
        flex: 1;
        min-width: 70px;
        text-align: center;
        padding: 8px 4px;
        background: var(--secondary-background-color, #f5f5f5);
        border-radius: 8px;
      }
      .stat-icon { font-size: 16px; display: block; margin-bottom: 2px; }
      .stat-value {
        font-size: 16px;
        font-weight: bold;
        color: var(--primary-text-color);
        display: block;
      }
      .stat-unit {
        font-size: 10px;
        color: var(--secondary-text-color);
      }
      
      /* Details Panel */
      .details-panel {
        padding: 12px 16px;
        border-bottom: 1px solid var(--divider-color);
        max-height: 300px;
        overflow-y: auto;
      }
      .details-section {
        margin-bottom: 16px;
      }
      .details-section:last-child { margin-bottom: 0; }
      .details-section h3 {
        margin: 0 0 8px 0;
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .zone-list, .trips-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .zone-item, .trip-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 10px;
        background: var(--secondary-background-color);
        border-radius: 6px;
        font-size: 13px;
      }
      .zone-name, .trip-route { color: var(--primary-text-color); }
      .zone-stats, .trip-stats {
        display: flex;
        gap: 12px;
        color: var(--secondary-text-color);
        font-size: 12px;
      }
      .zone-bar {
        height: 4px;
        background: var(--primary-color);
        border-radius: 2px;
        margin-top: 4px;
      }
      
      /* Legend */
      .legend {
        padding: 10px 16px;
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 12px;
        transition: background 0.2s;
      }
      .legend-item:hover {
        background: var(--secondary-background-color);
      }
      .legend-item.selected {
        background: var(--secondary-background-color);
        font-weight: bold;
      }
      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      
      /* Mobile */
      @media (max-width: 480px) {
        .stats-row { flex-wrap: wrap; }
        .stat-item { min-width: 45%; }
        .timeline-presets { justify-content: center; }
      }
    `;
  }

  _bindEvents() {
    // Preset buttons
    this.shadowRoot.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const days = parseInt(e.target.dataset.days);
        this._setDateRange(days);
        this.shadowRoot.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    // Timeline slider
    const slider = this.shadowRoot.getElementById('timeline');
    slider.addEventListener('input', (e) => this._onTimelineChange(parseInt(e.target.value)));

    // Playback controls
    this.shadowRoot.getElementById('btn-play').addEventListener('click', () => this._togglePlayback());
    this.shadowRoot.getElementById('btn-rewind').addEventListener('click', () => this._rewind());
    this.shadowRoot.getElementById('btn-forward').addEventListener('click', () => this._forward());
    this.shadowRoot.getElementById('playback-speed').addEventListener('change', (e) => {
      this._playback.speed = parseInt(e.target.value);
    });

    // Details toggle
    this.shadowRoot.getElementById('toggle-details').addEventListener('click', () => {
      this._showDetails = !this._showDetails;
      const panel = this.shadowRoot.getElementById('details-panel');
      const icon = this.shadowRoot.getElementById('toggle-icon');
      panel.style.display = this._showDetails ? 'block' : 'none';
      icon.textContent = this._showDetails ? '📈' : '📊';
    });
  }

  _setDateRange(days) {
    this._timeline.start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    this._timeline.end = new Date();
    this._timeline.current = new Date(this._timeline.end);
    this._config.history_days = days;
    this._loadHistory();
  }

  _initMap() {
    const mapEl = this.shadowRoot.getElementById('map');
    if (!mapEl || this._map) return;

    const defaultCenter = [0, 0];
    this._map = L.map(mapEl, {
      center: defaultCenter,
      zoom: this._config.default_zoom
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OSM',
      maxZoom: 19
    }).addTo(this._map);

    // Auto-follow settings
    this._autoFollowTarget = this._config.auto_follow || "off";
    this._lastAutoFollowPan = 0;
    }).addTo(this._map);
  }

  async _loadData() {
    await this._loadZones();
    await this._loadPersons();
    await this._loadHistory();
    this._updateTimelineLabels();
    setInterval(() => this._loadPersons(), this._config.update_interval * 1000);
  }

  async _loadZones() {
    if (!this._hass) return;

    Object.values(this._zoneCircles).forEach(c => c.remove());
    this._zoneCircles = {};
    this._zones = {};

    Object.keys(this._hass.states)
      .filter(id => id.startsWith('zone.'))
      .forEach(id => {
        const zone = this._hass.states[id];
        const { latitude, longitude, radius, friendly_name, icon } = zone.attributes;
        
        if (latitude && longitude && radius) {
          this._zones[id] = {
            name: friendly_name,
            lat: latitude,
            lng: longitude,
            radius: radius,
            icon: icon || 'mdi:map-marker'
          };

          if (this._config.show_zones && this._map) {
            const circle = L.circle([latitude, longitude], {
              radius: radius,
              color: '#3388ff',
              fillColor: '#3388ff',
              fillOpacity: 0.08,
              weight: 2,
              dashArray: '5, 5'
            }).addTo(this._map);
            circle.bindPopup(`<strong>${friendly_name}</strong><br>Radius: ${radius}m`);
            this._zoneCircles[id] = circle;
          }
        }
      });
  }

  async _loadPersons() {
    if (!this._hass || !this._map) return;

    const colors = this._config.person_colors;
    const persons = [];

    Object.values(this._markers).forEach(m => m.remove());
    this._markers = {};

    Object.keys(this._hass.states)
      .filter(id => id.startsWith('person.'))
      .filter(id => this._config.persons.length === 0 || this._config.persons.includes(id))
      .forEach(id => {
        const person = this._hass.states[id];
        const { latitude, longitude, gps_accuracy, battery_level } = person.attributes;
        const name = id.replace('person.', '');

        if (latitude && longitude) {
          const color = colors[name] || '#999';
          
          const icon = L.divIcon({
            className: 'person-marker',
            html: `<div style="
              background: ${color};
              width: 36px; height: 36px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex; align-items: center; justify-content: center;
              color: white; font-weight: bold; font-size: 14px;
            ">${name.charAt(0).toUpperCase()}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
          });

          const marker = L.marker([latitude, longitude], { icon, zIndexOffset: 1000 }).addTo(this._map);
          marker.bindPopup(`
            <strong>${name}</strong><br>
            📍 ${person.state}<br>
            📡 ±${gps_accuracy || '?'}m
            ${battery_level ? `<br>🔋 ${battery_level}%` : ''}
          `);

          this._markers[name] = marker;
          persons.push({ name, state: person.state, color, lat: latitude, lng: longitude, battery: battery_level });
        }
      });

    this._updateSubtitle(persons);
    this._updateLegend(persons);

    if (persons.length > 0 && !this._playback.playing) {
      const bounds = L.latLngBounds(persons.map(p => [p.lat, p.lng]));
      this._map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  async _loadHistory() {
    if (!this._historyAPI || !this._map) return;

    const personIds = Object.keys(this._markers);
    if (personIds.length === 0) return;

    Object.values(this._routeLines).forEach(lines => lines.forEach(l => l.remove()));
    this._routeLines = {};
    this._routes = {};

    for (const name of personIds) {
      const entityId = `person.${name}`;
      const history = await this._historyAPI.fetchHistory(entityId, this._timeline.start, this._timeline.end);

      if (history.length > 0) {
        const route = this._historyAPI.processHistory(history, this._zones);
        this._routes[name] = route;
        
        if (this._config.show_routes) {
          this._drawRoute(name, route.points);
        }
      }
    }

    this._updateAnalytics();
    this._updateZoneTimeList();
    this._updateTripsList();
  }

  _drawRoute(personName, points) {
    if (points.length < 2) return;

    const color = this._config.person_colors[personName] || '#999';
    const lines = [];
    const totalTime = new Date(points[points.length-1].timestamp) - new Date(points[0].timestamp);
    
    for (let i = 1; i < points.length; i++) {
      const age = new Date(points[i].timestamp) - new Date(points[0].timestamp);
      const opacity = 0.2 + 0.8 * (age / totalTime);
      const weight = points[i].isDriving ? 4 : 2;

      const line = L.polyline(
        [[points[i-1].lat, points[i-1].lng], [points[i].lat, points[i].lng]],
        { color, weight, opacity }
      ).addTo(this._map);

      lines.push(line);
    }

    // Start marker
    const startMarker = L.circleMarker([points[0].lat, points[0].lng], {
      radius: 5, color: color, fillColor: '#fff', fillOpacity: 1, weight: 2
    }).addTo(this._map);
    startMarker.bindPopup(`<strong>${personName}</strong><br>🚀 Start: ${TimeUtils.formatDateTime(points[0].timestamp)}`);
    lines.push(startMarker);

    this._routeLines[personName] = lines;
  }

  _updateSubtitle(persons) {
    const el = this.shadowRoot.getElementById('subtitle');
    if (!el) return;
    
    const batteryInfo = persons
      .filter(p => p.battery)
      .map(p => `${p.name.charAt(0).toUpperCase()}: ${p.battery}%`)
      .join(' • ');
    
    el.textContent = `${persons.length} tracking • ${this._config.history_days}d history${batteryInfo ? ' • 🔋 ' + batteryInfo : ''}`;
  }

  _updateLegend(persons) {
    const legend = this.shadowRoot.getElementById('legend');
    if (!legend) return;

    legend.innerHTML = persons.map(p => {
      const route = this._routes[p.name];
      const dist = route ? TimeUtils.formatDistance(route.stats.distance) : '';
      const selected = this._selectedPerson === p.name ? 'selected' : '';
      return `
        <div class="legend-item ${selected}" data-person="${p.name}">
          <div class="legend-dot" style="background: ${p.color}"></div>
          <span>${p.name} • ${p.state}${dist ? ` • ${dist}` : ''}</span>
        </div>
      `;
    }).join('');

    // Add click handlers
    legend.querySelectorAll('.legend-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.person;
        this._selectedPerson = this._selectedPerson === name ? null : name;
        this._updateLegend(persons);
        this._focusPerson(name);
      });
    });
  }

  _focusPerson(name) {
    const marker = this._markers[name];
    if (marker) {
      this._map.setView(marker.getLatLng(), 15);
      marker.openPopup();
    }
  }

  _updateAnalytics() {
    let totalDist = 0, totalMoving = 0, totalDriving = 0, maxSpeed = 0;

    Object.values(this._routes).forEach(route => {
      totalDist += route.stats.distance;
      totalMoving += route.stats.movingTime;
      totalDriving += route.stats.drivingTime;
      if (route.stats.maxSpeed > maxSpeed) maxSpeed = route.stats.maxSpeed;
    });

    this._setStatValue('stat-distance', TimeUtils.formatDistance(totalDist));
    this._setStatValue('stat-moving', TimeUtils.formatDuration(totalMoving));
    this._setStatValue('stat-driving', TimeUtils.formatDuration(totalDriving));
    this._setStatValue('stat-max-speed', TimeUtils.formatSpeed(maxSpeed));
  }

  _updateZoneTimeList() {
    const container = this.shadowRoot.getElementById('zone-time-list');
    if (!container) return;

    // Aggregate zone time across all persons
    const aggregated = {};
    let totalTime = 0;

    Object.values(this._routes).forEach(route => {
      Object.entries(route.zoneVisits).forEach(([zone, data]) => {
        if (!aggregated[zone]) {
          aggregated[zone] = { duration: 0, visits: 0 };
        }
        aggregated[zone].duration += data.duration;
        aggregated[zone].visits += data.visits;
        totalTime += data.duration;
      });
    });

    // Sort by duration
    const sorted = Object.entries(aggregated)
      .filter(([_, data]) => data.duration > 60) // Min 1 minute
      .sort((a, b) => b[1].duration - a[1].duration)
      .slice(0, 8);

    container.innerHTML = sorted.map(([zone, data]) => {
      const percent = totalTime > 0 ? (data.duration / totalTime) * 100 : 0;
      return `
        <div class="zone-item">
          <div style="flex: 1">
            <div class="zone-name">${zone}</div>
            <div class="zone-bar" style="width: ${percent}%"></div>
          </div>
          <div class="zone-stats">
            <span>${TimeUtils.formatDuration(data.duration)}</span>
            <span>${TimeUtils.formatPercent(data.duration, totalTime)}</span>
          </div>
        </div>
      `;
    }).join('') || '<div style="color: var(--secondary-text-color); font-size: 12px;">No zone data</div>';
  }

  _updateTripsList() {
    const container = this.shadowRoot.getElementById('trips-list');
    if (!container) return;

    // Collect all trips
    const allTrips = [];
    Object.entries(this._routes).forEach(([person, route]) => {
      route.trips.forEach(trip => {
        allTrips.push({ ...trip, person });
      });
    });

    // Sort by start time, newest first
    allTrips.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const recent = allTrips.slice(0, 6);

    container.innerHTML = recent.map(trip => {
      const from = trip.startZone || '📍';
      const to = trip.endZone || '📍';
      const color = this._config.person_colors[trip.person] || '#999';
      return `
        <div class="trip-item">
          <div>
            <div class="trip-route">
              <span style="color: ${color}">●</span> 
              ${from} → ${to}
            </div>
            <div style="font-size: 11px; color: var(--secondary-text-color)">
              ${TimeUtils.formatDateTime(trip.startTime)}
            </div>
          </div>
          <div class="trip-stats">
            <span>${TimeUtils.formatDistance(trip.distance)}</span>
            <span>${TimeUtils.formatDuration(trip.duration)}</span>
          </div>
        </div>
      `;
    }).join('') || '<div style="color: var(--secondary-text-color); font-size: 12px;">No trips recorded</div>';
  }

  _setStatValue(id, value) {
    const el = this.shadowRoot.getElementById(id);
    if (el) el.textContent = value;
  }

  _updateTimelineLabels() {
    const startEl = this.shadowRoot.getElementById('timeline-start');
    const endEl = this.shadowRoot.getElementById('timeline-end');
    const currentEl = this.shadowRoot.getElementById('timeline-current');

    if (startEl) startEl.textContent = TimeUtils.formatDate(this._timeline.start);
    if (endEl) endEl.textContent = TimeUtils.formatDate(this._timeline.end);
    if (currentEl) currentEl.textContent = TimeUtils.formatDateTime(this._timeline.current);
  }

  _onTimelineChange(value) {
    const range = this._timeline.end - this._timeline.start;
    const offset = (value / 1000) * range;
    this._timeline.current = new Date(this._timeline.start.getTime() + offset);
    
    this._updateTimelineLabels();
    this._updateMarkersToTime(this._timeline.current);
  }

  _updateMarkersToTime(targetTime) {
    Object.entries(this._routes).forEach(([name, route]) => {
      const points = route.points;
      if (points.length === 0) return;

      let point = points[0];
      for (let i = 0; i < points.length; i++) {
        if (new Date(points[i].timestamp) <= targetTime) {
          point = points[i];
        } else {
          break;
        }
      }

      const marker = this._markers[name];
      if (marker) {
        marker.setLatLng([point.lat, point.lng]);
      }
    });
  }

  _togglePlayback() {
    this._playback.playing = !this._playback.playing;
    const btn = this.shadowRoot.getElementById('btn-play');
    btn.textContent = this._playback.playing ? '⏸' : '▶';

    if (this._playback.playing) {
      this._startPlayback();
    } else {
      this._stopPlayback();
    }
  }

  _startPlayback() {
    const slider = this.shadowRoot.getElementById('timeline');
    let value = parseInt(slider.value);
    let lastFrame = performance.now();

    const animate = (now) => {
      if (!this._playback.playing) return;

      const delta = now - lastFrame;
      lastFrame = now;
      
      // Advance based on speed (roughly 1 second of real time = 1 minute of history at 1x)
      const increment = (delta / 16.67) * 0.05 * this._playback.speed;
      value += increment;
      
      if (value >= 1000) {
        value = 0;
      }

      slider.value = value;
      this._onTimelineChange(value);

      this._playback.animationFrame = requestAnimationFrame(animate);
    };

    this._playback.animationFrame = requestAnimationFrame(animate);
  }

  _stopPlayback() {
    if (this._playback.animationFrame) {
      cancelAnimationFrame(this._playback.animationFrame);
    }
  }

  _rewind() {
    const slider = this.shadowRoot.getElementById('timeline');
    slider.value = Math.max(0, parseInt(slider.value) - 50);
    this._onTimelineChange(parseInt(slider.value));
  }

  _forward() {
    const slider = this.shadowRoot.getElementById('timeline');
    slider.value = Math.min(1000, parseInt(slider.value) + 50);
    this._onTimelineChange(parseInt(slider.value));
  }

  getCardSize() {
    return 7;
  }

  static getConfigElement() {
    return document.createElement("location720-card-editor");
  }

  static getStubConfig() {
    return {
      title: 'Location720',
      history_days: 7,
      show_routes: true,
      show_zones: true
    };
  }
}

customElements.define('location720-card', Location720Card);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'location720-card',
  name: 'Location720',
  description: 'Private Life360 alternative - tracking, routes, playback, analytics',
  preview: true,
  documentationURL: 'https://github.com/BushDozer/Location720'
});

console.info(`%c LOCATION720 %c v${CARD_VERSION} `, 'background:#FF6B6B;color:white;font-weight:bold', 'background:#333;color:white');

// ============================================
// CARD EDITOR (Visual Config)
// ============================================

class Location720CardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this.shadowRoot) {
      this._updatePersonOptions();
    }
  }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }

    this.shadowRoot.innerHTML = `
      <style>
        .editor {
          padding: 16px;
        }
        .row {
          margin-bottom: 16px;
        }
        .row label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .row input, .row select {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .row input[type="checkbox"] {
          width: auto;
          margin-right: 8px;
        }
        .checkbox-row {
          display: flex;
          align-items: center;
        }
        .checkbox-row label {
          margin: 0;
          font-weight: normal;
        }
        .section-title {
          font-size: 14px;
          font-weight: bold;
          margin: 16px 0 8px 0;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color);
        }
        .person-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .person-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .color-input {
          width: 40px !important;
          height: 32px;
          padding: 2px;
          cursor: pointer;
        }
      </style>
      <div class="editor">
        <div class="row">
          <label>Title</label>
          <input type="text" id="title" value="${this._config.title || 'Location720'}">
        </div>
        
        <div class="row">
          <label>History Days</label>
          <select id="history_days">
            <option value="1" ${this._config.history_days === 1 ? 'selected' : ''}>1 day</option>
            <option value="3" ${this._config.history_days === 3 ? 'selected' : ''}>3 days</option>
            <option value="7" ${this._config.history_days === 7 ? 'selected' : ''}>7 days</option>
            <option value="14" ${this._config.history_days === 14 ? 'selected' : ''}>14 days</option>
            <option value="30" ${this._config.history_days === 30 ? 'selected' : ''}>30 days</option>
          </select>
        </div>

        <div class="row">
          <label>Map Height (px)</label>
          <input type="number" id="map_height" value="${this._config.map_height || 350}" min="200" max="800">
        </div>

        <div class="row">
          <label>Default Zoom</label>
          <input type="number" id="default_zoom" value="${this._config.default_zoom || 13}" min="1" max="19">
        </div>

        <div class="section-title">Display Options</div>
        
        <div class="row checkbox-row">
          <input type="checkbox" id="show_routes" ${this._config.show_routes !== false ? 'checked' : ''}>
          <label for="show_routes">Show Routes</label>
        </div>

        <div class="row checkbox-row">
          <input type="checkbox" id="show_zones" ${this._config.show_zones !== false ? 'checked' : ''}>
          <label for="show_zones">Show Zones</label>
        </div>

        <div class="row checkbox-row">
          <input type="checkbox" id="show_analytics" ${this._config.show_analytics !== false ? 'checked' : ''}>
          <label for="show_analytics">Show Analytics</label>
        </div>

        <div class="section-title">Persons</div>
        <div class="person-list" id="person-list">
          Loading...
        </div>
      </div>
    `;

    this._bindEvents();
    this._updatePersonOptions();
  }

  _bindEvents() {
    // Text/number inputs
    ['title', 'map_height', 'default_zoom'].forEach(id => {
      const el = this.shadowRoot.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          const value = e.target.type === 'number' ? parseInt(e.target.value) : e.target.value;
          this._updateConfig(id, value);
        });
      }
    });

    // Select
    const historyDays = this.shadowRoot.getElementById('history_days');
    if (historyDays) {
      historyDays.addEventListener('change', (e) => {
        this._updateConfig('history_days', parseInt(e.target.value));
      });
    }

    // Checkboxes
    ['show_routes', 'show_zones', 'show_analytics'].forEach(id => {
      const el = this.shadowRoot.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          this._updateConfig(id, e.target.checked);
        });
      }
    });
  }

  _updatePersonOptions() {
    const container = this.shadowRoot?.getElementById('person-list');
    if (!container || !this._hass) return;

    const persons = Object.keys(this._hass.states)
      .filter(id => id.startsWith('person.'))
      .map(id => ({
        id,
        name: id.replace('person.', ''),
        friendlyName: this._hass.states[id].attributes.friendly_name || id
      }));

    const currentColors = this._config.person_colors || {};
    const defaultColors = { person1: '#FF6B6B', person2: '#4ECDC4', person3: '#45B7D1' };

    container.innerHTML = persons.map(person => {
      const color = currentColors[person.name] || defaultColors[person.name] || '#999999';
      return `
        <div class="person-item">
          <input type="color" class="color-input" data-person="${person.name}" value="${color}">
          <span>${person.friendlyName}</span>
        </div>
      `;
    }).join('');

    // Bind color change events
    container.querySelectorAll('.color-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const personName = e.target.dataset.person;
        const color = e.target.value;
        const colors = { ...this._config.person_colors, [personName]: color };
        this._updateConfig('person_colors', colors);
      });
    });
  }

  _updateConfig(key, value) {
    this._config = { ...this._config, [key]: value };
    
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}

customElements.define('location720-card-editor', Location720CardEditor);

// Patch Location720Card to include crash detection
const OriginalSetConfig = Location720Card.prototype.setConfig;
Location720Card.prototype.setConfig = function(config) {
  OriginalSetConfig.call(this, config);
  
  // Initialize crash detector with config
  if (window.Location720CrashDetector) {
    this._crashDetector = new window.Location720CrashDetector(this._config);
  }
};

// Add crash detection styles
const OriginalGetStyles = Location720Card.prototype._getStyles;
Location720Card.prototype._getStyles = function() {
  return OriginalGetStyles.call(this) + `
    /* Crash Detection Styles */
    .crash-banner {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #ff4444, #cc0000);
      color: white;
      padding: 12px 16px;
      z-index: 1000;
      animation: crash-pulse 1s infinite;
    }
    @keyframes crash-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.8; }
    }
    .crash-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .crash-icon {
      font-size: 24px;
      animation: crash-shake 0.5s infinite;
    }
    @keyframes crash-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-2px); }
      75% { transform: translateX(2px); }
    }
    .crash-text { flex: 1; }
    .crash-text strong { display: block; }
    .crash-countdown {
      font-size: 20px;
      font-weight: bold;
    }
    .crash-cancel {
      background: white;
      color: #cc0000;
      border: none;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: bold;
      cursor: pointer;
    }
    
    /* SOS Button */
    .sos-btn {
      position: absolute;
      bottom: 70px;
      right: 12px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ff4444, #cc0000);
      color: white;
      border: 3px solid white;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 100;
      transition: transform 0.2s;
    }
    .sos-btn:hover { transform: scale(1.1); }
    .sos-btn.hidden { display: none; }
    
    /* SOS Modal */
    .sos-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .sos-modal-box {
      background: var(--card-background-color, white);
      border-radius: 16px;
      padding: 24px;
      max-width: 300px;
      text-align: center;
    }
    .sos-modal-box h3 {
      color: #cc0000;
      margin: 0 0 12px 0;
    }
    .sos-modal-btns {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 16px;
    }
    .sos-modal-btns button {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .sos-confirm {
      background: #cc0000;
      color: white;
    }
    .sos-cancel-modal {
      background: var(--secondary-background-color);
      color: var(--primary-text-color);
    }
  `;
};

// Override render to add SOS button and crash banner
const OriginalRender = Location720Card.prototype._render;
Location720Card.prototype._render = function() {
  OriginalRender.call(this);
  
  // Add crash banner
  const header = this.shadowRoot.querySelector('.header');
  if (header) {
    const banner = document.createElement('div');
    banner.className = 'crash-banner';
    banner.id = 'crash-banner';
    banner.style.display = 'none';
    banner.innerHTML = `
      <div class="crash-content">
        <span class="crash-icon">🚨</span>
        <div class="crash-text">
          <strong>Possible crash detected</strong>
          <span id="crash-person-name">Checking...</span>
        </div>
        <div class="crash-countdown" id="crash-countdown">30</div>
        <button class="crash-cancel" id="crash-cancel-btn">I'm OK</button>
      </div>
    `;
    header.parentNode.insertBefore(banner, header);
  }
  
  // Add SOS button
  const map = this.shadowRoot.getElementById('map');
  if (map) {
    const sos = document.createElement('button');
    sos.className = 'sos-btn' + (this._config.sos?.enabled ? '' : ' hidden');
    sos.id = 'sos-btn';
    sos.textContent = 'SOS';
    sos.title = 'Send emergency alert';
    map.parentNode.style.position = 'relative';
    map.parentNode.insertBefore(sos, map.nextSibling);
  }
  
  this._bindCrashEvents();
};

Location720Card.prototype._bindCrashEvents = function() {
  // SOS button
  const sosBtn = this.shadowRoot.getElementById('sos-btn');
  if (sosBtn) {
    sosBtn.onclick = () => this._showSOSModal();
  }
  
  // Crash cancel
  const cancelBtn = this.shadowRoot.getElementById('crash-cancel-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => this._cancelCrash();
  }
  
  // Listen for crash events
  window.addEventListener('location720-crash-alert', (e) => {
    this._sendCrashNotifications(e.detail);
  });
};

Location720Card.prototype._showSOSModal = function() {
  const modal = document.createElement('div');
  modal.className = 'sos-modal';
  modal.innerHTML = `
    <div class="sos-modal-box">
      <h3>🆘 Send SOS Alert?</h3>
      <p>This will immediately notify your emergency contacts with your location.</p>
      <div class="sos-modal-btns">
        <button class="sos-cancel-modal">Cancel</button>
        <button class="sos-confirm">SEND SOS</button>
      </div>
    </div>
  `;
  this.shadowRoot.appendChild(modal);
  
  modal.querySelector('.sos-cancel-modal').onclick = () => modal.remove();
  modal.querySelector('.sos-confirm').onclick = () => {
    modal.remove();
    this._sendSOS();
  };
};

Location720Card.prototype._sendSOS = function() {
  const person = Object.keys(this._markers)[0] || 'Unknown';
  const marker = this._markers[person];
  const loc = marker?.getLatLng();
  
  const message = `🆘 SOS ALERT from ${person}!\n\nLocation: ${loc?.lat?.toFixed(5)}, ${loc?.lng?.toFixed(5)}\nTime: ${new Date().toLocaleString()}\n\nThey need help immediately!`;
  
  // Send notifications
  const services = this._config.sos?.notify_services || [];
  services.forEach(svc => {
    if (this._hass) {
      this._hass.callService('notify', svc, {
        message,
        title: '🆘 SOS ALERT',
        data: { priority: 'high', ttl: 0, tag: 'location720-sos' }
      });
    }
  });
  
  // Visual feedback
  const btn = this.shadowRoot.getElementById('sos-btn');
  if (btn) {
    btn.textContent = 'SENT!';
    setTimeout(() => btn.textContent = 'SOS', 3000);
  }
};

Location720Card.prototype._showCrashBanner = function(person, seconds) {
  const banner = this.shadowRoot.getElementById('crash-banner');
  const nameEl = this.shadowRoot.getElementById('crash-person-name');
  const countdownEl = this.shadowRoot.getElementById('crash-countdown');
  
  if (banner) {
    banner.style.display = 'block';
    if (nameEl) nameEl.textContent = `Checking on ${person}...`;
    
    let remaining = seconds;
    this._crashInterval = setInterval(() => {
      remaining--;
      if (countdownEl) countdownEl.textContent = remaining;
      if (remaining <= 0) clearInterval(this._crashInterval);
    }, 1000);
  }
};

Location720Card.prototype._cancelCrash = function() {
  const banner = this.shadowRoot.getElementById('crash-banner');
  if (banner) banner.style.display = 'none';
  if (this._crashInterval) clearInterval(this._crashInterval);
  
  // Cancel in detector
  if (this._crashDetector) {
    Object.keys(this._crashDetector._pendingAlerts || {}).forEach(p => {
      this._crashDetector.cancelPendingAlert(p);
    });
  }
};

Location720Card.prototype._sendCrashNotifications = function(alert) {
  const services = this._config.crash_detection?.notify_services || [];
  services.forEach(svc => {
    if (this._hass) {
      this._hass.callService('notify', svc, {
        message: alert.message,
        title: '🚨 CRASH ALERT',
        data: { priority: 'high', ttl: 0, tag: 'location720-crash' }
      });
    }
  });
  
  this._cancelCrash();
};

// Feed speed data to crash detector during history processing
const OriginalLoadPersons = Location720Card.prototype._loadPersons;
Location720Card.prototype._loadPersons = async function() {
  await OriginalLoadPersons.call(this);
  
  // Feed current data to crash detector
  if (this._crashDetector && this._config.crash_detection?.enabled) {
    Object.entries(this._hass?.states || {})
      .filter(([id]) => id.startsWith('person.'))
      .forEach(([id, state]) => {
        const name = id.replace('person.', '');
        const { latitude, longitude, gps_accuracy } = state.attributes || {};
        
        if (latitude && longitude) {
          // Calculate speed from marker movement (simplified)
          const marker = this._markers[name];
          const route = this._routes[name];
          const lastPoint = route?.points?.[route.points.length - 1];
          
          this._crashDetector.addReading(name, {
            speed: lastPoint?.speed || 0,
            timestamp: new Date().toISOString(),
            accuracy: gps_accuracy || 999,
            zone: state.state,
            activity: state.attributes?.activity || null
          });
        }
      });
  }
};

console.info('%c LOCATION720 %c v0.5.0-beta %c Crash Detection ', 
  'background:#FF6B6B;color:white;font-weight:bold',
  'background:#333;color:white',
  'background:#cc0000;color:white');

// ============================================
// AUTO-FOLLOW WITH SMOOTH PAN
// ============================================

Location720Card.prototype._smoothPanTo = function(lat, lng) {
  if (!this._map) return;
  
  const targetLatLng = L.latLng(lat, lng);
  const currentCenter = this._map.getCenter();
  const distance = currentCenter.distanceTo(targetLatLng);
  
  // Only pan if moved more than 50 meters
  if (distance > 50) {
    this._map.panTo(targetLatLng, {
      animate: true,
      duration: 0.5,
      easeLinearity: 0.25
    });
  }
};

Location720Card.prototype._checkAutoFollow = function(personName, lat, lng) {
  const target = this._config.auto_follow;
  if (!target || target === 'off') return;
  
  // Rate limit panning to once per second
  const now = Date.now();
  if (this._lastAutoFollowPan && (now - this._lastAutoFollowPan) < 1000) return;
  
  if (target === 'all' || target === personName) {
    this._smoothPanTo(lat, lng);
    this._lastAutoFollowPan = now;
  }
};

// Patch _loadPersons to add auto-follow
const OriginalLoadPersonsForFollow = Location720Card.prototype._loadPersons;
Location720Card.prototype._loadPersons = async function() {
  await OriginalLoadPersonsForFollow.call(this);
  
  // Check for auto-follow
  if (this._config.auto_follow && this._config.auto_follow !== 'off') {
    const target = this._config.auto_follow;
    
    for (const [name, marker] of Object.entries(this._markers || {})) {
      if (target === 'all' || target === name) {
        const latLng = marker.getLatLng();
        this._checkAutoFollow(name, latLng.lat, latLng.lng);
        break; // Only follow first match if 'all'
      }
    }
  }
};

// ============================================
// AUTO-DISCOVER LOCATION720 SENSORS
// ============================================

Location720Card.prototype._getLocation720Sensors = function() {
  if (!this._hass) return [];
  
  return Object.keys(this._hass.states)
    .filter(id => id.startsWith('sensor.location720_') && id.endsWith('_coords'))
    .map(id => {
      const state = this._hass.states[id];
      const attrs = state.attributes || {};
      return {
        entity_id: id,
        person_id: attrs.person_id || id.replace('sensor.location720_', '').replace('_coords', ''),
        display_name: attrs.display_name || attrs.person_id,
        color: attrs.color || '#FF6B6B',
        latitude: attrs.latitude,
        longitude: attrs.longitude,
        gps_accuracy: attrs.gps_accuracy,
        battery_level: attrs.battery_level,
        state: state.state
      };
    });
};

// Override _loadPersons to use location720 sensors when available
const OriginalLoadPersonsForSensors = Location720Card.prototype._loadPersons;
Location720Card.prototype._loadPersons = async function() {
  // Try to load from location720 sensors first
  const l720Sensors = this._getLocation720Sensors();
  
  if (l720Sensors.length > 0) {
    // Use integration sensors
    Object.values(this._markers).forEach(m => m.remove());
    this._markers = {};
    
    const persons = [];
    
    for (const sensor of l720Sensors) {
      if (!sensor.latitude || !sensor.longitude) continue;
      
      const name = sensor.person_id;
      const color = this._config.person_colors?.[name] || sensor.color || '#FF6B6B';
      
      const icon = L.divIcon({
        className: 'location720-marker',
        html: `<div style="background-color:${color};width:40px;height:40px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:16px;">${name.charAt(0).toUpperCase()}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      
      const marker = L.marker([sensor.latitude, sensor.longitude], { icon }).addTo(this._map);
      
      marker.bindPopup(`
        <div style="min-width:150px;">
          <strong>${sensor.display_name || name}</strong><br>
          Accuracy: ${sensor.gps_accuracy || '?'}m
          ${sensor.battery_level ? `<br>Battery: ${sensor.battery_level}%` : ''}
        </div>
      `);
      
      this._markers[name] = marker;
      persons.push({ name, lat: sensor.latitude, lng: sensor.longitude });
      
      // Check auto-follow
      this._checkAutoFollow(name, sensor.latitude, sensor.longitude);
    }
    
    // Fit bounds if we have persons and not auto-following
    if (persons.length > 0 && (!this._config.auto_follow || this._config.auto_follow === 'off')) {
      const bounds = L.latLngBounds(persons.map(p => [p.lat, p.lng]));
      this._map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    
    return;
  }
  
  // Fallback to original method (person entities)
  await OriginalLoadPersonsForSensors.call(this);
};

// ============================================
// HISTORY FROM COORD SENSORS
// ============================================

Location720Card.prototype._loadHistoryFromCoordSensors = async function() {
  const l720Sensors = this._getLocation720Sensors();
  if (l720Sensors.length === 0) return false;
  
  for (const sensor of l720Sensors) {
    const entityId = sensor.entity_id;
    const name = sensor.person_id;
    
    const history = await this._historyAPI.fetchHistory(
      entityId, 
      this._timeline.start, 
      this._timeline.end
    );
    
    if (history.length > 0) {
      // Parse coord sensor states ("lat,lng" format)
      const points = history
        .filter(h => h.s && h.s.includes(','))
        .map(h => {
          const [lat, lng] = h.s.split(',').map(Number);
          return {
            lat,
            lng,
            timestamp: h.lu || h.lc,
            accuracy: h.a?.gps_accuracy || 999,
            battery: h.a?.battery_level
          };
        })
        .filter(p => !isNaN(p.lat) && !isNaN(p.lng));
      
      if (points.length > 0) {
        this._routes[name] = {
          points,
          stats: this._historyAPI.calculateStats ? 
            this._historyAPI.calculateStats(points) : 
            { totalPoints: points.length }
        };
        
        if (this._config.show_routes) {
          this._drawRoute(name, points);
        }
      }
    }
  }
  
  return true;
};

// Override _loadHistory to prefer coord sensors
const OriginalLoadHistory = Location720Card.prototype._loadHistory;
Location720Card.prototype._loadHistory = async function() {
  // Try coord sensors first
  const usedCoordSensors = await this._loadHistoryFromCoordSensors();
  
  if (!usedCoordSensors) {
    // Fallback to original method
    await OriginalLoadHistory.call(this);
  }
  
  this._updateAnalytics();
  if (this._updateZoneTimeList) this._updateZoneTimeList();
  if (this._updateTripsList) this._updateTripsList();
};

console.info('%c LOCATION720 %c v1.0.0 %c Integration Ready ', 
  'background:#FF6B6B;color:white;font-weight:bold',
  'background:#333;color:white',
  'background:#4CAF50;color:white');
