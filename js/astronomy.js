/* ==========================================================
   HOSAC ASTRONOMICAL INTELLIGENCE MODULE (PHASE 1+)
   ========================================================== */

let planetarium = null;
let lastAstroLat = null;
let lastAstroLon = null;
let activeAstroFilter = "all";
let selectedTargetId = null;
let astroRefreshInterval = null;
let latestIssPassSummary = null;
let lastIssFetchKey = null;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const EPHEMERIS_TARGETS = [
    {
        id: "moon",
        name: "Moon",
        body: "Moon",
        category: "planet",
        icon: "🌕",
        whereToLook: (az, alt, compass, extra) =>
            `Face ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation${extra ? ` • ${extra}` : ""}.`,
        whatToLookFor: "Lunar maria, crisp crater rims along the terminator, and current phase illumination. Binoculars bring out strong surface relief."
    },
    {
        id: "venus",
        name: "Venus",
        body: "Venus",
        category: "planet",
        icon: "✨",
        whereToLook: (az, alt, compass, extra) =>
            `Scan ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude${extra ? ` • ${extra}` : ""}.`,
        whatToLookFor: "Brilliant steady white/cream point of light—brighter than any star and without twinkling."
    },
    {
        id: "mars",
        name: "Mars",
        body: "Mars",
        category: "planet",
        icon: "🔴",
        whereToLook: (az, alt, compass, extra) =>
            `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation${extra ? ` • ${extra}` : ""}.`,
        whatToLookFor: "Distinctive warm reddish-orange hue and steady non-twinkling light."
    },
    {
        id: "jupiter",
        name: "Jupiter",
        body: "Jupiter",
        category: "planet",
        icon: "🪐",
        whereToLook: (az, alt, compass, extra) =>
            `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude${extra ? ` • ${extra}` : ""}.`,
        whatToLookFor: "Bright steady pale-gold object. Binoculars or a small telescope can reveal its four Galilean moons aligned near its equator."
    },
    {
        id: "saturn",
        name: "Saturn",
        body: "Saturn",
        category: "planet",
        icon: "💫",
        whereToLook: (az, alt, compass, extra) =>
            `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation${extra ? ` • ${extra}` : ""}.`,
        whatToLookFor: "Steady yellowish/straw-coloured star-like point; a telescope is needed to resolve its rings."
    },
    {
        id: "mercury",
        name: "Mercury",
        body: "Mercury",
        category: "planet",
        icon: "⚪",
        whereToLook: (az, alt, compass, extra) =>
            `Look low toward ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude${extra ? ` • ${extra}` : ""} shortly after sunset or before sunrise.`,
        whatToLookFor: "Compact white/cream point close to the horizon glow; best spotted with binoculars against clear twilight skies."
    }
];

const CONSTELLATION_TARGETS = [
    {
        id: "orion",
        name: "Orion",
        category: "constellation",
        icon: "🏹",
        raDeg: 83.5,
        decDeg: 2.0,
        whereToLook: (az, alt, compass) => `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude.`,
        whatToLookFor: "Three evenly spaced stars forming Orion's Belt, flanked by reddish Betelgeuse and bluish-white Rigel, with the Orion Nebula (M42) below the belt."
    },
    {
        id: "taurus",
        name: "Taurus",
        category: "constellation",
        icon: "🐂",
        raDeg: 74.0,
        decDeg: 18.5,
        whereToLook: (az, alt, compass) => `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation.`,
        whatToLookFor: "Bright orange Aldebaran at the tip of the V-shaped Hyades cluster, with the compact Pleiades (Seven Sisters) cluster nearby."
    },
    {
        id: "ursa-major",
        name: "Ursa Major / Plough",
        category: "constellation",
        icon: "🐻",
        raDeg: 165.0,
        decDeg: 56.0,
        whereToLook: (az, alt, compass) => `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude.`,
        whatToLookFor: "Seven bright stars forming the Plough / Big Dipper saucepan; follow the pointer stars (Dubhe and Merak) toward Polaris."
    },
    {
        id: "cassiopeia",
        name: "Cassiopeia",
        category: "constellation",
        icon: "👑",
        raDeg: 18.0,
        decDeg: 60.5,
        whereToLook: (az, alt, compass) => `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° altitude.`,
        whatToLookFor: "Distinctive five-star 'W' or 'M' zig-zag pattern across the Milky Way band."
    },
    {
        id: "cygnus",
        name: "Cygnus",
        category: "constellation",
        icon: "🦢",
        raDeg: 308.0,
        decDeg: 42.0,
        whereToLook: (az, alt, compass) => `Look ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation.`,
        whatToLookFor: "The Northern Cross asterism anchored by bright Deneb at the tail and Albireo at the head."
    }
];

