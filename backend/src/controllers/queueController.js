// backend/src/controllers/queueController.js
import { Patient, Doctor, Admin, Appointment, Payment, Message } from '../models.js';

export async function getLiveQueue(req, res) {
  const { clinicId, doctorId } = req.query;
  try {
    const today = new Date().toISOString().split('T')[0];
    const query = { date: today };
    if (clinicId) query.clinicId = clinicId;
    if (doctorId) query.doctorId = doctorId;

    const appts = await Appointment.find(query).sort({ token: 1 });
    const queue = await Promise.all(appts.map(async (a) => {
      const patient = await Patient.findById(a.patientId);
      return {
        apptId: a._id,
        stage: a.stage,
        patient: {
          id: patient?._id,
          fullName: patient?.fullName || 'Walk-in Patient',
          mobile: patient?.mobile || ''
        },
        appt: {
          token: a.token,
          date: a.date,
          time: a.time,
          reason: a.reason
        }
      };
    }));

    res.json({ queue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch live queue' });
  }
}

export async function assignQueue(req, res) {
  const { patientId, patientName, patientMobile, reason, clinicId, doctorId } = req.body;
  try {
    let pid = patientId;
    if (!pid) {
      let patient = await Patient.findOne({ mobile: patientMobile });
      if (!patient) {
        patient = new Patient({
          email: `${patientMobile}@walkin.careline.com`,
          mobile: patientMobile,
          fullName: patientName,
          password: 'walkinpassword123',
          role: 'patient',
          status: 'approved'
        });
        await patient.save();
      }
      pid = patient._id;
    }

    const today = new Date().toISOString().split('T')[0];
    const count = await Appointment.countDocuments({ clinicId, date: today });
    const token = count + 1;

    const appt = new Appointment({
      patientId: pid,
      clinicId,
      doctorId,
      date: today,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reason,
      token,
      paid: true,
      stage: 'in-queue'
    });
    await appt.save();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to assign walk-in patient' });
  }
}

export async function updateQueueStage(req, res) {
  const { apptId, stage } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    appt.stage = stage;
    await appt.save();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update queue stage' });
  }
}

export async function completeConsultation(req, res) {
  const { apptId } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    appt.stage = 'completed';
    await appt.save();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to complete appointment' });
  }
}

export async function getDashboardStats(req, res) {
  const { userId, role, clinicId } = req.query;
  try {
    let kpis = {};
    const unreadCount = userId ? await Message.countDocuments({ receiverId: userId, read: false }) : 0;

    if (role === 'patient') {
      const appts = await Appointment.find({ patientId: userId });
      const upcoming = appts.filter(a => !['completed', 'no-show', 'cancelled'].includes(a.stage)).length;
      let pos = '—';
      const active = appts.find(a => !['completed', 'no-show', 'cancelled'].includes(a.stage));
      if (active) {
        const queue = await Appointment.find({
          clinicId: active.clinicId,
          date: active.date,
          stage: { $in: ['in-queue', 'calling', 'in-consult'] }
        }).sort({ token: 1 });
        const idx = queue.findIndex(q => String(q._id) === String(active._id));
        if (idx !== -1) pos = `#${idx + 1}`;
      }

      kpis = {
        kpi1: String(upcoming), kpi1n: 'Scheduled', kpi1l: 'Appointments',
        kpi2: pos, kpi2n: 'Live Position', kpi2l: 'Queue Position',
        kpi3: String(unreadCount), kpi3n: 'Unread chats', kpi3l: 'Messages'
      };
    } else if (role === 'doctor') {
      const appts = await Appointment.find({ doctorId: userId });
      const completed = appts.filter(a => a.stage === 'completed').length;
      const waiting = appts.filter(a => ['in-queue', 'calling'].includes(a.stage)).length;

      kpis = {
        kpi1: String(appts.length), kpi1n: `Completed: ${completed}`, kpi1l: "Today's Consultations",
        kpi2: String(waiting), kpi2n: 'Patients waiting', kpi2l: 'Live Queue',
        kpi3: String(unreadCount), kpi3n: 'Unread chats', kpi3l: 'Messages'
      };
    } else if (role === 'admin') {
      const appts = await Appointment.find({ clinicId: userId });
      const clinic = await Admin.findById(userId);
      const activeDocs = await Doctor.countDocuments({ 
        status: 'approved', 
        'profile.clinicAssociation': clinic?.profile?.clinicName 
      });
      const payments = await Payment.find({ clinicId: userId, status: 'success' });
      const rev = payments.reduce((sum, p) => sum + p.amount, 0);

      kpis = {
        kpi1: String(appts.length), kpi1n: 'Walk-in & Online', kpi1l: 'Total Tickets',
        kpi2: String(activeDocs), kpi2n: 'Doctors on duty', kpi2l: 'Doctors',
        kpi3: `Rs${rev.toLocaleString()}`, kpi3n: 'Settled today', kpi3l: 'Revenue'
      };
    }

    res.json({ ok: true, stats: kpis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to hydrate stats' });
  }
}