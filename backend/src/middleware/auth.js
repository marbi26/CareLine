// backend/src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { Patient, Doctor, Admin, Support } from '../models.js';

export async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    // Look up the user in their specific collection based on the role in the token
    let user;
    if (payload.role === 'patient') {
      user = await Patient.findById(payload.id).select('-password');
    } else if (payload.role === 'doctor') {
      user = await Doctor.findById(payload.id).select('-password');
    } else if (payload.role === 'admin') {
      user = await Admin.findById(payload.id).select('-password');
    } else if (payload.role === 'support') {
      user = await Support.findById(payload.id).select('-password');
    }

    if (!user) throw new Error('User not found');
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Invalid token' });
  }
}