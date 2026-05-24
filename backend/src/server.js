import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import twilio from "twilio";
import { User, Appointment, Queue, Payment, SystemState, Message } from "./models.js";

dotenv.config();

const app = express();
app.use(
  cors({
    origin: true,
    credentials: false,
  })
);
app.use(express.json({ limit: "5mb" }));

const PORT = Number(process.env.PORT || 5050);
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/careline";
const JWT_SECRET = process.env.JWT_SECRET || "careline-secret";


const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));
const CARELINE_ROOT = path.join(__dirnamePath, "..", "..");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirnamePath, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploads folder statically
app.use("/uploads", express.static(uploadsDir));

function saveBase64Image(base64Str, prefix) {
  if (!base64Str || !base64Str.startsWith("data:image/")) return base64Str;
  
  const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return base64Str;
  
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const data = Buffer.from(matches[2], 'base64');
  const filename = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  
  fs.writeFileSync(filepath, data);
  return `/uploads/${filename}`;
}

const otpStore = new Map(); // key = mobile, value = { otpHash, expiresAt, payload }

const RoleEnum = z.enum(["patient", "doctor", "admin", "support"]);

const MobileSchema = z
  .string()
  .transform((s) => s.replace(/[^\d]/g, ""))
  .refine((s) => /^\d{10,13}$/.test(s), "Invalid mobile number");

const EmailSchema = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Invalid email");

const MandatoryEmailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Invalid email");

const PasswordSchema = z.string().min(8, "Password must be at least 8 characters");

function nowMs() {
  return Date.now();
}

function isActionPermitted(dateStr, timeStr) {
  try {
    const [hStr, mPart] = timeStr.split(":");
    const [mStr, ampm] = mPart.split(" ");
    let hours = parseInt(hStr);
    const minutes = parseInt(mStr);
    if (ampm.toLowerCase() === "pm" && hours < 12) hours += 12;
    if (ampm.toLowerCase() === "am" && hours === 12) hours = 0;

    const apptTime = new Date(dateStr);
    apptTime.setHours(hours, minutes, 0, 0);

    const diffMs = apptTime.getTime() - Date.now();
    const oneHourMs = 60 * 60 * 1000;

    return diffMs > oneHourMs;
  } catch (e) {
    return false;
  }
}

function makeId() {
  return crypto.randomBytes(12).toString("hex");
}

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ---- Real Email & SMS OTP Delivery ----

