// backend/src/utils/sms.js
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * @param {{to:string, body:string}} param0
 */
export async function sendSms({ to, body }) {
  await client.messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM,
    to,
  });
}