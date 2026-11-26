function updateClock() {

    const now = new Date();

    document.getElementById("clock").textContent =
        "Time: " +
        now.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit"
        });
}

setInterval(updateClock, 1000);

updateClock();