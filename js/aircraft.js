let aircraftMap;

let aircraftMarkers = new Map();

let activeIncidents = new Map();

let incidentLog = [];

let aircraftHistory = new Map();

let incidentTrackLine = null;

let incidentStartMarker = null;

let incidentEndMarker = null;

let refreshTimer = null;

let selectedIncidentId = null;

const WORKER_URL =
    "https://aircraft.andrew-froggatt01.workers.dev";

let currentAircraftRadius = 50;

let aircraftRadiusCircle = null;

let tileLayer = null;

let homeMarker = null;

let closestViewerActive = false;

/* ------------------------------------------------------------------
   Callsign normalisation & ADSBDB aircraft enrichment
   ------------------------------------------------------------------ */

const ADSBDB_AIRCRAFT_API = "https://api.adsbdb.com/v0/aircraft";
const adsbdbAircraftCache = new Map();

function normalizeRouteLookupCallsign(rawCallsign) {
    const cleaned = String(rawCallsign || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!cleaned) return null;

    // Match 2-3 letter airline prefix + flight number (strip leading zeros on numeric part)
    const match = cleaned.match(/^([A-Z]{2,3})0*([1-9][0-9]{0,3}[A-Z]{0,2})$/);
    if (!match) return null;

    return {
        raw: cleaned,
        prefix: match[1],
        numberPart: match[2],
        normalized: `${match[1]}${match[2]}`
    };
}

function getRouteCacheKeys(ac) {
    const keys = [];
    const raw = String((ac && ac.flight) || "").trim().toUpperCase().replace(/\s+/g, "");
    if (raw) keys.push(raw);

    const parsed = normalizeRouteLookupCallsign(raw);
    if (parsed && !keys.includes(parsed.normalized)) {
        keys.push(parsed.normalized);
    }
    return keys;
}

async function fetchAdsbdbAircraft(ac) {
    const hex = (ac && ac.hex) ? String(ac.hex).trim().toLowerCase() : "";
    const callsign = (ac && ac.flight) ? String(ac.flight).trim().toUpperCase() : "";
    if (!hex) return null;

    if (adsbdbAircraftCache.has(hex)) {
        return adsbdbAircraftCache.get(hex);
    }

    const query = callsign ? `?callsign=${encodeURIComponent(callsign)}` : "";
    const url = `${ADSBDB_AIRCRAFT_API}/${encodeURIComponent(hex)}${query}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 404) adsbdbAircraftCache.set(hex, null);
            return null;
        }
        const data = await res.json();
        const info = data && data.response && data.response.aircraft ? data.response.aircraft : null;
        if (info) {
            adsbdbAircraftCache.set(hex, info);
            if (!ac.r && info.registration) ac.r = info.registration;
            if (!ac.t && info.icao_type) ac.t = info.icao_type;
            if (!ac.desc && info.type) ac.desc = info.type;
            if (!ac.ownOp && info.registered_owner) ac.ownOp = info.registered_owner;
        } else {
            adsbdbAircraftCache.set(hex, null);
        }
        return info;
    } catch (err) {
        console.log("[ADSBdb] Aircraft lookup error:", err);
        return null;
    }
}

/* ------------------------------------------------------------------
   Aircraft photo lookup & cache (Planespotters + ADSBDB fallback)
   ------------------------------------------------------------------ */

const PLANESPOTTERS_API = "https://api.planespotters.net/pub/photos";
const aircraftPhotoCache = new Map();
const aircraftMetaCache = new Map();

function getPlanespottersSearchUrl(ac) {
    const reg = (ac && ac.r) ? String(ac.r).trim().toUpperCase() : "";
    const hex = (ac && ac.hex) ? String(ac.hex).trim().toLowerCase() : "";
    if (reg) {
        return `https://www.planespotters.net/search?q=${encodeURIComponent(reg)}`;
    }
    if (hex) {
        return `https://www.planespotters.net/search?q=${encodeURIComponent(hex)}`;
    }
    return "https://www.planespotters.net/";
}

async function fetchAircraftPhoto(ac) {
    const hex = (ac && ac.hex) ? String(ac.hex).trim().toLowerCase() : "";
    const reg = (ac && ac.r) ? String(ac.r).trim().toUpperCase() : "";
    const cacheKey = `${hex}|${reg}`;

    if (aircraftPhotoCache.has(cacheKey)) {
        return aircraftPhotoCache.get(cacheKey);
    }

    const endpoints = [];
    if (hex) {
        endpoints.push(`${PLANESPOTTERS_API}/hex/${encodeURIComponent(hex)}`);
    }
    if (reg) {
        endpoints.push(`${PLANESPOTTERS_API}/reg/${encodeURIComponent(reg)}`);
    }

    for (const url of endpoints) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;

            const data = await response.json();
            const photos = Array.isArray(data.photos) ? data.photos : [];
            if (photos.length > 0) {
                const p = photos[0];
                const imageUrl =
                    (p.thumbnail_large && p.thumbnail_large.src) ||
                    (p.thumbnail && p.thumbnail.src) ||
                    null;

                if (imageUrl) {
                    const result = {
                        found: true,
                        imageUrl,
                        pageUrl: p.link || getPlanespottersSearchUrl(ac),
                        photographer: p.photographer || null,
                        source: "Planespotters.net"
                    };
                    aircraftPhotoCache.set(cacheKey, result);
                    return result;
                }
            }
        } catch (err) {
            console.log("[Planespotters] Photo lookup error:", err);
        }
    }

    // Fallback to ADSBDB aircraft photo fields if available
    const metaInfo = await fetchAdsbdbAircraft(ac);
    const fallbackImg = metaInfo && (metaInfo.url_photo || metaInfo.url_photo_thumbnail);
    if (fallbackImg) {
        const result = {
            found: true,
            imageUrl: fallbackImg,
            pageUrl: getPlanespottersSearchUrl(ac),
            photographer: null,
            source: "ADSBdb"
        };
        aircraftPhotoCache.set(cacheKey, result);
        return result;
    }

    const notFound = {
        found: false,
        imageUrl: null,
        pageUrl: getPlanespottersSearchUrl(ac),
        photographer: null,
        source: null
    };
    aircraftPhotoCache.set(cacheKey, notFound);
    return notFound;
}

function getCachedRouteForAircraft(ac) {
    const keys = getRouteCacheKeys(ac);
    for (const k of keys) {
        if (acxRouteCache.has(k) && acxRouteCache.get(k)) {
            return acxRouteCache.get(k);
        }
    }
    return null;
}

function buildPopupHtml(ac, actualDistance, isActiveIncident, photoState = "idle", photoData = null) {
    let photoSection = "";

    if (photoState === "loading") {
        photoSection = `
            <div style="margin-top:8px;padding:6px;background:rgba(255,255,255,0.05);border-radius:6px;font-size:12px;">
                📷 Loading aircraft photo...
            </div>
        `;
    } else if (photoState === "loaded" && photoData && photoData.found && photoData.imageUrl) {
        const creditText = photoData.photographer
            ? `📷 ${photoData.photographer}`
            : (photoData.source || "Planespotters.net");
        photoSection = `
            <div style="margin-top:8px;">
                <a href="${photoData.pageUrl}" target="_blank" rel="noopener noreferrer">
                    <img
                        src="${photoData.imageUrl}"
                        alt="${ac.flight || ac.r || ac.hex || "Aircraft"}"
                        style="width:100%;max-width:240px;max-height:145px;object-fit:cover;border-radius:6px;display:block;margin-bottom:4px;"
                    >
                </a>
                <div style="font-size:11px;display:flex;justify-content:space-between;gap:8px;align-items:center;">
                    <span>${creditText}</span>
                    <a href="${photoData.pageUrl}" target="_blank" rel="noopener noreferrer" style="color:#4da6ff;font-weight:bold;">
                        View on Planespotters ↗
                    </a>
                </div>
            </div>
        `;
    } else {
        const searchUrl = (photoData && photoData.pageUrl) || getPlanespottersSearchUrl(ac);
        photoSection = `
            <div style="margin-top:8px;font-size:12px;">
                <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" style="color:#4da6ff;font-weight:bold;">
                    🔍 Search Planespotters Photo ↗
                </a>
            </div>
        `;
    }

    const cachedRoute = getCachedRouteForAircraft(ac);
    const fromCode = cachedRoute && cachedRoute.from && cachedRoute.from.code ? cachedRoute.from.code : null;
    const toCode = cachedRoute && cachedRoute.to && cachedRoute.to.code ? cachedRoute.to.code : null;
    const routeLine = (fromCode || toCode)
        ? `Route: <b>${fromCode || "—"} → ${toCode || "—"}</b><br>`
        : "";

    return `
        <div style="min-width:210px;max-width:250px;">
            <b>${ac.flight || ac.hex}</b><br>

            ${routeLine}Registration:
            ${ac.r || "Unknown"}<br>

            Aircraft:
            ${ac.t || "Unknown"}<br>

            Altitude:
            ${ac.alt_baro || "?"} ft<br>

            Speed:
            ${Math.round(ac.gs || 0)} kt<br>

            Heading:
            ${Math.round(ac.track || 0)}°<br>

            Squawk:
            ${ac.squawk || "—"}<br>

            Distance:
            ${actualDistance.toFixed(1)} mi<br>

            Category:
            ${isMilitary(ac) ? "Military" : "Civilian"}

            ${isActiveIncident
                ? "<br><b>🚨 ACTIVE INCIDENT</b>"
                : ""
            }

            ${photoSection}
        </div>
    `;
}

/* ------------------------------------------------------------------
   Full-screen aircraft card (split-flap style + right-hand OVERHEAD board)
   Opens when an aircraft marker, Closest chip, or Auto-Closest is triggered.
   Self-contained: injects its own CSS and DOM. Live-updates while open.
   ------------------------------------------------------------------ */

