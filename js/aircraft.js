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

async function handleMarkerClick(id, marker) {
    const meta = aircraftMetaCache.get(id);
    if (!meta) return;

    const { ac, actualDistance, isActiveIncident } = meta;
    const hex = ac.hex ? String(ac.hex).trim().toLowerCase() : "";
    const reg = ac.r ? String(ac.r).trim().toUpperCase() : "";
    const cacheKey = `${hex}|${reg}`;

    if (aircraftPhotoCache.has(cacheKey)) {
        const cached = aircraftPhotoCache.get(cacheKey);
        marker.setPopupContent(
            buildPopupHtml(ac, actualDistance, isActiveIncident, "loaded", cached)
        );
        return;
    }

    marker.setPopupContent(
        buildPopupHtml(ac, actualDistance, isActiveIncident, "loading", null)
    );

    const photoData = await fetchAircraftPhoto(ac);
    const latestMeta = aircraftMetaCache.get(id) || meta;

    marker.setPopupContent(
        buildPopupHtml(
            latestMeta.ac,
            latestMeta.actualDistance,
            latestMeta.isActiveIncident,
            "loaded",
            photoData
        )
    );
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
        applyMarkerHeading(id, anim.marker, heading);

        if (rawT >= 1) {
            anim.marker.setLatLng([anim.toLat, anim.toLon]);
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

        aircraftMap.setView(
            [lat, lon],
            9
        );

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
                !isActiveIncident
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
                        )
                        .bindPopup(
                            popup
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
                    activeIncidents.has(id)
                ) {

                    aircraftAnimations.delete(id);
                    marker.setOpacity(0.45);

                    return;

                }

                aircraftAnimations.delete(id);
                aircraftHeadingState.delete(id);
                aircraftMetaCache.delete(id);
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

    navigator.geolocation.getCurrentPosition(

        position => {

            currentLat =
                position.coords.latitude;

            currentLon =
                position.coords.longitude;

            aircraftMap.setView(
                [
                    currentLat,
                    currentLon
                ],
                9
            );

            if (aircraftRadiusCircle) {

                aircraftRadiusCircle.setLatLng([
                    currentLat,
                    currentLon
                ]);

            }

            if (homeMarker) {

                homeMarker.setLatLng([
                    currentLat,
                    currentLon
                ]);

            }

            if (typeof initOrUpdateAstronomy === "function") {
                initOrUpdateAstronomy(currentLat, currentLon);
            }

            loadAircraft();

        },

        error => {

            console.error(
                "GPS refresh failed",
                error
            );

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