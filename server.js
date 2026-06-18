require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const { getDatabase } = require("./lib/mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || "change-this-admin-secret";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

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

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return null;
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  );

  const allowedEmails = getAllowedAdminEmails();

  if (
    payload.expiresAt < Date.now() ||
    !allowedEmails.includes(payload.email)
  ) {
    return null;
  }

  return payload;
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");

  const admin = verifyAdminToken(token);

  if (!admin) {
    return res.status(401).json({
      message: "Admin access required."
    });
  }

  req.admin = admin;

  next();
}

function validateBooking(booking) {
  const requiredFields = [
    "name",
    "email",
    "phone",
    "service",
    "date",
    "time"
  ];

  const missingFields = requiredFields.filter(
    (field) =>
      !booking[field] || String(booking[field]).trim() === ""
  );

  if (missingFields.length > 0) {
    return `Missing fields: ${missingFields.join(", ")}`;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(String(booking.email).trim())) {
    return "Invalid email address.";
  }

  const phonePattern =
    /^(?:\+91|91|0)?[6-9][0-9]{9}$/;

  if (
    !phonePattern.test(
      String(booking.phone).replace(/\s+/g, "")
    )
  ) {
    return "Invalid phone number.";
  }

  return null;
}

async function getBookingsCollection() {
  const db = await getDatabase();

  return db.collection("appointments");
}

async function readBookings() {
  const collection = await getBookingsCollection();

  return await collection
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
}

function createStoredBooking(
  booking,
  status = "confirmed"
) {
  return {
    id:
      "RY-" +
      Date.now() +
      "-" +
      Math.random().toString(16).slice(2, 8),

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
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
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
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN
  ) {
    return null;
  }

  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

function formatBookingMessage(booking) {
  return `
Rayeth Studio Booking

Name: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone}
Service: ${booking.service}
Date: ${booking.date}
Time: ${booking.time}
`;
}

async function sendBookingEmails(booking) {
  const transporter = createEmailTransporter();

  if (!transporter) {
    return;
  }

  const from =
    process.env.EMAIL_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to: booking.email,
    subject: "Rayeth Studio Booking Confirmation",
    text: formatBookingMessage(booking)
  });

  if (process.env.SALON_OWNER_EMAIL) {
    await transporter.sendMail({
      from,
      to: process.env.SALON_OWNER_EMAIL,
      subject: "New Booking",
      text: formatBookingMessage(booking)
    });
  }
}

async function sendBookingSms(booking) {
  const client = createSmsClient();

  if (
    !client ||
    !process.env.TWILIO_FROM_NUMBER
  ) {
    return;
  }

  await client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to: booking.phone,
    body:
      `Rayeth Studio booking confirmed for ${booking.date} at ${booking.time}.`
  });
}
app.post("/api/book", async (req, res) => {
  const booking = req.body;

  const validationError = validateBooking(booking);

  if (validationError) {
    return res.status(400).json({
      message: validationError
    });
  }

  try {
    const collection = await getBookingsCollection();

    const storedBooking = createStoredBooking(booking);

    const existingBooking = await collection.findOne({
      date: storedBooking.date,
      time: storedBooking.time,
      status: { $ne: "cancelled" }
    });

    if (existingBooking) {
      return res.status(409).json({
        message: "This slot is already booked."
      });
    }

    await collection.insertOne(storedBooking);

    await Promise.all([
      sendBookingEmails(storedBooking),
      sendBookingSms(storedBooking)
    ]);

    return res.status(201).json({
      message: "Booking request received.",
      booking: storedBooking
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Booking could not be saved."
    });
  }
});

app.post("/api/admin/login", (req, res) => {

  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");

  const allowedEmails = getAllowedAdminEmails();

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required."
    });
  }

  if (!allowedEmails.includes(email)) {
    return res.status(401).json({
      message: "Invalid admin login."
    });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      message: "Invalid admin login."
    });
  }

  return res.json({
    token: createAdminToken(email),
    email
  });

});

app.get("/api/admin/bookings", requireAdmin, async (req, res) => {

  try {

    const bookings = await readBookings();

    return res.json({
      bookings
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      message: "Could not load bookings."
    });

  }

});

app.post("/api/admin/bookings", requireAdmin, async (req, res) => {

  const validationError = validateBooking(req.body);

  if (validationError) {

    return res.status(400).json({
      message: validationError
    });

  }

  try {

    const collection = await getBookingsCollection();

    const booking = createStoredBooking(
      req.body,
      req.body.status || "confirmed"
    );

    const existingBooking = await collection.findOne({
      date: booking.date,
      time: booking.time,
      status: { $ne: "cancelled" }
    });

    if (existingBooking) {

      return res.status(409).json({
        message: "This slot is already booked."
      });

    }

    await collection.insertOne(booking);

    return res.status(201).json({

      message: "Appointment added.",

      booking

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      message: "Could not add appointment."

    });

  }

});

app.patch(
  "/api/admin/bookings/:id/cancel",
  requireAdmin,
  async (req, res) => {

    try {

      const collection = await getBookingsCollection();

      const result = await collection.findOneAndUpdate(

        {
          id: req.params.id
        },

        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date().toISOString()
          }
        },

        {
          returnDocument: "after"
        }

      );

      if (!result.value && !result) {

        return res.status(404).json({

          message: "Appointment not found."

        });

      }

      return res.json({

        message: "Appointment cancelled.",

        booking: result.value || result

      });

    } catch (error) {

      console.error(error);

      return res.status(500).json({

        message: "Could not cancel appointment."

      });

    }

  }
);
app.delete(
  "/api/admin/bookings/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const collection = await getBookingsCollection();

      const result = await collection.deleteOne({
        id: req.params.id
      });

      if (!result.deletedCount) {
        return res.status(404).json({
          message: "Appointment not found."
        });
      }

      return res.json({
        message: "Appointment removed."
      });

    } catch (error) {

      console.error(error);

      return res.status(500).json({
        message: "Could not remove appointment."
      });

    }
  }
);

app.delete(
  "/api/admin/bookings",
  requireAdmin,
  async (req, res) => {

    try {

      const collection = await getBookingsCollection();

      await collection.deleteMany({});

      return res.json({
        message: "All appointments cleared."
      });

    } catch (error) {

      console.error(error);

      return res.status(500).json({
        message: "Could not clear appointments."
      });

    }

  }
);

/* Health check */

app.get("/api/health", (req, res) => {
  return res.json({
    success: true,
    message: "Rayeth Studio API running"
  });
});

/* 404 */

app.use((req, res) => {
  return res.status(404).json({
    message: "Route not found"
  });
});

/* Start server */

app.listen(PORT, () => {
  console.log("");
  console.log("====================================");
  console.log(" Rayeth Studio Server Started");
  console.log("====================================");
  console.log(`Running on http://localhost:${PORT}`);
  console.log("====================================");
});