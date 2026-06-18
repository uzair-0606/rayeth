const bookingsList = document.querySelector("#bookings-list");
const manualBookingForm = document.querySelector("#manual-booking-form");
const adminMessage = document.querySelector("#admin-message");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#login-message");
const loginCard = document.querySelector("#login-card");
const adminContent = document.querySelector("#admin-content");
const logoutButton = document.querySelector("#logout-button");
const refreshButton = document.querySelector("#refresh-bookings");
const clearButton = document.querySelector("#clear-bookings");
const tokenKey = "rayethAdminToken";

function showMessage(message, type = "") {
  adminMessage.textContent = message;
  adminMessage.className = `admin-message ${type ? `is-${type}` : ""}`;
}

function showLoginMessage(message, type = "") {
  loginMessage.textContent = message;
  loginMessage.className = `admin-message ${type ? `is-${type}` : ""}`;
}

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setAdminVisible(isVisible) {
  loginCard.hidden = isVisible;
  adminContent.hidden = !isVisible;
}

function adminFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${getToken()}`
    }
  });
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "";
  }

  return new Date(`${dateValue}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function renderBookings(bookings) {
  bookingsList.innerHTML = "";

  if (!bookings.length) {
    bookingsList.innerHTML = '<p class="empty-state">No appointments saved yet.</p>';
    return;
  }

  bookings.forEach((booking) => {
    const item = document.createElement("article");
    const isCancelled = booking.status === "cancelled";

    item.className = "booking-item";
    item.innerHTML = `
      <div>
        <h3>${booking.name}</h3>
        <p class="booking-meta">${booking.service} | ${formatDate(booking.date)} | ${booking.time}</p>
        <p class="booking-meta">${booking.phone} | ${booking.email}</p>
        <span class="booking-status ${isCancelled ? "cancelled" : ""}">${booking.status}</span>
      </div>
      <div class="booking-actions">
        <button class="cancel-button" type="button" data-action="cancel" data-id="${booking.id}" ${isCancelled ? "disabled" : ""}>Cancel</button>
        <button class="remove-button" type="button" data-action="remove" data-id="${booking.id}">Remove</button>
      </div>
    `;
    bookingsList.appendChild(item);
  });
}

async function loadBookings() {
  const response = await adminFetch("/api/admin/bookings");
  const result = await response.json();

  if (response.status === 401) {
    localStorage.removeItem(tokenKey);
    setAdminVisible(false);
  }

  if (!response.ok) {
    throw new Error(result.message || "Could not load appointments.");
  }

  renderBookings(result.bookings);
}

async function addManualBooking(event) {
  event.preventDefault();

  const booking = Object.fromEntries(new FormData(manualBookingForm).entries());

  try {
    const response = await adminFetch("/api/admin/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Could not add appointment.");
    }

    manualBookingForm.reset();
    showMessage("Appointment added.", "success");
    await loadBookings();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function handleBookingAction(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
  const options = action === "cancel"
    ? { method: "PATCH" }
    : { method: "DELETE" };
  const url = action === "cancel"
    ? `/api/admin/bookings/${id}/cancel`
    : `/api/admin/bookings/${id}`;

  if (action === "remove" && !confirm("Remove this appointment permanently?")) {
    return;
  }

  const response = await adminFetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    showMessage(result.message || "Action failed.", "error");
    return;
  }

  showMessage(result.message, "success");
  await loadBookings();
}

async function clearBookings() {
  if (!confirm("Clear all appointments permanently?")) {
    return;
  }

  const response = await adminFetch("/api/admin/bookings", { method: "DELETE" });
  const result = await response.json();

  if (!response.ok) {
    showMessage(result.message || "Could not clear appointments.", "error");
    return;
  }

  showMessage(result.message, "success");
  await loadBookings();
}

async function loginAdmin(event) {
  event.preventDefault();

  const credentials = Object.fromEntries(new FormData(loginForm).entries());

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Login failed.");
    }

    localStorage.setItem(tokenKey, result.token);
    loginForm.reset();
    showLoginMessage("");
    setAdminVisible(true);
    await loadBookings();
  } catch (error) {
    showLoginMessage(error.message, "error");
  }
}

function logoutAdmin() {
  localStorage.removeItem(tokenKey);
  setAdminVisible(false);
}

loginForm.addEventListener("submit", loginAdmin);
logoutButton.addEventListener("click", logoutAdmin);
manualBookingForm.addEventListener("submit", addManualBooking);
bookingsList.addEventListener("click", handleBookingAction);
refreshButton.addEventListener("click", loadBookings);
clearButton.addEventListener("click", clearBookings);

if (getToken()) {
  setAdminVisible(true);
  loadBookings().catch((error) => {
    showMessage(error.message, "error");
    setAdminVisible(false);
  });
} else {
  setAdminVisible(false);
}