async function sendRealEmail(email, otp) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";
  const from = process.env.SMTP_FROM || '"CareLine" <no-reply@careline.com>';

  let transporter;

  if (host && user && pass) {
    // Configured SMTP
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  } else {
    // Fallback: Generate Ethereal Mail dynamically for development/testing
    console.log("⚠️ SMTP configuration missing. Creating dynamic Ethereal Mail test account...");
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log(`✅ Dynamic Ethereal Mail Account created: ${testAccount.user}`);
    } catch (err) {
      console.error("❌ Failed to create dynamic Ethereal Mail test account:", err);
      console.log(`📬 [MOCK EMAIL] OTP for ${email}: ${otp}`);
      return;
    }
  }

  try {
    const info = await transporter.sendMail({
      from,
      to: email,
      subject: "Your CareLine Verification Code",
      text: `Your CareLine 6-digit OTP verification code is: ${otp}. It will expire in 3 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 12px;">
          <h2 style="color: #0d9488; text-align: center;">CareLine Verification Code</h2>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
          <p>Hello,</p>
          <p>Thank you for registering with CareLine. Please use the following 6-digit One-Time Password (OTP) to verify your account:</p>
          <div style="background-color: #f0fdfa; border: 1px solid #ccfbf1; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 2rem; font-weight: 800; letter-spacing: 4px; color: #0f766e;">${otp}</span>
          </div>
          <p style="font-size: 0.9rem; color: #666;">This code is valid for <strong>3 minutes</strong>. Please do not share this code with anyone.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
          <p style="font-size: 0.8rem; color: #999; text-align: center;">&copy; 2026 CareLine. All rights reserved.</p>
        </div>
      `,
    });

    console.log(`✉️ Email sent: ${info.messageId}`);
    if (!host) {
      // Print Ethereal Mail URL preview
      console.log(`🔗 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    }
  } catch (err) {
    console.error(`❌ Failed to send email to ${email}:`, err);
  }
}

async function sendRealSMS(mobile, otp) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  if (accountSid && authToken && fromNumber) {
    try {
      const client = twilio(accountSid, authToken);
      
      // Determine correct phone format for destination
      let formattedTo = mobile;
      if (!formattedTo.startsWith("+")) {
        if (formattedTo.length === 10) {
          // Auto-prepend +91 for 10-digit Indian numbers
          formattedTo = `+91${formattedTo}`;
        } else {
          formattedTo = `+${formattedTo}`;
        }
      }

      const message = await client.messages.create({
        body: `Your CareLine 6-digit OTP verification code is ${otp}. Valid for 3 minutes.`,
        from: fromNumber,
        to: formattedTo,
      });
      console.log(`📲 SMS sent via Twilio: ${message.sid}`);
    } catch (err) {
      console.error(`❌ Failed to send SMS via Twilio to ${mobile}:`, err);
    }
  } else {
    console.log(`📱 [CONSOLE OTP SMS] OTP for ${mobile}: ${otp}`);
  }
}

function publicUser(u) {
  return {
    id: u._id || u.id,
    role: u.role,
    fullName: u.fullName,
    mobile: u.mobile,
    email: u.email ?? null,
    status: u.status ?? "active",
    profile: u.profile ?? {},
    createdAt: u.createdAt,
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "careline-backend", time: new Date().toISOString() });
});

const ADMIN_KEY = process.env.CARELINE_ADMIN_KEY || "careline-admin";
function requireAdminKey(req, res) {
  const key = req.header("x-careline-admin-key");
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Missing/invalid admin key" });
    return false;
  }
  return true;
}

// ---- Signup (send OTP) ----
const SignupInitiateSchema = z.object({
  role: RoleEnum,
  fullName: z.string().trim().min(1, "Full name is required"),
  mobile: MobileSchema,
  email: MandatoryEmailSchema,
  password: PasswordSchema,
  profile: z.record(z.any()).optional(),
});

app.post("/api/auth/signup/initiate", async (req, res) => {
  const parsed = SignupInitiateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });
  }

  const body = parsed.data;
  const mobile = body.mobile;
  const email = body.email?.trim() || null;

  const existingUser = await User.findOne({ $or: [{ mobile }, ...(email ? [{ email }] : [])] });
  if (existingUser) {
    if (existingUser.status === "rejected") {
      await User.findByIdAndDelete(existingUser._id);
    } else {
      return res.status(409).json({ ok: false, error: "USER_EXISTS", message: "User already exists" });
    }
  }

  const otp = makeOtp();
  const otpHash = sha256(`${mobile}:${otp}`);
  const expiresAt = nowMs() + 3 * 60 * 1000;

  otpStore.set(mobile, {
    otpHash,
    expiresAt,
    payload: {
      role: body.role,
      fullName: body.fullName,
      mobile,
      email,
      passwordHash: await bcrypt.hash(body.password, 10),
      profile: body.profile || {},
    },
  });

  // Actually send the OTP to real channels
  sendRealSMS(mobile, otp);
  if (email) {
    sendRealEmail(email, otp);
  }

  return res.json({ ok: true, message: "OTP sent successfully", mobile, expiresInSeconds: 180 });
});

// ---- Signup (verify OTP & create account) ----
const SignupVerifySchema = z.object({
  mobile: MobileSchema,
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

app.post("/api/auth/signup/verify", async (req, res) => {
  const parsed = SignupVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });
  }

  const { mobile, otp } = parsed.data;
  const entry = otpStore.get(mobile);
  if (!entry) return res.status(400).json({ ok: false, error: "OTP_NOT_FOUND", message: "No OTP in progress" });
  if (nowMs() > entry.expiresAt) {
    otpStore.delete(mobile);
    return res.status(400).json({ ok: false, error: "OTP_EXPIRED", message: "OTP expired" });
  }

  const otpHash = sha256(`${mobile}:${otp}`);
  if (otpHash !== entry.otpHash) return res.status(400).json({ ok: false, error: "OTP_INVALID", message: "Invalid OTP" });

  const existingUser = await User.findOne({ $or: [{ mobile }, ...(entry.payload.email ? [{ email: entry.payload.email }] : [])] });
  if (existingUser) {
    if (existingUser.status === "rejected") {
      await User.findByIdAndDelete(existingUser._id);
    } else {
      otpStore.delete(mobile);
      return res.status(409).json({ ok: false, error: "USER_EXISTS", message: "User already exists" });
    }
  }

  const userId = makeId();

  if (entry.payload.profile && entry.payload.profile.clinicPicture) {
    entry.payload.profile.clinicPicture = saveBase64Image(entry.payload.profile.clinicPicture, `clinic-${userId}`);
  }

  const user = new User({
    _id: userId,
    role: entry.payload.role,
    fullName: entry.payload.fullName,
    mobile: entry.payload.mobile,
    email: entry.payload.email,
    passwordHash: entry.payload.passwordHash,
    profile: entry.payload.profile,
    status: entry.payload.role === "doctor" ? "pending_admin_approval" : "active",
  });

  await user.save();
  otpStore.delete(mobile);

  // ✅ NEW improved code
const token = jwt.sign(
  { id: user._id, role: user.role },
  JWT_SECRET,
  { expiresIn: "7d" }
);
const isDoctorPending = user.role === "doctor" && user.status !== "active";
return res.json({
  ok: true,
  message: isDoctorPending ? "Account created (pending admin approval)" : "Account created",
  token,
  user: publicUser(user.toObject()),
});
});

// ---- Login ----
const LoginSchema = z.object({
  role: RoleEnum.optional(),
  identifier: z.string().trim().min(1, "Identifier is required"),
  password: z.string().min(1, "Password is required"),
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });
  
  const { role, identifier, password } = parsed.data;
  const idTrim = identifier.trim();
  const mobileGuess = idTrim.replace(/[^\d]/g, "");
  const isMobile = /^\d{10,13}$/.test(mobileGuess);
  const emailGuess = idTrim.toLowerCase();

  const user = await User.findOne(isMobile ? { mobile: mobileGuess } : { email: emailGuess });
  if (!user) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS", message: "Invalid credentials" });
  if (role && user.role !== role) return res.status(403).json({ ok: false, error: "ROLE_MISMATCH", message: "Role not permitted for this account" });

  if (user.role === "doctor" && user.status === "pending_admin_approval") {
    return res.status(403).json({ ok: false, error: "DOCTOR_PENDING_APPROVAL", message: "Doctor account is pending clinic administration approval" });
  }

  if (user.role === "doctor" && user.status === "rejected") {
    return res.status(403).json({ ok: false, error: "DOCTOR_REJECTED", message: "Your doctor account was rejected by the clinic administration. Please sign up again." });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS", message: "Invalid credentials" });

  // ✅ NEW improved code
    const token = jwt.sign(
        { id: user._id, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
    return res.json({ ok: true, message: "Logged in", token, user: publicUser(user.toObject()) });
});

// ---- Public: list / search approved doctors ----
app.get("/api/doctors", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const specFilter = String(req.query.specialization || "").trim().toLowerCase();

  let query = { role: "doctor", status: "active" };
  if (specFilter) {
     query["profile.specialization"] = { $regex: specFilter, $options: "i" };
  }

  let doctors = await User.find(query).lean();

  function doctorSearchBlob(u) {
    const p = u.profile || {};
    return [u.fullName, p.specialization, p.clinicAssociation, p.medicalRegistrationNumber]
      .filter(Boolean).join(" ").toLowerCase();
  }

  if (q) {
    doctors = doctors.filter((u) => doctorSearchBlob(u).includes(q));
  }

  const admins = await User.find({ role: "admin" }).lean();

  const out = doctors.map((u) => {
    const p = u.profile || {};
    const clinicName = (p.clinicAssociation || "").trim().toLowerCase();
    const clinic = admins.find(a => (a.profile?.clinicName || "").trim().toLowerCase() === clinicName);
    
    return {
      id: u._id,
      fullName: u.fullName,
      specialization: p.specialization || null,
      clinicAssociation: p.clinicAssociation || null,
      clinicId: clinic ? clinic._id : null,
      availability: "Mon–Sat, 9:00 AM – 6:00 PM"
    };
  });

  return res.json({ ok: true, doctors: out });
});

// ---- Admin: view pending doctors ----
app.get("/api/admin/pending-doctors", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const pending = await User.find({ role: "doctor", status: "pending_admin_approval" }).lean();
  return res.json({ ok: true, pendingDoctors: pending.map(publicUser) });
});

// ---- Admin: approve doctor by id ----
const ApproveDoctorSchema = z.object({
  doctorId: z.string().trim().min(1),
});

app.post("/api/admin/approve-doctor", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const parsed = ApproveDoctorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const { doctorId } = parsed.data;
  const user = await User.findOneAndUpdate(
    { _id: doctorId, role: "doctor" },
    { status: "active", approvedAt: new Date() },
    { new: true }
  ).lean();

  if (!user) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Doctor not found" });

  return res.json({ ok: true, message: "Doctor approved", doctor: publicUser(user) });
});

// ---- Admin: reject doctor by id ----
app.post("/api/admin/reject-doctor", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const parsed = ApproveDoctorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const { doctorId } = parsed.data;
  const user = await User.findOneAndUpdate(
    { _id: doctorId, role: "doctor" },
    { status: "rejected" }
  );

  if (!user) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Doctor not found" });

  return res.json({ ok: true, message: "Doctor rejected and removed" });
});

// ---- Admin: update profile ----
const UpdateProfileSchema = z.object({
  fullName: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  age: z.union([z.number(), z.string()]).optional(),
  gender: z.string().optional(),
  clinicPicture: z.string().optional(),
  consultationFee: z.union([z.number(), z.string()]).optional(),
  clinicLocation: z.string().optional(),
  clinicName: z.string().optional(),
  specialization: z.string().optional(),
  bio: z.string().optional()
});

app.post("/api/user/update-profile", async (req, res) => {
  const userId = req.body.userId;
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const u = await User.findById(userId);
  if (!u) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "User not found" });

  if (parsed.data.fullName) u.fullName = parsed.data.fullName;
  if (parsed.data.mobile) u.mobile = parsed.data.mobile;
  if (parsed.data.email !== undefined) u.email = parsed.data.email;
  
  if (u.role === 'admin') {
    u.profile = u.profile || {};
    if (parsed.data.clinicPicture) {
      u.profile.clinicPicture = saveBase64Image(parsed.data.clinicPicture, `clinic-${u._id}`);
    }
    if (parsed.data.consultationFee !== undefined) u.profile.consultationFee = Number(parsed.data.consultationFee);
    if (parsed.data.clinicLocation) u.profile.clinicLocation = parsed.data.clinicLocation;
    if (parsed.data.clinicName) u.profile.clinicName = parsed.data.clinicName;
  } else if (u.role === 'doctor') {
    u.profile = u.profile || {};
    if (parsed.data.specialization) u.profile.specialization = parsed.data.specialization;
    if (parsed.data.bio) u.profile.bio = parsed.data.bio;
    if (parsed.data.gender) u.profile.gender = parsed.data.gender;
    if (parsed.data.clinicName) u.profile.clinicName = parsed.data.clinicName;
  } else if (u.role === 'patient') {
    u.profile = u.profile || {};
    if (parsed.data.age) u.profile.age = Number(parsed.data.age);
    if (parsed.data.gender) u.profile.gender = parsed.data.gender;
  }
  
  // To ensure Mongoose detects mixed type changes
  u.markModified('profile');
  await u.save();
  
  return res.json({ ok: true, message: "Profile updated successfully", user: publicUser(u.toObject()) });
});

// ---- Queue Management Endpoints ----

// GET /api/queue - Get live queue and today's appointments
app.get("/api/queue", async (req, res) => {
  const { clinicId, doctorId } = req.query;
  
  // Determine requester role for privacy
  let userRole = "guest";
  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
      userRole = decoded.role;
      userId = decoded.id;
    } catch(e) {}
  }
  const isStaff = ['admin', 'doctor', 'support'].includes(userRole);
  
  let apptQuery = {};
  if (clinicId) apptQuery.clinicId = clinicId;
  if (doctorId) apptQuery.doctorId = doctorId;

  const filteredAppts = await Appointment.find(apptQuery).lean();
  const filteredApptIds = filteredAppts.map(a => String(a._id));

  const queueItems = await Queue.find({ apptId: { $in: filteredApptIds } }).lean();

  // Load patients referenced by these appointments
  const patientIds = [...new Set(filteredAppts.map(a => a.patientId))];
  const patientUsers = await User.find({ _id: { $in: patientIds }, role: "patient" }, "fullName mobile").lean();
  const patientMap = Object.fromEntries(patientUsers.map(u => [String(u._id), u]));

  const queueWithDetails = queueItems.map(q => {
    const appt = filteredAppts.find(a => String(a._id) === String(q.apptId));
    const patient = appt ? patientMap[appt.patientId] : null;
    
    let patientData = null;
    if (patient) {
      if (isStaff || String(patient._id) === userId) {
        patientData = { id: String(patient._id), fullName: patient.fullName, mobile: patient.mobile };
      } else {
        // Privacy mask for other patients
        patientData = { id: String(patient._id), fullName: "Patient", mobile: "***" };
      }
    }

    return {
      ...q,
      appt: appt ? { ...appt, id: String(appt._id) } : null,
      patient: patientData
    };
  });
  
  // The frontend might need all patients to assign new tokens (staff only)
  let formattedPatients = [];
  if (isStaff) {
    const patients = await User.find({ role: "patient" }, "fullName mobile").lean();
    formattedPatients = patients.map(u => ({ id: String(u._id), fullName: u.fullName, mobile: u.mobile }));
  }

  const mappedAppts = filteredAppts.map(a => ({ ...a, id: String(a._id) }));

  res.json({ ok: true, queue: queueWithDetails, appointments: mappedAppts, patients: formattedPatients });
});

// POST /api/admin/queue/assign - Assign token (Admin Only)
const AssignTokenSchema = z.object({
  patientId: z.string().optional(),
  patientName: z.string().optional(),
  patientMobile: z.string().optional(),
  reason: z.string().optional(),
  clinicId: z.string().optional(),
  doctorId: z.string().optional()
}).refine(data => data.patientId || (data.patientName && data.patientMobile), {
  message: "Either patientId or both patientName and patientMobile must be provided"
});

app.post("/api/admin/queue/assign", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const parsed = AssignTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const { reason, clinicId, doctorId, patientName, patientMobile } = parsed.data;
  let patientId = parsed.data.patientId;
  
  if (!clinicId) return res.status(400).json({ ok: false, error: "MISSING_CLINIC_ID" });

  if (!patientId && patientName && patientMobile) {
    let existingUser = await User.findOne({ mobile: patientMobile, role: 'patient' });
    if (!existingUser) {
      existingUser = new User({
        _id: makeId(),
        role: 'patient',
        fullName: patientName,
        mobile: patientMobile,
        passwordHash: await bcrypt.hash(makeId(), 10),
        status: 'active'
      });
      await existingUser.save();
    }
    patientId = existingUser._id;
  }

  const activeQueueItems = await Queue.find({ stage: { $nin: ['completed', 'no-show'] } }).lean();
  const activeApptIds = activeQueueItems.map(q => String(q.apptId));

  const existingActive = await Appointment.findOne({
    patientId,
    clinicId,
    _id: { $in: activeApptIds }
  }).lean();
  
  if (existingActive) {
    return res.status(400).json({ 
      ok: false, 
      error: "ALREADY_IN_QUEUE", 
      message: `Patient already has an active token (#${existingActive.token}) in this clinic.` 
    });
  }

  const admin = await User.findById(clinicId).lean();
  const location = admin?.profile?.clinicName || 'CareLine Clinic';

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayAppts = await Appointment.find({ clinicId, date: todayDate }).lean();
  const todayTokens = todayAppts.map(a => Number(a.token) || 0);
  const nextToken = todayTokens.length > 0 ? Math.max(...todayTokens) + 1 : 1;
  
  const apptId = makeId();
  const newAppt = new Appointment({
    _id: apptId,
    patientId,
    clinicId,
    doctorId: doctorId || undefined,
    token: nextToken,
    date: todayDate,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    reason: reason || 'Walk-in Consultation',
    location: location,
  });
  
  await newAppt.save();

  const newQueue = new Queue({
    apptId: apptId,
    stage: 'in-queue'
  });
  await newQueue.save();
  
  res.json({ ok: true, message: "Token assigned", appointment: { ...newAppt.toObject(), id: apptId } });
});