const ACX_AIRLINES = {
    BAW: "British Airways", BA: "British Airways", SHT: "British Airways Shuttle",
    EZY: "easyJet", U2: "easyJet", EJU: "easyJet Europe", EC: "easyJet Europe",
    RYR: "Ryanair", FR: "Ryanair", RUK: "Ryanair UK", RK: "Ryanair UK",
    VIR: "Virgin Atlantic", VS: "Virgin Atlantic", TOM: "TUI Airways", BY: "TUI Airways", TUI: "TUI",
    EXS: "Jet2", LS: "Jet2", JBU: "JetBlue", B6: "JetBlue",
    UAL: "United Airlines", UA: "United Airlines", AAL: "American Airlines", AA: "American Airlines",
    DAL: "Delta Air Lines", DL: "Delta Air Lines", ACA: "Air Canada", AC: "Air Canada",
    WJA: "WestJet", WS: "WestJet", KLM: "KLM", KL: "KLM",
    AFR: "Air France", AF: "Air France", DLH: "Lufthansa", LH: "Lufthansa",
    SWR: "Swiss", LX: "Swiss", AUA: "Austrian", OS: "Austrian",
    BEL: "Brussels Airlines", SN: "Brussels Airlines", EIN: "Aer Lingus", EI: "Aer Lingus",
    EWG: "Eurowings", EW: "Eurowings", UAE: "Emirates", EK: "Emirates",
    QTR: "Qatar Airways", QR: "Qatar Airways", ETD: "Etihad", EY: "Etihad",
    THY: "Turkish Airlines", TK: "Turkish Airlines", SAS: "SAS", SK: "SAS",
    FIN: "Finnair", AY: "Finnair", IBE: "Iberia", IB: "Iberia",
    VLG: "Vueling", VY: "Vueling", TAP: "TAP Air Portugal", TP: "TAP Air Portugal",
    WZZ: "Wizz Air", W6: "Wizz Air", NOZ: "Norwegian", DY: "Norwegian", NAX: "Norwegian",
    ELY: "El Al", LY: "El Al", SIA: "Singapore Airlines", SQ: "Singapore Airlines",
    CPA: "Cathay Pacific", CX: "Cathay Pacific", ANA: "All Nippon Airways", NH: "All Nippon Airways",
    JAL: "Japan Airlines", JL: "Japan Airlines", QFA: "Qantas", QF: "Qantas",
    ETH: "Ethiopian Airlines", ET: "Ethiopian Airlines", SAA: "South African Airways", SA: "South African Airways",
    MSR: "EgyptAir", MS: "EgyptAir", RAM: "Royal Air Maroc", AT: "Royal Air Maroc",
    VOE: "Volotea", V7: "Volotea", LOG: "Loganair", LM: "Loganair",
    BCS: "European Air Charter", FDX: "FedEx", FX: "FedEx", UPS: "UPS Airlines", "5X": "UPS Airlines",
    DHK: "DHL Air UK", GEC: "Lufthansa Cargo", CLX: "Cargolux", CV: "Cargolux",
    ICE: "Icelandair", FI: "Icelandair", AIC: "Air India", AI: "Air India",
    PIA: "Pakistan International", PK: "Pakistan International", KAL: "Korean Air", KE: "Korean Air",
    AAR: "Asiana", OZ: "Asiana", CCA: "Air China", CA: "Air China",
    CSN: "China Southern", CZ: "China Southern", CES: "China Eastern", MU: "China Eastern",
    RJA: "Royal Jordanian", RJ: "Royal Jordanian", LOT: "LOT Polish", LO: "LOT Polish",
    CFE: "BA CityFlyer", EAF: "Eastern Airways", T3: "Eastern Airways",
    AEE: "Aegean", A3: "Aegean", LDM: "Laudamotion"
};

const acxRouteCache = new Map();
let acxOpenId = null;
let acxState = { photo: null, route: undefined, photoDone: false, routeDone: false };
let acxClockTimer = null;
let acxBoardPrefetchQueued = new Set();
const acxPrevDistMap = new Map();

function acxEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function acxTitleCase(s) {
    return String(s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
        .replace(/\b(Inc|Llc|Ltd|Plc|Co|Corp)\b\.?/g, "").replace(/\s+/g, " ").trim();
}

function acxAirlineName(ac) {
    const cs = (ac.flight || "").trim().toUpperCase().replace(/\s+/g, "");
    const parsed = normalizeRouteLookupCallsign(cs);
    if (parsed && ACX_AIRLINES[parsed.prefix]) return ACX_AIRLINES[parsed.prefix];
    const prefix3 = cs.slice(0, 3);
    if (/^[A-Z]{3}\d/.test(cs) && ACX_AIRLINES[prefix3]) return ACX_AIRLINES[prefix3];
    if (ac.ownOp) return acxTitleCase(ac.ownOp);
    return "";
}

function acxPlanespottersGalleryUrl(ac) {
    const reg = ac.r ? String(ac.r).trim().toUpperCase() : "";
    const hex = ac.hex ? String(ac.hex).trim().toLowerCase() : "";
    if (reg) return `https://www.planespotters.net/photos/reg/${encodeURIComponent(reg)}`;
    if (hex) return `https://www.planespotters.net/hex/${encodeURIComponent(hex.toUpperCase())}`;
    return "https://www.planespotters.net/";
}

async function acxFetchRoute(ac) {
    const parsed = normalizeRouteLookupCallsign(ac && ac.flight);
    if (!parsed) return null;

    const keys = getRouteCacheKeys(ac);
    for (const k of keys) {
        if (acxRouteCache.has(k)) {
            return acxRouteCache.get(k);
        }
    }

    const candidates = [parsed.raw];
    if (parsed.normalized !== parsed.raw) {
        candidates.push(parsed.normalized);
    }

    let result = null;
    let networkOk = false;

    for (const cs of candidates) {
        try {
            const r = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
            if (r.ok) {
                networkOk = true;
                const d = await r.json();
                const fr = d && d.response && d.response.flightroute;
                if (fr && fr.origin && fr.destination) {
                    result = {
                        from: {
                            code: fr.origin.iata_code || fr.origin.icao_code,
                            name: fr.origin.municipality || fr.origin.name
                        },
                        to: {
                            code: fr.destination.iata_code || fr.destination.icao_code,
                            name: fr.destination.municipality || fr.destination.name
                        },
                        airline: fr.airline && fr.airline.name ? fr.airline.name : ""
                    };
                    break;
                }
            } else if (r.status === 404) {
                networkOk = true;
            }
        } catch (err) {
            console.log("[Card] adsbdb route error:", err);
        }
    }

    if (!result) {
        for (const cs of candidates) {
            try {
                const r = await fetch(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(cs)}`);
                if (r.ok) {
                    networkOk = true;
                    const d = await r.json();
                    const parts = d && d.route ? String(d.route).split("-") : [];
                    if (parts.length >= 2) {
                        const look = async icao => {
                            try {
                                const ar = await fetch(`https://hexdb.io/api/v1/airport/icao/${encodeURIComponent(icao)}`);
                                if (!ar.ok) return { code: icao, name: "" };
                                const ad = await ar.json();
                                return {
                                    code: ad.iata || icao,
                                    name: (ad.airport || "").replace(/ (International|Intl\.?|Airport)\b/gi, "").trim()
                                };
                            } catch (e) { return { code: icao, name: "" }; }
                        };
                        const [from, to] = await Promise.all([look(parts[0]), look(parts[parts.length - 1])]);
                        result = { from, to };
                        break;
                    }
                }
            } catch (err) {
                console.log("[Card] hexdb route error:", err);
            }
        }
    }

    if (result || networkOk) {
        keys.forEach(k => acxRouteCache.set(k, result));
    }
    return result;
}

const ACX_HELI_CAPTIONS = {
    EC35: "Air ambulance / police helicopter", EC45: "Air ambulance / police helicopter",
    EC30: "Air ambulance / police helicopter", H135: "Air ambulance / police helicopter",
    H145: "Air ambulance / police helicopter", MBH5: "Air ambulance / police helicopter",
    BK17: "Air ambulance / police helicopter", A109: "Air ambulance / executive helicopter",
    A119: "Air ambulance / executive helicopter", B105: "Air ambulance / police helicopter",
    S92: "Search & rescue / offshore helicopter", S61: "Search & rescue helicopter",
    S61R: "Search & rescue helicopter", AS32: "Search & rescue / offshore helicopter",
    AS3B: "Search & rescue / offshore helicopter", A139: "Search & rescue / offshore helicopter",
    EC75: "Offshore / rescue helicopter",
    R22: "Light training helicopter", R44: "Light private helicopter", R66: "Light private helicopter",
    EN28: "Light private helicopter", EN48: "Light private helicopter",
    B06: "Light utility helicopter", B407: "Light utility helicopter", EC20: "Light utility helicopter",
    AS50: "Light utility helicopter", AS55: "Light utility helicopter"
};

function acxCaption(ac, callsign) {
    const type = (ac.t || "").toUpperCase().trim();
    const military = typeof isMilitary === "function" && isMilitary(ac);
    const heli = typeof isHelicopter === "function" && isHelicopter(ac);
    const uav = typeof isUAV === "function" && isUAV(ac);
    const airlineStyle = Boolean(normalizeRouteLookupCallsign(callsign));

    const service = typeof getEmergencyService === "function" ? getEmergencyService(ac) : null;

    if (service) {
        const kind = /flight$/i.test(service) ? "" : (heli ? " helicopter" : " aircraft");
        return `🚨 ${service}${kind}${military ? " · Military" : ""}`;
    }

    if (uav) return "Unmanned aircraft";
    if (military && heli) return "Military helicopter";
    if (military) return "Military aircraft";
    if (heli) return ACX_HELI_CAPTIONS[type] || "Helicopter";
    if (airlineStyle) return acxState.routeDone ? "No scheduled route found" : "Looking up route…";
    return "Private / general aviation";
}

/* ------------------------------------------------------------------
   Track mode: lock the map on one aircraft and follow it, even beyond
   the normal radius, until the user presses Untrack.
   ------------------------------------------------------------------ */

let acxTrackedId = null;
let acxTrackedName = "";
let acxTrackedSeen = 0;
let acxTrail = [];
let acxTrailLine = null;
let acxTrackBar = null;
let acxTrackTimer = null;

function acxFollow(id, lat, lon) {
    if (id !== acxTrackedId || !aircraftMap) return;
    aircraftMap.panTo([lat, lon], { animate: false });
}

function acxDrawTrail() {
    if (!aircraftMap) return;
    const pts = acxTrail.map(p => [p.lat, p.lon]);
    if (!acxTrailLine) {
        acxTrailLine = L.polyline(pts, { color: "#00e5ff", weight: 3, opacity: 0.85, dashArray: "6 6" }).addTo(aircraftMap);
    } else {
        acxTrailLine.setLatLngs(pts);
    }
}

function acxUpdateTrackBar() {
    if (!acxTrackBar) return;
    const meta = aircraftMetaCache.get(acxTrackedId);
    const ac = meta ? meta.ac : null;
    const lost = Date.now() - acxTrackedSeen > 45000;
    let info = "";
    if (ac) {
        const alt = ac.alt_baro === "ground" ? "On ground" :
            (Number.isFinite(Number(ac.alt_baro)) ? Math.round(Number(ac.alt_baro)).toLocaleString("en-GB") + " ft" : "");
        const spd = Math.round((Number(ac.gs) || 0) * MILES_PER_NM) + " mph";
        const dist = meta && Number.isFinite(meta.actualDistance) ? Math.round(meta.actualDistance).toLocaleString("en-GB") + " mi from home" : "";
        info = [alt, spd, dist].filter(Boolean).join(" · ");
    }
    acxTrackBar.querySelector(".acx-tb-text").innerHTML =
        `🎯 Tracking <b>${acxEsc(acxTrackedName)}</b>` +
        (info ? ` · ${acxEsc(info)}` : "") +
        (lost ? ` · <span class="acx-tb-lost">No signal — last known position</span>` : "");
}

