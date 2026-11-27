let rainRadarMap = null;
let rainRadarLayers = [];
let rainFrames = [];
let currentFrame = 0;
let radarAnimation = null;
let rainFrameTimes = [];
let lastGoodWeatherData = null;

const RAIN_ACTIVE_THRESHOLD_MM_HR = 0.3;
const SHORT_DURATION_MINUTES = 5;
const LONG_DURATION_CAP_MINUTES = 180; // ~3 hours max duration estimate
const DISPLAY_MODE_STORAGE_KEY = "hosac_display_mode_pref";
let currentDisplayModePref = "AUTO";

const RAIN_WEATHER_CODES = new Set([
    51, 53, 55, 56, 57,
    61, 63, 65, 66, 67,
    80, 81, 82,
    95, 96, 99
]);

function isRainWeatherCode(code) {
    return RAIN_WEATHER_CODES.has(Number(code));
}

function getDisplayMode() {
    try {
        const saved = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
        if (saved === "DAY" || saved === "NIGHT" || saved === "AUTO") {
            currentDisplayModePref = saved;
        }
    } catch {
        // Ignore storage errors
    }
    return currentDisplayModePref;
}

function setDisplayMode(pref) {
    const normalized = (pref === "DAY" || pref === "NIGHT" || pref === "AUTO") ? pref : "AUTO";
    currentDisplayModePref = normalized;
    try {
        localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, normalized);
    } catch {
        // Ignore storage errors
    }
    syncModeSelectorButtons(normalized);
    if (lastGoodWeatherData) {
        applyModeOverride(lastGoodWeatherData);
    } else {
        loadWeather();
    }
}

function syncModeSelectorButtons(pref) {
    document.querySelectorAll("#display-mode-selector .mode-btn").forEach(btn => {
        const isActive = btn.getAttribute("data-mode-pref") === pref;
        btn.classList.toggle("active", isActive);
    });
}

function bindDisplayModeSelector() {
    const container = document.getElementById("display-mode-selector");
    if (!container || container.dataset.bound === "true") return;
    container.dataset.bound = "true";

    syncModeSelectorButtons(getDisplayMode());

    container.querySelectorAll(".mode-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pref = btn.getAttribute("data-mode-pref") || "AUTO";
            setDisplayMode(pref);
        });
    });
}

function applyModeOverride(data, now = new Date()) {
    const sunrise = new Date(data.daily.sunrise[0]);
    const sunset = new Date(data.daily.sunset[0]);

    let nextEvent;
    let eventTime;
    let autoMode;

    if (now < sunrise) {
        nextEvent = "Sunrise";
        eventTime = sunrise;
        autoMode = "NIGHT";
    } else if (now < sunset) {
        nextEvent = "Sunset";
        eventTime = sunset;
        autoMode = "DAY";
    } else {
        nextEvent = "Sunrise";
        eventTime = new Date(sunrise);
        eventTime.setDate(eventTime.getDate() + 1);
        autoMode = "NIGHT";
    }

    const pref = getDisplayMode();
    const effectiveMode = pref === "AUTO" ? autoMode : pref;
    const aircraftRadius = effectiveMode === "NIGHT" ? 75 : 50;

    return {
        pref,
        mode: effectiveMode,
        autoMode,
        nextEvent,
        eventTime,
        aircraftRadius
    };
}

function degreesToCompass(degrees) {

    const directions = [
        "N", "NNE", "NE", "ENE",
        "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW",
        "W", "WNW", "NW", "NNW"
    ];

    const index = Math.round(degrees / 22.5) % 16;

    return directions[index];
}

function weatherCodeToText(code) {

    const descriptions = {
        0: "Clear Sky",
        1: "Mainly Clear",
        2: "Partly Cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing Fog",
        51: "Light Drizzle",
        53: "Moderate Drizzle",
        55: "Dense Drizzle",
        61: "Light Rain",
        63: "Moderate Rain",
        65: "Heavy Rain",
        71: "Light Snow",
        73: "Moderate Snow",
        75: "Heavy Snow",
        80: "Rain Showers",
        81: "Heavy Showers",
        82: "Violent Showers",
        95: "Thunderstorm"
    };

    return descriptions[code] || "Unknown";
}

