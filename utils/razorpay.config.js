import Razorpay from 'razorpay';
import 'dotenv/config';

export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_key_id_here',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret_here'
});

export const EMI_TENURES = [3, 6, 9, 12]; // months

export const EMI_INTEREST_RATES = {
  3: 0, // 0% for 3 months
  6: 2, // 2% for 6 months
  9: 3, // 3% for 9 months
  12: 4 // 4% for 12 months
};

export const calculateEMI = (principal, tenure) => {
  if (!EMI_TENURES.includes(tenure)) {
    throw new Error(`Invalid tenure. Allowed: ${EMI_TENURES.join(', ')}`);
  }

  const rate = EMI_INTEREST_RATES[tenure] / 100;
  const monthlyRate = rate / 12;

  let emiAmount;
  if (monthlyRate === 0) {
    emiAmount = principal / tenure;
  } else {
    const numerator = principal * monthlyRate * Math.pow(1 + monthlyRate, tenure);
    const denominator = Math.pow(1 + monthlyRate, tenure) - 1;
    emiAmount = numerator / denominator;
  }

  const totalAmount = emiAmount * tenure;
  const interestAmount = totalAmount - principal;

  return {
    monthlyAmount: Math.round(emiAmount),
    totalAmount: Math.round(totalAmount),
    interestAmount: Math.round(interestAmount),
    interestRate: EMI_INTEREST_RATES[tenure]
  };
};

export const createRazorpayOrder = async (amount, orderId, currency = 'INR') => {
  try {
    const order = await razorpayInstance.orders.create({
      amount: amount * 100,
      currency,
      receipt: orderId,
      payment_capture: 1
    });

    return order;
  } catch (error) {
    throw new Error(`Razorpay Order Creation Failed: ${error.message}`);
  }
};

export const createRazorpayEMIOrder = async (amount, orderId, tenure, currency = 'INR') => {
  try {
    const emiDetails = calculateEMI(amount, tenure);

    const order = await razorpayInstance.orders.create({
      amount: amount * 100,
      currency,
      receipt: orderId,
      payment_capture: 1,
      notes: {
        tenure,
        monthlyAmount: emiDetails.monthlyAmount,
        totalAmount: emiDetails.totalAmount
      }
    });

    return {
      order,
      emiDetails
    };
  } catch (error) {
    throw new Error(`Razorpay EMI Order Creation Failed: ${error.message}`);
  }
};

import crypto from 'crypto'
export const verifyRazorpaySignature = (
  orderId,
  paymentId,
  signature,
  secret = process.env.RAZORPAY_KEY_SECRET
) => {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(orderId + '|' + paymentId);
  const generatedSignature = hmac.digest('hex');

  return generatedSignature === signature;
};

export const getRazorpayPaymentDetails = async (paymentId) => {
  try {
    const payment = await razorpayInstance.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    throw new Error(`Failed to fetch payment details: ${error.message}`);
  }
};

export const refundRazorpayPayment = async (paymentId, amount) => {
  try {
    const options = {};
    if (amount && Number(amount) > 0) {
      options.amount = Math.round(Number(amount) * 100);
    }

    console.log("Refund options:", options, "Payment ID:", paymentId);

    const refund = await razorpayInstance.payments.refund(paymentId, options);
    console.log("Refund response:", refund);

    return refund;
  } catch (error) {
    console.error("Razorpay Refund Error Object:", error);
    throw new Error(`Refund failed: ${error?.error?.description || error.message || JSON.stringify(error)}`);
  }
};



export default {
  razorpayInstance,
  EMI_TENURES,
  EMI_INTEREST_RATES,
  calculateEMI,
  createRazorpayOrder,
  createRazorpayEMIOrder,
  verifyRazorpaySignature,
  getRazorpayPaymentDetails,
  refundRazorpayPayment
};
