/* ==========================================================
   HOSAC ASTRONOMICAL INTELLIGENCE MODULE (PHASE 1+)
   ========================================================== */

let planetarium = null;
let lastAstroLat = null;
let lastAstroLon = null;
let activeAstroFilter = "all";
let astroView = "dome";          // "dome" (all-sky) or "horizon" (panoramic)
let latestEvaluated = [];
let applyViewRetries = 0;
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
        const j2000 = Astronomy.Equator(bodyName, time, observer, false, true);
        const illum = Astronomy.Illumination(bodyName, time);

        return {
            az: normalizeDeg(hor.azimuth),
            alt: hor.altitude,
            visible: hor.altitude > 0,
            raDeg: j2000.ra * 15,
            decDeg: j2000.dec,
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
            extra: magText,
            raDeg: eph ? eph.raDeg : undefined,
            decDeg: eph ? eph.decDeg : undefined
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

    latestEvaluated = evaluated;

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

    const currentTarget = evaluated.find(t => t.id === selectedTargetId) || null;

    if (currentTarget) {
        renderObservationBrief(currentTarget);
        briefContainer.classList.add("has-target");
    } else {
        selectedTargetId = null;
        briefContainer.classList.remove("has-target");
        briefContainer.innerHTML = "";
    }

    updateSkyNote();
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
            <span>${horizonNote} <button type="button" class="astro-brief-close" title="Show all">✕</button></span>
        </div>
        <div class="astro-brief-grid">
            <div><strong>Where to Look:</strong> ${target.whereToLook(target.az, target.alt, target.compass, target.extra)}</div>
            <div><strong>What to Look For:</strong> ${target.whatToLookFor}</div>
        </div>
    `;
}

function slewPlanetariumToTarget(target) {
    // VirtualSky has no setAz(): azimuth is the az_off property (az option - 180).
    if (!planetarium || !target || astroView !== "horizon") return;

    planetarium.az_off = normalizeDeg(target.az) - 180;
    planetarium.draw();
}

const CONSTELLATION_ABBR = {
    "orion": "Ori",
    "taurus": "Tau",
    "ursa-major": "UMa",
    "cassiopeia": "Cas",
    "cygnus": "Cyg"
};

// Show only what the current filter / selection asks for.
function applySkyView() {
    const vs = planetarium;
    if (!vs || !vs.constellation) return;

    const sel = latestEvaluated.find(t => t.id === selectedTargetId) || null;

    let stars = false;
    let planets = false;
    let lines = false;

    if (sel) {
        lines = sel.category === "constellation";
    } else if (activeAstroFilter === "all") {
        stars = planets = lines = true;
    } else if (activeAstroFilter === "planet") {
        planets = true;
    } else if (activeAstroFilter === "constellation") {
        lines = true;
    }

    vs.showstars = stars;
    vs.showstarlabels = stars;
    vs.showplanets = planets;
    vs.showplanetlabels = planets;
    vs.constellation.lines = lines;
    vs.constellation.labels = lines;

    // Keep a copy of the full constellation list so we can narrow it to one
    if (!vs._allLines && Array.isArray(vs.lines)) {
        vs._allLines = vs.lines;
    }

    if (vs._allLines) {
        vs.lines =
            sel && sel.category === "constellation"
                ? vs._allLines.filter(l => l[0] === CONSTELLATION_ABBR[sel.id])
                : vs._allLines;
        applyViewRetries = 0;
    } else if (lines && applyViewRetries < 10) {
        // constellation data still downloading; try again shortly
        applyViewRetries++;
        setTimeout(applySkyView, 500);
    }

    // Single marker for a selected planet / Moon
    vs.pointers = [];
    if (
        sel &&
        sel.category === "planet" &&
        Number.isFinite(sel.raDeg) &&
        Number.isFinite(sel.decDeg)
    ) {
        vs.addPointer({
            ra: sel.raDeg,
            dec: sel.decDeg,
            label: sel.name,
            colour: "#ffd000",
            d: 10,
            html: ""
        });
    }

    vs.draw();
}

function updateSkyNote() {
    const stage = document.getElementById("starmap-stage");
    if (!stage) return;

    let note = document.getElementById("astro-map-note");
    if (!note) {
        note = document.createElement("div");
        note.id = "astro-map-note";
        stage.appendChild(note);
    }

    const sel = latestEvaluated.find(t => t.id === selectedTargetId) || null;
    const satelliteView =
        (sel && sel.category === "satellite") ||
        (!sel && activeAstroFilter === "satellite");

    note.textContent = satelliteView
        ? "Satellites move too fast to plot here - see the pass details in the info panel"
        : "";
    note.style.display = satelliteView ? "block" : "none";
}

function selectSkyTarget(target, shouldSlew = false) {
    // Tapping the selected item again goes back to showing the whole category
    selectedTargetId = selectedTargetId === target.id ? null : target.id;

    if (typeof currentLat === "number" && typeof currentLon === "number") {
        renderSkySelectorHud(currentLat, currentLon);
    }

    applySkyView();

    if (shouldSlew && selectedTargetId) {
        slewPlanetariumToTarget(target);
    }
}

function setAstroView(view) {
    astroView = view === "horizon" ? "horizon" : "dome";

    const btn = document.getElementById("astro-view-btn");
    if (btn) {
        btn.textContent = astroView === "dome" ? "🌐 Dome view" : "🏞️ Horizon view";
    }

    if (planetarium && typeof planetarium.selectProjection === "function") {
        planetarium.selectProjection(astroView === "dome" ? "polar" : "stereo");
        planetarium.az_off = 0;
        planetarium.draw();
    }
}

function bindAstroHudEvents() {
    const hud = document.getElementById("astronomy-hud");
    if (!hud || hud.dataset.bound === "true") return;
    hud.dataset.bound = "true";

    // View toggle button (added here so index.html needs no change)
    const bar = document.getElementById("astro-filter-bar");
    if (bar && !document.getElementById("astro-view-btn")) {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.id = "astro-view-btn";
        viewBtn.className = "astro-filter-btn";
        viewBtn.textContent = "🌐 Dome view";
        viewBtn.addEventListener("click", () => {
            setAstroView(astroView === "dome" ? "horizon" : "dome");
        });
        bar.appendChild(viewBtn);
    }

    hud.querySelectorAll("button[data-filter]").forEach(btn => {
        btn.addEventListener("click", () => {
            activeAstroFilter = btn.getAttribute("data-filter") || "all";
            selectedTargetId = null;

            hud.querySelectorAll("button[data-filter]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            if (typeof currentLat === "number" && typeof currentLon === "number") {
                renderSkySelectorHud(currentLat, currentLon);
            }

            applySkyView();
        });
    });

    const resetBtn = document.getElementById("astro-reset-view-btn");
    if (resetBtn) {
        resetBtn.textContent = "🧭 Reset view";
        resetBtn.addEventListener("click", () => {
            selectedTargetId = null;
            if (typeof currentLat === "number" && typeof currentLon === "number") {
                renderSkySelectorHud(currentLat, currentLon);
            }
            if (planetarium) {
                planetarium.az_off = 0;
            }
            applySkyView();
        });
    }

    // Close button inside the info card (delegated, as the card is re-rendered)
    document.addEventListener("click", e => {
        if (e.target && e.target.classList && e.target.classList.contains("astro-brief-close")) {
            selectedTargetId = null;
            if (typeof currentLat === "number" && typeof currentLon === "number") {
                renderSkySelectorHud(currentLat, currentLon);
            }
            applySkyView();
        }
    });
}

let astroInitRetries = 0;
let starmapObserver = null;
let starmapResizeTimer = null;

// Keep the planetarium canvas matched to its container when the layout
// changes (e.g. the observation brief grows or shrinks under the map).
function watchStarmapSize(el) {
    if (starmapObserver || typeof ResizeObserver === "undefined" || !el) {
        return;
    }

    starmapObserver = new ResizeObserver(() => {
        clearTimeout(starmapResizeTimer);
        starmapResizeTimer = setTimeout(() => {
            if (
                planetarium &&
                typeof planetarium.resize === "function" &&
                el.clientWidth > 0 &&
                el.clientHeight > 0
            ) {
                planetarium.resize();
            }
        }, 150);
    });

    starmapObserver.observe(el);
}

// Wrap the map in a stage so the info card can sit on top of it, and so the
// map can fill all the space the controls don't use.
function ensureStarmapStage() {
    let stage = document.getElementById("starmap-stage");
    if (stage) return stage;

    const el = document.getElementById("starmap");
    if (!el || !el.parentNode) return null;

    stage = document.createElement("div");
    stage.id = "starmap-stage";
    el.parentNode.insertBefore(stage, el);
    stage.appendChild(el);

    const brief = document.getElementById("astro-brief");
    if (brief) {
        stage.appendChild(brief);
    }

    return stage;
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
    ensureStarmapStage();

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

    // Wait until the map area actually has a size, otherwise VirtualSky
    // initialises a zero-sized canvas and nothing is ever drawn.
    if (starmapEl.clientWidth < 50 || starmapEl.clientHeight < 50) {
        if (astroInitRetries < 10) {
            astroInitRetries++;
            setTimeout(() => initOrUpdateAstronomy(lat, lon), 300);
        }
        return;
    }

    astroInitRetries = 0;

    lastAstroLat = lat;
    lastAstroLon = lon;

    starmapEl.innerHTML = "";

    planetarium = S.virtualsky({
        id: "starmap",
        projection: astroView === "dome" ? "polar" : "stereo",
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

    watchStarmapSize(starmapEl);
    applySkyView();
    updateSkyNote();

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