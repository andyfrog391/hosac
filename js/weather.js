let rainRadarMap = null;
let rainRadarLayers = [];
let rainFrames = [];
let currentFrame = 0;
let radarAnimation = null;
let rainFrameTimes = [];

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

async function loadWeather() {

    if (!currentLat || !currentLon) {
        return;
    }

    const url =
        `https://api.open-meteo.com/v1/forecast
    ?latitude=${currentLat}
    &longitude=${currentLon}
    &current_weather=true
    &hourly=relative_humidity_2m,cloud_cover,pressure_msl,apparent_temperature,precipitation
    &daily=sunrise,sunset,moonrise,moonset,moon_phase
    &timezone=auto`
            .replace(/\s/g, '');

    try {

        const response = await fetch(url);
        const data = await response.json();

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

        let nextEvent;
        let eventTime;
        let mode;
        let aircraftRadius;

        if (now < sunrise) {

            // Early morning, before today's sunrise
            nextEvent = "Sunrise";
            eventTime = sunrise;
            mode = "NIGHT";
            aircraftRadius = 75;

        } else if (now < sunset) {

            nextEvent = "Sunset";
            eventTime = sunset;
            mode = "DAY";
            aircraftRadius = 50;

        } else {

            // After sunset: next sunrise is tomorrow
            nextEvent = "Sunrise";

            eventTime = new Date(sunrise);
            eventTime.setDate(
                eventTime.getDate() + 1
            );

            mode = "NIGHT";
            aircraftRadius = 75;
        }

        const eventTimeText =
            eventTime.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit"
            });

        document.getElementById("mode").textContent =
            `Mode: ${mode} · ${nextEvent} ${eventTimeText}`;

        document.getElementById(
            "weather-title"
        ).textContent =
            mode === "NIGHT"
                ? "Sky Intelligence"
                : "Weather";

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

        const difference =
            eventTime - now;

        const hours =
            Math.floor(
                difference / 1000 / 60 / 60
            );

        const minutes =
            Math.floor(
                (difference / 1000 / 60) % 60
            );

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

        let issInfo = "Loading...";

        const moonImage =
            moonPhaseImage(
                data.daily.moon_phase[0]
            );

        console.log(
            "Moon phase raw:",
            data.daily.moon_phase[0]
        );

        console.log(
            "Moon image:",
            moonImage
        );

        const currentHour =
            new Date().getHours();

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

        const rainNext2Hours =
            data.hourly.precipitation
                .slice(
                    currentHour,
                    currentHour + 2
                );

        const maxRain =
            Math.max(
                ...rainNext2Hours
            );

        let rainRisk;

        if (maxRain >= 2) {

            rainRisk = "HEAVY";

        } else if (maxRain >= 0.5) {

            rainRisk = "LIKELY";

        } else if (maxRain > 0) {

            rainRisk = "POSSIBLE";

        } else {

            rainRisk = "DRY";

        }

        let rainColour = "#22c55e";

        if (rainRisk === "POSSIBLE") {
            rainColour = "#eab308";
        }

        if (rainRisk === "LIKELY") {
            rainColour = "#f97316";
        }

        if (rainRisk === "HEAVY") {
            rainColour = "#ef4444";
        }
        let rainArrival =
            "No rain expected";

        for (let i = 0; i < 6; i++) {

            if (
                data.hourly.precipitation[
                currentHour + i
                ] > 0.2
            ) {

                rainArrival =
                    `Approx ${i} hour${i !== 1 ? "s" : ""
                    }`;

                break;

            }

        }

        let weatherAlert =
            "None";

        if (maxRain >= 3) {

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
        const rainBars =
            data.hourly.precipitation
                .slice(currentHour, currentHour + 24)
                .map(v => {

                    if (v >= 3) return "█";
                    if (v >= 1) return "▓";
                    if (v >= 0.3) return "▒";
                    if (v > 0) return "░";

                    return "·";

                })
                .join("");
        try {

            const issResponse =
                await fetch(
                    `https://iss-api.polluxlabs.io/iss-pass?lat=${currentLat}&lon=${currentLon}&n=1`
                );

            const issData =
                await issResponse.json();

            if (
                issData.passes &&
                issData.passes.length > 0
            ) {

                const pass =
                    issData.passes[0];

                const riseTime =
                    new Date(
                        pass.rise.time
                    );

                issInfo =
                    `${riseTime.toLocaleTimeString(
                        "en-GB",
                        {
                            hour: "2-digit",
                            minute: "2-digit"
                        }
                    )} • ${Math.round(
                        pass.duration_sec / 60
                    )} mins`;

            }

        } catch {

            issInfo = "Unavailable";

        }

        document.getElementById("weather-content").innerHTML = `
            <p><strong>Condition:</strong> ${weatherText}</p>

            <p><strong>Temperature:</strong>
            ${data.current_weather.temperature}°C</p>

            <p><strong>Feels Like:</strong>
            ${feelsLike}°C</p>

            <p><strong>Humidity:</strong>
            ${humidity}%</p>

            <p><strong>Cloud Cover:</strong>
            ${cloudCover}%</p>

            <p><strong>Pressure:</strong>
            ${pressure} hPa</p>

            <p><strong>Wind:</strong>
            ${windDirection}
            (${data.current_weather.winddirection}°)
            ${data.current_weather.windspeed} km/h</p>

           <p><strong>Rain Next 2h:</strong>
            <span style="
                color:${rainColour};
                font-weight:bold;
            ">
            ${rainRisk}
            </span>
            (${maxRain.toFixed(1)} mm)
            </p>

            <p><strong>Rain Arrival:</strong>
            ${rainArrival}</p>

            <p><strong>Weather Alert:</strong>
            ${weatherAlert}</p>

            <hr style="margin:10px 0;">

            <p><strong>Sunrise:</strong> ${sunriseText}</p>

            <p><strong>Sunset:</strong> ${sunsetText}</p>

            ${mode === "NIGHT" ? `

            <hr style="margin:10px 0;">

            <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
            ">

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

            <hr style="margin:10px 0;">

            <p>
            <strong>ISS Next Pass:</strong>
            ${issInfo}
            </p>

            ` : ""}
        `;

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

setInterval(loadWeather, 60000);

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