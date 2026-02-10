import nodemailer from 'nodemailer';
import 'dotenv/config'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || "hit.kalathiyainfotech@gmail.com",
    pass: process.env.EMAIL_PASS || "fxea ykui olbg oqoh",
  },
});

transporter.verify(err => {
  if (err) console.log('Email error:', err.message);
});

export default transporter;
