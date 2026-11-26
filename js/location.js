let currentLat = null;
let currentLon = null;

let lastRadarGps = null;

// Keep the weather radar centred on the tablet as the GPS moves.
// Ignores small GPS jitter (under 500 m) and keeps the current zoom.
function followRadarToGps() {

    if (typeof rainRadarMap === "undefined" || !rainRadarMap) {
        return;
    }

    if (!lastRadarGps) {
        lastRadarGps = [currentLat, currentLon];
        return;
    }

    const movedMetres =
        rainRadarMap.distance(
            lastRadarGps,
            [currentLat, currentLon]
        );

    if (movedMetres > 500) {

        rainRadarMap.setView(
            [currentLat, currentLon],
            rainRadarMap.getZoom()
        );

        lastRadarGps = [currentLat, currentLon];

    }

}

function updateLocation(position) {

    currentLat = position.coords.latitude;
    currentLon = position.coords.longitude;

    document.getElementById("gpsStatus").textContent =
        "GPS: ✓";

    initialiseAircraftMap(
        currentLat,
        currentLon
    );

    if (typeof initOrUpdateAstronomy === "function") {
        initOrUpdateAstronomy(currentLat, currentLon);
    }

    followRadarToGps();

    loadWeather();

    if (typeof refreshAlerts === "function") {
        refreshAlerts();
    }
}

function locationError(error) {

    document.getElementById("gpsStatus").textContent =
        "GPS: Unavailable";

    console.log(error);
}

if (navigator.geolocation) {

    navigator.geolocation.getCurrentPosition(
        updateLocation,
        locationError
    );

    navigator.geolocation.watchPosition(
        updateLocation,
        locationError,
        {
            enableHighAccuracy: true,
            maximumAge: 15000,
            timeout: 20000
        }
    );

}