function acxOnTrackedUpdate(ac) {
    acxTrackedSeen = Date.now();
    const last = acxTrail[acxTrail.length - 1];
    if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
        acxTrail.push({ lat: ac.lat, lon: ac.lon });
        if (acxTrail.length > 600) acxTrail.shift();
        acxDrawTrail();
    }
    const marker = aircraftMarkers.get(acxTrackedId);
    if (marker) marker.setOpacity(1);
    acxUpdateTrackBar();
}

function startAircraftTracking(id) {
    const meta = aircraftMetaCache.get(id);
    const marker = aircraftMarkers.get(id);
    if (!meta || !marker || !aircraftMap) return;

    if (acxTrackedId !== null && acxTrackedId !== id) stopAircraftTracking(false);

    const ac = meta.ac;
    acxTrackedId = id;
    acxTrackedName = (ac.flight || "").trim() || ac.r || String(ac.hex || "").toUpperCase();
    acxTrackedSeen = Date.now();
    acxTrail = (aircraftHistory.get(id) || []).map(p => ({ lat: p.lat, lon: p.lon }));
    acxTrail.push({ lat: ac.lat, lon: ac.lon });

    const host = aircraftMap.getContainer();
    if (!acxTrackBar) {
        acxTrackBar = document.createElement("div");
        acxTrackBar.id = "acx-trackbar";
        acxTrackBar.innerHTML = `<span class="acx-tb-text"></span><button type="button">Untrack</button>`;
        acxTrackBar.querySelector("button").addEventListener("click", () => stopAircraftTracking(true));
        L.DomEvent.disableClickPropagation(acxTrackBar);
        host.appendChild(acxTrackBar);
    }

    acxDrawTrail();
    acxUpdateTrackBar();
    clearInterval(acxTrackTimer);
    acxTrackTimer = setInterval(acxUpdateTrackBar, 5000);

    aircraftMap.setView(marker.getLatLng(), Math.max(aircraftMap.getZoom(), 8), { animate: false });
}

function stopAircraftTracking(resetView = true) {
    if (acxTrackedId === null) return;
    acxTrackedId = null;
    clearInterval(acxTrackTimer);
    acxTrackTimer = null;
    if (acxTrackBar) { acxTrackBar.remove(); acxTrackBar = null; }
    if (acxTrailLine && aircraftMap) { aircraftMap.removeLayer(acxTrailLine); acxTrailLine = null; }
    acxTrail = [];
    if (resetView && aircraftMap && Number.isFinite(currentLat) && Number.isFinite(currentLon)) {
        aircraftMap.setView([currentLat, currentLon], 9, { animate: false });
    }
    if (typeof loadAircraft === "function") loadAircraft();
}

function acxBearing(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
        Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
}

function acxCompassLetter(deg) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function acxInjectStyles() {
    if (document.getElementById("acx-styles")) return;
    const s = document.createElement("style");
    s.id = "acx-styles";
    s.textContent = `
    #acx-overlay{position:fixed;inset:0;z-index:100000;background:#f6f6f3;color:#111;display:none;
        flex-direction:row;gap:1.8vw;padding:2.2vh 2.6vw;box-sizing:border-box;overflow:hidden;
        font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
    #acx-overlay.open{display:flex}
    #acx-overlay .acx-main{flex:2 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
    #acx-overlay .acx-board{flex:1 1 0;min-width:0;min-height:0;background:#141310;color:#e7e2d3;
        border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;overflow:hidden;
        box-shadow:0 10px 28px rgba(0,0,0,.22)}
    #acx-overlay .acx-board-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
        border-bottom:2px solid #d4a72c;padding-bottom:10px;margin-bottom:12px}
    #acx-overlay .acx-board-title{font-size:clamp(18px,2.2vw,28px);font-weight:800;letter-spacing:.12em;color:#e2b33b}
    #acx-overlay .acx-board-meta{font-size:clamp(11px,1.15vw,14px);letter-spacing:.08em;color:#b8b19d;
        text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #acx-overlay .acx-board-cols{display:grid;grid-template-columns:1.35fr 0.9fr 0.72fr 0.72fr 0.95fr 0.68fr;gap:8px;
        font-size:11px;font-weight:700;letter-spacing:.1em;color:#9d9684;padding:0 10px 8px;text-transform:uppercase}
    #acx-overlay .acx-board-cols span:nth-child(5),
    #acx-overlay .acx-board-cols span:nth-child(6){text-align:right}
    #acx-overlay .acx-board-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
    #acx-overlay .acx-board-row{display:grid;grid-template-columns:1.35fr 0.9fr 0.72fr 0.72fr 0.95fr 0.68fr;
        align-items:center;gap:8px;width:100%;border:1px solid rgba(255,255,255,.05);background:#201e19;
        color:#e7e2d3;border-radius:6px;padding:9px 10px;text-align:left;cursor:pointer;font-family:inherit;
        font-size:clamp(12px,1.25vw,15px);transition:background .15s ease,border-color .15s ease}
    #acx-overlay .acx-board-row:hover{background:#2a2720;border-color:rgba(226,179,59,.45)}
    #acx-overlay .acx-board-row.active{background:#2d281b;border-color:#e2b33b}
    #acx-overlay .acx-b-flt{font-weight:800;color:#e2b33b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #acx-overlay .acx-b-typ,#acx-overlay .acx-b-apt{color:#d8d2c2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #acx-overlay .acx-b-alt,#acx-overlay .acx-b-mi{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#f1ede2}
    #acx-overlay .acx-b-trend{display:inline-block;margin-left:4px;font-size:11px;font-weight:700}
    #acx-overlay .acx-b-trend.closer{color:#4ade80}
    #acx-overlay .acx-b-trend.further{color:#f87171}
    #acx-overlay .acx-board-empty{color:#9d9684;font-size:13px;padding:18px 10px;text-align:center}
    #acx-overlay .acx-top{display:flex;justify-content:space-between;align-items:center;font-size:clamp(12px,1.6vw,18px);color:#555}
    #acx-overlay .acx-top .acx-right{display:flex;align-items:center;gap:16px}
    #acx-overlay .acx-close{border:0;background:#111;color:#fff;width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer}
    .acx-fl{display:inline-flex;gap:.07em;vertical-align:middle}
    .acx-fl i{font-style:normal;background:#1b1b1b;color:#f4f4f4;font-weight:700;padding:0 .13em;border-radius:.1em;
        position:relative;line-height:1.18;min-width:.42em;text-align:center;display:inline-block;transform-origin:50% 50%}
    .acx-fl i::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(0,0,0,.75)}
    .acx-fl i.flip{animation:acxflip .45s ease-out both}
    @keyframes acxflip{0%{transform:scaleY(.05)}60%{transform:scaleY(1.06)}100%{transform:scaleY(1)}}
    .acx-big{font-size:clamp(44px,9.5vh,108px)}
    .acx-med{font-size:clamp(26px,4.8vh,52px)}
    .acx-stat{font-size:clamp(24px,5vh,52px)}
    #acx-overlay .acx-row{display:flex;align-items:center;gap:2.2vw;margin-top:1.4vh}
    #acx-overlay .acx-arrow{font-size:clamp(28px,6vh,60px);line-height:1}
    #acx-overlay .acx-names{display:flex;gap:2.2vw;font-weight:700;font-size:clamp(14px,2.2vh,24px);margin-top:.6vh}
    #acx-overlay .acx-id{display:flex;align-items:center;gap:1.6vw;margin-top:1.4vh;font-size:clamp(13px,2vh,21px)}
    #acx-overlay .acx-badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:.8vh}
    #acx-overlay .acx-badge{padding:4px 12px;border-radius:999px;font-size:clamp(12px,1.8vh,17px);font-weight:700;background:#ddd}
    #acx-overlay .acx-badge.mil{background:#2f4f2f;color:#fff}
    #acx-overlay .acx-badge.emg{background:#c0182c;color:#fff}
    #acx-overlay .acx-badge.svc{background:#0f766e;color:#fff}
    #acx-overlay .acx-badge.gone{background:#555;color:#fff}
    #acx-overlay .acx-badge.auto{background:#0b57d0;color:#fff}
    #acx-overlay .acx-photo{flex:1;min-height:0;margin:1.4vh 0;display:flex;align-items:center;justify-content:center;
        position:relative;border-radius:12px;background:#ebebe7;overflow:hidden}
    #acx-overlay .acx-photo img{max-width:100%;max-height:100%;object-fit:contain;display:block}
    #acx-overlay .acx-photo svg{width:70%;height:70%;color:#2a3b57;opacity:.85}
    #acx-overlay .acx-credit{position:absolute;left:10px;bottom:8px;font-size:12px;background:rgba(255,255,255,.8);padding:2px 8px;border-radius:6px}
    #acx-overlay .acx-note{position:absolute;right:10px;bottom:8px;font-size:12px;background:rgba(255,255,255,.8);padding:2px 8px;border-radius:6px;color:#444}
    #acx-overlay .acx-stats{display:flex;align-items:center;gap:2vw;flex-wrap:wrap}
    #acx-overlay .acx-unit{font-size:clamp(13px,2vh,20px);color:#555}
    #acx-overlay .acx-compass{display:flex;align-items:center;gap:8px;margin-left:auto;font-weight:700;font-size:clamp(16px,2.8vh,28px)}
    #acx-overlay .acx-compass svg{width:clamp(44px,7.5vh,76px);height:clamp(44px,7.5vh,76px)}
    #acx-overlay .acx-btn{align-self:flex-start;margin-top:1.4vh;background:#0b57d0;color:#fff;text-decoration:none;
        padding:11px 20px;border-radius:999px;font-weight:700;font-size:clamp(13px,2vh,19px)}
    #acx-overlay .acx-actions{display:flex;gap:12px;flex-wrap:wrap}
    #acx-overlay .acx-track{background:#111;border:0;cursor:pointer;font-family:inherit}
    #acx-overlay .acx-track.on{background:#c0182c}
    @media (max-width: 820px){
        #acx-overlay{flex-direction:column;overflow-y:auto;gap:14px}
        #acx-overlay .acx-main{flex:none;overflow:visible}
        #acx-overlay .acx-photo{min-height:180px;flex:none}
        #acx-overlay .acx-board{flex:none;max-height:42vh}
    }
    #acx-trackbar{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;
        gap:12px;background:rgba(17,24,39,.94);color:#fff;border:1px solid #00e5ff;border-radius:999px;padding:6px 8px 6px 16px;
        font-size:14px;max-width:94%;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.5)}
    #acx-trackbar .acx-tb-text{overflow:hidden;text-overflow:ellipsis}
    #acx-trackbar .acx-tb-lost{color:#fbbf24;font-weight:700}
    #acx-trackbar button{background:#c0182c;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:14px}
    #auto-closest-btn{background:#111827;color:#e5e7eb;border:1px solid #4da6ff;border-radius:6px;padding:6px 10px;
        cursor:pointer;font-weight:bold;font-size:12px}
    #auto-closest-btn:hover:not(:disabled){background:#1d4ed8;color:#fff}
    #auto-closest-btn.active{background:#0b57d0;color:#fff;border-color:#93c5fd}
    #auto-closest-btn:disabled{opacity:0.5;cursor:default}
    #gps-refresh-btn.is-refreshing{opacity:0.75;transform:scale(0.96)}
    body.night-mode #auto-closest-btn{border-color:#ff4d4d;color:#fecaca}
    body.night-mode #auto-closest-btn:hover:not(:disabled),
    body.night-mode #auto-closest-btn.active{background:#7f1d1d;color:#fff}
    `;
    document.head.appendChild(s);
}

