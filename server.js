require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3000;
const BOOKINGS_FILE = path.join(__dirname, "bookings.json");
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "change-this-admin-secret";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

function getAllowedAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function createAdminToken(email) {
  const payload = JSON.stringify({
    email: email.toLowerCase(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8
  });
  const encodedPayload = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const allowedEmails = getAllowedAdminEmails();

  if (payload.expiresAt < Date.now() || !allowedEmails.includes(payload.email)) {
    return null;
  }

  return payload;
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const admin = verifyAdminToken(token);

  if (!admin) {
    return res.status(401).json({ message: "Admin access required." });
  }

  req.admin = admin;
  return next();
}

function validateBooking(booking) {
  const requiredFields = ["name", "email", "phone", "service", "date", "time"];
  const missingFields = requiredFields.filter((field) => !booking[field] || String(booking[field]).trim() === "");
  const email = String(booking.email || "").trim();
  const phone = String(booking.phone || "").trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const indianPhonePattern = /^(?:\+91[\s-]?|91[\s-]?|0)?[6-9]\d{9}$/;

  if (missingFields.length > 0) {
    return `Missing required field${missingFields.length > 1 ? "s" : ""}: ${missingFields.join(", ")}`;
  }

  if (!emailPattern.test(email)) {
    return "Please enter a valid email address.";
  }

  if (!indianPhonePattern.test(phone.replace(/\s+/g, ""))) {
    return "Please enter a valid Indian phone number.";
  }

  return null;
}

async function readBookings() {
  try {
    const data = await fs.readFile(BOOKINGS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeBookings(bookings) {
  await fs.writeFile(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

function createStoredBooking(booking, status = "confirmed") {
  return {
    id: `RY-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: String(booking.name).trim(),
    email: String(booking.email).trim(),
    phone: String(booking.phone).trim(),
    service: String(booking.service).trim(),
    date: String(booking.date).trim(),
    time: String(booking.time).trim(),
    status,
    createdAt: new Date().toISOString()
  };
}

function createEmailTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function createSmsClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }

  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function formatBookingMessage(booking) {
  return [
    "Rayeth Studio booking request",
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    `Phone: ${booking.phone}`,
    `Service: ${booking.service}`,
    `Date: ${booking.date}`,
    `Time: ${booking.time}`
  ].join("\n");
}

async function sendBookingEmails(booking) {
  const transporter = createEmailTransporter();

  if (!transporter) {
    console.info("Email credentials are not configured. Skipping email notifications.");
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const ownerEmail = process.env.SALON_OWNER_EMAIL;
  const bookingDetails = formatBookingMessage(booking);

  await transporter.sendMail({
    from,
    to: booking.email,
    subject: "Rayeth Studio booking confirmation",
    text: `Thank you for booking with Rayeth Studio.\n\n${bookingDetails}`
  });

  if (ownerEmail) {
    await transporter.sendMail({
      from,
      to: ownerEmail,
      subject: "New Rayeth Studio booking",
      text: bookingDetails
    });
  }
}

async function sendBookingSms(booking) {
  const client = createSmsClient();

  if (!client || !process.env.TWILIO_FROM_NUMBER) {
    console.info("Twilio credentials are not configured. Skipping SMS notifications.");
    return;
  }

  const bookingDetails = formatBookingMessage(booking);
  const messages = [
    {
      to: booking.phone,
      body: `Rayeth Studio booking received for ${booking.service} on ${booking.date} at ${booking.time}.`
    }
  ];

  if (process.env.SALON_OWNER_PHONE) {
    messages.push({
      to: process.env.SALON_OWNER_PHONE,
      body: bookingDetails
    });
  }

  await Promise.all(
    messages.map((message) =>
      client.messages.create({
        from: process.env.TWILIO_FROM_NUMBER,
        to: message.to,
        body: message.body
      })
    )
  );
}

app.post("/api/book", async (req, res) => {
  const booking = req.body;
  const validationError = validateBooking(booking);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    const storedBooking = createStoredBooking(booking);
    const bookings = await readBookings();

    bookings.unshift(storedBooking);
    await writeBookings(bookings);
    await Promise.all([sendBookingEmails(storedBooking), sendBookingSms(storedBooking)]);

    return res.status(201).json({
      message: "Booking request received.",
      booking: storedBooking
    });
  } catch (error) {
    console.error("Booking save or notification failed:", error);
    return res.status(500).json({
      message: "Booking could not be saved. Please try again."
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const allowedEmails = getAllowedAdminEmails();

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  if (!allowedEmails.length) {
    return res.status(500).json({ message: "Admin email is not configured." });
  }

  if (!allowedEmails.includes(email) || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Invalid admin login." });
  }

  return res.json({ token: createAdminToken(email), email });
});

app.get("/api/admin/bookings", requireAdmin, async (_req, res) => {
  try {
    const bookings = await readBookings();
    return res.json({ bookings });
  } catch (error) {
    console.error("Could not read bookings:", error);
    return res.status(500).json({ message: "Could not load bookings." });
  }
});

app.post("/api/admin/bookings", requireAdmin, async (req, res) => {
  const validationError = validateBooking(req.body);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    const booking = createStoredBooking(req.body, req.body.status || "confirmed");
    const bookings = await readBookings();

    bookings.unshift(booking);
    await writeBookings(bookings);

    return res.status(201).json({ message: "Appointment added.", booking });
  } catch (error) {
    console.error("Could not add admin booking:", error);
    return res.status(500).json({ message: "Could not add appointment." });
  }
});

app.patch("/api/admin/bookings/:id/cancel", requireAdmin, async (req, res) => {
  try {
    const bookings = await readBookings();
    const booking = bookings.find((item) => item.id === req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    booking.status = "cancelled";
    booking.cancelledAt = new Date().toISOString();
    await writeBookings(bookings);

    return res.json({ message: "Appointment cancelled.", booking });
  } catch (error) {
    console.error("Could not cancel booking:", error);
    return res.status(500).json({ message: "Could not cancel appointment." });
  }
});

app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const bookings = await readBookings();
    const nextBookings = bookings.filter((item) => item.id !== req.params.id);

    if (nextBookings.length === bookings.length) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    await writeBookings(nextBookings);
    return res.json({ message: "Appointment removed." });
  } catch (error) {
    console.error("Could not remove booking:", error);
    return res.status(500).json({ message: "Could not remove appointment." });
  }
});

app.delete("/api/admin/bookings", requireAdmin, async (_req, res) => {
  try {
    await writeBookings([]);
    return res.json({ message: "All appointments cleared." });
  } catch (error) {
    console.error("Could not clear bookings:", error);
    return res.status(500).json({ message: "Could not clear appointments." });
  }
});

app.listen(PORT, () => {
  console.log(`Rayeth Studio server running at http://localhost:${PORT}`);
});
