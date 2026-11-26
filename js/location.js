let currentLat = null;
let currentLon = null;

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