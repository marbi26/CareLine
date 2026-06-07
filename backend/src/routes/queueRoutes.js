// backend/src/routes/queueRoutes.js
import express from 'express';
import {
  getLiveQueue,
  assignQueue,
  updateQueueStage,
  completeConsultation,
  getDashboardStats
} from '../controllers/queueController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Dashboard Stats endpoint is public / handles authorization internally
router.get('/dashboard/stats', getDashboardStats);

router.use(auth); // Require login for mutating queue stages

router.get('/', getLiveQueue);
router.post('/admin/queue/assign', assignQueue);
router.post('/admin/queue/delete', (req, res) => updateQueueStage(req, res)); // Maps delete to stage change
router.post('/admin/queue/advance', updateQueueStage);
router.post('/update-stage', updateQueueStage);
router.post('/doctor/queue/complete', completeConsultation);

export default router;