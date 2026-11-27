/* ==========================================================
   HOSAC ASTRONOMICAL INTELLIGENCE MODULE (PHASE 1)
   ========================================================== */

let planetarium = null;
let lastAstroLat = null;
let lastAstroLon = null;
let activeAstroFilter = "all";
let astroView = "dome"; // "dome" (all-sky) or "horizon" (panoramic)
let latestEvaluated = [];
let applyViewRetries = 0;
let selectedTargetId = null;
let astroRefreshInterval = null;
let globeAnimFrameId = null;
let globeRotationLon = 0;
let astronomyEntered = false;

let globeIsDragging = false;
let globeDragLastX = 0;
let globeDragLastY = 0;
let globePitchDeg = 22;
let globeAutoSpin = true;

const EARTH_TEXTURE_URL =
    "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_atmos_2048.jpg";

let earthPhotoCanvas = null;
let earthPhotoReady = false;
let earthPhotoLoading = false;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const EPHEMERIS_TARGETS = [
    {
        id: "moon",
        name: "Moon",
        body: "Moon",
        category: "planet",
        icon: "🌕",
        image: "images/astronomy/planets/moon.jpg",
        bestViewing: "Evening / Night sky",
        whatToLookFor: "Crisp crater rims along the terminator and lunar maria",
        observationNotes: "Binoculars bring out strong surface relief along the terminator."
    },
    {
        id: "venus",
        name: "Venus",
        body: "Venus",
        category: "planet",
        icon: "✨",
        image: "images/astronomy/planets/venus.jpg",
        bestViewing: "Twilight / Early evening",
        whatToLookFor: "Brilliant steady white/cream point without twinkling",
        observationNotes: "Brighter than any star; phases visible in binoculars or a small scope."
    },
    {
        id: "mars",
        name: "Mars",
        body: "Mars",
        category: "planet",
        icon: "🔴",
        image: "images/astronomy/planets/mars.jpg",
        bestViewing: "Evening / Night sky",
        whatToLookFor: "Distinctive warm reddish-orange hue and steady light",
        observationNotes: "Does not twinkle like background stars; compare colour against nearby stars."
    },
    {
        id: "jupiter",
        name: "Jupiter",
        body: "Jupiter",
        category: "planet",
        icon: "🪐",
        image: "images/astronomy/planets/jupiter.jpg",
        bestViewing: "Night sky",
        whatToLookFor: "Bright cream-coloured object",
        observationNotes: "Galilean moons visible with binoculars; cloud bands resolve in a small telescope."
    },
    {
        id: "saturn",
        name: "Saturn",
        body: "Saturn",
        category: "planet",
        icon: "💫",
        image: "images/astronomy/planets/saturn.jpg",
        bestViewing: "Evening / Night sky",
        whatToLookFor: "Steady yellowish/straw-coloured star-like point",
        observationNotes: "A telescope is needed to resolve Saturn's ring system."
    },
    {
        id: "mercury",
        name: "Mercury",
        body: "Mercury",
        category: "planet",
        icon: "⚪",
        image: "images/astronomy/planets/mercury.jpg",
        bestViewing: "Low twilight window",
        whatToLookFor: "Compact white/cream point low near the horizon glow",
        observationNotes: "Best spotted shortly after sunset or before sunrise using binoculars."
    }
];

const CONSTELLATION_TARGETS = [
    {
        id: "orion",
        name: "Orion",
        category: "constellation",
        icon: "🏹",
        image: "images/astronomy/constellations/orion.jpg",
        raDeg: 83.5,
        decDeg: 2.0,
        visibleFeatures: "Betelgeuse, Rigel, Orion Nebula",
        bestViewing: "20:00–02:00",
        whatToLookFor: "Three bright stars forming Orion's Belt"
    },
    {
        id: "taurus",
        name: "Taurus",
        category: "constellation",
        icon: "🐂",
        image: "images/astronomy/constellations/taurus.jpg",
        raDeg: 74.0,
        decDeg: 18.5,
        visibleFeatures: "Aldebaran, Hyades, Pleiades",
        bestViewing: "19:30–02:30",
        whatToLookFor: "Orange Aldebaran at the V-shaped Hyades cluster with the Pleiades nearby"
    },
    {
        id: "ursa-major",
        name: "Ursa Major / Plough",
        category: "constellation",
        icon: "🐻",
        image: "images/astronomy/constellations/ursa-major.jpg",
        raDeg: 165.0,
        decDeg: 56.0,
        visibleFeatures: "The Plough, Dubhe & Merak pointers, Mizar & Alcor",
        bestViewing: "All night (circumpolar)",
        whatToLookFor: "Seven bright saucepan stars; follow the pointer stars toward Polaris"
    },
    {
        id: "cassiopeia",
        name: "Cassiopeia",
        category: "constellation",
        icon: "👑",
        image: "images/astronomy/constellations/cassiopeia.jpg",
        raDeg: 18.0,
        decDeg: 60.5,
        visibleFeatures: "Five-star 'W' asterism, Milky Way band, Double Cluster",
        bestViewing: "All night (circumpolar)",
        whatToLookFor: "Distinctive five-star 'W' or 'M' zig-zag pattern across the sky"
    },
    {
        id: "cygnus",
        name: "Cygnus",
        category: "constellation",
        icon: "🦢",
        image: "images/astronomy/constellations/cygnus.jpg",
        raDeg: 308.0,
        decDeg: 42.0,
        visibleFeatures: "Deneb, Albireo, Northern Cross",
        bestViewing: "18:00–23:00",
        whatToLookFor: "Cross-shaped star pattern tracing the Northern Cross along the Milky Way"
    }
];