function acxEnsureOverlay() {
    acxInjectStyles();
    let el = document.getElementById("acx-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "acx-overlay";
    el.innerHTML = `
        <div class="acx-main">
            <div class="acx-top">
                <span id="acx-place"></span>
                <span class="acx-right"><span id="acx-live"></span>
                <button class="acx-close" id="acx-close" aria-label="Close">✕</button></span>
            </div>
            <div class="acx-row">
                <span class="acx-fl acx-big" id="acx-from"></span>
                <span class="acx-arrow" id="acx-arrow">→</span>
                <span class="acx-fl acx-big" id="acx-to"></span>
            </div>
            <div class="acx-names"><span id="acx-fromname"></span><span id="acx-toname" style="margin-left:auto"></span></div>
            <div class="acx-id">
                <span class="acx-fl acx-med" id="acx-flight"></span>
                <span id="acx-desc"></span>
            </div>
            <div class="acx-badges" id="acx-badges"></div>
            <div class="acx-photo" id="acx-photo"></div>
            <div class="acx-stats">
                <span class="acx-fl acx-stat" id="acx-alt"></span><span class="acx-unit" id="acx-altlabel"></span>
                <span class="acx-fl acx-stat" id="acx-spd"></span>
                <span class="acx-fl acx-stat" id="acx-dist"></span><span class="acx-unit">away</span>
                <span class="acx-compass"><span id="acx-dir"></span>
                    <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="none" stroke="#111" stroke-width="2"/>
                    <text x="24" y="8" font-size="9" text-anchor="middle" font-weight="700" fill="#111">N</text>
                    <g id="acx-needle"><polygon points="24,10 29,26 24,23 19,26" fill="#111"/></g></svg>
                </span>
            </div>
            <div class="acx-actions">
                <a class="acx-btn" id="acx-link" target="_blank" rel="noopener noreferrer">View gallery on Planespotters ↗</a>
                <button type="button" class="acx-btn acx-track" id="acx-track">🎯 Track on map</button>
            </div>
        </div>
        <aside class="acx-board" aria-label="Overhead aircraft sorted closest to furthest">
            <div class="acx-board-top">
                <span class="acx-board-title">OVERHEAD</span>
                <span class="acx-board-meta" id="acx-board-meta"></span>
            </div>
            <div class="acx-board-cols">
                <span>FLIGHT</span>
                <span>TYPE</span>
                <span>FROM</span>
                <span>TO</span>
                <span>ALT FT</span>
                <span>MI</span>
            </div>
            <div class="acx-board-list" id="acx-board-list"></div>
        </aside>
    `;
    document.body.appendChild(el);
    el.querySelector("#acx-close").addEventListener("click", closeAircraftCard);
    el.querySelector("#acx-track").addEventListener("click", () => {
        const id = acxOpenId;
        if (id === null) return;
        if (acxTrackedId === id) stopAircraftTracking(true);
        else startAircraftTracking(id);
        closeAircraftCard();
    });
    const boardList = el.querySelector("#acx-board-list");
    if (boardList) {
        boardList.addEventListener("click", e => {
            const row = e.target.closest(".acx-board-row");
            if (!row) return;
            const id = row.dataset.id;
            if (!id || !aircraftMetaCache.has(id)) return;
            closestViewerActive = false;
            syncAutoClosestButton();
            openAircraftCard(id);
        });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeAircraftCard(); });
    return el;
}

function acxRenderOverheadBoard() {
    if (acxOpenId === null) return;
    const listEl = document.getElementById("acx-board-list");
    const metaEl = document.getElementById("acx-board-meta");
    if (!listEl) return;

    const place = (typeof currentLocationName !== "undefined" && currentLocationName)
        ? String(currentLocationName).toUpperCase()
        : "LOCAL SKY";
    const d = new Date();
    const clock = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (metaEl) metaEl.textContent = `${place} · ${clock}`;

    const entries = [];
    aircraftMetaCache.forEach((meta, id) => {
        if (!meta || !meta.ac || !Number.isFinite(meta.actualDistance)) return;
        entries.push({ id, ac: meta.ac, dist: meta.actualDistance });
    });

    entries.sort((a, b) => a.dist - b.dist);

    if (entries.length === 0) {
        listEl.innerHTML = `<div class="acx-board-empty">No aircraft in range</div>`;
        return;
    }

    const activeIds = new Set(entries.map(e => e.id));
    acxPrevDistMap.forEach((_, prevId) => {
        if (!activeIds.has(prevId)) acxPrevDistMap.delete(prevId);
    });

    listEl.innerHTML = entries.map(({ id, ac, dist }) => {
        const flight = (ac.flight || "").trim().toUpperCase() || ac.r || String(ac.hex || "").toUpperCase() || "—";
        const type = (ac.t || "—").toUpperCase();
        const cachedRoute = getCachedRouteForAircraft(ac);
        const fromCode = cachedRoute && cachedRoute.from && cachedRoute.from.code ? cachedRoute.from.code : "—";
        const toCode = cachedRoute && cachedRoute.to && cachedRoute.to.code ? cachedRoute.to.code : "—";

        let altStr = "—";
        if (ac.alt_baro === "ground") {
            altStr = "GND";
        } else if (Number.isFinite(Number(ac.alt_baro))) {
            altStr = Math.round(Number(ac.alt_baro)).toLocaleString("en-GB");
        }

        const prevDist = acxPrevDistMap.get(id);
        let trendHtml = "";
        if (typeof prevDist === "number" && Number.isFinite(prevDist)) {
            const delta = dist - prevDist;
            if (delta < -0.05) {
                trendHtml = `<span class="acx-b-trend closer" title="Closing in">↓</span>`;
            } else if (delta > 0.05) {
                trendHtml = `<span class="acx-b-trend further" title="Moving away">↑</span>`;
            }
        }
        acxPrevDistMap.set(id, dist);

        const miStr = dist.toFixed(1);
        const activeCls = id === acxOpenId ? " active" : "";

        return `
            <button type="button" class="acx-board-row${activeCls}" data-id="${acxEsc(id)}">
                <span class="acx-b-flt">${acxEsc(flight)}</span>
                <span class="acx-b-typ">${acxEsc(type)}</span>
                <span class="acx-b-apt">${acxEsc(fromCode)}</span>
                <span class="acx-b-apt">${acxEsc(toCode)}</span>
                <span class="acx-b-alt">${acxEsc(altStr)}</span>
                <span class="acx-b-mi">${acxEsc(miStr)}${trendHtml}</span>
            </button>
        `;
    }).join("");

    entries.slice(0, 12).forEach(({ ac }) => {
        const keys = getRouteCacheKeys(ac);
        const primaryKey = keys[0];
        if (!primaryKey || !normalizeRouteLookupCallsign(primaryKey)) return;
        const alreadyCached = keys.some(k => acxRouteCache.has(k));
        if (!alreadyCached && !acxBoardPrefetchQueued.has(primaryKey)) {
            acxBoardPrefetchQueued.add(primaryKey);
            acxFetchRoute(ac).then(() => {
                acxBoardPrefetchQueued.delete(primaryKey);
                if (acxOpenId !== null) acxRenderOverheadBoard();
            }).catch(() => {
                acxBoardPrefetchQueued.delete(primaryKey);
            });
        }
    });
}

function acxSetFlap(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    text = String(text);
    if (el.dataset.v === text) return;
    const first = el.dataset.v === undefined;
    el.dataset.v = text;
    el.innerHTML = [...text].map((c, i) =>
        `<i class="${first ? "" : "flip"}" style="animation-delay:${i * 40}ms">${c === " " ? "&nbsp;" : acxEsc(c)}</i>`
    ).join("");
}

function acxSilhouette(ac) {
    if (typeof isHelicopter === "function" && isHelicopter(ac)) {
        return `<svg viewBox="0 0 200 100" fill="currentColor"><rect x="30" y="18" width="140" height="4" rx="2"/>
            <rect x="98" y="20" width="4" height="12"/><ellipse cx="85" cy="52" rx="42" ry="22"/>
            <rect x="120" y="46" width="70" height="7" rx="3"/><rect x="184" y="32" width="5" height="24" rx="2"/>
            <rect x="50" y="80" width="75" height="4" rx="2"/><rect x="62" y="72" width="4" height="10"/><rect x="108" y="72" width="4" height="10"/></svg>`;
    }
    return `<svg viewBox="0 0 240 100" fill="currentColor"><ellipse cx="115" cy="58" rx="100" ry="11"/>
        <polygon points="28,56 8,16 26,16 52,50"/><polygon points="120,58 175,84 150,84 95,60"/>
        <ellipse cx="128" cy="76" rx="14" ry="6"/></svg>`;
}

function acxRenderPhoto() {
    const box = document.getElementById("acx-photo");
    if (!box || acxOpenId === null) return;
    const meta = aircraftMetaCache.get(acxOpenId);
    const ac = meta ? meta.ac : (acxState.lastAc || {});
    const p = acxState.photo;
    if (p && p.found && p.imageUrl) {
        const creditParts = [];
        if (p.photographer) creditParts.push("📷 " + acxEsc(p.photographer));
        creditParts.push(acxEsc(p.source || "Planespotters.net"));
        box.innerHTML = `<a href="${acxEsc(p.pageUrl)}" target="_blank" rel="noopener noreferrer" style="display:contents">
            <img src="${acxEsc(p.imageUrl)}" alt="${acxEsc(ac.flight || ac.r || "Aircraft")}"></a>
            <span class="acx-credit">${creditParts.join(" · ")}</span>`;
    } else {
        box.innerHTML = acxSilhouette(ac) +
            `<span class="acx-note">${acxState.photoDone ? "No photo on Planespotters yet" : "Looking for a photo…"}</span>`;
    }
}

