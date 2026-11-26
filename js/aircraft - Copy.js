let aircraftMap;
let aircraftMarkers = new Map();
let refreshTimer = null;

const WORKER_URL =
    "https://aircraft.andrew-froggatt01.workers.dev";

let currentAircraftRadius = 50;
let aircraftRadiusCircle = null;
let tileLayer = null;

function updateAircraftRadius(radius) {

    currentAircraftRadius = radius;

    if (aircraftRadiusCircle) {

        aircraftRadiusCircle.setRadius(
            radius * 1609.34
        );

    }

}

function setMapTheme(mode) {

    document.body.dataset.mode =
        mode;

    if (!aircraftMap || !tileLayer) {
        return;
    }

    aircraftMap.removeLayer(
        tileLayer
    );

    if (mode === "NIGHT") {

        tileLayer =
            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                {
                    attribution:
                        "&copy; CARTO"
                }
            );

    } else {

        tileLayer =
            L.tileLayer(
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    attribution:
                        "&copy; OpenStreetMap"
                }
            );

    }

    tileLayer.addTo(
        aircraftMap
    );

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

        "RRR",
        "ASCOT",
        "RCH",
        "QID",
        "NATO",
        "SHF",
        "CFC",
        "AME",
        "DUKE",
        "BAF"

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

    return (
        ac.dbFlags &&
        (ac.dbFlags & 1) === 1
    );

}

function isHelicopter(ac) {

    const type =
        (ac.t || "")
        .toUpperCase();

    return (
        type.includes("H") ||
        ac.category === "A7"
    );

}

function buildIcon(ac) {

    const military =
        isMilitary(ac);

    const helicopter =
        isHelicopter(ac);

    const symbol =
        helicopter ?
        "🚁" :
        "✈️";

    const colour =
        military ?
        "#ff4444" :
        "#4da6ff";

    return L.divIcon({

        html: `
            <div style="
                font-size:22px;
                color:${colour};
                transform:rotate(${ac.track || 0}deg);
            ">
                ${symbol}
            </div>
        `,

        className: "",
        iconSize: [22,22],
        iconAnchor: [11,11]

    });

}

async function loadAircraft() {

    if (
        currentLat === null ||
        currentLon === null
    ) {
        return;
    }

    try {

        const response =
            await fetch(
                `${WORKER_URL}/lat/${currentLat}/lon/${currentLon}/dist/${currentAircraftRadius}`
            );

        const data =
            await response.json();

        if (
            data.success === false
        ) {

            console.log(
                "Aircraft feed unavailable",
                data.errors
            );

            return;

        }

        const aircraft =
            data.ac ||
            data.aircraft ||
            [];

        const seen =
            new Set();

        let militaryCount = 0;
        let civilianCount = 0;
        let emergencyCount = 0;

        aircraft.forEach(ac => {

            if (
                !ac.lat ||
                !ac.lon
            ) {
                return;
            }

            const actualDistance =
                aircraftMap.distance(
                    [currentLat,currentLon],
                    [ac.lat,ac.lon]
                ) / 1609.34;

            if (
                actualDistance >
                currentAircraftRadius
            ) {
                return;
            }

            const id =
                ac.hex ||
                ac.flight;

            if (!id) {
                return;
            }

            seen.add(id);

            const military =
                isMilitary(ac);

            if (military) {
                militaryCount++;
            } else {
                civilianCount++;
            }

            if (
                ac.squawk === "7500" ||
                ac.squawk === "7600" ||
                ac.squawk === "7700"
            ) {

                emergencyCount++;

            }

            const popup = `

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

                Distance:
                ${actualDistance.toFixed(1)} mi<br>

                Category:
                ${military ? "Military" : "Civilian"}

            `;

            if (
                aircraftMarkers.has(id)
            ) {

                const marker =
                    aircraftMarkers.get(id);

                marker.setLatLng(
                    [
                        ac.lat,
                        ac.lon
                    ]
                );

                marker.setIcon(
                    buildIcon(ac)
                );

                marker.setPopupContent(
                    popup
                );

            } else {

                const marker =
                    L.marker(
                        [
                            ac.lat,
                            ac.lon
                        ],
                        {
                            icon:
                                buildIcon(ac)
                        }
                    )
                    .addTo(
                        aircraftMap
                    )
                    .bindPopup(
                        popup
                    );

                aircraftMarkers.set(
                    id,
                    marker
                );

            }

        });

        aircraftMarkers.forEach(
            (
                marker,
                id

            ) => {

                if (
                    !seen.has(id)
                ) {

                    aircraftMap.removeLayer(
                        marker
                    );

                    aircraftMarkers.delete(
                        id
                    );

                }

            }
        );

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

    }

}