function moonPhaseToText(phase) {

    if (phase < 0.06 || phase >= 0.94)
        return "New Moon";

    if (phase < 0.19)
        return "Waxing Crescent";

    if (phase < 0.31)
        return "First Quarter";

    if (phase < 0.44)
        return "Waxing Gibbous";

    if (phase < 0.56)
        return "Full Moon";

    if (phase < 0.69)
        return "Waning Gibbous";

    if (phase < 0.81)
        return "Last Quarter";

    return "Waning Crescent";

}

function moonPhaseImage(phase) {

    if (phase < 0.06 || phase >= 0.94)
        return "images/moon/new-moon.png";

    if (phase < 0.19)
        return "images/moon/waxing-crescent.png";

    if (phase < 0.31)
        return "images/moon/first-quarter.png";

    if (phase < 0.44)
        return "images/moon/waxing-gibbous.png";

    if (phase < 0.56)
        return "images/moon/full-moon.png";

    if (phase < 0.69)
        return "images/moon/waning-gibbous.png";

    if (phase < 0.81)
        return "images/moon/last-quarter.png";

    return "images/moon/waning-crescent.png";

}

function classifyRainRate(mmPerHour) {
    if (mmPerHour >= 2.0) return "Heavy";
    if (mmPerHour >= 0.5) return "Moderate";
    if (mmPerHour >= RAIN_ACTIVE_THRESHOLD_MM_HR) return "Light";
    return null;
}