function updateAircraftCard() {
    if (acxOpenId === null) return;
    const meta = aircraftMetaCache.get(acxOpenId);
    if (meta) acxState.lastAc = meta.ac;
    const ac = (meta && meta.ac) || acxState.lastAc;
    if (!ac) return;
    const gone = !meta;

    const callsign = (ac.flight || "").trim().toUpperCase();
    const reg = ac.r ? String(ac.r).toUpperCase() : "";
    const route = acxState.route;

    if (route) {
        document.getElementById("acx-arrow").style.display = "";
        document.getElementById("acx-to").style.display = "";
        document.getElementById("acx-flight").parentElement.style.display = "";
        acxSetFlap("acx-from", route.from.code || "---");
        acxSetFlap("acx-to", route.to.code || "---");
        document.getElementById("acx-fromname").textContent = route.from.name || "";
        document.getElementById("acx-toname").textContent = route.to.name || "";
        acxSetFlap("acx-flight", callsign || reg || (ac.hex || "").toUpperCase());
    } else {
        document.getElementById("acx-arrow").style.display = "none";
        document.getElementById("acx-to").style.display = "none";
        document.getElementById("acx-fromname").textContent = acxCaption(ac, callsign);
        document.getElementById("acx-toname").textContent = "";
        acxSetFlap("acx-from", callsign || reg || (ac.hex || "").toUpperCase());
        document.getElementById("acx-flight").parentElement.style.display = "none";
    }

    const airline = acxAirlineName(ac) || (route && route.airline) || "";
    const type = ac.desc ? acxTitleCase(ac.desc).replace(/\bBoeing\b/, "Boeing") : (ac.t || "");
    const desc = [airline, type, reg].filter(Boolean).join(", ");
    document.getElementById("acx-desc").textContent = desc || (ac.hex ? "ICAO " + String(ac.hex).toUpperCase() : "");

    const badges = [];
    if (closestViewerActive) badges.push(`<span class="acx-badge auto">📡 Closest Viewer</span>`);
    const svcLabel = typeof getEmergencyService === "function" ? getEmergencyService(ac) : null;
    if (svcLabel) badges.push(`<span class="acx-badge svc">🚨 ${acxEsc(svcLabel)}</span>`);
    if (typeof isMilitary === "function" && isMilitary(ac)) badges.push(`<span class="acx-badge mil">Military</span>`);
    if (typeof isEmergency === "function" && isEmergency(ac)) {
        badges.push(`<span class="acx-badge emg">🚨 ${acxEsc(getEmergencyDescription(ac.squawk) || "Emergency")} · ${acxEsc(ac.squawk)}</span>`);
    } else if (ac.squawk) {
        badges.push(`<span class="acx-badge">Squawk ${acxEsc(ac.squawk)}</span>`);
    }
    if (gone) badges.push(`<span class="acx-badge gone">Out of range — last known position</span>`);
    document.getElementById("acx-badges").innerHTML = badges.join("");

    const onGround = ac.alt_baro === "ground";
    const altNum = Number(ac.alt_baro);
    const vr = Number(ac.baro_rate !== undefined ? ac.baro_rate : ac.geom_rate);
    let label = "in level flight";
    if (onGround) label = "on the ground";
    else if (Number.isFinite(vr) && vr > 300) label = "climbing";
    else if (Number.isFinite(vr) && vr < -300) label = "descending";
    acxSetFlap("acx-alt", onGround ? "GND" : (Number.isFinite(altNum) ? Math.round(altNum) : "?") + "FT");
    document.getElementById("acx-altlabel").textContent = label;
    acxSetFlap("acx-spd", Math.round((Number(ac.gs) || 0) * MILES_PER_NM) + "MPH");

    const dist = meta ? meta.actualDistance : null;
    acxSetFlap("acx-dist", (dist !== null && Number.isFinite(dist) ? dist.toFixed(1) : "?") + "MI");

    if (Number.isFinite(currentLat) && Number.isFinite(currentLon) && Number.isFinite(ac.lat) && Number.isFinite(ac.lon)) {
        const b = acxBearing(currentLat, currentLon, ac.lat, ac.lon);
        document.getElementById("acx-dir").textContent = acxCompassLetter(b);
        document.getElementById("acx-needle").setAttribute("transform", `rotate(${b.toFixed(0)} 24 24)`);
    }

    document.getElementById("acx-link").href = acxPlanespottersGalleryUrl(ac);
    const tb = document.getElementById("acx-track");
    if (tb) {
        const on = acxTrackedId === acxOpenId;
        tb.textContent = on ? "⏹ Untrack" : "🎯 Track on map";
        tb.classList.toggle("on", on);
        tb.style.display = gone ? "none" : "";
    }
    acxRenderPhoto();
    acxRenderOverheadBoard();
}

function acxTickClock() {
    const el = document.getElementById("acx-live");
    if (!el) return;
    const d = new Date();
    el.textContent = "Live " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (acxOpenId !== null) acxRenderOverheadBoard();
}

async function openAircraftCard(id) {
    const meta = aircraftMetaCache.get(id);
    if (!meta) return;
    const el = acxEnsureOverlay();

    if (acxOpenId !== id) {
        acxState = { photo: null, route: undefined, photoDone: false, routeDone: false, lastAc: meta.ac };
        ["acx-from", "acx-to", "acx-flight", "acx-alt", "acx-spd", "acx-dist"].forEach(k => {
            const n = document.getElementById(k);
            if (n) { delete n.dataset.v; n.innerHTML = ""; }
        });
    }
    acxOpenId = id;

    const place = (typeof currentLocationName !== "undefined" && currentLocationName) ? currentLocationName : "";
    document.getElementById("acx-place").textContent = place ? `The sky over ${place}` : "Aircraft overhead";
    acxTickClock();
    clearInterval(acxClockTimer);
    acxClockTimer = setInterval(acxTickClock, 15000);

    el.classList.add("open");
    updateAircraftCard();

    const ac = meta.ac;
    if (!ac.r || !ac.desc) {
        fetchAdsbdbAircraft(ac).then(info => {
            if (acxOpenId !== id || !info) return;
            updateAircraftCard();
        }).catch(() => {});
    }

    const cached = (typeof aircraftPhotoCache !== "undefined")
        ? aircraftPhotoCache.get(`${(ac.hex || "").trim().toLowerCase()}|${(ac.r || "").trim().toUpperCase()}`) : null;
    if (cached) { acxState.photo = cached; acxState.photoDone = true; }

    const photoP = cached ? Promise.resolve(cached) : fetchAircraftPhoto(ac);
    const routeP = acxFetchRoute(ac);

    photoP.then(p => {
        if (acxOpenId !== id) return;
        acxState.photo = p; acxState.photoDone = true; acxRenderPhoto();
    }).catch(() => { acxState.photoDone = true; acxRenderPhoto(); });

    routeP.then(r => {
        if (acxOpenId !== id) return;
        acxState.route = r; acxState.routeDone = true; updateAircraftCard();
        acxRenderOverheadBoard();
    }).catch(() => { acxState.routeDone = true; });
}

function closeAircraftCard() {
    const el = document.getElementById("acx-overlay");
    if (el) el.classList.remove("open");
    acxOpenId = null;
    closestViewerActive = false;
    syncAutoClosestButton();
    clearInterval(acxClockTimer);
}

function getNearestAircraftId() {
    let bestId = null;
    let bestDist = Infinity;

    aircraftMetaCache.forEach((meta, id) => {
        if (!meta || !Number.isFinite(meta.actualDistance)) return;
        if (meta.actualDistance <= currentAircraftRadius && meta.actualDistance < bestDist) {
            bestDist = meta.actualDistance;
            bestId = id;
        }
    });

    return bestId;
}

function syncAutoClosestButton(hasTarget = Boolean(getNearestAircraftId())) {
    const btn = document.getElementById("auto-closest-btn");
    if (!btn) return;
    btn.disabled = !hasTarget;
    btn.classList.toggle("active", closestViewerActive && hasTarget);
    btn.textContent = closestViewerActive ? "📡 Auto-Closest: ON" : "📡 Auto-Closest";
}

function openClosestAircraftViewer() {
    const nearestId = getNearestAircraftId();
    if (!nearestId) return;

    closestViewerActive = true;
    syncAutoClosestButton(true);
    openAircraftCard(nearestId);
}

async function handleMarkerClick(id, marker) {
    closestViewerActive = false;
    syncAutoClosestButton();
    openAircraftCard(id);
}

/* ------------------------------------------------------------------
   Smooth aircraft glide / interpolation state
   ------------------------------------------------------------------ */

const GLIDE_DURATION_MS = 14500;

let aircraftAnimations = new Map();
let glideRafId = null;
let aircraftHeadingState = new Map();

function shortestAngleDiff(fromDeg, toDeg) {
    const a = ((fromDeg % 360) + 360) % 360;
    const b = ((toDeg % 360) + 360) % 360;
    let diff = b - a;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
}

function applyMarkerHeading(id, marker, headingDeg) {
    if (!marker) return;
    const el = marker.getElement();
    if (!el) return;
    const spinner = el.querySelector(".ac-rotator");
    if (spinner) {
        spinner.style.transform = `rotate(${headingDeg}deg)`;
    }
    aircraftHeadingState.set(id, headingDeg);
}

function scheduleAircraftGlide(id, marker, newLat, newLon, newTrack) {
    const targetTrack = Number.isFinite(Number(newTrack)) ? Number(newTrack) : 0;
    const currentLatLng = marker.getLatLng();

    const prevHeading = aircraftHeadingState.has(id)
        ? aircraftHeadingState.get(id)
        : targetTrack;
    const headingDelta = shortestAngleDiff(prevHeading, targetTrack);

    const moved =
        Math.abs(currentLatLng.lat - newLat) > 1e-6 ||
        Math.abs(currentLatLng.lng - newLon) > 1e-6;

    const turned = Math.abs(headingDelta) > 0.25;

    if (!moved && !turned) {
        marker.setLatLng([newLat, newLon]);
        applyMarkerHeading(id, marker, targetTrack);
        aircraftAnimations.delete(id);
        return;
    }

    aircraftAnimations.set(id, {
        marker,
        fromLat: currentLatLng.lat,
        fromLon: currentLatLng.lng,
        toLat: newLat,
        toLon: newLon,
        fromHeading: prevHeading,
        headingDelta,
        startTime: performance.now(),
        duration: GLIDE_DURATION_MS
    });

    if (!glideRafId) {
        glideRafId = requestAnimationFrame(stepAircraftGlide);
    }
}

function stepAircraftGlide(now) {
    aircraftAnimations.forEach((anim, id) => {
        if (!aircraftMarkers.has(id)) {
            aircraftAnimations.delete(id);
            return;
        }

        const elapsed = now - anim.startTime;
        const rawT = Math.min(Math.max(elapsed / anim.duration, 0), 1);
        const easedT = 1 - Math.pow(1 - rawT, 1.35);

        const lat = anim.fromLat + (anim.toLat - anim.fromLat) * easedT;
        const lon = anim.fromLon + (anim.toLon - anim.fromLon) * easedT;
        const heading = anim.fromHeading + anim.headingDelta * easedT;

        anim.marker.setLatLng([lat, lon]);
        acxFollow(id, lat, lon);
        applyMarkerHeading(id, anim.marker, heading);

        if (rawT >= 1) {
            anim.marker.setLatLng([anim.toLat, anim.toLon]);
            acxFollow(id, anim.toLat, anim.toLon);
            applyMarkerHeading(id, anim.marker, anim.fromHeading + anim.headingDelta);
            aircraftAnimations.delete(id);
        }
    });

    if (aircraftAnimations.size > 0) {
        glideRafId = requestAnimationFrame(stepAircraftGlide);
    } else {
        glideRafId = null;
    }
}