const SATELLITE_TARGETS = [
    {
        id: "iss-live",
        name: "ISS Pass",
        category: "satellite",
        icon: "🛰️",
        raDeg: 142.0,
        decDeg: 14.0,
        whereToLook: (az, alt, compass, extra) =>
            extra
                ? `Next pass: ${extra}. Watch ${compass} (${Math.round(az)}° azimuth) around ${Math.round(alt)}° elevation.`
                : `Watch ${compass} (${Math.round(az)}° azimuth) around ${Math.round(alt)}° elevation — checking live ISS pass feed.`,
        whatToLookFor: "Fast, smooth, steady point of light gliding across stars without flashing red/green aircraft strobes. Fades when entering Earth's shadow."
    },
    {
        id: "polar-leo-band",
        name: "LEO Polar Pass Corridor",
        category: "satellite",
        icon: "📡",
        raDeg: 5.0,
        decDeg: 68.0,
        whereToLook: (az, alt, compass) =>
            `Scan ${compass} (${Math.round(az)}° azimuth) at ${Math.round(alt)}° elevation along high-inclination orbits.`,
        whatToLookFor: "Dim-to-moderate moving satellites gliding steadily across background stars with occasional brief solar glints."
    }
];

function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
}

function azToCompass8(azDeg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round(normalizeDeg(azDeg) / 45) % 8;
    return dirs[idx];
}

async function fetchIssPassForAstronomy(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (key === lastIssFetchKey && latestIssPassSummary) {
        return latestIssPassSummary;
    }

    try {
        const response = await fetch(
            `https://iss-api.polluxlabs.io/iss-pass?lat=${lat}&lon=${lon}&n=1`
        );
        const data = await response.json();

        if (data.passes && data.passes.length > 0) {
            const pass = data.passes[0];
            const riseTime = new Date(pass.rise.time);
            const riseStr = riseTime.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });
            const durMins = Math.round(pass.duration_sec / 60);
            latestIssPassSummary = `${riseStr} • ${durMins} min${durMins !== 1 ? "s" : ""}`;
        } else {
            latestIssPassSummary = "No upcoming pass in window";
        }
        lastIssFetchKey = key;
    } catch {
        latestIssPassSummary = "Pass feed unavailable";
    }

    return latestIssPassSummary;
}

/* Convert Equatorial (RA/Dec in degrees) to Horizontal (Azimuth/Altitude in degrees) */
function computeAzAltFromRaDec(raDeg, decDeg, latDeg, lonDeg, date = new Date()) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const t = (jd - 2451545.0) / 36525.0;

    let gmst =
        280.46061837 +
        360.98564736629 * (jd - 2451545.0) +
        0.000387933 * t * t -
        (t * t * t) / 38710000;
    gmst = normalizeDeg(gmst);

    const lstDeg = normalizeDeg(gmst + lonDeg);
    const haRad = normalizeDeg(lstDeg - raDeg) * DEG2RAD;
    const latRad = latDeg * DEG2RAD;
    const decRad = decDeg * DEG2RAD;

    const sinAlt =
        Math.sin(latRad) * Math.sin(decRad) +
        Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;

    const cosAzNum = Math.sin(decRad) - Math.sin(latRad) * sinAlt;
    const cosAzDen = Math.cos(latRad) * Math.cos(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
    let azDeg = Math.acos(Math.max(-1, Math.min(1, cosAzNum / (cosAzDen || 1e-9)))) * RAD2DEG;

    if (Math.sin(haRad) > 0) {
        azDeg = 360 - azDeg;
    }

    return {
        az: normalizeDeg(azDeg),
        alt: altDeg,
        visible: altDeg > 0
    };
}

function computeEphemerisBody(bodyName, lat, lon, date) {
    if (typeof Astronomy === "undefined") {
        return null;
    }

    try {
        const observer = new Astronomy.Observer(lat, lon, 0);
        const time = Astronomy.MakeTime(date);
        const equ = Astronomy.Equator(bodyName, time, observer, true, true);
        const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
        const illum = Astronomy.Illumination(bodyName, time);

        return {
            az: normalizeDeg(hor.azimuth),
            alt: hor.altitude,
            visible: hor.altitude > 0,
            mag: typeof illum.mag === "number" ? illum.mag : null
        };
    } catch (err) {
        console.log("[Astronomy] Ephemeris calculation error for", bodyName, err);
        return null;
    }
}

