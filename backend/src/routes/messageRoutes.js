// backend/src/routes/messageRoutes.js
import express from 'express';
import { getContacts, getChatHistory, sendMessage } from '../controllers/messageController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.use(auth); // Require login for all message routes

router.get('/contacts', getContacts);
router.get('/history', getChatHistory);
router.post('/send', sendMessage);

export default router;