function updateAircraftRadius(radius) {

    currentAircraftRadius = radius;

    if (aircraftRadiusCircle) {

        aircraftRadiusCircle.setRadius(
            radius * 1609.34
        );

    }

}

function setMapTheme(mode) {

    document.body.dataset.mode = mode;

    const isNight = mode === "NIGHT";

    document.body.classList.toggle("night-mode", isNight);

    const rainRadarEl = document.getElementById("rain-radar");
    const nightAircraftSlot = document.getElementById("night-aircraft-slot");
    const dayAircraftSlot = document.getElementById("day-aircraft-slot");
    const astronomyContainer = document.getElementById("astronomy-container");
    const rightPanelTitle = document.getElementById("right-panel-title");

    const aircraftSummary = document.getElementById("aircraft-summary");
    const aircraftMapEl = document.getElementById("aircraft-map");

    if (isNight) {
        if (rainRadarEl) rainRadarEl.style.display = "none";
        if (nightAircraftSlot) {
            nightAircraftSlot.style.display = "block";
            if (aircraftSummary && aircraftMapEl && !nightAircraftSlot.contains(aircraftMapEl)) {
                nightAircraftSlot.appendChild(aircraftSummary);
                nightAircraftSlot.appendChild(aircraftMapEl);
            }
        }

        if (rightPanelTitle) rightPanelTitle.textContent = "Astronomical Intelligence";
        if (astronomyContainer) astronomyContainer.style.display = "flex";

        if (typeof initOrUpdateAstronomy === "function" && currentLat !== null && currentLon !== null) {
            initOrUpdateAstronomy(currentLat, currentLon);
        }
    } else {
        if (rightPanelTitle) rightPanelTitle.textContent = "Aircraft Tracking";
        if (astronomyContainer) astronomyContainer.style.display = "none";

        if (dayAircraftSlot && aircraftSummary && aircraftMapEl && !dayAircraftSlot.contains(aircraftMapEl)) {
            dayAircraftSlot.appendChild(aircraftSummary);
            dayAircraftSlot.appendChild(aircraftMapEl);
        }

        if (nightAircraftSlot) nightAircraftSlot.style.display = "none";
        if (rainRadarEl) rainRadarEl.style.display = "block";
    }

    if (aircraftMap) {
        setTimeout(() => {
            aircraftMap.invalidateSize();
        }, 50);
    }

    if (typeof rainRadarMap !== "undefined" && rainRadarMap && !isNight) {
        setTimeout(() => {
            rainRadarMap.invalidateSize();
        }, 50);
    }

}

function initialiseAircraftMap(lat, lon) {

    if (aircraftMap) {

        if (homeMarker) {
            homeMarker.setLatLng([lat, lon]);
        }

        if (aircraftRadiusCircle) {
            aircraftRadiusCircle.setLatLng([lat, lon]);
        }

        return;

    }

    aircraftMap =
        L.map("aircraft-map")
            .setView(
                [lat, lon],
                9
            );

    tileLayer =
        L.tileLayer(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution:
                    "&copy; OpenStreetMap"
            }
        ).addTo(
            aircraftMap
        );

    homeMarker =
        L.marker([lat, lon])
            .addTo(aircraftMap)
            .bindPopup(
                "Home Location"
            );

    aircraftRadiusCircle =
        L.circle(
            [lat, lon],
            {
                radius:
                    currentAircraftRadius *
                    1609.34,
                color: "#4da6ff",
                fillOpacity: 0.05
            }
        )
            .addTo(
                aircraftMap
            );

    loadAircraft();

    if (!refreshTimer) {

        refreshTimer =
            setInterval(
                loadAircraft,
                15000
            );

    }

}

function isMilitary(ac) {

    const flight =
        (ac.flight || "")
            .trim()
            .toUpperCase();

    const militaryPrefixes = [
        "RRR", "ASCOT",
        "RCH", "REACH", "QID",
        "NATO",
        "CFC",
        "SHELL", "TARTN", "JAKE", "CNV", "HERKY", "SPAR",
        "GHOST", "LAGR", "VENUS", "ROGUE", "BLACKJACK",
        "AME", "DUKE", "SHF", "BAF"
    ];

    if (
        militaryPrefixes.some(
            prefix =>
                flight.startsWith(
                    prefix
                )
        )
    ) {
        return true;
    }

    const reg =
        (ac.r || "")
            .toUpperCase();

    if (
        reg.startsWith("ZZ") ||
        reg.startsWith("ZM") ||
        reg.startsWith("ZH") ||
        reg.startsWith("ZE")
    ) {
        return true;
    }

    return (
        ac.dbFlags &&
        (ac.dbFlags & 1) === 1
    );

}

const HELICOPTER_TYPES = new Set([
    "EH10", "LYNX", "A159", "AW159", "H47", "H64", "H60", "H53", "H1",
    "S61", "S61R", "S58T", "S64", "S65", "PUMA", "GAZL", "LAMA",
    "ALO2", "ALO3", "TIGR", "NH90", "UH1", "HUEY", "V22",
    "AS32", "AS3B", "AS65", "AS55", "AS50", "AS53",
    "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "EC75", "EC60",
    "A109", "A119", "A139", "A149", "A169", "A189",
    "S76", "S92", "S70", "S300", "S333",
    "B06", "B06T", "B105", "B212", "B222", "B230", "B407", "B412",
    "B427", "B429", "B430", "B505", "B47G", "B47J", "B47T",
    "R22", "R44", "R66", "EN28", "EN48", "H269", "H500", "HUCO",
    "MD52", "MD60", "EXPL", "NOTR", "BK17", "G2CA", "KMAX",
    "KA32", "KA27", "KA26", "MI2", "MI8", "MI14", "MI24", "MI26", "MI28"
]);

const knownHelicopters = new Set();

function isHelicopter(ac) {

    const hex =
        String(ac.hex || "")
            .toLowerCase();

    const type =
        (ac.t || "")
            .toUpperCase()
            .trim();

    const desc =
        (ac.desc || "")
            .toUpperCase();

    const heli =
        ac.category === "A7" ||
        HELICOPTER_TYPES.has(type) ||
        /HELICOPTER|ROTORCRAFT|\bMERLIN\b|\bLYNX\b|\bWILDCAT\b|\bCHINOOK\b|\bAPACHE\b|\bPUMA\b|\bSEA ?KING\b/
            .test(desc);

    if (hex) {

        if (heli) {
            knownHelicopters.add(hex);
        }

        return heli || knownHelicopters.has(hex);

    }

    return heli;

}

function isEmergency(ac) {

    return (
        ac.squawk === "7400" ||
        ac.squawk === "7500" ||
        ac.squawk === "7600" ||
        ac.squawk === "7700"
    );

}

const EMERGENCY_SERVICE_CALLSIGNS = [
    ["POLICE", "Police"],
    ["NPAS", "Police"],
    ["HELIMED", "Air ambulance"],
    ["AIRAMB", "Air ambulance"],
    ["AMBULANCE", "Air ambulance"],
    ["MEDEVAC", "Medical flight"],
    ["LIFEGUARD", "Medical flight"],
    ["MEDIC", "Medical flight"],
    ["RESCUE", "Rescue / SAR"],
    ["RSCU", "Rescue / SAR"],
    ["COASTGUARD", "Coastguard"],
    ["CGUARD", "Coastguard"],
    ["FIRE", "Fire service"]
];

const EMERGENCY_SERVICE_OPERATOR_RE =
    /POLICE|NPAS|AMBULANCE|PARAMEDIC|HELIMED|MEDICAL|NHS|COAST ?GUARD|FIRE (AND|&) RESCUE|FIRE SERVICE|LIFEBOAT|RESCUE/i;

function getEmergencyService(ac) {

    const callsign =
        (ac.flight || "")
            .trim()
            .toUpperCase();

    if (callsign) {
        for (const [prefix, label] of EMERGENCY_SERVICE_CALLSIGNS) {
            if (callsign.startsWith(prefix)) {
                return label;
            }
        }
    }

    const operator = String(ac.ownOp || "");

    if (operator && EMERGENCY_SERVICE_OPERATOR_RE.test(operator)) {

        if (/POLICE|NPAS/i.test(operator)) return "Police";
        if (/AMBULANCE|PARAMEDIC|HELIMED|MEDICAL|NHS/i.test(operator)) return "Air ambulance";
        if (/COAST ?GUARD/i.test(operator)) return "Coastguard";
        if (/FIRE/i.test(operator)) return "Fire service";
        if (/LIFEBOAT/i.test(operator)) return "Lifeboat / SAR";
        return "Rescue / SAR";

    }

    return null;

}

function getEmergencyDescription(squawk) {

    switch (squawk) {

        case "7400":
            return "Unmanned Aircraft Lost Link";

        case "7500":
            return "Unlawful Interference / Hijacking";

        case "7600":
            return "Radio Communications Failure";

        case "7700":
            return "General Emergency";

        default:
            return null;

    }

}

function isUAV(ac) {

    return (
        ac.category === "B6"
    );

}

