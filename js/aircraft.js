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

/* ------------------------------------------------------------------
   Aircraft photo lookup & cache (Planespotters)
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
                        photographer: p.photographer || null
                    };
                    aircraftPhotoCache.set(cacheKey, result);
                    return result;
                }
            }
        } catch (err) {
            console.log("[Planespotters] Photo lookup error:", err);
        }
    }

    const notFound = {
        found: false,
        imageUrl: null,
        pageUrl: getPlanespottersSearchUrl(ac),
        photographer: null
    };
    aircraftPhotoCache.set(cacheKey, notFound);
    return notFound;
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
                    <span>${photoData.photographer ? `📷 ${photoData.photographer}` : "Planespotters.net"}</span>
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

    return `
        <div style="min-width:210px;max-width:250px;">
            <b>${ac.flight || ac.hex}</b><br>

            Registration:
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
   Full-screen aircraft card (split-flap style)
   Opens when an aircraft marker is clicked. Self-contained: injects
   its own CSS and DOM. Live-updates while open.
   ------------------------------------------------------------------ */

const ACX_AIRLINES = {
    BAW: "British Airways", SHT: "British Airways Shuttle", EZY: "easyJet", EJU: "easyJet Europe",
    RYR: "Ryanair", RUK: "Ryanair UK", VIR: "Virgin Atlantic", TOM: "TUI Airways", TUI: "TUI",
    EXS: "Jet2", JBU: "JetBlue", UAL: "United Airlines", AAL: "American Airlines",
    DAL: "Delta Air Lines", ACA: "Air Canada", WJA: "WestJet", KLM: "KLM", AFR: "Air France",
    DLH: "Lufthansa", SWR: "Swiss", AUA: "Austrian", BEL: "Brussels Airlines", EIN: "Aer Lingus",
    EWG: "Eurowings", UAE: "Emirates", QTR: "Qatar Airways", ETD: "Etihad", THY: "Turkish Airlines",
    SAS: "SAS", FIN: "Finnair", IBE: "Iberia", VLG: "Vueling", TAP: "TAP Air Portugal",
    WZZ: "Wizz Air", NOZ: "Norwegian", NAX: "Norwegian", ELY: "El Al", SIA: "Singapore Airlines",
    CPA: "Cathay Pacific", ANA: "All Nippon Airways", JAL: "Japan Airlines", QFA: "Qantas",
    ETH: "Ethiopian Airlines", SAA: "South African Airways", MSR: "EgyptAir", RAM: "Royal Air Maroc",
    VOE: "Volotea", LOG: "Loganair", BCS: "European Air Charter", FDX: "FedEx", UPS: "UPS Airlines",
    DHK: "DHL Air UK", GEC: "Lufthansa Cargo", CLX: "Cargolux", ICE: "Icelandair", AIC: "Air India",
    PIA: "Pakistan International", KAL: "Korean Air", AAR: "Asiana", CCA: "Air China",
    CSN: "China Southern", CES: "China Eastern", RJA: "Royal Jordanian", LOT: "LOT Polish",
    CFE: "BA CityFlyer", EAF: "Eastern Airways", AEE: "Aegean", LDM: "Laudamotion"
};

