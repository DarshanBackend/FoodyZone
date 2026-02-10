import twilio from 'twilio';
import 'dotenv/config';

const accountSid = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

export const sendSMS = async (to, body) => {
    try {
        const message = await client.messages.create({
            body: body,
            from: fromPhone,
            to: to
        });
        console.log("SMS sent successfully:", message.sid);
        return message;
    } catch (error) {
        console.error("Error sending SMS:", error);
        // Don't throw error to prevent blocking main flow if SMS fails, 
        // unless strictly required. But for OTP, it is required.
        throw error;
    }
};