// Fallback [lon, lat] continent polygons if photographic texture cannot be loaded
const GLOBE_CONTINENTS = [
    [[-10.5, 51.5], [-6.2, 51.8], [-5.5, 54.6], [-8.5, 55.2], [-10.5, 54.0]],
    [[-5.8, 50.0], [-1.8, 50.8], [1.7, 51.3], [1.7, 52.9], [-0.5, 54.5], [-3.0, 55.0], [-5.0, 57.5], [-3.1, 58.6], [-6.1, 57.2], [-5.2, 53.3]],
    [[-9.5, 37.0], [-9.2, 42.8], [-1.8, 43.4], [-4.8, 48.4], [2.2, 51.0], [4.5, 53.4], [8.5, 54.5], [8.2, 57.1], [10.6, 57.7], [12.5, 55.6], [18.5, 54.5], [24.0, 59.5], [30.0, 60.0], [28.0, 65.5], [20.0, 70.0], [15.0, 68.2], [5.0, 60.5], [6.0, 58.0], [14.0, 54.0], [14.5, 45.5], [18.0, 40.5], [15.5, 38.0], [12.5, 41.8], [9.5, 45.5], [5.0, 43.3], [3.1, 42.4], [-0.3, 39.5], [-5.6, 36.0]],
    [[5.0, 59.0], [11.0, 59.0], [18.0, 59.3], [21.0, 63.5], [25.5, 65.8], [30.5, 69.8], [26.0, 71.0], [17.0, 69.5], [11.0, 65.0], [6.5, 62.0]],
    [[-17.5, 14.7], [-16.5, 20.8], [-13.0, 27.8], [-5.5, 35.8], [10.5, 37.2], [11.5, 33.5], [25.0, 32.0], [32.3, 31.3], [37.0, 22.0], [43.3, 11.8], [51.3, 12.0], [49.0, 6.0], [41.5, -1.8], [40.2, -10.5], [35.5, -19.8], [32.8, -26.8], [27.9, -33.0], [18.4, -34.4], [16.4, -28.6], [14.5, -22.9], [11.8, -15.5], [12.2, -6.0], [9.4, 1.0], [9.7, 4.0], [2.5, 6.3], [-4.0, 5.2], [-7.6, 4.4], [-13.7, 9.0], [-16.8, 12.3]],
    [[-52.0, 60.0], [-44.0, 60.0], [-36.0, 66.0], [-21.0, 70.5], [-18.0, 77.0], [-25.0, 82.0], [-45.0, 83.0], [-60.0, 78.0], [-56.0, 71.0], [-51.0, 64.5]],
    [[-168.0, 65.5], [-162.0, 68.5], [-156.0, 71.3], [-140.0, 69.6], [-128.0, 70.5], [-110.0, 69.0], [-95.0, 68.5], [-82.0, 63.0], [-78.0, 54.5], [-64.0, 50.5], [-55.5, 52.0], [-52.6, 47.5], [-60.5, 45.8], [-66.5, 44.5], [-70.5, 41.6], [-74.0, 40.5], [-76.0, 35.2], [-80.5, 25.2], [-82.5, 27.5], [-89.5, 29.2], [-97.2, 26.0], [-96.5, 19.2], [-90.5, 21.2], [-87.0, 21.5], [-83.5, 15.0], [-83.0, 9.5], [-78.0, 8.2], [-85.5, 10.5], [-93.0, 14.8], [-105.5, 20.5], [-110.0, 24.2], [-114.5, 31.5], [-117.2, 32.6], [-122.5, 37.8], [-124.5, 42.0], [-124.2, 48.3], [-135.0, 57.0], [-149.5, 61.0], [-161.0, 55.0], [-166.5, 54.0]],
    [[-77.5, 8.2], [-71.5, 12.2], [-62.0, 10.5], [-50.0, 1.5], [-44.0, -2.5], [-35.0, -6.0], [-38.5, -13.0], [-40.5, -20.5], [-48.5, -25.5], [-53.5, -33.5], [-65.0, -41.0], [-67.5, -55.0], [-74.0, -52.5], [-75.5, -45.0], [-71.6, -33.0], [-70.5, -18.5], [-77.0, -12.0], [-81.2, -4.5], [-79.0, 1.5]],
    [[26.5, 41.0], [35.5, 36.5], [35.8, 33.0], [43.0, 13.0], [54.0, 16.5], [59.5, 22.5], [51.0, 29.5], [48.5, 30.0], [56.5, 26.5], [68.0, 24.5], [72.8, 19.0], [77.5, 8.2], [80.3, 13.0], [88.0, 22.0], [92.0, 21.0], [97.5, 16.5], [100.5, 13.5], [104.0, 1.3], [101.5, 5.5], [109.0, 12.0], [108.0, 21.0], [114.0, 22.5], [121.5, 25.0], [122.0, 31.2], [119.5, 35.0], [122.0, 39.8], [126.5, 35.0], [129.0, 35.5], [131.0, 43.0], [140.5, 52.0], [143.0, 54.0], [162.0, 59.5], [170.0, 66.0], [178.0, 66.5], [158.0, 70.5], [135.0, 72.0], [105.0, 76.5], [80.0, 73.5], [68.0, 70.0], [58.0, 69.5], [42.0, 66.5], [38.0, 55.5], [29.0, 41.2]],
    [[130.5, 31.5], [136.5, 34.5], [140.8, 35.5], [141.5, 41.2], [145.5, 43.5], [140.2, 45.2], [139.0, 38.0], [132.0, 34.5]],
    [[114.0, -22.0], [122.0, -18.0], [130.8, -12.4], [136.5, -12.2], [142.5, -10.8], [145.5, -15.5], [153.2, -27.5], [150.2, -37.2], [143.5, -38.8], [137.0, -35.0], [131.0, -31.8], [115.0, -34.2], [113.5, -26.0]]
];

