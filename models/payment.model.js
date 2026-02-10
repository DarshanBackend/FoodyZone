import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true
        },
        orderId: {
            type: String, // Storing as String to match order.orderId (e.g. ORD_123) or ObjectId if preferred. In Order model it is String.
            required: true,
            index: true
        },
        orderObjectId: { // Linking to actual Order document ID
            type: mongoose.Schema.Types.ObjectId,
            ref: "order"
        },
        razorpayOrderId: {
            type: String,
            required: true
        },
        razorpayPaymentId: {
            type: String,
            required: true,
            unique: true
        },
        razorpaySignature: {
            type: String
        },
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            default: "INR"
        },
        status: {
            type: String,
            required: true
        },
        method: {
            type: String,
            required: true
        },
        email: {
            type: String
        },
        contact: {
            type: String
        },
        bank: {
            type: String
        },
        wallet: {
            type: String
        },
        vpa: {
            type: String
        },
        card: {
            id: String,
            entity: String,
            name: String,
            last4: String,
            network: String,
            type: String,
            issuer: String,
            international: Boolean,
            emi: Boolean
        },
        acquirer_data: {
            bank_transaction_id: String
        },
        fee: Number,
        tax: Number,
        error_code: String,
        error_description: String,
        created_at: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

export default mongoose.model("payment", paymentSchema);