// POST /api/admin/queue/advance - Advance queue (Admin Only)
const AdvanceQueueSchema = z.object({
  apptId: z.string().min(1),
  stage: z.enum(["calling", "in-consult", "no-show", "in-queue", "completed"])
});

app.post("/api/admin/queue/advance", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const parsed = AdvanceQueueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });
  
  const qItem = await Queue.findOneAndUpdate({ apptId: parsed.data.apptId }, { stage: parsed.data.stage, updatedAt: new Date() });
  if (!qItem) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Queue item not found" });
  
  res.json({ ok: true, message: "Queue advanced" });
});

// POST /api/doctor/queue/complete - Complete visit (Doctor Only)
const CompleteVisitSchema = z.object({
  apptId: z.string().min(1),
  userId: z.string().min(1)
});

app.post("/api/doctor/queue/complete", async (req, res) => {
  const parsed = CompleteVisitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });
  
  const user = await User.findById(parsed.data.userId).lean();
  if (!user || user.role !== 'doctor') return res.status(403).json({ ok: false, error: "UNAUTHORIZED", message: "Only doctors can complete visits" });
  
  const qItem = await Queue.findOne({ apptId: parsed.data.apptId });
  if (!qItem) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  
  qItem.stage = 'completed';
  await qItem.save();
  
  const currentAppt = await Appointment.findById(parsed.data.apptId).lean();
  if (currentAppt) {
    const queueInQueue = await Queue.find({ stage: 'in-queue' }).lean();
    const inQueueApptIds = queueInQueue.map(q => String(q.apptId));

    const queryOptions = currentAppt.doctorId ? { doctorId: currentAppt.doctorId } : { clinicId: currentAppt.clinicId };
    const potentialNextAppts = await Appointment.find({ _id: { $in: inQueueApptIds }, ...queryOptions }).sort({ token: 1 }).lean();

    if (potentialNextAppts.length > 0) {
      await Queue.findOneAndUpdate({ apptId: potentialNextAppts[0]._id }, { stage: 'calling', updatedAt: new Date() });
    }
  }

  res.json({ ok: true, message: "Visit completed and next patient called" });
});