function ensureEarthPhotoTexture() {
    if (earthPhotoReady || earthPhotoLoading) return;
    earthPhotoLoading = true;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        const off = document.createElement("canvas");
        off.width = Math.min(1024, img.naturalWidth || 1024);
        off.height = Math.min(512, img.naturalHeight || 512);
        const octx = off.getContext("2d");
        if (octx) {
            octx.drawImage(img, 0, 0, off.width, off.height);
            earthPhotoCanvas = off;
            earthPhotoReady = true;
        }
        earthPhotoLoading = false;
    };
    img.onerror = () => {
        earthPhotoLoading = false;
        earthPhotoReady = false;
    };
    img.src = EARTH_TEXTURE_URL;
}

function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
}

function azToCompass8(azDeg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round(normalizeDeg(azDeg) / 45) % 8;
    return dirs[idx];
}

function azToCompass16(azDeg) {
    const dirs = [
        "North", "North-North-East", "North-East", "East-North-East",
        "East", "East-South-East", "South-East", "South-South-East",
        "South", "South-South-West", "South-West", "West-South-West",
        "West", "West-North-West", "North-West", "North-North-West"
    ];
    const idx = Math.round(normalizeDeg(azDeg) / 22.5) % 16;
    return dirs[idx];
}

function getVisibilityRating(altDeg, visible) {
    if (!visible || altDeg <= 0) return "Low / Horizon";
    if (altDeg >= 30) return "Excellent";
    if (altDeg >= 15) return "Good";
    return "Fair";
}

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
            directionFull: azToCompass16(coords.az),
            visibilityRating: getVisibilityRating(coords.alt, coords.visible),
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
            directionFull: azToCompass16(coords.az),
            visibilityRating: getVisibilityRating(coords.alt, coords.visible),
            extra: ""
        });
    }

    return results;
}

function getMoonSummary(now) {
    const ws = window.hosacWeatherSummary;
    if (ws && ws.moonPhase && typeof ws.moonIllumination === "number") {
        return {
            phase: ws.moonPhase,
            illumination: `${ws.moonIllumination}%`
        };
    }

    if (typeof Astronomy !== "undefined") {
        try {
            const time = Astronomy.MakeTime(now);
            const phaseDeg = Astronomy.MoonPhase(time);
            const illum = Math.round(((1 - Math.cos(phaseDeg * DEG2RAD)) / 2) * 100);
            let phaseText = "Waxing Crescent";
            if (phaseDeg < 22.5 || phaseDeg >= 337.5) phaseText = "New Moon";
            else if (phaseDeg < 67.5) phaseText = "Waxing Crescent";
            else if (phaseDeg < 112.5) phaseText = "First Quarter";
            else if (phaseDeg < 157.5) phaseText = "Waxing Gibbous";
            else if (phaseDeg < 202.5) phaseText = "Full Moon";
            else if (phaseDeg < 247.5) phaseText = "Waning Gibbous";
            else if (phaseDeg < 292.5) phaseText = "Last Quarter";
            else phaseText = "Waning Crescent";

            return { phase: phaseText, illumination: `${illum}%` };
        } catch {
            // Fall through
        }
    }

    return { phase: "Live", illumination: "--" };
}

