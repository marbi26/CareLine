// backend/src/utils/email.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * @param {{to:string, subject:string, html:string}} param0
 */
export async function sendMail({ to, subject, html }) {
  const mailOptions = {
    from: `"CareLine" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  };
  await transporter.sendMail(mailOptions);
}