function formatDurationPhrase(totalMinutes) {
    if (totalMinutes < 60) {
        const mins = Math.max(1, Math.round(totalMinutes));
        return `${mins} min${mins === 1 ? "" : "s"}`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const remMins = Math.round((totalMinutes % 60) / 5) * 5;

    if (remMins === 0) {
        return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
    if (remMins === 60) {
        return `${hours + 1} hour${hours + 1 === 1 ? "" : "s"}`;
    }

    return `${hours}h ${remMins}m`;
}

function formatLongRainDetail(intensity, now) {
    if (intensity === "Light") {
        return "Persistent drizzle forecast";
    }

    if (now.getHours() < 12) {
        return "Expected through the morning";
    }

    return "Expected for much of today";
}

function buildRainSeries(data, nowMs) {
    if (
        data.minutely_15 &&
        Array.isArray(data.minutely_15.time) &&
        Array.isArray(data.minutely_15.precipitation) &&
        data.minutely_15.time.length > 0
    ) {
        const stepMinutes = 15;
        const points = [];

        for (let i = 0; i < data.minutely_15.time.length; i++) {
            const tMs = new Date(data.minutely_15.time[i]).getTime();
            const endMs = tMs + stepMinutes * 60000;
            if (endMs <= nowMs) continue;

            const rawMm = Math.max(0, Number(data.minutely_15.precipitation[i]) || 0);
            points.push({
                startMs: Math.max(tMs, nowMs),
                endMs,
                rateMmHr: rawMm * (60 / stepMinutes)
            });
        }

        if (points.length > 0) {
            return points;
        }
    }

    if (
        data.hourly &&
        Array.isArray(data.hourly.time) &&
        Array.isArray(data.hourly.precipitation)
    ) {
        const stepMinutes = 60;
        const points = [];

        for (let i = 0; i < data.hourly.time.length; i++) {
            const tMs = new Date(data.hourly.time[i]).getTime();
            const endMs = tMs + stepMinutes * 60000;
            if (endMs <= nowMs) continue;

            const rawMm = Math.max(0, Number(data.hourly.precipitation[i]) || 0);
            points.push({
                startMs: Math.max(tMs, nowMs),
                endMs,
                rateMmHr: rawMm
            });
        }

        return points;
    }

    return [];
}

function evaluateRainForecast(data, now = new Date()) {
    const nowMs = now.getTime();
    const series = buildRainSeries(data, nowMs);
    const codeIsRainy = isRainWeatherCode(data?.current_weather?.weathercode);

    if (series.length === 0) {
        if (codeIsRainy) {
            return {
                state: "ACTIVE",
                intensity: "Light",
                headline: "🌧 LIGHT RAIN",
                detail: "Observed in current weather"
            };
        }
        return {
            state: "DRY",
            intensity: null,
            headline: "✅ DRY",
            detail: "No rain expected"
        };
    }

    const currentRate = series[0].rateMmHr;
    const isActiveNow =
        currentRate >= RAIN_ACTIVE_THRESHOLD_MM_HR ||
        (codeIsRainy && currentRate > 0);

    if (isActiveNow) {
        const effectiveRate = Math.max(currentRate, RAIN_ACTIVE_THRESHOLD_MM_HR);
        const intensity = classifyRainRate(effectiveRate) || "Light";
        let endTimeMs = null;

        // Require two consecutive low slots before declaring a break so brief lulls don't flicker
        for (let i = 0; i < series.length; i++) {
            const nextIsDry =
                series[i].rateMmHr < RAIN_ACTIVE_THRESHOLD_MM_HR &&
                (!series[i + 1] || series[i + 1].rateMmHr < RAIN_ACTIVE_THRESHOLD_MM_HR);
            if (nextIsDry) {
                endTimeMs = series[i].startMs;
                break;
            }
        }

        const remainingMinutes =
            endTimeMs === null
                ? LONG_DURATION_CAP_MINUTES
                : Math.min(LONG_DURATION_CAP_MINUTES, Math.max(0, (endTimeMs - nowMs) / 60000));

        const headlineIcon = intensity === "Light" ? "🌧" : "⚠";
        const headline = `${headlineIcon} ${intensity.toUpperCase()} RAIN`;

        if (remainingMinutes < SHORT_DURATION_MINUTES) {
            return {
                state: "ACTIVE",
                intensity,
                headline,
                detail: "Rain ending shortly"
            };
        }

        if (remainingMinutes >= LONG_DURATION_CAP_MINUTES) {
            return {
                state: "ACTIVE",
                intensity,
                headline,
                detail: formatLongRainDetail(intensity, now)
            };
        }

        const durationText = formatDurationPhrase(remainingMinutes);
        if (intensity === "Light") {
            return {
                state: "ACTIVE",
                intensity,
                headline,
                detail: `Rain ending in ${durationText}`
            };
        }

        return {
            state: "ACTIVE",
            intensity,
            headline,
            detail: `Expected for next ${durationText}`
        };
    }

    const maxLookAheadMs = nowMs + 6 * 60 * 60 * 1000;
    for (let i = 0; i < series.length; i++) {
        const pt = series[i];
        if (pt.startMs > maxLookAheadMs) break;

        if (pt.rateMmHr >= RAIN_ACTIVE_THRESHOLD_MM_HR) {
            const minsUntilRain = Math.max(1, Math.round((pt.startMs - nowMs) / 60000));
            return {
                state: "APPROACHING",
                intensity: null,
                headline: "🌧 RAIN APPROACHING",
                detail: `Arriving in ${formatDurationPhrase(minsUntilRain)}`
            };
        }
    }

    return {
        state: "DRY",
        intensity: null,
        headline: "✅ DRY",
        detail: "No rain expected"
    };
}

function getNext2HourRainMetrics(data, now = new Date()) {
    const nowMs = now.getTime();
    const twoHoursMs = nowMs + 2 * 60 * 60 * 1000;
    const weatherCode = Number(data?.current_weather?.weathercode);
    const codeIsRainy = isRainWeatherCode(weatherCode);

    let currentRateMmHr = 0;
    let peakRateMmHr = 0;
    let total2hMm = 0;

    if (
        data.minutely_15 &&
        Array.isArray(data.minutely_15.time) &&
        Array.isArray(data.minutely_15.precipitation)
    ) {
        const stepMs = 15 * 60000;
        let seenCurrent = false;

        for (let i = 0; i < data.minutely_15.time.length; i++) {
            const startMs = new Date(data.minutely_15.time[i]).getTime();
            const endMs = startMs + stepMs;
            if (endMs <= nowMs) continue;
            if (startMs >= twoHoursMs) break;

            const mm15 = Math.max(0, Number(data.minutely_15.precipitation[i]) || 0);
            const rateMmHr = mm15 * 4;

            if (!seenCurrent) {
                currentRateMmHr = rateMmHr;
                seenCurrent = true;
            }
            if (rateMmHr > peakRateMmHr) {
                peakRateMmHr = rateMmHr;
            }
            total2hMm += mm15;
        }
    } else if (
        data.hourly &&
        Array.isArray(data.hourly.time) &&
        Array.isArray(data.hourly.precipitation)
    ) {
        const stepMs = 60 * 60000;
        let seenCurrent = false;

        for (let i = 0; i < data.hourly.time.length; i++) {
            const startMs = new Date(data.hourly.time[i]).getTime();
            const endMs = startMs + stepMs;
            if (endMs <= nowMs) continue;
            if (startMs >= twoHoursMs) break;

            const hrMm = Math.max(0, Number(data.hourly.precipitation[i]) || 0);
            if (!seenCurrent) {
                currentRateMmHr = hrMm;
                seenCurrent = true;
            }
            if (hrMm > peakRateMmHr) {
                peakRateMmHr = hrMm;
            }
            const overlapStart = Math.max(startMs, nowMs);
            const overlapEnd = Math.min(endMs, twoHoursMs);
            const fraction = Math.max(0, (overlapEnd - overlapStart) / stepMs);
            total2hMm += hrMm * fraction;
        }
    }

    const isRainingNow =
        currentRateMmHr >= RAIN_ACTIVE_THRESHOLD_MM_HR ||
        (codeIsRainy && currentRateMmHr > 0);

    let statusLabel;
    let statusColour;

    if (isRainingNow && peakRateMmHr >= 2.0) {
        statusLabel = "HEAVY NOW";
        statusColour = "#ef4444";
    } else if (isRainingNow) {
        statusLabel = "RAINING NOW";
        statusColour = "#38bdf8";
    } else if (peakRateMmHr >= 2.0) {
        statusLabel = "HEAVY";
        statusColour = "#ef4444";
    } else if (peakRateMmHr >= 0.5) {
        statusLabel = "LIKELY";
        statusColour = "#f97316";
    } else if (peakRateMmHr > 0 || (codeIsRainy && currentRateMmHr === 0)) {
        statusLabel = "POSSIBLE";
        statusColour = "#eab308";
    } else {
        statusLabel = "DRY";
        statusColour = "#22c55e";
    }

    return {
        isRainingNow,
        currentRateMmHr,
        peakRateMmHr,
        total2hMm,
        statusLabel,
        statusColour
    };
}

function getRainTheme(rainForecast) {
    if (rainForecast.state === "APPROACHING") {
        return {
            label: "APPROACHING",
            bg: "rgba(234, 179, 8, 0.14)",
            badgeBg: "rgba(234, 179, 8, 0.22)",
            color: "#eab308",
            border: "rgba(234, 179, 8, 0.45)"
        };
    }

    if (rainForecast.state === "ACTIVE") {
        if (rainForecast.intensity === "Heavy") {
            return {
                label: "HEAVY",
                bg: "rgba(239, 68, 68, 0.15)",
                badgeBg: "rgba(239, 68, 68, 0.24)",
                color: "#ef4444",
                border: "rgba(239, 68, 68, 0.5)"
            };
        }
        if (rainForecast.intensity === "Moderate") {
            return {
                label: "MODERATE",
                bg: "rgba(249, 115, 22, 0.15)",
                badgeBg: "rgba(249, 115, 22, 0.24)",
                color: "#f97316",
                border: "rgba(249, 115, 22, 0.5)"
            };
        }
        return {
            label: "LIGHT",
            bg: "rgba(56, 189, 248, 0.14)",
            badgeBg: "rgba(56, 189, 248, 0.22)",
            color: "#38bdf8",
            border: "rgba(56, 189, 248, 0.5)"
        };
    }

    return {
        label: "DRY",
        bg: "rgba(34, 197, 94, 0.12)",
        badgeBg: "rgba(34, 197, 94, 0.2)",
        color: "#22c55e",
        border: "rgba(34, 197, 94, 0.45)"
    };
}

function formatRainBadge(rainForecast) {
    const theme = getRainTheme(rainForecast);
    return `<span class="rain-intel-badge" style="
        background:${theme.badgeBg};
        color:${theme.color};
        border:1px solid ${theme.border};
    ">${theme.label}</span>`;
}

function isValidWeatherPayload(data) {
    return Boolean(
        data &&
        data.current_weather &&
        typeof data.current_weather.winddirection === "number" &&
        typeof data.current_weather.windspeed === "number" &&
        typeof data.current_weather.temperature === "number" &&
        data.hourly &&
        Array.isArray(data.hourly.precipitation) &&
        data.daily &&
        Array.isArray(data.daily.sunrise) &&
        Array.isArray(data.daily.sunset) &&
        Array.isArray(data.daily.moon_phase)
    );
}

async function loadWeather() {
    bindDisplayModeSelector();

    if (!currentLat || !currentLon) {
        return;
    }

    const url =
        `https://api.open-meteo.com/v1/forecast
    ?latitude=${currentLat}
    &longitude=${currentLon}
    &current_weather=true
    &minutely_15=precipitation
    &hourly=relative_humidity_2m,cloud_cover,pressure_msl,apparent_temperature,precipitation
    &daily=sunrise,sunset,moonrise,moonset,moon_phase
    &timezone=auto`
            .replace(/\s/g, '');

    try {

        let data = null;

        try {
            const response = await fetch(url);
            const json = await response.json();

            if (response.ok && isValidWeatherPayload(json)) {
                data = json;
                lastGoodWeatherData = json;
                window.lastWeatherData = json;
            } else {
                console.warn(
                    "Open-Meteo returned error or incomplete payload:",
                    response.status,
                    json
                );
            }
        } catch (fetchError) {
            console.warn("Open-Meteo fetch failed:", fetchError);
        }

        if (!data) {
            if (lastGoodWeatherData) {
                console.info("Using last cached Open-Meteo weather payload.");
                data = lastGoodWeatherData;
            } else {
                return;
            }
        }

        const windDirection =
            degreesToCompass(
                data.current_weather.winddirection
            );

        const sunrise =
            new Date(data.daily.sunrise[0]);

        const sunset =
            new Date(data.daily.sunset[0]);

        const moonrise =
            new Date(data.daily.moonrise[0]);

        const moonset =
            new Date(data.daily.moonset[0]);

        const moonriseText =
            moonrise.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        const moonsetText =
            moonset.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        const sunriseText =
            sunrise.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        const sunsetText =
            sunset.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        const now = new Date();
        const modeInfo = applyModeOverride(data, now);
        const { pref, mode, nextEvent, eventTime, aircraftRadius } = modeInfo;

        const eventTimeText =
            eventTime.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        const prefLabel = pref === "AUTO" ? "" : ` [${pref}]`;
        document.getElementById("mode").textContent =
            `Mode: ${mode}${prefLabel} · ${nextEvent} ${eventTimeText}`;

        document.getElementById(
            "weather-title"
        ).textContent =
            mode === "NIGHT"
                ? "Sky Intelligence"
                : "Weather Intelligence";

        document.getElementById("radius").textContent =
            `Radius: ${aircraftRadius}mi`;

        document.getElementById("aircraft-radius").textContent =
            `${aircraftRadius} miles`;

        updateAircraftRadius(
            aircraftRadius
        );

        // Any failure while redrawing the maps must not stop the weather panel
        try {
            setMapTheme(
                mode
            );

            updateRainRadar();
        } catch (themeError) {
            console.error("Map theme update failed", themeError);
        }

        if (mode === "NIGHT") {

            document.body.classList.add(
                "night-mode"
            );

        } else {

            document.body.classList.remove(
                "night-mode"
            );
        }

        const weatherText =
            weatherCodeToText(
                data.current_weather.weathercode
            );

        const moonPhase =
            moonPhaseToText(
                data.daily.moon_phase[0]
            );

        const moonPhaseValue =
            data.daily.moon_phase[0];

        const moonIllumination =
            Math.round(
                (
                    1 -
                    Math.cos(
                        moonPhaseValue * 2 * Math.PI
                    )
                ) / 2 * 100
            );

        const moonImage =
            moonPhaseImage(
                data.daily.moon_phase[0]
            );

        const currentHour =
            now.getHours();

        const humidity =
            data.hourly.relative_humidity_2m[currentHour];

        const cloudCover =
            data.hourly.cloud_cover[currentHour];

        const pressure =
            Math.round(
                data.hourly.pressure_msl[currentHour]
            );

        const feelsLike =
            Math.round(
                data.hourly.apparent_temperature[currentHour]
            );

        const rain2h = getNext2HourRainMetrics(data, now);
        const maxRain = rain2h.total2hMm;
        const rainRisk = rain2h.statusLabel;
        const rainColour = rain2h.statusColour;

        const rainForecast =
            evaluateRainForecast(
                data,
                now
            );

        const rainTheme =
            getRainTheme(
                rainForecast
            );

        const rainBadgeHtml =
            formatRainBadge(
                rainForecast
            );

        let weatherAlert =
            "None";

        if (rain2h.peakRateMmHr >= 3.0) {

            weatherAlert =
                "Heavy rain expected";

        } else if (
            data.current_weather.windspeed >= 30
        ) {

            weatherAlert =
                "Strong winds";

        } else if (
            cloudCover >= 95
        ) {

            weatherAlert =
                "Low cloud";

        }

        const hasActiveWeatherAlert =
            weatherAlert !== "None";

        const windSpeedRounded =
            Math.round(data.current_weather.windspeed);

        document.getElementById("weather-content").innerHTML = `
            <div class="weather-intel-hero" style="
                background:${rainTheme.bg};
                border:1px solid ${rainTheme.border};
                border-left:4px solid ${rainTheme.color};
            ">
                <div class="weather-intel-top">
                    <span class="weather-intel-headline" style="color:${rainTheme.color};">
                        ${rainForecast.headline}
                    </span>
                    ${rainBadgeHtml}
                </div>
                <div class="weather-intel-detail">${rainForecast.detail}</div>
            </div>

            <p class="weather-grid-item"><strong>Condition:</strong> ${weatherText}</p>
            <p class="weather-grid-item"><strong>Temperature:</strong> ${data.current_weather.temperature}°C</p>

            <p class="weather-grid-item"><strong>Feels Like:</strong> ${feelsLike}°C</p>
            <p class="weather-grid-item"><strong>Wind:</strong> ${windDirection} (${data.current_weather.winddirection}°) ${windSpeedRounded} km/h</p>

            <p class="weather-grid-item"><strong>Cloud Cover:</strong> ${cloudCover}%</p>
            <p class="weather-grid-item"><strong>Rain Next 2h:</strong>
                <span style="color:${rainColour};font-weight:bold;">${rainRisk}</span>
                (${maxRain.toFixed(1)} mm)
            </p>

            <p class="weather-alert-row ${hasActiveWeatherAlert ? "is-active" : ""}">
                <strong>Weather Alert:</strong> ${weatherAlert}
            </p>

            <hr class="weather-divider">

            <p class="weather-grid-item weather-ref"><strong>Humidity:</strong> ${humidity}%</p>
            <p class="weather-grid-item weather-ref"><strong>Pressure:</strong> ${pressure} hPa</p>

            <p class="weather-grid-item weather-ref"><strong>Sunrise:</strong> ${sunriseText}</p>
            <p class="weather-grid-item weather-ref"><strong>Sunset:</strong> ${sunsetText}</p>

            ${mode === "NIGHT" ? `

            <hr class="weather-divider">

            <div class="weather-night-astro">

                <div>

                    <p><strong>Moon Phase:</strong>
                    ${moonPhase}</p>

                    <p><strong>Illumination:</strong>
                    ${moonIllumination}%</p>

                    <p><strong>Moonrise:</strong>
                    ${moonriseText}</p>

                    <p><strong>Moonset:</strong>
                    ${moonsetText}</p>

                </div>

                <img
                    src="${moonImage}"
                    alt="Moon Phase"
                    style="
                        width:100px;
                        height:100px;
                        object-fit:contain;
                    ">

            </div>

            ` : ""}
        `;

        if (typeof renderTonightSummary === "function") {
            renderTonightSummary({
                mode,
                cloudCover,
                moonPhase,
                moonIllumination,
                lat: currentLat,
                lon: currentLon
            });
        }

    } catch (error) {

        console.error("Weather load failed", error);

    }

}

function updateRainRadar() {

    if (!currentLat || !currentLon) {
        return;
    }

    if (document.body.classList.contains("night-mode")) {
        return;
    }

    if (!rainRadarMap) {

        rainRadarMap =
            L.map("rain-radar", {
                zoomControl: false,
                attributionControl: false
            }).setView(
                [
                    currentLat,
                    currentLon
                ],
                7
            );

        L.tileLayer(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        ).addTo(
            rainRadarMap
        );

        addRadarTimeControl();

        loadRainViewerLayer();

    }

}

async function loadRainViewerLayer() {

    // The radar map only exists once it has been created in day mode,
    // so there is nothing to add layers to at night.
    if (!rainRadarMap) {
        return;
    }

    try {

        const response =
            await fetch(
                "https://api.rainviewer.com/public/weather-maps.json"
            );

        const data =
            await response.json();

        rainFrames =
            data.radar.past.map(
                frame =>
                    `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`
            );

        rainFrameTimes =
            data.radar.past.map(
                frame => frame.time
            );

        // Replace the old frames with the newest ones, so the radar
        // keeps up with the clock instead of freezing on the first load
        {

            rainRadarLayers.forEach(layer => {
                rainRadarMap.removeLayer(layer);
            });

            rainRadarLayers = [];
            currentFrame = 0;

            rainFrames.forEach(frameUrl => {

                const layer =
                    L.tileLayer(
                        frameUrl,
                        {
                            opacity: 0
                        }
                    ).addTo(
                        rainRadarMap
                    );

                rainRadarLayers.push(
                    layer
                );

            });

            if (rainRadarLayers.length > 0) {
                rainRadarLayers[0]
                    .setOpacity(0.65);
            }

            updateRadarTimeLabel(0);

        }

        if (!radarAnimation) {

            startRadarAnimation();

        }

    } catch (err) {

        console.error(
            "RainViewer load failed",
            err
        );

    }

}

// Clock shown in the corner of the radar for the frame being displayed
function updateRadarTimeLabel(index) {

    const el = document.getElementById("radar-time");

    if (!el || !rainFrameTimes[index]) {
        return;
    }

    const when = new Date(rainFrameTimes[index] * 1000);

    const clock =
        when.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit"
        });

    const minsAgo =
        Math.round(
            (Date.now() - when.getTime()) / 60000
        );

    const isLatest =
        index === rainFrameTimes.length - 1;

    el.textContent =
        `🌧 ${clock}` +
        (isLatest
            ? " · latest"
            : ` · ${minsAgo} min ago`);

}

