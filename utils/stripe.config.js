import Stripe from 'stripe';
import 'dotenv/config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createPaymentIntent = async (amount, orderId, currency = 'inr') => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
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

export const retrievePaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        throw new Error(`Failed to retrieve payment intent: ${error.message}`);
    }
};

export const createStripeRefund = async (paymentIntentId, amount) => {
    try {
        const refundData = {
            payment_intent: paymentIntentId
        };

        if (amount && Number(amount) > 0) {
            refundData.amount = Math.round(Number(amount) * 100);
        }

        const refund = await stripe.refunds.create(refundData);
        return refund;
    } catch (error) {
        throw new Error(`Stripe Refund Failed: ${error.message}`);
    }
};

export const constructWebhookEvent = (rawBody, signature, webhookSecret) => {
    try {
        const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        return event;
    } catch (error) {
        throw new Error(`Webhook signature verification failed: ${error.message}`);
    }
};

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