function getEvaluatedTargets(lat, lon) {
    const now = new Date();
    const results = [];

    for (const p of EPHEMERIS_TARGETS) {
        const eph = computeEphemerisBody(p.body, lat, lon, now);
        const coords = eph || computeAzAltFromRaDec(120, 15, lat, lon, now);
        const magText = eph && typeof eph.mag === "number" ? `mag ${eph.mag.toFixed(1)}` : "";

        results.push({
            ...p,
            az: coords.az,
            alt: coords.alt,
            visible: coords.visible,
            compass: azToCompass8(coords.az),
            extra: magText
        });
    }

    for (const c of CONSTELLATION_TARGETS) {
        const coords = computeAzAltFromRaDec(c.raDeg, c.decDeg, lat, lon, now);
        results.push({
            ...c,
            az: coords.az,
            alt: coords.alt,
            visible: coords.visible,
            compass: azToCompass8(coords.az),
            extra: ""
        });
    }

    for (const s of SATELLITE_TARGETS) {
        const coords = computeAzAltFromRaDec(s.raDeg, s.decDeg, lat, lon, now);
        const extra = s.id === "iss-live" ? (latestIssPassSummary || "") : "";
        results.push({
            ...s,
            az: coords.az,
            alt: coords.alt,
            visible: s.id === "iss-live" ? true : coords.visible,
            compass: azToCompass8(coords.az),
            extra
        });
    }

    return results;
}

function renderSkySelectorHud(lat, lon) {
    const chipsContainer = document.getElementById("astro-target-chips");
    const briefContainer = document.getElementById("astro-brief");
    if (!chipsContainer || !briefContainer) return;

    const evaluated = getEvaluatedTargets(lat, lon);

    const filteredByCat =
        activeAstroFilter === "all"
            ? evaluated
            : evaluated.filter(item => item.category === activeAstroFilter);

    const aboveHorizon = filteredByCat.filter(item => item.visible);
    const displayList = aboveHorizon.length > 0 ? aboveHorizon : filteredByCat;

    if (!selectedTargetId && displayList.length > 0) {
        selectedTargetId = displayList[0].id;
    }

    chipsContainer.innerHTML = displayList
        .map(item => {
            const isSelected = item.id === selectedTargetId;
            const statusBadge = item.visible
                ? `${Math.round(item.az)}° ${item.compass} · ${Math.max(0, Math.round(item.alt))}°`
                : `Low/Horizon (${Math.round(item.az)}° ${item.compass})`;

            return `
                <button
                    type="button"
                    class="astro-target-chip ${isSelected ? "selected" : ""} ${item.visible ? "is-visible" : "is-low"}"
                    data-target-id="${item.id}"
                >
                    <span>${item.icon} ${item.name}</span>
                    <span class="astro-chip-meta">${statusBadge}</span>
                </button>
            `;
        })
        .join("");

    chipsContainer.querySelectorAll(".astro-target-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target-id");
            const chosen = evaluated.find(t => t.id === targetId);
            if (chosen) {
                selectSkyTarget(chosen, true);
            }
        });
    });

    const currentTarget =
        evaluated.find(t => t.id === selectedTargetId) || displayList[0] || null;

    if (currentTarget) {
        selectedTargetId = currentTarget.id;
        renderObservationBrief(currentTarget);
    } else {
        briefContainer.innerHTML = `
            <div class="astro-brief-empty">No targets available for this filter.</div>
        `;
    }
}

function renderObservationBrief(target) {
    const briefContainer = document.getElementById("astro-brief");
    if (!briefContainer || !target) return;

    const horizonNote = target.visible
        ? `<span class="astro-status-up">● Above Horizon</span>`
        : `<span class="astro-status-low">○ Below/Near Horizon</span>`;

    briefContainer.innerHTML = `
        <div class="astro-brief-header">
            <strong>${target.icon} ${target.name}</strong>
            <span>${horizonNote}</span>
        </div>
        <div class="astro-brief-grid">
            <div><strong>Where to Look:</strong> ${target.whereToLook(target.az, target.alt, target.compass, target.extra)}</div>
            <div><strong>What to Look For:</strong> ${target.whatToLookFor}</div>
        </div>
    `;
}