// ---- GET /api/clinics - List all clinics ----
app.get("/api/clinics", async (req, res) => {
  const clinicsData = await User.find({ role: "admin", status: "active" }).lean();
  const clinics = clinicsData
    .filter(u => u.profile?.clinicName)
    .map(u => ({
      id: u._id,
      name: u.profile.clinicName,
      location: u.profile.clinicLocation || "—",
      picture: u.profile.clinicPicture || null,
      adminName: u.fullName,
      consultationFee: u.profile.consultationFee || 500
    }));
  return res.json({ ok: true, clinics });
});

// ---- GET /api/clinics/:clinicId/doctors ----
app.get("/api/clinics/:clinicId/doctors", async (req, res) => {
  const { clinicId } = req.params;
  const clinic = await User.findOne({ _id: clinicId, role: "admin" }).lean();
  if (!clinic) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Clinic not found" });

  const clinicName = (clinic.profile?.clinicName || "").trim().toLowerCase();

  const doctorsData = await User.find({ role: "doctor", status: "active" }).lean();
  const doctors = doctorsData
    .filter(u => (u.profile?.clinicAssociation || "").trim().toLowerCase() === clinicName)
    .map(u => ({
      id: u._id,
      fullName: u.fullName,
      specialization: u.profile?.specialization || "General Physician",
      clinicAssociation: u.profile?.clinicAssociation || clinic.profile.clinicName,
      availability: "Mon–Sat, 9:00 AM – 6:00 PM"
    }));

  return res.json({ ok: true, clinic: { id: clinic._id, name: clinic.profile.clinicName, location: clinic.profile.clinicLocation }, doctors });
});