function getViewingConditions(evaluated) {
    const ws = window.hosacWeatherSummary;
    if (ws) {
        if (ws.rainState === "ACTIVE") return "Poor (Rain)";
        if (typeof ws.cloudCover === "number") {
            if (ws.cloudCover <= 25) return "Excellent";
            if (ws.cloudCover <= 65) return "Good";
            return "Fair / Cloudy";
        }
    }

    const visibleCount = evaluated.filter(t => t.visible && t.alt >= 15).length;
    return visibleCount >= 3 ? "Good" : "Fair";
}

function ensureTonightsSkyPanel() {
    const container = document.getElementById("astronomy-container");
    const hud = document.getElementById("astronomy-hud");
    if (!container || !hud) return null;

    let panel = document.getElementById("tonights-sky-summary");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "tonights-sky-summary";
        container.insertBefore(panel, hud);
    }
    return panel;
}

function renderTonightsSkySummary(evaluated) {
    const panel = ensureTonightsSkyPanel();
    if (!panel) return;

    const visiblePlanets = evaluated.filter(
        t => t.category === "planet" && t.id !== "moon" && t.visible
    );
    const sortedPlanets = [...visiblePlanets].sort((a, b) => b.alt - a.alt);
    const bestPlanet = sortedPlanets[0] ? sortedPlanets[0].name : "None High";

    const visibleConstellations = evaluated.filter(
        t => t.category === "constellation" && t.visible
    );
    const sortedConstellations = [...visibleConstellations].sort((a, b) => b.alt - a.alt);
    const bestConstellation = sortedConstellations[0]
        ? sortedConstellations[0].name.split(" / ")[0]
        : "Low";

    const moonInfo = getMoonSummary(new Date());
    const conditions = getViewingConditions(evaluated);

    panel.innerHTML = `
        <div class="tonights-sky-title">⭐ TONIGHT'S SKY</div>
        <div class="tonights-sky-grid">
            <div><strong>Best Planet:</strong> ${bestPlanet}</div>
            <div><strong>Best Constellation:</strong> ${bestConstellation}</div>
            <div><strong>Moon Phase:</strong> ${moonInfo.phase}</div>
            <div><strong>Moon Illumination:</strong> ${moonInfo.illumination}</div>
            <div><strong>Viewing Conditions:</strong> ${conditions}</div>
            <div><strong>Visible Planets:</strong> ${visiblePlanets.length}</div>
        </div>
    `;
}

function renderSkySelectorHud(lat, lon) {
    const chipsContainer = document.getElementById("astro-target-chips");
    const briefContainer = document.getElementById("astro-brief");
    if (!chipsContainer || !briefContainer) return;

    const evaluated = getEvaluatedTargets(lat, lon);
    latestEvaluated = evaluated;

    renderTonightsSkySummary(evaluated);

    const filteredByCat =
        activeAstroFilter === "all"
            ? evaluated
            : evaluated.filter(item => item.category === activeAstroFilter);

    const aboveHorizon = filteredByCat.filter(item => item.visible);
    const displayList = aboveHorizon.length > 0 ? aboveHorizon : filteredByCat;

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
}

function renderObservationBrief(target) {
    const briefContainer = document.getElementById("astro-brief");
    if (!briefContainer || !target) return;

    const altDisplay = `${Math.round(target.alt)}°`;
    const horizonNote = target.visible
        ? `<span class="astro-status-up">● ${target.visibilityRating}</span>`
        : `<span class="astro-status-low">○ ${target.visibilityRating}</span>`;

    const imgHtml = target.image
        ? `<img class="astro-card-img" src="${target.image}" alt="${target.name}" onerror="this.style.display='none'">`
        : "";

    if (target.category === "constellation") {
        briefContainer.innerHTML = `
            <div class="astro-brief-header">
                <strong>${target.icon} ${target.name.toUpperCase()}</strong>
                <span>${horizonNote} <button type="button" class="astro-brief-close" title="Close card">✕</button></span>
            </div>
            <div class="astro-intel-card">
                ${imgHtml}
                <div class="astro-intel-rows">
                    <div><strong>Where to Look:</strong> ${target.directionFull} (${Math.round(target.az)}°, ${altDisplay})</div>
                    <div><strong>What to Look For:</strong> ${target.whatToLookFor}</div>
                    <div><strong>Visible Features:</strong> ${target.visibleFeatures}</div>
                    <div><strong>Best Viewing:</strong> ${target.bestViewing}</div>
                    <div><strong>Visibility Tonight:</strong> ${target.visibilityRating}</div>
                </div>
            </div>
        `;
        return;
    }

    briefContainer.innerHTML = `
        <div class="astro-brief-header">
            <strong>${target.icon} ${target.name.toUpperCase()}</strong>
            <span>${horizonNote} <button type="button" class="astro-brief-close" title="Close card">✕</button></span>
        </div>
        <div class="astro-intel-card">
            ${imgHtml}
            <div class="astro-intel-rows">
                <div><strong>Direction:</strong> ${target.directionFull} (${Math.round(target.az)}°)</div>
                <div><strong>Altitude:</strong> ${altDisplay}${target.extra ? ` (${target.extra})` : ""}</div>
                <div><strong>What To Look For:</strong> ${target.whatToLookFor}</div>
                <div><strong>Visibility:</strong> ${target.visibilityRating} (${target.bestViewing})</div>
                <div><strong>Observation Notes:</strong> ${target.observationNotes}</div>
            </div>
        </div>
    `;
}

