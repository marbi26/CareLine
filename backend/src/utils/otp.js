// backend/src/utils/otp.js
import crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_EXPIRE_MS = 10 * 60 * 1000; // 10 min

export function generateOtp() {
  const otp = crypto
    .randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
  const expires = Date.now() + OTP_EXPIRE_MS;
  return { otp, expires };
}

export function verifyOtp(storedOtp, storedExpires, suppliedOtp) {
  const now = Date.now();
  return storedOtp === suppliedOtp && now < storedExpires;
}