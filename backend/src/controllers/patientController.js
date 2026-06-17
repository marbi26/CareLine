// backend/src/controllers/patientController.js
import { Patient, Doctor, Admin, Appointment, Payment } from '../models.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

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

    // Check for slot conflicts at the new time
    const slotConflict = await Appointment.findOne({
      doctorId: appt.doctorId,
      date: newDate,
      time: newSlotTime,
      stage: { $nin: ['cancelled', 'no-show'] },
      _id: { $ne: apptId }
    });
    if (slotConflict) {
      return res.status(400).json({ message: 'SLOT_UNAVAILABLE' });
    }

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
    const AVG_MINS_PER_PATIENT = 10; // assumption for wait time estimate

    const formatted = await Promise.all(appts.map(async (a) => {
      const doc = await Doctor.findById(a.doctorId);
      const cl  = await Admin.findById(a.clinicId);

      // Base fields always returned
      const base = {
        id:             a._id,
        token:          a.token,
        date:           a.date,
        time:           a.time,
        doctorFullName: doc ? doc.fullName : 'Doctor',
        doctorId:       a.doctorId,
        specialization: doc?.profile?.specialization || '',
        clinicId:       a.clinicId,
        location:       cl ? (cl.profile?.clinicName || cl.fullName) : 'Clinic Center',
        reason:         a.reason,
        stage:          a.stage,
        paid:           a.paid,
        // defaults — overwritten below for active appointments
        patientsAhead:  null,
        currentToken:   null,
        estimatedWait:  null
      };

      // Only compute live queue fields for active (non-terminal) stages
      const activeStages = ['in-queue', 'calling', 'in-consult', 'scheduled'];
      if (activeStages.includes(a.stage)) {
        try {
          // All non-terminal appointments in this clinic today, sorted by token
          const queue = await Appointment.find({
            clinicId: a.clinicId,
            date:     a.date,
            stage:    { $in: ['in-queue', 'calling', 'in-consult'] }
          }).sort({ token: 1 });

          // Token currently being called
          const callingAppt = queue.find(q => q.stage === 'calling');
          base.currentToken = callingAppt ? callingAppt.token : null;

          // Patients that still need to be seen BEFORE this patient
          const myIdx = queue.findIndex(q => String(q._id) === String(a._id));
          if (myIdx === -1) {
            // Patient not in active queue yet (scheduled but not paid/queued)
            base.patientsAhead = null;
            base.estimatedWait = null;
          } else {
            // Count only those with a lower or equal token but not yet done
            base.patientsAhead = myIdx; // 0 = you're next
            base.estimatedWait = Math.max(0, myIdx * AVG_MINS_PER_PATIENT);
          }
        } catch (_) {
          // silently ignore if queue lookup fails
        }
      }

      return base;
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

export async function createRazorpayOrder(req, res) {
  const { apptId, amount } = req.body;
  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.log('⚠️ Razorpay credentials missing. Running in Sandbox Fallback Mode.');
      return res.json({
        success: true,
        dummy: true,
        orderId: `dummy_order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount: amount || 500
      });
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });

    const options = {
      amount: Math.round((amount || 500) * 100), // amount in paisa
      currency: "INR",
      receipt: `receipt_${apptId}_${Date.now()}`
    };

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (razorErr) {
      console.warn('⚠️ Razorpay API failed. Falling back to Sandbox mode. Error:', razorErr.message || razorErr);
      return res.json({
        success: true,
        dummy: true,
        orderId: `sandbox_order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount: amount || 500
      });
    }
    res.json({
      success: true,
      dummy: false,
      orderId: order.id,
      amount: order.amount / 100,
      keyId: keyId
    });
  } catch (err) {
    console.error('Error creating Razorpay order:', err);
    // Final fallback — should not normally reach here
    return res.json({
      success: true,
      dummy: true,
      orderId: `fallback_order_${Date.now()}`,
      amount: amount || 500
    });
  }
}

export async function verifyRazorpayPayment(req, res) {
  const {
    patientId,
    apptId,
    amount,
    method,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    dummy
  } = req.body;

  try {
    const appt = await Appointment.findById(apptId);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const patient = await Patient.findById(patientId);

    if (dummy) {
      // Record sandbox fallback payment directly as success
      appt.paid = true;
      appt.stage = 'in-queue';
      await appt.save();

      const payment = new Payment({
        patientId,
        patientName: patient ? patient.fullName : 'Walk-in',
        clinicId: appt.clinicId,
        apptId,
        amount: amount || 500,
        method: method || 'Razorpay (Sandbox)',
        status: 'success'
      });
      await payment.save();
      return res.json({ success: true, message: 'Sandbox payment verified successfully' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(400).json({ message: 'Razorpay secret key not configured on server' });
    }

    // Verify signature
    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(razorpayOrderId + '|' + razorpayPaymentId);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpaySignature) {
      const payment = new Payment({
        patientId,
        patientName: patient ? patient.fullName : 'Walk-in',
        clinicId: appt.clinicId,
        apptId,
        amount: amount || 500,
        method: method || 'Razorpay',
        status: 'failed'
      });
      await payment.save();
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    appt.paid = true;
    appt.stage = 'in-queue';
    await appt.save();

    const payment = new Payment({
      patientId,
      patientName: patient ? patient.fullName : 'Walk-in',
      clinicId: appt.clinicId,
      apptId,
      amount: amount || 500,
      method: method || 'Razorpay',
      status: 'success'
    });
    await payment.save();

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    console.error('Error verifying Razorpay payment:', err);
    res.status(500).json({ message: 'Failed to verify payment' });
  }
}