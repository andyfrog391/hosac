/* ==========================================================
   HOSAC ALERT MANAGER (PRODUCTION MULTI-SOURCE FRAMEWORK)
   ========================================================== */

const ALERT_CONFIG = Object.freeze({
	pollIntervalMs: 60000,
	bannerRotateIntervalMs: 5000,
	floodRadiusKm: 25,
	weatherRadiusKm: 50,
	aircraftAlertRadiusKm: 100,
	metOfficeProxyUrl: "https://hosac-metoffice-warnings.andrew-froggatt01.workers.dev/"
});

const ALERT_PRIORITIES = Object.freeze({
	AIRCRAFT_EMERGENCY: 100,
	UAV_ALERT: 95,
	FLOOD_SEVERE: 90,
	WEATHER_RED: 80,
	WEATHER_AMBER: 70,
	FLOOD_WARNING: 60,
	WEATHER_YELLOW: 50,
	INFO: 10
});

let activeAlerts = [];
let bannerRotationIndex = 0;
let bannerRotationTimer = null;
const alertProviders = new Map();

/* ==========================================================
   GEOSPATIAL, DISTANCE & FORMATTING HELPERS
   ========================================================== */

function getHosacPosition() {
	if (
		typeof currentLat === "number" &&
		typeof currentLon === "number" &&
		!Number.isNaN(currentLat) &&
		!Number.isNaN(currentLon)
	) {
		return { lat: currentLat, lon: currentLon };
	}
	return null;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
	if ([lat1, lon1, lat2, lon2].some(v => typeof v !== "number" || Number.isNaN(v))) {
		return null;
	}
	const toRad = deg => (deg * Math.PI) / 180;
	const earthRadiusKm = 6371;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistanceText(distanceKm) {
	if (typeof distanceKm !== "number" || Number.isNaN(distanceKm)) {
		return null;
	}
	return distanceKm < 10 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`;
}

function formatTimeHHMM(value) {
	if (!value) return "N/A";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cleanText(candidates, fallback = "Unknown") {
	for (const val of candidates) {
		if (typeof val === "string" && val.trim() && val.trim().toLowerCase() !== "unknown") {
			return val.trim();
		}
	}
	return fallback;
}

function pointInRing(lon, lat, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0], yi = ring[i][1];
		const xj = ring[j][0], yj = ring[j][1];
		const crosses = ((yi > lat) !== (yj > lat)) &&
			(lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
		if (crosses) inside = !inside;
	}
	return inside;
}

function pointInGeoJson(lat, lon, geometry) {
	if (!geometry) return false;
	if (geometry.type === "Polygon") {
		const rings = geometry.coordinates || [];
		if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
		return !rings.slice(1).some(hole => pointInRing(lon, lat, hole));
	}
	if (geometry.type === "MultiPolygon") {
		return (geometry.coordinates || []).some(poly =>
			pointInGeoJson(lat, lon, { type: "Polygon", coordinates: poly })
		);
	}
	return false;
}

function minDistanceToGeometryKm(lat, lon, geometry) {
	if (pointInGeoJson(lat, lon, geometry)) return 0;

	let minKm = Number.POSITIVE_INFINITY;
	const walkCoords = node => {
		if (!Array.isArray(node)) return;
		if (typeof node[0] === "number" && typeof node[1] === "number") {
			const d = calculateDistanceKm(lat, lon, node[1], node[0]);
			if (typeof d === "number" && d < minKm) minKm = d;
		} else {
			node.forEach(walkCoords);
		}
	};
	walkCoords(geometry?.coordinates);
	return Number.isFinite(minKm) ? minKm : null;
}

/* ==========================================================
   ALERT STORE, SORTING & BANNER ROTATION
   ========================================================== */

function compareAlerts(a, b) {
	if (b.priority !== a.priority) return b.priority - a.priority;

	const distA = typeof a.distanceKm === "number" ? a.distanceKm : Number.POSITIVE_INFINITY;
	const distB = typeof b.distanceKm === "number" ? b.distanceKm : Number.POSITIVE_INFINITY;
	if (distA !== distB) return distA - distB;

	return (b.updatedTimestamp || 0) - (a.updatedTimestamp || 0);
}

function setSourceAlerts(source, alerts) {
	const remaining = activeAlerts.filter(alert => alert.source !== source);
	activeAlerts = [...remaining, ...alerts].sort(compareAlerts);
	bannerRotationIndex = 0;
	syncBannerRotation();
	updateAlertBanner();
}

function clearSourceAlerts(source) {
	setSourceAlerts(source, []);
}

function stopBannerRotation() {
	if (bannerRotationTimer) {
		clearInterval(bannerRotationTimer);
		bannerRotationTimer = null;
	}
	bannerRotationIndex = 0;
}

function syncBannerRotation() {
	if (activeAlerts.length > 1 && !bannerRotationTimer) {
		bannerRotationTimer = setInterval(() => {
			if (activeAlerts.length <= 1) {
				stopBannerRotation();
				return;
			}
			bannerRotationIndex = (bannerRotationIndex + 1) % activeAlerts.length;
			updateAlertBanner();
		}, ALERT_CONFIG.bannerRotateIntervalMs);
	} else if (activeAlerts.length <= 1) {
		stopBannerRotation();
	}
}

function updateAlertBanner() {
	const banner = document.getElementById("alert-banner");
	if (!banner) return;

	banner.className = "alert-banner";

	if (activeAlerts.length === 0) {
		banner.textContent = "✅ HOSAC STATUS NORMAL";
		return;
	}

	const idx = bannerRotationIndex % activeAlerts.length;
	const alert = activeAlerts[idx];
	const counter = activeAlerts.length > 1 ? ` [${idx + 1}/${activeAlerts.length}]` : "";

	banner.textContent = `${alert.bannerText}${counter}`;
	if (alert.className) {
		banner.classList.add(alert.className);
	}
}

/* ==========================================================
   LOCAL PANEL RENDERER
   ========================================================== */

function renderAlertCard(alert) {
	const blocks = [
		`<strong>${alert.icon} ${alert.title}</strong>`,
		`<strong>Area:</strong><br>${alert.area}`
	];

	if (alert.distance) {
		blocks.push(`<strong>Distance:</strong><br>${alert.distance}`);
	}
	if (alert.context) {
		blocks.push(`<strong>Context:</strong><br>${alert.context}`);
	}
	if (alert.lastUpdated) {
		blocks.push(`<strong>Last Updated:</strong><br>${alert.lastUpdated}`);
	}

	blocks.push(`<strong>Message:</strong><br>${alert.message}`);
	blocks.push(`<strong>Severity:</strong><br>${alert.severityLabel}`);

	return `<div class="alert-entry alert-source-${alert.source}">${blocks.join("<br><br>")}</div>`;
}

function updateLocalAlertsPanel(html) {
	const panel = document.getElementById("local-alert-content");
	if (!panel) return;
	panel.innerHTML = html;
}

function renderCombinedLocalPanel(pos) {
	if (!pos) {
		updateLocalAlertsPanel(`
			<div class="alert-entry">
				<strong>📍 GPS Position Unavailable</strong><br>
				Waiting for live GPS coordinates from HOSAC location module.
			</div>
		`);
		return;
	}

	const floodAlerts = activeAlerts.filter(a => a.source === "flood");
	const otherAlerts = activeAlerts.filter(a => a.source !== "flood");
	const sections = [];

	if (otherAlerts.length > 0) {
		sections.push(otherAlerts.map(renderAlertCard).join("<hr>"));
	}

	if (floodAlerts.length > 0) {
		sections.push(floodAlerts.map(renderAlertCard).join("<hr>"));
	} else {
		sections.push(`
			<div class="alert-entry">
				<strong>✅ No Flood Alerts Within ${ALERT_CONFIG.floodRadiusKm} km</strong>
			</div>
		`);
	}

	updateLocalAlertsPanel(sections.join("<hr>"));
}

/* ==========================================================
   PROVIDER REGISTRATION & REFRESH ORCHESTRATION
   ========================================================== */

function registerAlertProvider(provider) {
	alertProviders.set(provider.name, provider);
}

async function refreshAlerts() {
	const pos = getHosacPosition();

	for (const provider of alertProviders.values()) {
		try {
			await provider.check(pos);
		} catch (err) {
			console.error(`[Alerts] Provider "${provider.name}" failed:`, err);
		}
	}

	renderCombinedLocalPanel(pos);
}

/* ==========================================================
   1. ENVIRONMENT AGENCY FLOOD PROVIDER
   ========================================================== */

registerAlertProvider({
	name: "flood",
	async check(pos) {
		if (!pos) {
			clearSourceAlerts("flood");
			return;
		}

		const url = `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${encodeURIComponent(pos.lat)}&long=${encodeURIComponent(pos.lon)}&dist=${ALERT_CONFIG.floodRadiusKm}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Flood API HTTP ${response.status}`);

		const data = await response.json();
		const items = Array.isArray(data.items) ? data.items : [];

		const alerts = items
			.map(flood => {
				const isSevere = flood.severityLevel === 1;
				const title = cleanText([flood.severity], "Flood Warning");
				const area = cleanText([
					flood.description,
					flood.floodArea?.description,
					flood.floodArea?.label,
					flood.eaAreaName
				]);

				const fLat = flood.floodArea?.lat ?? flood.lat;
				const fLon = flood.floodArea?.long ?? flood.long;
				const distanceKm = calculateDistanceKm(pos.lat, pos.lon, fLat, fLon);
				const distance = formatDistanceText(distanceKm);

				const rawUpdated =
					flood.timeMessageChanged ||
					flood.timeSeverityChanged ||
					flood.messageChanged ||
					null;
				const parsedTime = rawUpdated ? new Date(rawUpdated).getTime() : 0;
				const updatedTimestamp = Number.isNaN(parsedTime) ? 0 : parsedTime;

				const priority = isSevere
					? ALERT_PRIORITIES.FLOOD_SEVERE
					: ALERT_PRIORITIES.FLOOD_WARNING;
				const className = isSevere ? "alert-emergency" : "alert-flood";
				const distSuffix = distance ? ` | ${distance}` : "";

				return {
					source: "flood",
					icon: "🌊",
					title,
					area,
					distance,
					distanceKm,
					context: cleanText([flood.eaAreaName], "Environment Agency"),
					message: cleanText([flood.message], "No further information"),
					severityLabel: String(flood.severityLevel ?? "N/A"),
					lastUpdated: formatTimeHHMM(rawUpdated),
					updatedTimestamp,
					priority,
					className,
					bannerText: `🌊 ${title} | ${area}${distSuffix}`
				};
			})
			.sort(compareAlerts);

		setSourceAlerts("flood", alerts);
	}
});

/* ==========================================================
   2. MET OFFICE NSWWS WEATHER WARNING PROVIDER
   ========================================================== */

registerAlertProvider({
	name: "metoffice",
	async check(pos) {
		if (!pos || !ALERT_CONFIG.metOfficeProxyUrl) {
			clearSourceAlerts("metoffice");
			return;
		}

		const response = await fetch(ALERT_CONFIG.metOfficeProxyUrl);
		if (!response.ok) throw new Error(`Met Office feed HTTP ${response.status}`);

		const geojson = await response.json();
		const features = Array.isArray(geojson.features) ? geojson.features : [];
		const nowMs = Date.now();

		const alerts = features
			.map(feature => {
				const props = feature.properties || {};
				const status = String(props.warningStatus || "ISSUED").toUpperCase();
				if (status === "EXPIRED" || status === "CANCELLED") return null;

				if (props.validToDate) {
					const expiresMs = new Date(props.validToDate).getTime();
					if (!Number.isNaN(expiresMs) && expiresMs < nowMs) return null;
				}

				const geom = feature.geometry;
				const distanceKm = minDistanceToGeometryKm(pos.lat, pos.lon, geom);
				const insidePolygon = pointInGeoJson(pos.lat, pos.lon, geom);
				const withinRadius = typeof distanceKm === "number" && distanceKm <= ALERT_CONFIG.weatherRadiusKm;

				if (!insidePolygon && !withinRadius) return null;

				const level = String(props.warningLevel || "YELLOW").toUpperCase();
				const hazard = Array.isArray(props.weatherType) && props.weatherType.length
					? props.weatherType
						.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
						.join(" & ")
					: "Weather";

				const levelMeta = {
					RED: {
						icon: "🔴",
						word: "Red",
						priority: ALERT_PRIORITIES.WEATHER_RED,
						className: "alert-emergency"
					},
					AMBER: {
						icon: "🟠",
						word: "Amber",
						priority: ALERT_PRIORITIES.WEATHER_AMBER,
						className: "alert-weather-amber"
					},
					YELLOW: {
						icon: "🟡",
						word: "Yellow",
						priority: ALERT_PRIORITIES.WEATHER_YELLOW,
						className: "alert-weather-yellow"
					}
				}[level] || {
					icon: "🟡",
					word: "Yellow",
					priority: ALERT_PRIORITIES.WEATHER_YELLOW,
					className: "alert-weather-yellow"
				};

				const title = `${levelMeta.word} ${hazard} Warning`;
				const regions = Array.isArray(props.affectedAreas)
					? props.affectedAreas
						.flatMap(areaObj => (Array.isArray(areaObj.subRegions) && areaObj.subRegions.length
							? areaObj.subRegions
							: [areaObj.regionName]))
						.filter(Boolean)
					: [];
				const area = cleanText([regions.join(", "), props.warningHeadline], "Local Warning Area");
				const distance = formatDistanceText(distanceKm);
				const validStr = props.validFromDate && props.validToDate
					? `Valid ${formatTimeHHMM(props.validFromDate)}–${formatTimeHHMM(props.validToDate)}`
					: null;
				const context = ["Met Office", validStr].filter(Boolean).join(" • ");

				const rawUpdated = props.modifiedDate || props.issuedDate || null;
				const parsedTime = rawUpdated ? new Date(rawUpdated).getTime() : 0;
				const distSuffix = distance ? ` | ${distance}` : "";

				return {
					source: "metoffice",
					icon: levelMeta.icon,
					title,
					area,
					distance,
					distanceKm,
					context,
					message: cleanText([props.warningHeadline, props.description], "Severe weather warning in force."),
					severityLabel: levelMeta.word,
					lastUpdated: formatTimeHHMM(rawUpdated),
					updatedTimestamp: Number.isNaN(parsedTime) ? 0 : parsedTime,
					priority: levelMeta.priority,
					className: levelMeta.className,
					bannerText: `${levelMeta.icon} ${title} | ${area}${distSuffix}`
				};
			})
			.filter(Boolean)
			.sort(compareAlerts);

		setSourceAlerts("metoffice", alerts);
	}
});

/* ==========================================================
   3. AIRCRAFT EMERGENCIES & UAV PROVIDER (EXISTING FEED)
   ========================================================== */

function getExistingAircraftList() {
	const candidates = [
		window.aircraftData,
		window.trackedAircraft,
		window.aircraftList,
		typeof window.getTrackedAircraft === "function" ? window.getTrackedAircraft() : null
	];

	for (const list of candidates) {
		if (Array.isArray(list)) return list;
	}
	return [];
}

function classifyAircraftAlert(ac) {
	const squawk = String(ac.squawk || ac.transponder || ac.code || "").trim();
	const emergencyFlag = Boolean(
		ac.emergency ||
		ac.isEmergency ||
		ac.emergencyFlag ||
		(ac.flags && ac.flags.emergency)
	);
	const militaryEmergency = Boolean(
		(ac.military || ac.isMilitary || ac.mil) &&
		(emergencyFlag || ["7500", "7600", "7700"].includes(squawk))
	);

	if (["7500", "7600", "7700"].includes(squawk) || emergencyFlag || militaryEmergency) {
		const reason = squawk
			? `Squawk ${squawk}`
			: militaryEmergency
				? "Military Emergency"
				: "Emergency Flag";
		return {
			kind: "emergency",
			icon: "🚨",
			title: militaryEmergency ? `Military Aircraft Emergency (${reason})` : `Aircraft Emergency (${reason})`,
			priority: ALERT_PRIORITIES.AIRCRAFT_EMERGENCY,
			className: "alert-emergency",
			severityLabel: militaryEmergency ? "Military Emergency" : reason
		};
	}

	const category = String(ac.category || ac.emitterCategory || "").toUpperCase();
	const isUav =
		category === "B6" ||
		(typeof window.isUavAircraft === "function" && window.isUavAircraft(ac)) ||
		Boolean(ac.isUav || ac.uav);

	if (isUav) {
		return {
			kind: "uav",
			icon: "🛸",
			title: "UAV Activity Alert",
			priority: ALERT_PRIORITIES.UAV_ALERT,
			className: "alert-uav",
			severityLabel: "UAV (B6)"
		};
	}

	return null;
}

registerAlertProvider({
	name: "aircraft",
	async check(pos) {
		if (!pos) {
			clearSourceAlerts("aircraft");
			return;
		}

		const list = getExistingAircraftList();
		const alerts = list
			.map(ac => {
				if (!ac) return null;
				const classification = classifyAircraftAlert(ac);
				if (!classification) return null;

				const acLat = ac.lat ?? ac.latitude ?? ac.position?.lat;
				const acLon = ac.lon ?? ac.lng ?? ac.longitude ?? ac.position?.lon;
				const distanceKm = calculateDistanceKm(pos.lat, pos.lon, acLat, acLon);

				if (typeof distanceKm === "number" && distanceKm > ALERT_CONFIG.aircraftAlertRadiusKm) {
					return null;
				}

				const callsign = cleanText([ac.flight, ac.callsign, ac.registration, ac.hex, ac.icao24], "Unknown Aircraft");
				const altText = typeof ac.alt_baro === "number"
					? `${Math.round(ac.alt_baro)} ft`
					: typeof ac.altitude === "number"
						? `${Math.round(ac.altitude)} ft`
						: null;
				const squawkText = ac.squawk ? `Squawk ${ac.squawk}` : null;
				const distance = formatDistanceText(distanceKm);
				const context = [callsign, altText, squawkText].filter(Boolean).join(" • ");
				const rawUpdated = ac.lastSeen || ac.seen_pos || ac.timestamp || Date.now();
				const parsedTime = typeof rawUpdated === "number" ? rawUpdated : new Date(rawUpdated).getTime();
				const distSuffix = distance ? ` | ${distance}` : "";

				return {
					source: "aircraft",
					icon: classification.icon,
					title: classification.title,
					area: callsign,
					distance,
					distanceKm,
					context,
					message: cleanText(
						[ac.alertMessage, ac.notes, `${classification.title} involving ${callsign}`],
						`${classification.title} involving ${callsign}`
					),
					severityLabel: classification.severityLabel,
					lastUpdated: formatTimeHHMM(rawUpdated),
					updatedTimestamp: Number.isNaN(parsedTime) ? Date.now() : parsedTime,
					priority: classification.priority,
					className: classification.className,
					bannerText: `${classification.icon} ${classification.title} | ${callsign}${distSuffix}`
				};
			})
			.filter(Boolean)
			.sort(compareAlerts);

		setSourceAlerts("aircraft", alerts);
	}
});

/* ==========================================================
   INITIALIZATION
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
	refreshAlerts();
	setInterval(refreshAlerts, ALERT_CONFIG.pollIntervalMs);
});