function addRadarTimeControl() {

    if (!rainRadarMap || document.getElementById("radar-time")) {
        return;
    }

    const control = L.control({ position: "topright" });

    control.onAdd = function () {

        const div = L.DomUtil.create("div", "radar-time");

        div.id = "radar-time";

        div.style.cssText =
            "background:rgba(17,24,39,0.88);" +
            "color:#fff;" +
            "padding:4px 10px;" +
            "border-radius:6px;" +
            "font:bold 13px Arial,sans-serif;" +
            "border:1px solid #4da6ff;" +
            "white-space:nowrap;";

        return div;

    };

    control.addTo(rainRadarMap);

}

function startRadarAnimation() {

    radarAnimation =
        setInterval(() => {

            if (
                rainRadarLayers.length === 0
            ) {
                return;
            }

            const previousFrame =
                currentFrame;

            currentFrame++;

            if (
                currentFrame >=
                rainRadarLayers.length
            ) {

                currentFrame = 0;

            }

            rainRadarLayers[
                previousFrame
            ].setOpacity(0);

            rainRadarLayers[
                currentFrame
            ].setOpacity(0.65);

            updateRadarTimeLabel(currentFrame);

        }, 450);

}

setInterval(
    loadWeather,
    60000
);

setInterval(
    loadRainViewerLayer,
    300000
);