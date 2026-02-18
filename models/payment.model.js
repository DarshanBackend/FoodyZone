import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true
        },
        orderId: {
            type: String,
            required: true,
            index: true
        },
        orderObjectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "order"
        },

        stripePaymentIntentId: {
            type: String,
            required: true,
            unique: true
        },
        stripeClientSecret: {
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
            enum: ["pending", "processing", "succeeded", "failed", "refunded", "cancelled"],
            default: "pending",
            required: true
        },
        method: {
            type: String,
            enum: ["card", "upi", "netbanking", "cod", "unknown"],
            default: "card",
            required: true
        },

        email: { type: String },
        contact: { type: String },

        card: {
            brand: String,
            last4: String,
            expMonth: Number,
            expYear: Number,
            funding: String
        },

        refundId: { type: String },
        refundAmount: { type: Number, default: 0 },
        refundStatus: { type: String },
        refundDate: { type: Date },
        errorCode: { type: String },
        errorMessage: { type: String },

        paymentDate: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

paymentSchema.index({ stripePaymentIntentId: 1 });
paymentSchema.index({ userId: 1 });

export default mongoose.model("payment", paymentSchema);