// ---- GET /api/doctors/:doctorId/profile ----
app.get("/api/doctors/:doctorId/profile", async (req, res) => {
  const { doctorId } = req.params;
  const doctor = await User.findOne({ _id: doctorId, role: "doctor", status: "active" }).lean();
  if (!doctor) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Doctor not found" });

  const p = doctor.profile || {};
  const clinicName = (p.clinicAssociation || "").trim().toLowerCase();
  const clinic = clinicName
    ? await User.findOne({ role: "admin", "profile.clinicName": { $regex: `^${clinicName}$`, $options: "i" } }).lean()
    : null;

  return res.json({
    ok: true,
    doctor: {
      id: doctor._id,
      fullName: doctor.fullName,
      specialization: p.specialization || "General Physician",
      bio: p.bio || null,
      clinicAssociation: p.clinicAssociation || null,
      availability: "Mon–Sat, 9:00 AM – 6:00 PM",
      clinic: clinic ? {
        id: clinic._id,
        name: clinic.profile?.clinicName || null,
        location: clinic.profile?.clinicLocation || null,
        picture: clinic.profile?.clinicPicture
          ? (clinic.profile.clinicPicture.startsWith("/uploads")
              ? clinic.profile.clinicPicture
              : clinic.profile.clinicPicture)
          : null,
        consultationFee: clinic.profile?.consultationFee || null,
      } : null
    }
  });
});

// ---- GET /api/doctors/:doctorId/slots ----
app.get("/api/doctors/:doctorId/slots", async (req, res) => {
  const { doctorId } = req.params;
  const date = String(req.query.date || "").trim();

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "BAD_DATE", message: "Provide a valid date (YYYY-MM-DD)" });
  }

  const doctor = await User.findOne({ _id: doctorId, role: "doctor" }).lean();
  if (!doctor) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Doctor not found" });

  const allSlots = [];
  for (let h = 9; h < 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const suffix = h < 12 ? "AM" : "PM";
      const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
      allSlots.push({ time: `${hh}:${mm}`, label: `${displayH}:${mm} ${suffix}` });
    }
  }

  const bookedAppts = await Appointment.find({ doctorId, date, slotTime: { $ne: null } }).lean();
  const bookedTimes = new Set(bookedAppts.map(a => a.slotTime));

  const slots = allSlots.map(s => ({ ...s, available: !bookedTimes.has(s.time) }));

  return res.json({ ok: true, doctorId, date, slots });
});

// ---- POST /api/patient/book ----
const PatientBookSchema = z.object({
  patientId: z.string().min(1),
  clinicId: z.string().optional(),
  doctorId: z.string().optional(),
  date: z.string().optional(),
  slotTime: z.string().optional(),
  reason: z.string().optional()
});

app.post("/api/patient/book", async (req, res) => {
  const parsed = PatientBookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const { patientId, clinicId, doctorId, date, slotTime, reason } = parsed.data;

  if (doctorId && date && slotTime) {
    const conflict = await Appointment.findOne({ doctorId, date, slotTime }).lean();
    if (conflict) {
      return res.status(409).json({ ok: false, error: "SLOT_UNAVAILABLE", message: "This time slot is no longer available. Please select another slot." });
    }
  }

  const doctor = doctorId ? await User.findById(doctorId).lean() : null;
  const clinic = clinicId ? await User.findById(clinicId).lean() : null;

  const targetDate = date || new Date().toISOString().slice(0, 10);
  
  let apptQuery = { date: targetDate };
  if (clinicId) {
    apptQuery.clinicId = clinicId;
  } else if (doctorId) {
    apptQuery.doctorId = doctorId;
  }
  
  const todayAppts = await Appointment.find(apptQuery).lean();
  const todayTokens = todayAppts.map(a => Number(a.token) || 0);
  const nextToken = todayTokens.length > 0 ? Math.max(...todayTokens) + 1 : 1;

  let displayTime = slotTime || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (slotTime) {
    const [hh, mm] = slotTime.split(":").map(Number);
    const suffix = hh < 12 ? "AM" : "PM";
    const displayH = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
    displayTime = `${displayH}:${String(mm).padStart(2, "0")} ${suffix}`;
  }

  const apptId = makeId();
  const newAppt = new Appointment({
    _id: apptId,
    patientId,
    token: nextToken,
    date: targetDate,
    slotTime: slotTime || null,
    time: displayTime,
    reason: reason || "Online Booking",
    location: clinic?.profile?.clinicName || "CareLine Clinic",
    clinicId: clinicId || null,
    doctorId: doctorId || null,
    doctorName: doctor ? doctor.fullName : null,
    specialization: doctor?.profile?.specialization || null,
  });

  await newAppt.save();

  const newQueue = new Queue({ apptId: apptId, stage: "in-queue" });
  await newQueue.save();

  return res.json({ ok: true, message: "Appointment booked successfully", appointment: { ...newAppt.toObject(), id: apptId } });
});

