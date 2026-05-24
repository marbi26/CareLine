import mongoose from 'mongoose';

// User Schema (Patients, Doctors, Admins)
const userSchema = new mongoose.Schema({
  _id: { type: String }, // We will use the existing hex IDs
  role: { type: String, enum: ['patient', 'doctor', 'admin', 'support'], required: true },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String },
  passwordHash: { type: String, required: true },
  profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now },
  approvedAt: { type: Date }
});

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  _id: { type: String },
  patientId: { type: String, ref: 'User', required: true },
  clinicId: { type: String, ref: 'User' },
  doctorId: { type: String, ref: 'User' },
  token: { type: Number },
  date: { type: String }, // YYYY-MM-DD
  slotTime: { type: String }, // HH:mm
  time: { type: String }, // Display time e.g., 9:30 AM
  reason: { type: String },
  location: { type: String },
  doctorName: { type: String },
  specialization: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Queue Schema
const queueSchema = new mongoose.Schema({
  apptId: { type: String, ref: 'Appointment', required: true },
  stage: { type: String, enum: ['in-queue', 'calling', 'in-consult', 'completed', 'no-show'], default: 'in-queue' },
  updatedAt: { type: Date, default: Date.now }
});

// Payment Schema
const paymentSchema = new mongoose.Schema({
  _id: { type: String },
  patientId: { type: String, ref: 'User', required: true },
  apptId: { type: String, ref: 'Appointment', required: true },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
  createdAt: { type: Date, default: Date.now }
});

// System State (Doctor Delays)
const systemStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g., 'doctorDelays'
  value: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const messageSchema = new mongoose.Schema({
  _id: { type: String },
  senderId: { type: String, ref: 'User', required: true },
  receiverId: { type: String, ref: 'User', required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

export const User = mongoose.model('User', userSchema);
export const Appointment = mongoose.model('Appointment', appointmentSchema);
export const Queue = mongoose.model('Queue', queueSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const SystemState = mongoose.model('SystemState', systemStateSchema);
export const Message = mongoose.model('Message', messageSchema);
