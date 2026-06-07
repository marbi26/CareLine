// backend/src/routes/doctorRoutes.js
import express from 'express';
import {
  getAllClinics,
  getDoctorsByClinic,
  getDoctors,
  getDoctorProfile,
  getDoctorSlots
} from '../controllers/doctorController.js';

const router = express.Router();

// Public doctor discovery routes
router.get('/', getDoctors);
router.get('/:doctorId/profile', getDoctorProfile);
router.get('/:doctorId/slots', getDoctorSlots);

export default router;