// backend/src/routes/patientRoutes.js
import express from 'express';
import {
  bookAppointment,
  rescheduleAppointment,
  cancelAppointment,
  recordPayment,
  getPatientAppointments,
  getPatientPayments,
  createRazorpayOrder,
  verifyRazorpayPayment
} from '../controllers/patientController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.use(auth); // Requires JWT Authentication for patient routes

router.post('/book', bookAppointment);
router.post('/appointment/reschedule', rescheduleAppointment);
router.post('/appointment/cancel', cancelAppointment);
router.post('/payment/record', recordPayment);
router.post('/payment/razorpay-order', createRazorpayOrder);
router.post('/payment/razorpay-verify', verifyRazorpayPayment);
router.get('/:id/appointments', getPatientAppointments);
router.get('/:id/payments', getPatientPayments);

export default router;