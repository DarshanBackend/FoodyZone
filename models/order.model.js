import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "product",
      required: true
    },

    price: { type: Number, required: true },
    discountedPrice: { type: Number },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true },
    totalDiscountedPrice: { type: Number },

    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller",
      required: true
    },

    // Restaurant name for delivery items
    restaurantName: { type: String, default: null },

    // Per-item estimated delivery
    estimatedDelivery: { type: String, default: null },
    estimatedDeliveryDate: { type: Date, default: null },

    itemStatus: {
      type: String,
      enum: ["pending", "confirmed", "processing", "shipped", "delivered", "returned", "cancelled"],
      default: "pending"
    },

    // Item-level status history for per-item timeline
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        notes: String
      }
    ],

    deliveredAt: { type: Date },
    cancelledAt: { type: Date }
  },
  { _id: true, timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true
    },

    orderId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },

    items: [orderItemSchema],

    shippingAddress: {
      country: { type: String, required: true },
      houseDetails: { type: String, required: true },
      landmark: { type: String, required: true },
      state: { type: String },
      city: { type: String },
      postalCode: { type: String },
      address: { type: String },
      mapUrl: { type: String }
    },

    courierService: {
      type: String,
      enum: ["regular", "standard"],
      default: "regular"
    },
    estimatedDeliveryDate: { type: Date },
    actualDeliveryDate: { type: Date },
    trackingNumber: { type: String },

    priceSummary: {
      subtotal: { type: Number, default: 0 },
      itemDiscount: { type: Number, default: 0 },
      couponDiscount: { type: Number, default: 0 },
      subtotalAfterDiscounts: { type: Number, default: 0 },
      deliveryCharge: { type: Number, default: 0 },
      finalTotal: { type: Number, default: 0 }
    },

    appliedOffers: {
      coupon: {
        couponId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "coupon"
        },
        code: String,
        discountType: { type: String, enum: ["flat", "percentage"] },
        discountValue: { type: Number },
        discountApplied: { type: Number, default: 0 }
      }
    },

    // Stripe Payment Info
    paymentInfo: {
      method: {
        type: String,
        enum: ["cod", "card", "upi", "netbanking"],
        default: "cod"
      },
      status: {
        type: String,
        enum: ["pending", "completed", "failed", "refunded"],
        default: "pending"
      },
      stripePaymentIntentId: String,
      stripeClientSecret: String,
      transactionId: String,
      paymentDate: Date,
      refundAmount: { type: Number, default: 0 },
      refundDate: Date
    },

    orderStatus: {
      current: {
        type: String,
        enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"],
        default: "pending"
      },
      history: [
        {
          status: String,
          timestamp: { type: Date, default: Date.now },
          notes: String
        }
      ]
    },

    timeline: {
      orderCreated: { type: Date },
      paymentCompleted: { type: Date },
      orderConfirmed: { type: Date },
      processingStarted: { type: Date },
      orderShipped: { type: Date },
      orderDelivered: { type: Date },
      orderCancelled: { type: Date },
      orderReturned: { type: Date }
    },

    notes: String,
    cancellationReason: String,
    returnReason: String,

    lastUpdated: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ "orderStatus.current": 1 });
orderSchema.index({ createdAt: -1 });

export default mongoose.model("order", orderSchema);