// ---- GET /api/patient/:patientId/appointments ----
app.get("/api/patient/:patientId/appointments", async (req, res) => {
  const { patientId } = req.params;
  const myAppts = await Appointment.find({ patientId }).sort({ createdAt: -1 }).lean();
  const apptIds = myAppts.map(a => String(a._id));
  const queues = await Queue.find({ apptId: { $in: apptIds } }).lean();
  const queueMap = Object.fromEntries(queues.map(q => [q.apptId, q]));

  const docIds = [...new Set(myAppts.map(a => a.doctorId).filter(Boolean))];
  const doctors = await User.find({ _id: { $in: docIds } }).lean();
  const docMap = Object.fromEntries(doctors.map(d => [String(d._id), d]));

  const doctorDelaysDoc = await SystemState.findOne({ key: 'doctorDelays' }).lean();
  const doctorDelays = doctorDelaysDoc?.value || {};

  // For queue logic
  const allQueues = await Queue.find({}).lean();
  const allAppts = await Appointment.find({}).lean();

  const enrichedAppts = myAppts.map(a => {
    const queueItem = queueMap[String(a._id)];
    const doctor = docMap[a.doctorId];
    
    let currentToken = null;
    let patientsAhead = 0;
    
    if (queueItem && !["completed", "no-show"].includes(queueItem.stage)) {
      const activeQs = allQueues.filter(q => ["calling", "in-consult"].includes(q.stage));
      const callingOrInConsult = activeQs.find(q => {
        const qAppt = allAppts.find(aa => String(aa._id) === q.apptId);
        return qAppt && (qAppt.doctorId === a.doctorId || (a.clinicId && qAppt.clinicId === a.clinicId));
      });
      
      if (callingOrInConsult) {
        const cAppt = allAppts.find(aa => String(aa._id) === callingOrInConsult.apptId);
        currentToken = cAppt?.token || null;
      }

      // Count ahead
      const sortedQueue = allQueues.filter(q => {
         const qAppt = allAppts.find(aa => String(aa._id) === q.apptId);
         return qAppt && (qAppt.doctorId === a.doctorId || (a.clinicId && qAppt.clinicId === a.clinicId)) && !["completed", "no-show"].includes(q.stage);
      }).sort((q1, q2) => new Date(q1.createdAt) - new Date(q2.createdAt));
      
      const myIndex = sortedQueue.findIndex(q => q.apptId === String(a._id));
      if (myIndex !== -1) {
        patientsAhead = myIndex;
      }
    }

    const docDelay = doctorDelays[a.doctorId] || 0;

    return {
      ...a,
      id: String(a._id),
      stage: queueItem?.stage || "completed",
      doctorFullName: doctor ? doctor.fullName : (a.doctorName || null),
      specialization: doctor?.profile?.specialization || a.specialization || null,
      currentToken,
      patientsAhead,
      estimatedWait: (patientsAhead * 10) + docDelay
    };
  });

  return res.json({ ok: true, appointments: enrichedAppts });
});

// POST /api/admin/queue/delete
app.post("/api/admin/queue/delete", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const { apptId } = req.body;
  if (!apptId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });
  
  const qItem = await Queue.findOneAndDelete({ apptId });
  if (!qItem) return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Queue item not found" });
  
  res.json({ ok: true, message: "Token removed from queue" });
});

// ---- POST /api/patient/appointment/cancel ----
app.post("/api/patient/appointment/cancel", async (req, res) => {
  const { apptId } = req.body;
  if (!apptId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });

  const appt = await Appointment.findById(apptId).lean();
  if (!appt) return res.status(404).json({ ok: false, message: "Appointment not found" });

  if (!isActionPermitted(appt.date, appt.time)) {
    return res.status(400).json({ ok: false, message: "Cancellation not permitted within 1 hour of appointment." });
  }

  await Appointment.findByIdAndDelete(apptId);
  await Queue.findOneAndDelete({ apptId });
  
  res.json({ ok: true, message: "Appointment cancelled" });
});

// ---- POST /api/patient/appointment/reschedule ----
app.post("/api/patient/appointment/reschedule", async (req, res) => {
  const { apptId, newDate, newSlotTime } = req.body;
  if (!apptId || !newDate || !newSlotTime) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });

  const appt = await Appointment.findById(apptId);
  if (!appt) return res.status(404).json({ ok: false, message: "Appointment not found" });

  if (!isActionPermitted(appt.date, appt.time)) {
    return res.status(400).json({ ok: false, message: "Rescheduling not permitted within 1 hour of appointment." });
  }

  const isTaken = await Appointment.findOne({ doctorId: appt.doctorId, date: newDate, time: newSlotTime, _id: { $ne: apptId } }).lean();
  if (isTaken) return res.status(400).json({ ok: false, message: "Selected slot is no longer available" });

  appt.date = newDate;
  appt.time = newSlotTime;
  
  const targetAppts = await Appointment.find({
    $or: [{ doctorId: appt.doctorId }, { clinicId: appt.clinicId }],
    date: newDate
  }).lean();
  
  const maxToken = targetAppts.reduce((max, curr) => Math.max(max, curr.token || 0), 0);
  appt.token = maxToken + 1;

  await appt.save();

  await Queue.findOneAndUpdate({ apptId }, { stage: "in-queue", updatedAt: new Date() }, { upsert: true });

  res.json({ ok: true, message: "Appointment rescheduled successfully", appointment: { ...appt.toObject(), id: apptId } });
});