const acxRouteCache = new Map();
let acxOpenId = null;
let acxState = { photo: null, route: undefined, photoDone: false, routeDone: false };
let acxClockTimer = null;

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
    const cs = (ac.flight || "").trim().toUpperCase();
    const prefix = cs.slice(0, 3);
    if (/^[A-Z]{3}\d/.test(cs) && ACX_AIRLINES[prefix]) return ACX_AIRLINES[prefix];
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
    const callsign = (ac.flight || "").trim().toUpperCase();
    if (!/^[A-Z]{3}[0-9]{1,4}[A-Z]{0,2}$/.test(callsign)) return null;
    if (acxRouteCache.has(callsign)) return acxRouteCache.get(callsign);

    let result = null;
    let networkOk = false;

    // 1) adsb.lol route set
    try {
        const r = await fetch("https://api.adsb.lol/api/0/routeset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planes: [{ callsign, lat: ac.lat, lng: ac.lon }] })
        });
        if (r.ok) {
            networkOk = true;
            const d = await r.json();
            const e = Array.isArray(d) ? d[0] : null;
            const a = e && Array.isArray(e._airports) ? e._airports : [];
            if (a.length >= 2 && e.plausible !== false) {
                const o = a[0], x = a[a.length - 1];
                result = {
                    from: { code: o.iata || o.icao, name: o.location || o.name },
                    to: { code: x.iata || x.icao, name: x.location || x.name }
                };
            }
        }
    } catch (err) {
        console.log("[Card] adsb.lol route error:", err);
    }

    // 2) hexdb.io fallback
    if (!result) {
        try {
            const r = await fetch(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(callsign)}`);
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
                }
            }
        } catch (err) {
            console.log("[Card] hexdb route error:", err);
        }
    }

    if (result || networkOk) acxRouteCache.set(callsign, result);
    return result;
}

const ACX_HELI_CAPTIONS = {
    // Typically air ambulance / police in the UK
    EC35: "Air ambulance / police helicopter", EC45: "Air ambulance / police helicopter",
    EC30: "Air ambulance / police helicopter", H135: "Air ambulance / police helicopter",
    H145: "Air ambulance / police helicopter", MBH5: "Air ambulance / police helicopter",
    BK17: "Air ambulance / police helicopter", A109: "Air ambulance / executive helicopter",
    A119: "Air ambulance / executive helicopter", B105: "Air ambulance / police helicopter",
    // Search and rescue / offshore
    S92: "Search & rescue / offshore helicopter", S61: "Search & rescue helicopter",
    S61R: "Search & rescue helicopter", AS32: "Search & rescue / offshore helicopter",
    AS3B: "Search & rescue / offshore helicopter", A139: "Search & rescue / offshore helicopter",
    EC75: "Offshore / rescue helicopter",
    // Training / light
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
    const airlineStyle = /^[A-Z]{3}[0-9]{1,4}[A-Z]{0,2}$/.test(callsign);

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
        flex-direction:column;padding:2.2vh 3.2vw;box-sizing:border-box;overflow:hidden;
        font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
    #acx-overlay.open{display:flex}
    #acx-overlay .acx-top{display:flex;justify-content:space-between;align-items:center;font-size:clamp(12px,1.6vw,18px);color:#555}
    #acx-overlay .acx-top .acx-right{display:flex;align-items:center;gap:16px}
    #acx-overlay .acx-close{border:0;background:#111;color:#fff;width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer}
    .acx-fl{display:inline-flex;gap:.07em;vertical-align:middle}
    .acx-fl i{font-style:normal;background:#1b1b1b;color:#f4f4f4;font-weight:700;padding:0 .13em;border-radius:.1em;
        position:relative;line-height:1.18;min-width:.42em;text-align:center;display:inline-block;transform-origin:50% 50%}
    .acx-fl i::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(0,0,0,.75)}
    .acx-fl i.flip{animation:acxflip .45s ease-out both}
    @keyframes acxflip{0%{transform:scaleY(.05)}60%{transform:scaleY(1.06)}100%{transform:scaleY(1)}}
    .acx-big{font-size:clamp(48px,11vh,120px)}
    .acx-med{font-size:clamp(28px,5.2vh,56px)}
    .acx-stat{font-size:clamp(26px,5.4vh,56px)}
    #acx-overlay .acx-row{display:flex;align-items:center;gap:2.2vw;margin-top:1.6vh}
    #acx-overlay .acx-arrow{font-size:clamp(28px,6vh,60px);line-height:1}
    #acx-overlay .acx-names{display:flex;gap:2.2vw;font-weight:700;font-size:clamp(14px,2.4vh,26px);margin-top:.8vh}
    #acx-overlay .acx-id{display:flex;align-items:center;gap:1.6vw;margin-top:1.6vh;font-size:clamp(13px,2.2vh,22px)}
    #acx-overlay .acx-badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:1vh}
    #acx-overlay .acx-badge{padding:4px 12px;border-radius:999px;font-size:clamp(12px,1.9vh,18px);font-weight:700;background:#ddd}
    #acx-overlay .acx-badge.mil{background:#2f4f2f;color:#fff}
    #acx-overlay .acx-badge.emg{background:#c0182c;color:#fff}
    #acx-overlay .acx-badge.gone{background:#555;color:#fff}
    #acx-overlay .acx-photo{flex:1;min-height:0;margin:1.6vh 0;display:flex;align-items:center;justify-content:center;
        position:relative;border-radius:12px;background:#ebebe7;overflow:hidden}
    #acx-overlay .acx-photo img{max-width:100%;max-height:100%;object-fit:contain;display:block}
    #acx-overlay .acx-photo svg{width:70%;height:70%;color:#2a3b57;opacity:.85}
    #acx-overlay .acx-credit{position:absolute;left:10px;bottom:8px;font-size:12px;background:rgba(255,255,255,.8);padding:2px 8px;border-radius:6px}
    #acx-overlay .acx-note{position:absolute;right:10px;bottom:8px;font-size:12px;background:rgba(255,255,255,.8);padding:2px 8px;border-radius:6px;color:#444}
    #acx-overlay .acx-stats{display:flex;align-items:center;gap:2.2vw;flex-wrap:wrap}
    #acx-overlay .acx-unit{font-size:clamp(13px,2.2vh,22px);color:#555}
    #acx-overlay .acx-compass{display:flex;align-items:center;gap:8px;margin-left:auto;font-weight:700;font-size:clamp(16px,3vh,30px)}
    #acx-overlay .acx-compass svg{width:clamp(44px,8vh,80px);height:clamp(44px,8vh,80px)}
    #acx-overlay .acx-btn{align-self:flex-start;margin-top:1.6vh;background:#0b57d0;color:#fff;text-decoration:none;
        padding:12px 22px;border-radius:999px;font-weight:700;font-size:clamp(14px,2.2vh,20px)}
    #acx-overlay .acx-actions{display:flex;gap:12px;flex-wrap:wrap}
    #acx-overlay .acx-track{background:#111;border:0;cursor:pointer;font-family:inherit}
    #acx-overlay .acx-track.on{background:#c0182c}
    #acx-trackbar{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;
        gap:12px;background:rgba(17,24,39,.94);color:#fff;border:1px solid #00e5ff;border-radius:999px;padding:6px 8px 6px 16px;
        font-size:14px;max-width:94%;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.5)}
    #acx-trackbar .acx-tb-text{overflow:hidden;text-overflow:ellipsis}
    #acx-trackbar .acx-tb-lost{color:#fbbf24;font-weight:700}
    #acx-trackbar button{background:#c0182c;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:14px}
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
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeAircraftCard(); });
    return el;
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
        box.innerHTML = `<a href="${acxEsc(p.pageUrl)}" target="_blank" rel="noopener noreferrer" style="display:contents">
            <img src="${acxEsc(p.imageUrl)}" alt="${acxEsc(ac.flight || ac.r || "Aircraft")}"></a>
            <span class="acx-credit">${p.photographer ? "📷 " + acxEsc(p.photographer) + " · " : ""}Planespotters.net</span>`;
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

    // Route / identity
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

    const airline = acxAirlineName(ac);
    const type = ac.desc ? acxTitleCase(ac.desc).replace(/\bBoeing\b/, "Boeing") : (ac.t || "");
    const desc = [airline, type, reg].filter(Boolean).join(", ");
    document.getElementById("acx-desc").textContent = desc || (ac.hex ? "ICAO " + String(ac.hex).toUpperCase() : "");

    // Badges
    const badges = [];
    if (typeof isMilitary === "function" && isMilitary(ac)) badges.push(`<span class="acx-badge mil">Military</span>`);
    if (typeof isEmergency === "function" && isEmergency(ac)) {
        badges.push(`<span class="acx-badge emg">🚨 ${acxEsc(getEmergencyDescription(ac.squawk) || "Emergency")} · ${acxEsc(ac.squawk)}</span>`);
    } else if (ac.squawk) {
        badges.push(`<span class="acx-badge">Squawk ${acxEsc(ac.squawk)}</span>`);
    }
    if (gone) badges.push(`<span class="acx-badge gone">Out of range — last known position</span>`);
    document.getElementById("acx-badges").innerHTML = badges.join("");

    // Stats
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
}

function acxTickClock() {
    const el = document.getElementById("acx-live");
    if (!el) return;
    const d = new Date();
    el.textContent = "Live " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

async function openAircraftCard(id) {
    const meta = aircraftMetaCache.get(id);
    if (!meta) return;
    const el = acxEnsureOverlay();

    // Reset state for a new aircraft
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
    }).catch(() => { acxState.routeDone = true; });
}

function closeAircraftCard() {
    const el = document.getElementById("acx-overlay");
    if (el) el.classList.remove("open");
    acxOpenId = null;
    clearInterval(acxClockTimer);
}

async function handleMarkerClick(id, marker) {
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

        // Don't pull the map back home while following an aircraft
        if (acxTrackedId === null) {
            aircraftMap.setView(
                [lat, lon],
                9
            );
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

        // RAF
        "RRR",
        "ASCOT",

        // USAF
        "RCH",
        "REACH",
        "QID",

        // NATO
        "NATO",

        // Canadian
        "CFC",

        // Common military callsigns
        "SHELL",
        "TARTN",
        "JAKE",
        "CNV",
        "HERKY",
        "SPAR",
        "GHOST",
        "LAGR",
        "VENUS",
        "ROGUE",
        "BLACKJACK",

        "AME",
        "DUKE",
        "SHF",
        "BAF",

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

    // UK / NATO military
    "EH10", "LYNX", "A159", "AW159", "H47", "H64", "H60", "H53", "H1",
    "S61", "S61R", "S58T", "S64", "S65", "PUMA", "GAZL", "LAMA",
    "ALO2", "ALO3", "TIGR", "NH90", "UH1", "HUEY", "V22",
    "AS32", "AS3B", "AS65", "AS55", "AS50", "AS53",

    // Civil / emergency services
    "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "EC75", "EC60",
    "A109", "A119", "A139", "A149", "A169", "A189",
    "S76", "S92", "S70", "S300", "S333",
    "B06", "B06T", "B105", "B212", "B222", "B230", "B407", "B412",
    "B427", "B429", "B430", "B505", "B47G", "B47J", "B47T",
    "R22", "R44", "R66", "EN28", "EN48", "H269", "H500", "HUCO",
    "MD52", "MD60", "EXPL", "NOTR", "BK17", "G2CA", "KMAX",

    // Russian / other
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

    const colour =
        emergency
            ? "#ffc107"
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

            if (isEmergency(ac)) {

                emergencyCount++;

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

    } catch (err) {

        console.error(
            "Aircraft load failed",
            err
        );

    } finally {

        loadingAircraft = false;

    }

}

function recenterMap() {

    stopAircraftTracking(false);

    const btn =
        document.getElementById(
            "gps-refresh-btn"
        );

    const BTN_LABEL = "📍 Re-Centre";

    const setBtn = (text, disabled) => {
        if (!btn) return;
        btn.textContent = text;
        btn.disabled = !!disabled;
    };

    // Move every map and panel to a position. Works the same in day and
    // night mode (the aircraft map just lives in a different panel).
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

    // 1) Instant response: recentre on the last known position straight away
    if (
        Number.isFinite(currentLat) &&
        Number.isFinite(currentLon)
    ) {
        applyPosition(currentLat, currentLon);
    }

    if (!navigator.geolocation) {
        return;
    }

    // 2) Then refresh the GPS fix and recentre again if it has moved
    setBtn("📍 Locating…", true);

    navigator.geolocation.getCurrentPosition(

        position => {

            applyPosition(
                position.coords.latitude,
                position.coords.longitude
            );

            setBtn(BTN_LABEL, false);

        },

        error => {

            console.error(
                "GPS refresh failed",
                error
            );

            setBtn("⚠ No GPS fix", false);

            setTimeout(
                () => setBtn(BTN_LABEL, false),
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