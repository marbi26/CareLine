// backend/src/controllers/authController.js
import jwt from 'jsonwebtoken';
import { Patient, Doctor, Admin, Support } from '../models.js';
import { generateOtp, verifyOtp } from '../utils/otp.js';
import { sendMail } from '../utils/email.js';
import { sendSms } from '../utils/sms.js';

function getModelByRole(role) {
  if (role === 'patient') return Patient;
  if (role === 'doctor') return Doctor;
  if (role === 'admin') return Admin;
  return Support;
}

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ---- Signup Step 1: Initiate ----
export async function signupInitiate(req, res) {
  const { role, fullName, mobile, email, password, profile } = req.body;
  try {
    const Model = getModelByRole(role);
    const existing = await Model.findOne({ $or: [{ email }, { mobile }] });
    if (existing && existing.status !== 'pending-verify') {
      return res.status(400).json({ message: 'Email or Mobile already registered' });
    }

    const { otp, expires } = generateOtp();

    let user = existing;
    if (user) {
      user.fullName = fullName;
      user.password = password;
      user.profile = profile;
      user.otp = otp;
      user.otpExpires = new Date(expires);
    } else {
      user = new Model({
        email,
        mobile,
        password,
        fullName,
        role,
        profile,
        otp,
        otpExpires: new Date(expires),
        status: 'pending-verify'
      });
    }
    await user.save();

    console.log(`\n🔑 [DEVELOPER OTP LOG] Role: ${role} | User: ${email} | Mobile: ${mobile} | OTP: ${otp}\n`);

    try {
      await sendMail({
        to: email,
        subject: 'CareLine Verification OTP',
        html: `<p>Your verification OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
      });
    } catch (e) {
      console.warn('⚠️ SMTP Email delivery failed. Using console log fallback.');
    }

    try {
      await sendSms({ to: mobile, body: `Your CareLine OTP is: ${otp}` });
    } catch (e) {
      console.warn('⚠️ Twilio SMS delivery failed.');
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
}

// ---- Signup Step 2: Verify & Finalize ----
export async function signupVerify(req, res) {
  const { mobile, otp } = req.body;
  try {
    let user = await Patient.findOne({ mobile });
    let Model = Patient;

    if (!user) { user = await Doctor.findOne({ mobile }); Model = Doctor; }
    if (!user) { user = await Admin.findOne({ mobile }); Model = Admin; }
    if (!user) { user = await Support.findOne({ mobile }); Model = Support; }

    if (!user) return res.status(400).json({ message: 'User not found' });

    const valid = verifyOtp(user.otp, user.otpExpires, otp);
    if (!valid) return res.status(400).json({ message: 'Invalid or expired OTP' });

    user.otp = undefined;
    user.otpExpires = undefined;
    user.status = user.role === 'doctor' ? 'pending' : 'approved';
    await user.save();

    res.json({ message: 'Account verified successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// ---- Login ----
export async function login(req, res) {
  const { role, identifier, password } = req.body;
  try {
    const Model = getModelByRole(role);
    const emailKey = identifier ? identifier.toLowerCase() : '';
    const user = await Model.findOne({
      $or: [
        { email: emailKey },
        { mobile: identifier }
      ]
    });

    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    if (user.status === 'pending-verify') return res.status(400).json({ message: 'Account verification pending. Please register again.' });
    if (user.status === 'pending') return res.status(400).json({ message: 'Your doctor account is pending clinic approval.' });
    if (user.status === 'rejected') return res.status(400).json({ message: 'Your account review has been rejected.' });

    const match = await user.comparePassword(password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        mobile: user.mobile,
        role: user.role,
        profile: user.profile
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

export function logout(_req, res) {
  res.json({ message: 'Logged out' });
}