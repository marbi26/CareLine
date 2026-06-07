// backend/src/controllers/doctorController.js
import { Admin, Doctor, Appointment } from '../models.js';
import mongoose from 'mongoose';

// ---- Get All Clinics ----
export async function getAllClinics(req, res) {
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
    console.error(err);
    res.status(500).json({ message: 'Failed to load clinics' });
  }
}

// ---- Get Doctor List by Clinic ID ----
export async function getDoctorsByClinic(req, res) {
  const { clinicId } = req.params;
  try {
    const clinic = await Admin.findById(clinicId);
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });

    const clinicName = clinic.profile?.clinicName;
    const doctors = await Doctor.find({
      status: 'approved',
      'profile.clinicAssociation': clinicName
    });

    const formatted = doctors.map(d => ({
      id: d._id,
      fullName: d.fullName,
      specialization: d.profile?.specialization,
      availability: d.profile?.availability || 'Mon - Sat, 10:00 AM - 06:00 PM'
    }));

    res.json({ doctors: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load doctors' });
  }
}

// ---- Search Doctor Profiles ----
export async function getDoctors(req, res) {
  const { q, specialty } = req.query;
  try {
    const filter = { status: 'approved' };
    if (specialty) {
      filter['profile.specialization'] = specialty;
    }
    if (q) {
      filter.fullName = { $regex: q, $options: 'i' };
    }

    const doctors = await Doctor.find(filter);
    const formatted = doctors.map(d => ({
      id: d._id,
      fullName: d.fullName,
      specialization: d.profile?.specialization,
      clinicAssociation: d.profile?.clinicAssociation || 'General Clinic',
      availability: d.profile?.availability || 'Mon - Sat, 10:00 AM - 06:00 PM'
    }));

    res.json({ doctors: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load doctor profiles' });
  }
}

export async function getDoctorProfile(req, res) {
  const { doctorId } = req.params;
  try {
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
    res.json({
      id: doctor._id,
      fullName: doctor.fullName,
      email: doctor.email,
      mobile: doctor.mobile,
      profile: doctor.profile
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch doctor profile' });
  }
}

export async function getDoctorSlots(req, res) {
  const { doctorId } = req.params;
  const { date } = req.query;
  try {
    const baseSlots = [
      '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', 
      '12:00 PM', '12:30 PM', '02:00 PM', '02:30 PM', 
      '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
    ];

    const bookings = await Appointment.find({
      doctorId: new mongoose.Types.ObjectId(doctorId),
      date,
      stage: { $nin: ['cancelled', 'no-show'] }
    });

    const bookedTimes = bookings.map(b => b.time);

    const slots = baseSlots.map(s => ({
      time: s,
      label: s,
      available: !bookedTimes.includes(s)
    }));

    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch slots' });
  }
}