// ---- Payment Schemas ----
const RecordPaymentSchema = z.object({
  patientId: z.string().min(1),
  apptId: z.string().min(1),
  amount: z.number().positive(),
  method: z.string().min(1),
  status: z.enum(["success", "failed", "pending"])
});

// ---- POST /api/patient/payment/record ----
app.post("/api/patient/payment/record", async (req, res) => {
  const parsed = RecordPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });

  const { patientId, apptId, amount, method, status } = parsed.data;
  
  const newPayment = new Payment({
    _id: makeId(),
    patientId,
    apptId,
    amount,
    method,
    status
  });
  
  await newPayment.save();
  res.json({ ok: true, message: "Payment recorded", payment: { ...newPayment.toObject(), id: newPayment._id } });
});

// POST /api/queue/update-stage
app.post("/api/queue/update-stage", async (req, res) => {
  const { apptId, stage } = req.body;
  if (!apptId || !stage) return res.status(400).json({ ok: false, error: "MISSING_DATA" });

  const qItem = await Queue.findOneAndUpdate({ apptId }, { stage, updatedAt: new Date() });
  if (!qItem) return res.status(404).json({ ok: false, error: "NOT_IN_QUEUE" });

  return res.json({ ok: true, message: "Queue stage updated" });
});

// ---- GET /api/dashboard/stats ----
app.get("/api/dashboard/stats", async (req, res) => {
  const { userId, role, clinicId } = req.query;
  if (!userId || !role) return res.status(400).json({ ok: false, error: "MISSING_PARAMS" });

  const today = new Date().toISOString().split('T')[0];

  if (role === 'admin') {
    const cId = clinicId || userId;
    const clinicAppts = await Appointment.find({ clinicId: cId, date: today }).lean();
    const apptIds = clinicAppts.map(a => String(a._id));
    const clinicQueue = await Queue.find({ apptId: { $in: apptIds } }).lean();
    const payments = await Payment.find({ apptId: { $in: apptIds }, status: 'success' }).lean();
    
    const revenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const activeDocs = new Set(clinicAppts.map(a => a.doctorId)).size;

    return res.json({ ok: true, stats: {
      kpi1: `${revenue}`, kpi1l: 'Revenue', kpi1n: 'Today',
      kpi2: `${clinicQueue.length}`, kpi2l: 'Queue', kpi2n: 'Patients Waiting',
      kpi3: `${activeDocs}`, kpi3l: 'Doctors', kpi3n: 'Active Today'
    }});
  }

  if (role === 'doctor') {
    const doctorAppts = await Appointment.find({ doctorId: userId, date: today }).lean();
    const apptIds = doctorAppts.map(a => String(a._id));
    const doctorQueue = await Queue.find({ apptId: { $in: apptIds } }).lean();

    return res.json({ ok: true, stats: {
      kpi1: `${doctorAppts.length}`, kpi1l: 'Consultations', kpi1n: 'Total Today',
      kpi2: `${doctorQueue.filter(q => q.stage === 'in-queue' || q.stage === 'calling').length}`, kpi2l: 'Waiting', kpi2n: 'In Queue',
      kpi3: `${doctorQueue.filter(q => q.stage === 'completed').length}`, kpi3l: 'Completed', kpi3n: 'Patients seen'
    }});
  }

  if (role === 'patient') {
    const patientAppts = await Appointment.find({ patientId: userId }).lean();
    const upcoming = patientAppts.filter(a => a.date >= today && a.status !== 'completed'); // Note: 'status' is not natively on appt unless joined, ignoring for now or using queue
    
    const allQueues = await Queue.find({}).lean();
    const activeAppt = upcoming.find(a => allQueues.some(q => q.apptId === String(a._id)));
    
    let kpi2 = 'None';
    if (activeAppt) {
      const qItem = allQueues.find(q => q.apptId === String(activeAppt._id));
      kpi2 = qItem ? `#${activeAppt.token} (${qItem.stage})` : 'Pending';
    }

    return res.json({ ok: true, stats: {
      kpi1: `${upcoming.length}`, kpi1l: 'Appointments', kpi1n: 'Upcoming',
      kpi2: kpi2, kpi2l: 'Active Token', kpi2n: 'Current Status',
      kpi3: patientAppts.length, kpi3l: 'History', kpi3n: 'Total Visits'
    }});
  }

  return res.status(400).json({ ok: false, error: "INVALID_ROLE" });
});

// ---- GET /api/admin/reports/financial ----
app.get("/api/admin/reports/financial", async (req, res) => {
  const { clinicId } = req.query;
  if (!clinicId) return res.status(400).json({ ok: false, error: "MISSING_CLINIC_ID" });

  const clinicAppts = await Appointment.find({ clinicId }).lean();
  const clinicApptIds = clinicAppts.map(a => String(a._id));

  const payments = await Payment.find({ apptId: { $in: clinicApptIds }, status: 'success' }).lean();

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now); startOfMonth.setDate(now.getDate() - 30);

  const stats = {
    daily: 0,
    weekly: 0,
    monthly: 0,
    totalCount: payments.length,
    recent: payments.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10)
  };

  payments.forEach(p => {
    const d = new Date(p.createdAt);
    if (d >= startOfDay) stats.daily += p.amount;
    if (d >= startOfWeek) stats.weekly += p.amount;
    if (d >= startOfMonth) stats.monthly += p.amount;
  });

  const patientIds = [...new Set(payments.map(p => p.patientId))];
  const patients = await User.find({ _id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map(u => [String(u._id), u.fullName]));

  stats.recent = stats.recent.map(p => ({
    ...p,
    id: String(p._id),
    patientName: patientMap[p.patientId] || "Unknown Patient"
  }));

  return res.json({ ok: true, stats });
});

// ---- GET /api/patient/:patientId/payments ----
app.get("/api/patient/:patientId/payments", async (req, res) => {
  const { patientId } = req.params;
  const payments = await Payment.find({ patientId }).sort({ createdAt: -1 }).lean();
  const apptIds = [...new Set(payments.map(p => p.apptId))];
  const appts = await Appointment.find({ _id: { $in: apptIds } }).lean();
  const apptMap = Object.fromEntries(appts.map(a => [String(a._id), a]));

  const enrichedPayments = payments.map(p => {
    const appt = apptMap[p.apptId];
    return {
      ...p,
      id: String(p._id),
      clinicName: appt?.location || "CareLine Clinic",
      date: appt?.date || "—"
    };
  });
    
  res.json({ ok: true, payments: enrichedPayments });
});

// ---- POST /api/doctor/queue/delay ----
const QueueDelaySchema = z.object({
  userId: z.string().min(1),
  delayMinutes: z.number()
});

app.post("/api/doctor/queue/delay", async (req, res) => {
  const parsed = QueueDelaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR" });

  const { userId, delayMinutes } = parsed.data;
  
  let doc = await SystemState.findOne({ key: 'doctorDelays' });
  if (!doc) doc = new SystemState({ key: 'doctorDelays', value: {} });

  doc.value[userId] = (doc.value[userId] || 0) + delayMinutes;
  doc.markModified('value');
  await doc.save();
  
  res.json({ ok: true, message: `Queue delayed by ${delayMinutes} mins`, totalDelay: doc.value[userId] });
});

// ---- GET /api/messages/contacts ----
app.get("/api/messages/contacts", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ ok: false, error: "MISSING_USER_ID" });

  const user = await User.findById(userId).lean();
  if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

  const contactIds = new Set();

  // 1. Find contacts from appointments
  if (user.role === 'patient') {
    const appts = await Appointment.find({ patientId: userId }).lean();
    appts.forEach(a => {
      if (a.doctorId) contactIds.add(String(a.doctorId));
      if (a.clinicId) contactIds.add(String(a.clinicId));
    });
  } else if (user.role === 'doctor') {
    const appts = await Appointment.find({ doctorId: userId }).lean();
    appts.forEach(a => {
      if (a.patientId) contactIds.add(String(a.patientId));
    });
  } else if (user.role === 'admin' || user.role === 'support') {
    const clinicId = userId;
    const appts = await Appointment.find({ clinicId }).lean();
    appts.forEach(a => {
      if (a.patientId) contactIds.add(String(a.patientId));
      if (a.doctorId) contactIds.add(String(a.doctorId));
    });
  }

  // 2. Find contacts from messages history
  const chattedSenders = await Message.distinct("senderId", { receiverId: userId });
  const chattedReceivers = await Message.distinct("receiverId", { senderId: userId });
  chattedSenders.forEach(id => contactIds.add(String(id)));
  chattedReceivers.forEach(id => contactIds.add(String(id)));

  // Exclude self if present
  contactIds.delete(String(userId));

  const contactList = Array.from(contactIds);
  const contactUsers = await User.find({ _id: { $in: contactList } }).lean();

  const enrichedContacts = await Promise.all(contactUsers.map(async (c) => {
    const unreadCount = await Message.countDocuments({ senderId: c._id, receiverId: userId, read: false });
    const lastMsg = await Message.findOne({
      $or: [
        { senderId: userId, receiverId: c._id },
        { senderId: c._id, receiverId: userId }
      ]
    }).sort({ createdAt: -1 }).lean();

    let subLabel = null;
    if (c.role === 'doctor') subLabel = c.profile?.specialization || 'Doctor';
    else if (c.role === 'admin') subLabel = c.profile?.clinicName || 'Clinic Admin';
    else if (c.role === 'patient') subLabel = 'Patient';
    else subLabel = 'Staff';

    return {
      id: c._id,
      fullName: c.fullName,
      role: c.role,
      subLabel,
      unreadCount,
      lastMessage: lastMsg ? { content: lastMsg.content, createdAt: lastMsg.createdAt } : null
    };
  }));

  // Sort contacts by last message time (most recent first)
  enrichedContacts.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  res.json({ ok: true, contacts: enrichedContacts });
});

// ---- GET /api/messages/history ----
app.get("/api/messages/history", async (req, res) => {
  const { user1, user2, viewerId } = req.query;
  if (!user1 || !user2) return res.status(400).json({ ok: false, error: "MISSING_USER_IDS" });

  // Fetch history
  const messages = await Message.find({
    $or: [
      { senderId: user1, receiverId: user2 },
      { senderId: user2, receiverId: user1 }
    ]
  }).sort({ createdAt: 1 }).lean();

  // Mark incoming messages as read
  const markAsReadRecipient = viewerId || user1;
  const markAsReadSender = (markAsReadRecipient === user1) ? user2 : user1;
  
  await Message.updateMany(
    { senderId: markAsReadSender, receiverId: markAsReadRecipient, read: false },
    { read: true }
  );

  res.json({ ok: true, messages: messages.map(m => ({ ...m, id: m._id })) });
});

// ---- POST /api/messages/send ----
const SendMessageSchema = z.object({
  senderId: z.string().min(1),
  receiverId: z.string().min(1),
  content: z.string().trim().min(1)
});

app.post("/api/messages/send", async (req, res) => {
  const parsed = SendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const { senderId, receiverId, content } = parsed.data;

  const messageId = makeId();
  const newMessage = new Message({
    _id: messageId,
    senderId,
    receiverId,
    content,
    createdAt: new Date(),
    read: false
  });

  await newMessage.save();
  res.json({ ok: true, message: { ...newMessage.toObject(), id: messageId } });
});

app.get("/", (_req, res) => {
  res.redirect("/index.html");
});

app.use(express.static(CARELINE_ROOT));

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB successfully");
    app.listen(PORT, BIND_HOST, () => {
      console.log(`CareLine backend listening on http://127.0.0.1:${PORT} (also try http://localhost:${PORT})`);
      console.log(`Open the app at http://127.0.0.1:${PORT}/index.html`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

startServer();