function buildIcon(ac, id = null) {

    const military =
        isMilitary(ac);

    const helicopter =
        isHelicopter(ac);

    const emergency =
        isEmergency(ac);

    const uav =
        isUAV(ac);

    const service =
        getEmergencyService(ac);

    const colour =
        emergency
            ? "#ffc107"
            : service
                ? "#00d68f"
                : military
                    ? "#ff4444"
                    : uav
                        ? "#9c27b0"
                        : "#4da6ff";

    const initialHeading =
        id && aircraftHeadingState.has(id)
            ? aircraftHeadingState.get(id)
            : (ac.track || 0);

    const svg = helicopter

        ? `
        <svg viewBox="0 0 24 24"
            width="28"
            height="28">

            <g stroke="#000000"
                stroke-width="1.2"
                stroke-linejoin="round"
                stroke-linecap="round"
                fill="${colour}">

                <rect x="11"
                    y="13"
                    width="2"
                    height="9"
                    rx="1"/>

                <rect x="8.8"
                    y="19.6"
                    width="6.4"
                    height="1.8"
                    rx=".9"/>

                <ellipse cx="12"
                        cy="10"
                        rx="3.6"
                        ry="5.4"/>

            </g>

            <g stroke="#000000"
               stroke-width="3.2"
               stroke-linecap="round">

                <line x1="3"
                    y1="3"
                    x2="21"
                    y2="17"/>

                <line x1="21"
                    y1="3"
                    x2="3"
                    y2="17"/>

            </g>

            <g stroke="${colour}"
            stroke-width="1.5"
            stroke-linecap="round">

                <line x1="3"
                    y1="3"
                    x2="21"
                    y2="17"/>

                <line x1="21"
                    y1="3"
                    x2="3"
                    y2="17"/>

            </g>

            <circle cx="12"
                    cy="10"
                    r="1.7"
                    fill="#000000"
                    stroke="${colour}"/>

        </svg>
        `

        : `
        <svg viewBox="0 0 24 24"
             width="32"
             height="32">

            <path
                fill="${colour}"
                stroke="#111111"
                stroke-width="1.2"
                stroke-linejoin="round"
                d="
                    M21 16
                    v-2
                    l-8-5
                    V3.5
                    c0-.83-.67-1.5-1.5-1.5
                    S10 2.67 10 3.5
                    V9
                    l-8 5
                    v2
                    l8-2.5
                    V19
                    l-2 1.5
                    V22
                    l3.5-1
                    3.5 1
                    v-1.5
                    L13 19
                    v-5.5
                    l8 2.5
                    z"/>
        </svg>
        `;

    return L.divIcon({

        html: `
            <div class="ac-rotator" style="
                width:32px;
                height:32px;
                transform:rotate(${initialHeading}deg);
                transform-origin:center center;
            ">
                ${svg}
            </div>
        `,

        className: "",

        iconSize: [32, 32],

        iconAnchor: [16, 16]

    });

}

/* ------------------------------------------------------------------
   HOSAC incident tracking helpers
   ------------------------------------------------------------------ */

const MILES_PER_NM = 1.15078;

const INCIDENT_SEARCH_NM = [40, 120, 240];

const MAX_TRACK_POINTS = 4000;

let loadingAircraft = false;

function normHex(value) {

    return String(value || "")
        .trim()
        .toLowerCase();

}

function thinTrack(track) {

    const kept = track.filter(
        (p, i) =>
            i === 0 ||
            i === track.length - 1 ||
            i % 2 === 0
    );

    track.length = 0;

    kept.forEach(p => track.push(p));

}

async function fetchIncidentAircraft(incident) {

    const hex = normHex(incident.id);

    const last =
        incident.track &&
            incident.track.length
            ? incident.track[incident.track.length - 1]
            : null;

    const lat = last ? last.lat : currentLat;
    const lon = last ? last.lon : currentLon;

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
    ) {
        return null;
    }

    for (const nm of INCIDENT_SEARCH_NM) {

        try {

            const response =
                await fetch(
                    `${WORKER_URL}/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${nm}`
                );

            if (!response.ok) {
                continue;
            }

            const data =
                await response.json();

            const found =
                (data.ac || data.aircraft || [])
                    .find(
                        a =>
                            normHex(a.hex) === hex &&
                            Number.isFinite(a.lat) &&
                            Number.isFinite(a.lon)
                    );

            if (found) {
                return found;
            }

        } catch (err) {

            console.log(
                "Incident search failed",
                incident.id,
                nm,
                err
            );

        }

    }

    return null;

}

async function loadAircraft() {

    if (
        currentLat === null ||
        currentLon === null
    ) {
        return;
    }

    if (loadingAircraft) {
        return;
    }

    loadingAircraft = true;

    try {

        let aircraft = [];

        try {

            const radiusNm =
                (
                    currentAircraftRadius /
                    MILES_PER_NM
                ).toFixed(1);

            const response =
                await fetch(
                    `${WORKER_URL}/lat/${currentLat}/lon/${currentLon}/dist/${radiusNm}`
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                data.success === false
            ) {

                console.log(
                    "Aircraft feed unavailable",
                    data.errors
                );

            } else {

                aircraft =
                    data.ac ||
                    data.aircraft ||
                    [];

            }

        } catch (err) {

            console.log(
                "Aircraft feed failed",
                err
            );

        }

        for (
            const incident of activeIncidents.values()
        ) {

            const hex =
                normHex(incident.id);

            const alreadyPresent =
                aircraft.some(
                    a =>
                        normHex(a.hex) === hex
                );

            if (alreadyPresent) {
                continue;
            }

            const found =
                await fetchIncidentAircraft(
                    incident
                );

            if (found) {
                aircraft.push(found);
            }

        }

        if (acxTrackedId !== null) {
            const alreadyPresent = aircraft.some(a => normHex(a.hex) === acxTrackedId);
            if (!alreadyPresent) {
                const found = await fetchIncidentAircraft({
                    id: acxTrackedId,
                    track: acxTrail
                });
                if (found) {
                    aircraft.push(found);
                }
            }
        }

        const seen =
            new Set();

        let militaryCount = 0;
        let civilianCount = 0;
        let emergencyCount = 0;
        let closestMiles = Infinity;
        let closestName = "";
        let closestId = null;
        let logChanged = false;

        aircraft.forEach(ac => {

            if (
                !Number.isFinite(ac.lat) ||
                !Number.isFinite(ac.lon)
            ) {
                return;
            }

            const id =
                normHex(ac.hex) ||
                (ac.flight || "").trim();

            if (!id) {
                return;
            }

            const actualDistance =
                aircraftMap.distance(
                    [currentLat, currentLon],
                    [ac.lat, ac.lon]
                ) / 1609.34;

            const isActiveIncident =
                activeIncidents.has(id);

            if (
                actualDistance >
                currentAircraftRadius &&
                !isActiveIncident &&
                id !== acxTrackedId
            ) {
                return;
            }

            if (!aircraftHistory.has(id)) {

                aircraftHistory.set(id, []);

            }

            const history =
                aircraftHistory.get(id);

            history.push({

                time: Date.now(),
                lat: ac.lat,
                lon: ac.lon,
                altitude: ac.alt_baro,
                speed: ac.gs,
                heading: ac.track

            });

            while (
                history.length > 40
            ) {

                history.shift();

            }

            seen.add(id);

            const military =
                isMilitary(ac);

            if (military) {
                militaryCount++;
            } else {
                civilianCount++;
            }

            if (isEmergency(ac) || getEmergencyService(ac)) {

                emergencyCount++;

            }

            if (
                actualDistance <= currentAircraftRadius &&
                actualDistance < closestMiles
            ) {

                closestMiles = actualDistance;
                closestId = id;

                closestName =
                    (ac.flight || "").trim() ||
                    ac.r ||
                    "";

            }

            aircraftMetaCache.set(id, {
                ac,
                actualDistance,
                isActiveIncident
            });

            if (id === acxOpenId) updateAircraftCard();
            if (id === acxTrackedId) acxOnTrackedUpdate(ac);

            const popup = buildPopupHtml(
                ac,
                actualDistance,
                isActiveIncident,
                "idle",
                null
            );

            if (
                aircraftMarkers.has(id)
            ) {

                const marker =
                    aircraftMarkers.get(id);

                marker.setIcon(
                    buildIcon(ac, id)
                );

                if (!marker.isPopupOpen()) {
                    marker.setPopupContent(popup);
                }

                marker.setOpacity(1);

                scheduleAircraftGlide(
                    id,
                    marker,
                    ac.lat,
                    ac.lon,
                    ac.track
                );

            } else {

                const initialHeading = Number.isFinite(Number(ac.track)) ? Number(ac.track) : 0;
                aircraftHeadingState.set(id, initialHeading);

                const marker =
                    L.marker(
                        [
                            ac.lat,
                            ac.lon
                        ],
                        {
                            icon:
                                buildIcon(ac, id)
                        }
                    )
                        .addTo(
                            aircraftMap
                        );

                marker.on("click", () => {
                    handleMarkerClick(id, marker);
                });

                aircraftMarkers.set(
                    id,
                    marker
                );

            }

            const emergencyDescription =
                getEmergencyDescription(
                    ac.squawk
                ) ||
                (ac.r === "EI-DVI"
                    ? "General Emergency"
                    : null);

            if (
                isActiveIncident
            ) {

                const incident =
                    activeIncidents.get(id);

                const now = Date.now();

                incident.lastContact =
                    now -
                    (
                        Number(ac.seen_pos) || 0
                    ) * 1000;

                incident.onGround =
                    ac.alt_baro === "ground";

                const lastPoint =
                    incident.track[
                    incident.track.length - 1
                    ];

                if (
                    !lastPoint ||
                    lastPoint.lat !== ac.lat ||
                    lastPoint.lon !== ac.lon
                ) {

                    incident.track.push({

                        time: now,
                        lat: ac.lat,
                        lon: ac.lon,
                        altitude: ac.alt_baro,
                        speed: ac.gs,
                        heading: ac.track

                    });

                    if (
                        incident.track.length >
                        MAX_TRACK_POINTS
                    ) {

                        thinTrack(
                            incident.track
                        );

                    }

                }

                logChanged = true;

            }

            if (
                selectedIncidentId === id
            ) {

                drawIncidentTrack(
                    id,
                    false
                );

            }

            if (
                emergencyDescription &&
                !activeIncidents.has(id)
            ) {

                const incident = {

                    id: id,

                    status: "ACTIVE",

                    squawk: ac.squawk,

                    description:
                        emergencyDescription,

                    callsign:
                        ac.flight || ac.hex,

                    registration:
                        ac.r,

                    aircraftType:
                        ac.t,

                    startTime:
                        Date.now(),

                    lastContact:
                        Date.now(),

                    onGround:
                        ac.alt_baro === "ground",

                    track: [

                        ...(
                            aircraftHistory.get(id)
                            || []
                        )

                    ]

                };

                activeIncidents.set(
                    id,
                    incident
                );

                incidentLog.unshift(
                    incident
                );

                logChanged = true;

            }

        });

        aircraftMarkers.forEach(
            (
                marker,
                id
            ) => {

                if (
                    seen.has(id)
                ) {
                    return;
                }

                if (
                    activeIncidents.has(id) ||
                    id === acxTrackedId
                ) {

                    aircraftAnimations.delete(id);
                    marker.setOpacity(0.45);

                    return;

                }

                aircraftAnimations.delete(id);
                aircraftHeadingState.delete(id);
                aircraftMetaCache.delete(id);
                if (id === acxOpenId) updateAircraftCard();
                aircraftMap.removeLayer(
                    marker
                );

                aircraftMarkers.delete(
                    id
                );

            }
        );

        if (logChanged) {

            saveIncidentLog();

            renderIncidentLog();

        }

        const mil =
            document.getElementById(
                "military-count"
            );

        const civ =
            document.getElementById(
                "civilian-count"
            );

        const emg =
            document.getElementById(
                "emergency-count"
            );

        if (mil) {
            mil.textContent =
                militaryCount;
        }

        if (civ) {
            civ.textContent =
                civilianCount;
        }

        if (emg) {
            emg.textContent =
                emergencyCount;
        }

        updateClosestChip(closestMiles, closestName, closestId);

        if (closestViewerActive && acxOpenId !== null && closestId && closestId !== acxOpenId) {
            openAircraftCard(closestId);
        } else if (acxOpenId !== null) {
            acxRenderOverheadBoard();
        }

    } catch (err) {

        console.error(
            "Aircraft load failed",
            err
        );

    } finally {

        loadingAircraft = false;

    }

}