function slewPlanetariumToTarget(target) {
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
        applyViewRetries++;
        setTimeout(applySkyView, 500);
    }

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

function selectSkyTarget(target, shouldSlew = false) {
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

/* ==========================================================
   PHOTOGRAPHIC ORTHOGRAPHIC NIGHT INTELLIGENCE GLOBE
   ========================================================== */

function computeSubsolarLatLon(date = new Date()) {
    const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const dayOfYear = (date.getTime() - startOfYear.getTime()) / 86400000;
    const declDeg = 23.44 * Math.sin(((2 * Math.PI) / 365.25) * (dayOfYear - 81));
    const utcHours =
        date.getUTCHours() +
        date.getUTCMinutes() / 60 +
        date.getUTCSeconds() / 3600;
    let sunLon = (12 - utcHours) * 15;
    if (sunLon > 180) sunLon -= 360;
    if (sunLon < -180) sunLon += 360;
    return { lat: declDeg, lon: sunLon };
}

function projectOrtho3D(latDeg, lonDeg, centerLonDeg, centerLatDeg, cx, cy, radius) {
    const lat = latDeg * DEG2RAD;
    const cLat = centerLatDeg * DEG2RAD;
    const dLon = (lonDeg - centerLonDeg) * DEG2RAD;

    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const cosCLat = Math.cos(cLat);
    const sinCLat = Math.sin(cLat);
    const cosDLon = Math.cos(dLon);
    const sinDLon = Math.sin(dLon);

    const x = cosLat * sinDLon;
    const y = sinLat * cosCLat - cosLat * sinCLat * cosDLon;
    const z = sinLat * sinCLat + cosLat * cosCLat * cosDLon;

    return {
        x: cx + x * radius,
        y: cy - y * radius,
        z
    };
}

function isPointInNightSide(latDeg, lonDeg, subsolar) {
    const pLat = latDeg * DEG2RAD;
    const sLat = subsolar.lat * DEG2RAD;
    const dLon = (lonDeg - subsolar.lon) * DEG2RAD;
    const cosZenith =
        Math.sin(pLat) * Math.sin(sLat) +
        Math.cos(pLat) * Math.cos(sLat) * Math.cos(dLon);
    return cosZenith < 0;
}

function syncGlobeCanvasSize() {
    const canvas = document.getElementById("night-globe-canvas");
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    const availW = Math.max(180, Math.floor(wrap.clientWidth - 12));
    const availH = Math.max(180, Math.floor(wrap.clientHeight - 12));
    const size = Math.min(availW, availH, 560);

    if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
    }
}

function renderPhotographicSphere(ctx, cx, cy, r, centerLonDeg, centerLatDeg) {
    const tex = earthPhotoCanvas;
    const tw = tex.width;
    const th = tex.height;
    const cLat = centerLatDeg * DEG2RAD;
    const cosCLat = Math.cos(cLat);
    const sinCLat = Math.sin(cLat);
    const centerLonNorm = normalizeDeg(centerLonDeg);

    // Draw horizontal latitude slices across the visible sphere for smooth 60fps orthographic mapping
    const stepPx = 2;
    const rInt = Math.floor(r);

    for (let dy = -rInt; dy <= rInt; dy += stepPx) {
        const ny = -dy / r;
        const maxXSq = 1 - ny * ny;
        if (maxXSq <= 0) continue;

        const maxX = Math.sqrt(maxXSq);
        const dstY = cy + dy;

        // Sample longitude across [-maxX, +maxX]
        const cols = Math.max(12, Math.ceil(maxX * r * 0.45));
        for (let i = 0; i < cols; i++) {
            const nx0 = -maxX + (2 * maxX * i) / cols;
            const nx1 = -maxX + (2 * maxX * (i + 1)) / cols;
            const nxMid = (nx0 + nx1) * 0.5;

            const nzSq = 1 - nxMid * nxMid - ny * ny;
            if (nzSq <= 0) continue;
            const nz = Math.sqrt(nzSq);

            // Inverse orthographic projection to (lat, lon)
            const sinLat = ny * cosCLat + nz * sinCLat;
            const latRad = Math.asin(Math.max(-1, Math.min(1, sinLat)));
            const cosLat = Math.cos(latRad) || 1e-6;

            const sinDLon = nxMid / cosLat;
            const cosDLon = (nz * cosCLat - ny * sinCLat) / cosLat;
            const dLonDeg = Math.atan2(sinDLon, cosDLon) * RAD2DEG;

            const lonDeg = normalizeDeg(centerLonNorm + dLonDeg);
            const u = lonDeg / 360;
            const v = (90 - latRad * RAD2DEG) / 180;

            const srcX = Math.max(0, Math.min(tw - 2, Math.floor(u * tw)));
            const srcY = Math.max(0, Math.min(th - 2, Math.floor(v * th)));

            const dstX0 = cx + nx0 * r;
            const dstX1 = cx + nx1 * r;
            const dstW = Math.max(1.5, dstX1 - dstX0 + 0.6);

            ctx.drawImage(tex, srcX, srcY, Math.max(2, tw / cols), stepPx + 0.5, dstX0, dstY, dstW, stepPx + 0.6);
        }
    }
}

