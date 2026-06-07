// backend/src/controllers/patientController.js
import { Patient, Doctor, Admin, Appointment, Payment } from '../models.js';

export async function bookAppointment(req, res) {
  const { patientId, clinicId, doctorId, date, slotTime, reason } = req.body;
  try {
    const slotConflict = await Appointment.findOne({
      doctorId,
      date,
      time: slotTime,
      stage: { $nin: ['cancelled', 'no-show'] }
    });
    if (slotConflict) {
      return res.status(400).json({ message: 'SLOT_UNAVAILABLE' });
    }

    const doctor = await Doctor.findById(doctorId);
    const clinic = await Admin.findById(clinicId);

    const count = await Appointment.countDocuments({ clinicId, date });
    const token = count + 1;

    const appt = new Appointment({
      patientId,
      clinicId,
      doctorId,
      date,
      time: slotTime,
      reason,
      token,
      stage: 'scheduled'
    });
    await appt.save();

    res.status(201).json({
      appointment: {
        id: appt._id,
        token: appt.token,
        date: appt.date,
        time: appt.time,
        doctorName: doctor ? doctor.fullName : 'Verified Doctor',
        location: clinic ? (clinic.profile?.clinicName || clinic.fullName) : 'Clinic Center',
        reason: appt.reason
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
}

export async function rescheduleAppointment(req, res) {
  const { apptId, newDate, newSlotTime } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    appt.date = newDate;
    appt.time = newSlotTime;
    appt.stage = 'scheduled';
    await appt.save();

    res.json({ appointment: appt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to reschedule' });
  }
}

export async function cancelAppointment(req, res) {
  const { apptId } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    appt.stage = 'cancelled';
    await appt.save();

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to cancel' });
  }
}

export async function recordPayment(req, res) {
  const { patientId, apptId, amount, method, status } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const patient = await Patient.findById(patientId);

    appt.paid = status === 'success';
    if (status === 'success') {
      appt.stage = 'in-queue';
    }
    await appt.save();

    const payment = new Payment({
      patientId,
      patientName: patient ? patient.fullName : 'Walk-in',
      clinicId: appt.clinicId,
      apptId,
      amount,
      method,
      status
    });
    await payment.save();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to record payment' });
  }
}

export async function getPatientAppointments(req, res) {
  const { id } = req.params;
  try {
    const appts = await Appointment.find({ patientId: id }).sort({ createdAt: -1 });
    const formatted = await Promise.all(appts.map(async (a) => {
      const doc = await Doctor.findById(a.doctorId);
      const cl = await Admin.findById(a.clinicId);
      return {
        id: a._id,
        token: a.token,
        date: a.date,
        time: a.time,
        doctorFullName: doc ? doc.fullName : 'Doctor',
        clinicId: a.clinicId,
        location: cl ? (cl.profile?.clinicName || cl.fullName) : 'Clinic Center',
        reason: a.reason,
        stage: a.stage,
        paid: a.paid
      };
    }));

    res.json({ appointments: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch appointments' });
  }
}

export async function getPatientPayments(req, res) {
  const { id } = req.params;
  try {
    const payments = await Payment.find({ patientId: id }).sort({ createdAt: -1 });
    const formatted = await Promise.all(payments.map(async (p) => {
      const clinic = await Admin.findById(p.clinicId);
      return {
        id: p._id,
        apptId: String(p.apptId),
        clinicName: clinic ? (clinic.profile?.clinicName || clinic.fullName) : 'Clinic Center',
        date: p.createdAt.toLocaleDateString(),
        method: p.method,
        amount: p.amount,
        status: p.status
      };
    }));

    res.json({ payments: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load payments' });
  }
}