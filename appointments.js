const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector(".site-menu");
const menuBackdrop = document.querySelector(".menu-backdrop");
const timeSlotsContainer = document.querySelector("#time-slots");
const selectedTimeInput = document.querySelector("#selected-time");
const bookingForm = document.querySelector("#booking-form");
const formMessage = document.querySelector("#form-message");
const dateInput = bookingForm.elements.date;

const availableTimes = [
  "08:00 AM",
  "08:30 AM",
  "09:00 AM",
  "09:30 AM",
  "10:00 AM",
  "10:30 AM",
  "11:00 AM",
  "11:30 AM",
  "12:00 PM",
  "12:30 PM",
  "01:00 PM",
  "01:30 PM",
  "02:00 PM",
  "02:30 PM",
  "03:00 PM",
  "03:30 PM",
  "04:00 PM",
  "04:30 PM",
  "05:00 PM",
  "05:30 PM",
  "06:00 PM",
  "06:30 PM",
  "07:00 PM",
  "07:30 PM",
  "08:00 PM",
  "08:30 PM",
  "09:00 PM",
  "09:30 PM",
  "10:00 PM"
];

function setMenuState(isOpen) {
  if (!menuToggle || !siteMenu || !menuBackdrop) {
    return;
  }

  menuToggle.classList.toggle("is-open", isOpen);
  siteMenu.classList.toggle("is-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  siteMenu.setAttribute("aria-hidden", String(!isOpen));
  menuBackdrop.hidden = !isOpen;
  document.body.style.overflow = isOpen ? "hidden" : "";
}

function setMinimumDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dateInput.min = `${yyyy}-${mm}-${dd}`;
}

function renderTimeSlots() {
  timeSlotsContainer.innerHTML = "";

  availableTimes.forEach((time) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot";
    button.textContent = time;
    button.dataset.time = time;
    button.addEventListener("click", () => selectTime(button));
    timeSlotsContainer.appendChild(button);
  });
}

function selectTime(selectedButton) {
  document.querySelectorAll(".time-slot").forEach((button) => {
    button.classList.toggle("is-selected", button === selectedButton);
  });
  selectedTimeInput.value = selectedButton.dataset.time;
}

function showMessage(message, type) {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type ? `is-${type}` : ""}`;
}

async function submitBooking(event) {
  event.preventDefault();

  if (!selectedTimeInput.value) {
    showMessage("Please select an available time slot.", "error");
    return;
  }

  const submitButton = bookingForm.querySelector(".confirm-button");
  const formData = new FormData(bookingForm);
  const booking = Object.fromEntries(formData.entries());

  submitButton.disabled = true;
  submitButton.textContent = "Confirming...";
  showMessage("", "");

  try {
    const response = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Booking could not be completed.");
    }

    bookingForm.reset();
    selectedTimeInput.value = "";
    document.querySelectorAll(".time-slot").forEach((button) => button.classList.remove("is-selected"));
    showMessage("Your booking request has been received. A confirmation will follow shortly.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Confirm Booking";
  }
}

if (menuToggle && siteMenu && menuBackdrop) {
  menuToggle.addEventListener("click", () => {
    setMenuState(!siteMenu.classList.contains("is-open"));
  });

  menuBackdrop.addEventListener("click", () => setMenuState(false));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenuState(false);
  }
});

bookingForm.addEventListener("submit", submitBooking);

setMinimumDate();
renderTimeSlots();