function drawRealisticGlobe(lat, lon) {
    ensureEarthPhotoTexture();

    const canvas = document.getElementById("night-globe-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w < 40 || h < 40) return;

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.47;
    const now = new Date();
    const subsolar = computeSubsolarLatLon(now);

    ctx.clearRect(0, 0, w, h);

    // Subtle crisp starfield
    ctx.fillStyle = "rgba(255, 225, 225, 0.48)";
    const starSeeds = [
        [0.07, 0.12, 1.1], [0.18, 0.82, 1.3], [0.27, 0.21, 0.9], [0.78, 0.16, 1.2],
        [0.86, 0.72, 1.0], [0.92, 0.31, 1.4], [0.11, 0.49, 0.8], [0.71, 0.86, 1.1]
    ];
    for (const [sx, sy, sr] of starSeeds) {
        ctx.beginPath();
        ctx.arc(w * sx, h * sy, sr, 0, Math.PI * 2);
        ctx.fill();
    }

    // Subtle atmospheric glow
    const rimGlow = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.08);
    rimGlow.addColorStop(0, "rgba(255, 77, 77, 0.22)");
    rimGlow.addColorStop(1, "rgba(6, 8, 13, 0)");
    ctx.fillStyle = rimGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Base ocean fill
    ctx.fillStyle = "#0b1320";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    if (earthPhotoReady && earthPhotoCanvas) {
        renderPhotographicSphere(ctx, cx, cy, r, globeRotationLon, globePitchDeg);
        // Night-mode warm/reddish photographic tint so it preserves night vision
        ctx.fillStyle = "rgba(38, 8, 10, 0.24)";
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    } else {
        // Vector continent fallback while texture loads or if offline
        for (const poly of GLOBE_CONTINENTS) {
            const projected = poly.map(([pLon, pLat]) =>
                projectOrtho3D(pLat, pLon, globeRotationLon, globePitchDeg, cx, cy, r)
            );
            const frontPts = projected.filter(p => p.z > -0.02);
            if (frontPts.length < 3) continue;

            ctx.beginPath();
            let moved = false;
            for (const p of projected) {
                if (p.z > -0.08) {
                    if (!moved) { ctx.moveTo(p.x, p.y); moved = true; }
                    else ctx.lineTo(p.x, p.y);
                }
            }
            ctx.closePath();

            const avgLon = poly.reduce((acc, item) => acc + item[0], 0) / poly.length;
            const avgLat = poly.reduce((acc, item) => acc + item[1], 0) / poly.length;
            const isNightSide = isPointInNightSide(avgLat, avgLon, subsolar);

            ctx.fillStyle = isNightSide ? "#2a1d22" : "#3a322d";
            ctx.fill();
            ctx.strokeStyle = isNightSide ? "rgba(255, 110, 110, 0.55)" : "rgba(226, 232, 240, 0.55)";
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }
    }

    // Day/Night Terminator curve
    const terminatorPts = [];
    for (let step = 0; step <= 180; step += 3) {
        const bearing = step * DEG2RAD;
        const sLat = subsolar.lat * DEG2RAD;
        const sLon = subsolar.lon * DEG2RAD;
        const latRad = Math.asin(Math.cos(sLat) * Math.cos(bearing));
        const lonRad = sLon + Math.atan2(Math.sin(bearing), -Math.sin(sLat) * Math.cos(bearing));
        const pt = projectOrtho3D(
            latRad * RAD2DEG,
            lonRad * RAD2DEG,
            globeRotationLon,
            globePitchDeg,
            cx,
            cy,
            r
        );
        if (pt.z >= 0) terminatorPts.push(pt);
    }
    if (terminatorPts.length > 1) {
        ctx.strokeStyle = "rgba(255, 150, 95, 0.72)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        terminatorPts.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 3D spherical limb shading
    const sphereShade = ctx.createRadialGradient(
        cx - r * 0.28,
        cy - r * 0.28,
        r * 0.12,
        cx,
        cy,
        r * 1.05
    );
    sphereShade.addColorStop(0, "rgba(255, 255, 255, 0.06)");
    sphereShade.addColorStop(0.68, "rgba(0, 0, 0, 0.18)");
    sphereShade.addColorStop(1, "rgba(0, 0, 0, 0.68)");
    ctx.fillStyle = sphereShade;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Current GPS marker on the globe
    if (typeof lat === "number" && typeof lon === "number") {
        const gpsPt = projectOrtho3D(lat, lon, globeRotationLon, globePitchDeg, cx, cy, r);
        if (gpsPt.z > 0) {
            ctx.strokeStyle = "rgba(255, 85, 85, 0.92)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(gpsPt.x, gpsPt.y, 9, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#ff4d4d";
            ctx.beginPath();
            ctx.arc(gpsPt.x, gpsPt.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();

    // Crisp outer limb stroke
    ctx.strokeStyle = "rgba(255, 77, 77, 0.65)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Update geolocation readout inside the globe space
    const coordsEl = document.getElementById("globe-gps-readout");
    if (coordsEl) {
        const gpsStr =
            typeof lat === "number" && typeof lon === "number"
                ? `GPS ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`
                : "GPS Awaiting lock...";
        const sunStr = `Sun ${Math.abs(subsolar.lat).toFixed(1)}°${subsolar.lat >= 0 ? "N" : "S"}, ${Math.abs(subsolar.lon).toFixed(1)}°${subsolar.lon >= 0 ? "E" : "W"}`;
        coordsEl.textContent = `${gpsStr} · ${sunStr}`;
    }

    if (globeAutoSpin && !globeIsDragging) {
        globeRotationLon = (globeRotationLon + 0.18) % 360;
    }
}

function bindGlobeInteractions(lat, lon) {
    const canvas = document.getElementById("night-globe-canvas");
    if (!canvas || canvas.dataset.bound === "true") return;
    canvas.dataset.bound = "true";

    canvas.addEventListener("pointerdown", e => {
        globeIsDragging = true;
        globeAutoSpin = false;
        globeDragLastX = e.clientX;
        globeDragLastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", e => {
        if (!globeIsDragging) return;
        const dx = e.clientX - globeDragLastX;
        const dy = e.clientY - globeDragLastY;
        globeDragLastX = e.clientX;
        globeDragLastY = e.clientY;

        globeRotationLon = normalizeDeg(globeRotationLon - dx * 0.45);
        globePitchDeg = Math.max(-65, Math.min(65, globePitchDeg + dy * 0.35));
        drawRealisticGlobe(lat, lon);
    });

    const endDrag = () => {
        globeIsDragging = false;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("dblclick", () => {
        globeAutoSpin = !globeAutoSpin;
    });
}

function ensureGlobeLandingView() {
    const container = document.getElementById("astronomy-container");
    if (!container) return null;

    let landing = document.getElementById("night-globe-landing");
    if (!landing) {
        landing = document.createElement("div");
        landing.id = "night-globe-landing";
        landing.style.cssText =
            "position:relative;flex:1;min-height:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:10px;background:#06080d;";

        landing.innerHTML = `
            <canvas id="night-globe-canvas" width="420" height="420" style="display:block;max-width:100%;max-height:100%;"></canvas>
            <div id="globe-gps-readout" style="position:absolute;top:10px;left:12px;z-index:2;font-size:11.5px;color:#fecaca;background:rgba(10,13,20,0.72);border:1px solid rgba(255,77,77,0.35);border-radius:6px;padding:4px 8px;pointer-events:none;">
                GPS Awaiting lock...
            </div>
            <button type="button" id="enter-astronomy-btn" class="enter-astro-btn" style="position:absolute;bottom:10px;right:12px;z-index:2;background:rgba(127,29,29,0.92);color:#fff;border:1px solid #ff4d4d;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:bold;cursor:pointer;">
                Enter Astronomy View →
            </button>
        `;
        container.appendChild(landing);

        const enterBtn = landing.querySelector("#enter-astronomy-btn");
        if (enterBtn) {
            enterBtn.addEventListener("click", () => {
                astronomyEntered = true;
                stopGlobeAnimation();
                updateNightModeStageVisibility();
                if (typeof currentLat === "number" && typeof currentLon === "number") {
                    lastAstroLat = null;
                    lastAstroLon = null;
                    initOrUpdateAstronomy(currentLat, currentLon);
                }
            });
        }
    }

    return landing;
}

function startGlobeAnimation(lat, lon) {
    stopGlobeAnimation();
    bindGlobeInteractions(lat, lon);
    ensureEarthPhotoTexture();
    if (typeof lon === "number" && globeRotationLon === 0 && !globeIsDragging) {
        globeRotationLon = lon;
    }

    requestAnimationFrame(() => {
        syncGlobeCanvasSize();
        drawRealisticGlobe(lat, lon);

        const step = () => {
            if (!document.body.classList.contains("night-mode") || astronomyEntered) {
                globeAnimFrameId = null;
                return;
            }
            drawRealisticGlobe(lat, lon);
            globeAnimFrameId = requestAnimationFrame(step);
        };
        globeAnimFrameId = requestAnimationFrame(step);
    });
}

function stopGlobeAnimation() {
    if (globeAnimFrameId !== null) {
        cancelAnimationFrame(globeAnimFrameId);
        globeAnimFrameId = null;
    }
}

function updateNightModeStageVisibility() {
    const isNight = document.body.classList.contains("night-mode");
    const landing = document.getElementById("night-globe-landing");
    const meta = document.getElementById("astronomy-meta");
    const skySummary = document.getElementById("tonights-sky-summary");
    const hud = document.getElementById("astronomy-hud");
    const stage = document.getElementById("starmap-stage");

    if (!isNight) {
        astronomyEntered = false;
        stopGlobeAnimation();
        if (landing) landing.style.display = "none";
        return;
    }

    const showGlobe = !astronomyEntered;
    if (landing) landing.style.display = showGlobe ? "flex" : "none";
    if (meta) meta.style.display = showGlobe ? "none" : "flex";
    if (skySummary) skySummary.style.display = showGlobe ? "none" : "block";
    if (hud) hud.style.display = showGlobe ? "none" : "flex";
    if (stage) stage.style.display = showGlobe ? "none" : "block";
}

function bindAstroHudEvents() {
    const hud = document.getElementById("astronomy-hud");
    if (!hud || hud.dataset.bound === "true") return;
    hud.dataset.bound = "true";

    const bar = document.getElementById("astro-filter-bar");
    if (bar) {
        if (!document.getElementById("astro-back-globe-btn")) {
            const backBtn = document.createElement("button");
            backBtn.type = "button";
            backBtn.id = "astro-back-globe-btn";
            backBtn.className = "astro-filter-btn";
            backBtn.textContent = "🌍 Globe";
            backBtn.title = "Return to Night Intelligence Globe";
            backBtn.addEventListener("click", () => {
                selectedTargetId = null;
                astronomyEntered = false;
                updateNightModeStageVisibility();
                if (typeof currentLat === "number" && typeof currentLon === "number") {
                    startGlobeAnimation(currentLat, currentLon);
                }
            });
            bar.insertBefore(backBtn, bar.firstChild);
        }

        if (!document.getElementById("astro-view-btn")) {
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
    }

    hud.querySelectorAll("button[data-filter]").forEach(btn => {
        btn.addEventListener("click", () => {
            const filterVal = btn.getAttribute("data-filter") || "all";
            if (filterVal === "satellite") {
                activeAstroFilter = "all";
                selectedTargetId = null;
                return;
            }
            activeAstroFilter = filterVal;
            selectedTargetId = null;

            hud.querySelectorAll("button[data-filter]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            if (typeof currentLat === "number" && typeof currentLon === "number") {
                renderSkySelectorHud(currentLat, currentLon);
            }

            applySkyView();
        });
    });

    const satBtn = hud.querySelector('button[data-filter="satellite"]');
    if (satBtn) {
        satBtn.style.display = "none";
    }

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
    ensureGlobeLandingView();
    updateNightModeStageVisibility();

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

    if (!astronomyEntered) {
        startGlobeAnimation(lat, lon);
        return;
    }

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

    if (!astroRefreshInterval) {
        astroRefreshInterval = setInterval(() => {
            if (
                document.body.classList.contains("night-mode") &&
                astronomyEntered &&
                typeof currentLat === "number" &&
                typeof currentLon === "number"
            ) {
                renderSkySelectorHud(currentLat, currentLon);
            }
        }, 30000);
    }
}

function resizeAstronomyMap() {
    if (!document.body.classList.contains("night-mode")) return;

    if (!astronomyEntered && typeof currentLat === "number" && typeof currentLon === "number") {
        syncGlobeCanvasSize();
        drawRealisticGlobe(currentLat, currentLon);
        return;
    }

    if (
        astronomyEntered &&
        typeof currentLat === "number" &&
        typeof currentLon === "number"
    ) {
        lastAstroLat = null;
        lastAstroLon = null;
        initOrUpdateAstronomy(currentLat, currentLon);
    }
}

window.addEventListener("resize", resizeAstronomyMap);