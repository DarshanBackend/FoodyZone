import Stripe from 'stripe';
import 'dotenv/config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create a Stripe Payment Intent
 * @param {Number} amount - Amount in INR (rupees)
 * @param {String} orderId - Your order ID for reference
 * @param {String} currency - Currency code (default: INR)
 * @returns {Object} - Stripe PaymentIntent object
 */
export const createPaymentIntent = async (amount, orderId, currency = 'inr') => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Stripe expects amount in paise
            currency,
            metadata: {
                orderId
            },
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            }
        });

        return paymentIntent;
    } catch (error) {
        throw new Error(`Stripe Payment Intent Creation Failed: ${error.message}`);
    }
};

/**
 * Retrieve a Stripe Payment Intent
 * @param {String} paymentIntentId 
 * @returns {Object} - Stripe PaymentIntent object
 */
export const retrievePaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        throw new Error(`Failed to retrieve payment intent: ${error.message}`);
    }
};

/**
 * Create a Stripe Refund
 * @param {String} paymentIntentId - Stripe Payment Intent ID
 * @param {Number} amount - Refund amount in INR (optional, full refund if not provided)
 * @returns {Object} - Stripe Refund object
 */
export const createStripeRefund = async (paymentIntentId, amount) => {
    try {
        const refundData = {
            payment_intent: paymentIntentId
        };

        if (amount && Number(amount) > 0) {
            refundData.amount = Math.round(Number(amount) * 100); // Convert to paise
        }

        const refund = await stripe.refunds.create(refundData);
        return refund;
    } catch (error) {
        throw new Error(`Stripe Refund Failed: ${error.message}`);
    }
};

/**
 * Construct and verify Stripe Webhook Event
 * @param {Buffer} rawBody - Raw request body
 * @param {String} signature - Stripe signature header
 * @param {String} webhookSecret - Webhook signing secret
 * @returns {Object} - Stripe Event object
 */
export const constructWebhookEvent = (rawBody, signature, webhookSecret) => {
    try {
        const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        return event;
    } catch (error) {
        throw new Error(`Webhook signature verification failed: ${error.message}`);
    }
};

/**
 * Confirm a PaymentIntent with a test payment method (for testing only)
 * Uses Stripe's test card pm_card_visa
 * @param {String} paymentIntentId
 * @returns {Object} - Confirmed PaymentIntent
 */
export const confirmPaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: 'pm_card_visa'
        });
        return paymentIntent;
    } catch (error) {
        throw new Error(`Stripe Payment Confirm Failed: ${error.message}`);
    }
};

export { stripe };

export default {
    stripe,
    createPaymentIntent,
    retrievePaymentIntent,
    confirmPaymentIntent,
    createStripeRefund,
    constructWebhookEvent
};