function updateClosestChip(miles, name, id = null) {

    let span = document.getElementById("closest-aircraft");
    let chip = span ? span.closest(".aircraft-stat") : null;
    let autoBtn = document.getElementById("auto-closest-btn");

    if (!span) {

        const summary = document.getElementById("aircraft-summary");
        const btn = document.getElementById("gps-refresh-btn");

        if (!summary) return;

        chip = document.createElement("div");
        chip.className = "aircraft-stat";
        chip.title = "Click to open card for closest aircraft";
        chip.innerHTML = 'Closest: <span id="closest-aircraft">--</span>';

        chip.addEventListener("click", () => {
            const targetId = chip.dataset.aircraftId;
            if (targetId && aircraftMetaCache.has(targetId)) {
                closestViewerActive = false;
                syncAutoClosestButton();
                openAircraftCard(targetId);
            }
        });

        autoBtn = document.createElement("button");
        autoBtn.type = "button";
        autoBtn.id = "auto-closest-btn";
        autoBtn.textContent = "📡 Auto-Closest";
        autoBtn.title = "Open closest aircraft card and automatically follow the nearest aircraft";
        autoBtn.addEventListener("click", () => {
            if (closestViewerActive && acxOpenId !== null) {
                closeAircraftCard();
            } else {
                openClosestAircraftViewer();
            }
        });

        if (btn && btn.parentElement && btn.parentElement.parentElement === summary) {
            summary.insertBefore(chip, btn.parentElement);
            summary.insertBefore(autoBtn, btn.parentElement);
        } else {
            summary.appendChild(chip);
            summary.appendChild(autoBtn);
        }

        span = chip.querySelector("#closest-aircraft");

    }

    const hasTarget = Number.isFinite(miles) && Boolean(id);

    if (chip) {
        chip.dataset.aircraftId = hasTarget ? id : "";
        chip.style.cursor = hasTarget ? "pointer" : "default";
        chip.style.opacity = hasTarget ? "1" : "0.75";
    }

    span.textContent =
        Number.isFinite(miles)
            ? `${miles.toFixed(1)} mi${name ? " · " + name : ""}`
            : "--";

    if (!hasTarget && closestViewerActive) {
        closestViewerActive = false;
    }

    syncAutoClosestButton(hasTarget);

}

function recenterMap() {

    stopAircraftTracking(false);

    const btn =
        document.getElementById(
            "gps-refresh-btn"
        );

    const BTN_ICON = "📍";
    let resetBtnTimer = null;

    const setBtn = (disabled, titleText, refreshing = false) => {
        if (!btn) return;
        clearTimeout(resetBtnTimer);
        btn.textContent = BTN_ICON;
        btn.disabled = !!disabled;
        btn.classList.toggle("is-refreshing", !!refreshing);
        if (titleText) {
            btn.title = titleText;
            btn.setAttribute("aria-label", titleText);
        }
    };

    const applyPosition = (lat, lon) => {

        currentLat = lat;
        currentLon = lon;

        if (aircraftMap) {

            aircraftMap.invalidateSize();

            aircraftMap.setView(
                [lat, lon],
                9
            );

        }

        if (aircraftRadiusCircle) {
            aircraftRadiusCircle.setLatLng([lat, lon]);
        }

        if (homeMarker) {
            homeMarker.setLatLng([lat, lon]);
        }

        if (typeof rainRadarMap !== "undefined" && rainRadarMap) {
            rainRadarMap.invalidateSize();
            rainRadarMap.setView([lat, lon], 7);
        }

        if (typeof initOrUpdateAstronomy === "function") {
            initOrUpdateAstronomy(lat, lon);
        }

        loadAircraft();

    };

    if (
        Number.isFinite(currentLat) &&
        Number.isFinite(currentLon)
    ) {
        applyPosition(currentLat, currentLon);
    }

    if (!navigator.geolocation) {
        setBtn(false, "Re-Centre Map", false);
        return;
    }

    setBtn(true, "Locating GPS position…", true);

    navigator.geolocation.getCurrentPosition(

        position => {

            applyPosition(
                position.coords.latitude,
                position.coords.longitude
            );

            setBtn(false, "Re-Centre Map", false);

        },

        error => {

            console.error(
                "GPS refresh failed",
                error
            );

            setBtn(false, "No GPS fix — Re-Centre Map", false);

            resetBtnTimer = setTimeout(
                () => setBtn(false, "Re-Centre Map", false),
                2500
            );

        },

        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        }

    );

}

function saveIncidentLog() {

    const write = () =>
        localStorage.setItem(
            "hosacIncidentLog",
            JSON.stringify(
                incidentLog
            )
        );

    try {

        write();

    } catch (err) {

        incidentLog.forEach(incident => {

            if (
                incident.track &&
                incident.track.length > 200
            ) {

                thinTrack(
                    incident.track
                );

            }

        });

        try {

            write();

        } catch (err2) {

            console.error(
                "Incident log could not be saved",
                err2
            );

        }

    }

}

function loadIncidentLog() {

    const saved =
        localStorage.getItem(
            "hosacIncidentLog"
        );

    if (saved) {

        try {

            incidentLog =
                JSON.parse(
                    saved
                );

        } catch (err) {

            console.error(
                "Incident log unreadable",
                err
            );

            incidentLog = [];

        }

        incidentLog.forEach(incident => {

            if (
                incident.status !== "CLOSED"
            ) {

                incident.id =
                    normHex(incident.id);

                activeIncidents.set(
                    incident.id,
                    incident
                );

            }

        });

    }

}

function renderIncidentLog() {

    const container =
        document.getElementById(
            "incident-log"
        );

    if (!container) {
        return;
    }

    const activeIncidentsList =
        incidentLog.filter(
            incident =>
                incident.status !== "CLOSED"
        );

    const historicalIncidentsList =
        incidentLog.filter(
            incident =>
                incident.status === "CLOSED"
        );

    container.innerHTML = `
<div class="incident-panels">

    <div class="incident-column">

        <h3>🚨 Active Incidents (${activeIncidentsList.length})</h3>

        ${activeIncidentsList.length === 0
            ? '<div class="incident-empty">No active incidents</div>'
            : activeIncidentsList.map(incident => `

                    <div class="incident-card">

                        <div class="incident-title">
                            🚨 ${incident.description}
                        </div>

                        <div>${incident.callsign || "Unknown"}</div>

                        <div>${incident.registration || "Unknown"}</div>

                        <div>Squawk: ${incident.squawk}</div>

                        <div>Track Points: ${incident.track.length}</div>

                        <div>
                            Last contact:
                            ${incident.lastContact
                    ? new Date(incident.lastContact).toLocaleTimeString("en-GB")
                    : "—"
                }
                            ${incident.onGround ? " · On ground" : ""}
                        </div>

                        <button onclick="viewIncidentTrack('${incident.id}')">
                            View Track
                        </button>

                        <button onclick="closeIncident('${incident.id}')">
                            Close
                        </button>

                    </div>

                `).join('')
        }

    </div>

    <div class="incident-column">

        <h3>✅ Historical Incidents (${historicalIncidentsList.length})</h3>

        ${historicalIncidentsList.length === 0
            ? '<div class="incident-empty">No historical incidents</div>'
            : historicalIncidentsList.map(incident => `

                    <div class="incident-card">

                        <div class="incident-title">
                            ✅ ${incident.description}
                        </div>

                        <div>${incident.callsign || "Unknown"}</div>

                        <div>${incident.registration || "Unknown"}</div>

                        <div>Squawk: ${incident.squawk}</div>

                        <div>Track Points: ${incident.track.length}</div>

                        <button onclick="viewIncidentTrack('${incident.id}')">
                            View Track
                        </button>

                    </div>

                `).join('')
        }

    </div>

</div>
`;

}

function viewIncidentTrack(id) {

    if (
        selectedIncidentId === id
    ) {

        clearIncidentTrack();

        selectedIncidentId = null;

        return;

    }

    selectedIncidentId = id;

    drawIncidentTrack(id);

}

function drawIncidentTrack(id, fit = true) {

    const incident =
        incidentLog.find(
            x => x.id === id
        );

    if (
        !incident ||
        !incident.track ||
        incident.track.length === 0
    ) {

        return;

    }

    clearIncidentTrack();

    const points =
        incident.track.map(
            p => [p.lat, p.lon]
        );

    incidentTrackLine =
        L.polyline(
            points,
            {
                color: "#ffd000",
                weight: 4
            }
        ).addTo(
            aircraftMap
        );

    const start =
        incident.track[0];

    const end =
        incident.track[
        incident.track.length - 1
        ];

    incidentStartMarker =
        L.circleMarker(
            [start.lat, start.lon],
            {
                radius: 8,
                color: "#00ff00",
                fillColor: "#00ff00",
                fillOpacity: 1
            }
        ).addTo(
            aircraftMap
        ).bindPopup(
            "Incident Start"
        );

    incidentEndMarker =
        L.circleMarker(
            [end.lat, end.lon],
            {
                radius: 8,
                color: "#ff0000",
                fillColor: "#ff0000",
                fillOpacity: 1
            }
        ).addTo(
            aircraftMap
        ).bindPopup(
            "Latest Position"
        );

    if (
        fit ||
        !aircraftMap.getBounds().contains(
            [end.lat, end.lon]
        )
    ) {

        aircraftMap.fitBounds(
            incidentTrackLine.getBounds(),
            {
                padding: [30, 30]
            }
        );

    }

}

function clearIncidentTrack() {

    if (incidentTrackLine) {

        aircraftMap.removeLayer(
            incidentTrackLine
        );

        incidentTrackLine = null;

    }

    if (incidentStartMarker) {

        aircraftMap.removeLayer(
            incidentStartMarker
        );

        incidentStartMarker = null;

    }

    if (incidentEndMarker) {

        aircraftMap.removeLayer(
            incidentEndMarker
        );

        incidentEndMarker = null;

    }

}

function closeIncident(id) {

    const incident =
        incidentLog.find(
            x => x.id === id
        );

    if (!incident) {
        return;
    }

    incident.status = "CLOSED";

    activeIncidents.delete(id);

    if (
        selectedIncidentId === id
    ) {

        clearIncidentTrack();

        selectedIncidentId = null;

    }

    saveIncidentLog();

    renderIncidentLog();

}

document.addEventListener(

    "DOMContentLoaded",

    () => {

        loadIncidentLog();

        renderIncidentLog();

        const btn =

            document.getElementById(

                "gps-refresh-btn"

            );

        if (btn) {

            btn.addEventListener(

                "click",

                recenterMap

            );

        }

    }

);