function slewPlanetariumToTarget(target) {
    if (!planetarium || !target) return;

    const targetAz = normalizeDeg(target.az);
    const targetAlt = Math.max(5, Math.min(80, target.alt));

    try {
        if (typeof planetarium.setAz === "function") {
            planetarium.setAz(targetAz);
        } else {
            planetarium.az = targetAz;
            if (typeof planetarium.draw === "function") {
                planetarium.draw();
            }
        }

        if (typeof planetarium.setEl === "function") {
            planetarium.setEl(targetAlt);
        }
    } catch (err) {
        console.log("[Astronomy] Slew adjustment fallback:", err);
    }
}

function selectSkyTarget(target, shouldSlew = false) {
    selectedTargetId = target.id;
    if (typeof currentLat === "number" && typeof currentLon === "number") {
        renderSkySelectorHud(currentLat, currentLon);
    } else {
        renderObservationBrief(target);
    }
    if (shouldSlew) {
        slewPlanetariumToTarget(target);
    }
}

function bindAstroHudEvents() {
    const hud = document.getElementById("astronomy-hud");
    if (!hud || hud.dataset.bound === "true") return;
    hud.dataset.bound = "true";

    hud.querySelectorAll(".astro-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            activeAstroFilter = btn.getAttribute("data-filter") || "all";
            selectedTargetId = null;

            hud.querySelectorAll(".astro-filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            if (typeof currentLat === "number" && typeof currentLon === "number") {
                renderSkySelectorHud(currentLat, currentLon);
            }
        });
    });

    const resetBtn = document.getElementById("astro-reset-view-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (planetarium && typeof planetarium.setAz === "function") {
                planetarium.setAz(180);
            }
        });
    }
}

function initOrUpdateAstronomy(lat, lon) {
    if (
        typeof lat !== "number" ||
        typeof lon !== "number" ||
        Number.isNaN(lat) ||
        Number.isNaN(lon)
    ) {
        return;
    }

    bindAstroHudEvents();

    const container = document.getElementById("astronomy-container");
    const starmapEl = document.getElementById("starmap");
    const coordsLabel = document.getElementById("astro-coords");

    if (!container || !starmapEl) {
        return;
    }

    if (coordsLabel) {
        coordsLabel.textContent = `LAT: ${lat.toFixed(4)}° | LON: ${lon.toFixed(4)}°`;
    }

    if (container.style.display === "none") {
        return;
    }

    fetchIssPassForAstronomy(lat, lon).then(() => {
        if (document.body.classList.contains("night-mode")) {
            renderSkySelectorHud(lat, lon);
        }
    });

    renderSkySelectorHud(lat, lon);

    if (typeof S === "undefined" || typeof S.virtualsky !== "function") {
        console.warn("[Astronomy] VirtualSky library not yet loaded.");
        return;
    }

    if (
        planetarium &&
        lastAstroLat !== null &&
        Math.abs(lat - lastAstroLat) < 0.0001 &&
        Math.abs(lon - lastAstroLon) < 0.0001
    ) {
        return;
    }

    lastAstroLat = lat;
    lastAstroLon = lon;

    starmapEl.innerHTML = "";

    planetarium = S.virtualsky({
        id: "starmap",
        projection: "stereo",
        latitude: lat,
        longitude: lon,
        clock: new Date(),
        live: true,
        constellations: true,
        constellationlabels: true,
        constellationboundaries: false,
        showstars: true,
        showstarlabels: true,
        showplanets: true,
        showplanetlabels: true,
        showmoon: true,
        showsun: false,
        cardinalpoints: true,
        ground: true,
        az: 180,
        gridlines_az: true,
        gridlines_eq: false,
        showdate: true,
        showposition: false,
        fontsize: "12px",
        colour: "#ff4d4d"
    });

    if (!astroRefreshInterval) {
        astroRefreshInterval = setInterval(() => {
            if (
                document.body.classList.contains("night-mode") &&
                typeof currentLat === "number" &&
                typeof currentLon === "number"
            ) {
                renderSkySelectorHud(currentLat, currentLon);
            }
        }, 30000);
    }
}

function resizeAstronomyMap() {
    if (
        document.body.classList.contains("night-mode") &&
        typeof currentLat === "number" &&
        typeof currentLon === "number"
    ) {
        lastAstroLat = null;
        lastAstroLon = null;
        initOrUpdateAstronomy(currentLat, currentLon);
    }
}

window.addEventListener("resize", resizeAstronomyMap);