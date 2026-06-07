// backend/src/models.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const { Schema, model } = mongoose;

// Hashing pre-save middleware helper
const hashPassword = async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
};

const comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/* ---------- 1. Patients Collection ---------- */
const patientSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'patient' },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  otp: { type: String },
  otpExpires: { type: Date },
  status: { type: String, default: 'approved' },
  profile: { type: Schema.Types.Mixed, default: {} }, // age, gender
  createdAt: { type: Date, default: Date.now }
});
patientSchema.pre('save', hashPassword);
patientSchema.methods.comparePassword = comparePassword;
const Patient = model('Patient', patientSchema);

/* ---------- 2. Doctors Collection ---------- */
const doctorSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'doctor' },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  otp: { type: String },
  otpExpires: { type: Date },
  status: { type: String, default: 'pending' }, 
  profile: { type: Schema.Types.Mixed, default: {} }, // specialization, clinicAssociation, regNo, availability
  createdAt: { type: Date, default: Date.now }
});
doctorSchema.pre('save', hashPassword);
doctorSchema.methods.comparePassword = comparePassword;
const Doctor = model('Doctor', doctorSchema);

/* ---------- 3. Admins (Clinics) Collection ---------- */
const adminSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  otp: { type: String },
  otpExpires: { type: Date },
  status: { type: String, default: 'approved' },
  profile: { type: Schema.Types.Mixed, default: {} }, // clinicName, clinicLocation, clinicPicture, consultationFee
  createdAt: { type: Date, default: Date.now }
});
adminSchema.pre('save', hashPassword);
adminSchema.methods.comparePassword = comparePassword;
const Admin = model('Admin', adminSchema);

/* ---------- 4. Support Staff Collection ---------- */
const supportSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'support' },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  otp: { type: String },
  otpExpires: { type: Date },
  status: { type: String, default: 'approved' },
  profile: { type: Schema.Types.Mixed, default: {} }, // employeeId, department
  createdAt: { type: Date, default: Date.now }
});
supportSchema.pre('save', hashPassword);
supportSchema.methods.comparePassword = comparePassword;
const Support = model('Support', supportSchema);

/* ---------- 5. Appointments Collection ---------- */
const appointmentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  clinicId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  date: { type: String, required: true }, 
  time: { type: String, required: true }, 
  reason: { type: String, default: 'Consultation' },
  token: { type: Number, required: true },
  stage: { 
    type: String, 
    enum: ['scheduled', 'in-queue', 'calling', 'in-consult', 'completed', 'no-show', 'cancelled'], 
    default: 'scheduled' 
  },
  paid: { type: Boolean, default: false },
  prescription: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});
const Appointment = model('Appointment', appointmentSchema);

/* ---------- 6. Payments Collection ---------- */
const paymentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  patientName: { type: String, required: true },
  clinicId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
  apptId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  amount: { type: Number, required: true },
  method: { type: String, required: true }, 
  status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
  createdAt: { type: Date, default: Date.now }
});
const Payment = model('Payment', paymentSchema);

export { Patient, Doctor, Admin, Support, Appointment, Payment };