// backend/src/routes/authRoutes.js
import express from 'express';
import {
  signupInitiate,
  signupVerify,
  login,
  logout
} from '../controllers/authController.js';

const router = express.Router();

router.post('/signup/initiate', signupInitiate);
router.post('/signup/verify', signupVerify);
router.post('/login', login);
router.post('/logout', logout);

export default router;