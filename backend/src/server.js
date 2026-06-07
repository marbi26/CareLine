// backend/src/server.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Route imports
import authRoutes from './routes/authRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import queueRoutes from './routes/queueRoutes.js';
import { Patient, Doctor, Admin, Support, Payment } from './models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the root CareLine folder
app.use(express.static(path.join(__dirname, '../../')));

// Binding API routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/queue', queueRoutes);

// Public / API namespace compatibility handlers
app.use('/api/clinics', doctorRoutes); 
app.use('/api/patient', patientRoutes); 
app.use('/api/user', patientRoutes); 

// ---- Additional API: Clinics discovery handler ----
app.get('/api/clinics', async (req, res) => {
  try {
    const clinics = await Admin.find({ status: 'approved' });
    const formatted = clinics.map(c => ({
      id: c._id,
      name: c.profile?.clinicName || c.fullName,
      location: c.profile?.clinicLocation || 'Online',
      picture: c.profile?.clinicPicture || null,
      consultationFee: Number(c.profile?.consultationFee) || 500
    }));
    res.json({ clinics: formatted });
  } catch (err) {
    res.status(500).json({ message: 'Error loading clinics' });
  }
});

app.get('/api/clinics/:clinicId/doctors', async (req, res) => {
  try {
    const clinic = await Admin.findById(req.params.clinicId);
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });
    const doctors = await Doctor.find({
      status: 'approved',
      'profile.clinicAssociation': clinic.profile?.clinicName
    });
    res.json({
      doctors: doctors.map(d => ({
        id: d._id,
        fullName: d.fullName,
        specialization: d.profile?.specialization,
        availability: d.profile?.availability || 'Mon - Sat, 10 AM - 6 PM'
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- Additional API: Admin review flow handler ----
app.get('/api/admin/pending-doctors', async (req, res) => {
  try {
    const pending = await Doctor.find({ status: 'pending' });
    res.json({
      pendingDoctors: pending.map(d => ({
        id: d._id,
        fullName: d.fullName,
        profile: d.profile
      }))
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load doctors' });
  }
});

app.post('/api/admin/approve-doctor', async (req, res) => {
  try {
    await Doctor.findByIdAndUpdate(req.body.doctorId, { status: 'approved' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/admin/reject-doctor', async (req, res) => {
  try {
    await Doctor.findByIdAndDelete(req.body.doctorId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- Additional API: Clinic Financial Reports ----
app.get('/api/admin/reports/financial', async (req, res) => {
  const { clinicId } = req.query;
  try {
    const payments = await Payment.find({ clinicId, status: 'success' }).sort({ createdAt: -1 });

    const daily = payments
      .filter(p => new Date(p.createdAt).toDateString() === new Date().toDateString())
      .reduce((sum, p) => sum + p.amount, 0);

    const weekly = payments
      .filter(p => (Date.now() - new Date(p.createdAt)) < 7 * 24 * 60 * 60 * 1000)
      .reduce((sum, p) => sum + p.amount, 0);

    const monthly = payments
      .filter(p => (Date.now() - new Date(p.createdAt)) < 30 * 24 * 60 * 60 * 1000)
      .reduce((sum, p) => sum + p.amount, 0);

    res.json({
      stats: {
        daily,
        weekly,
        monthly,
        recent: payments.slice(0, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- Additional API: User profile updates ----
app.post('/api/user/update-profile', async (req, res) => {
  const { userId, fullName, mobile, email, consultationFee, clinicLocation } = req.body;
  try {
    let user = await Patient.findById(userId);
    if (!user) user = await Doctor.findById(userId);
    if (!user) user = await Admin.findById(userId);
    if (!user) user = await Support.findById(userId);

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (fullName) user.fullName = fullName;
    if (mobile) user.mobile = mobile;
    if (email) user.email = email;

    if (user.role === 'admin') {
      user.profile = {
        ...user.profile,
        consultationFee: consultationFee || user.profile?.consultationFee,
        clinicLocation: clinicLocation || user.profile?.clinicLocation
      };
    }
    await user.save();

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Simple health check endpoint
app.get('/health', (_req, res) => res.json({ status: 'UP' }));

// Fallback to serve index.html for any frontend SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '../../index.html'));
});

// ---------- DB & Server ----------
const PORT = process.env.PORT || 5050;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/careline';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });