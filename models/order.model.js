import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "product",
      required: true
    },
    packSizeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false
    },
    weight: { type: Number },
    unit: { type: String },

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

    itemStatus: {
      type: String,
      enum: ["pending", "confirmed", "processing", "shipped", "delivered", "returned", "cancelled"],
      default: "pending"
    }
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
      subtotal: { type: Number, default: 0 }, // original prices
      itemDiscount: { type: Number, default: 0 }, // product discounts
      comboDiscount: { type: Number, default: 0 },
      couponDiscount: { type: Number, default: 0 },
      subtotalAfterDiscounts: { type: Number, default: 0 },
      gst: { type: Number, default: 0 }, // 18% GST
      deliveryCharge: { type: Number, default: 0 },
      finalTotal: { type: Number, default: 0 }
    },

    appliedOffers: {
      combos: [
        {
          comboId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "comboOffer"
          },
          title: String,
          discountApplied: { type: Number, default: 0 }
        }
      ],
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

    paymentInfo: {
      method: {
        type: String,
        enum: ["cod", "card", "emi", "upi", "netbanking"],
        default: "cod"
      },
      status: {
        type: String,
        enum: ["pending", "completed", "failed", "refunded"],
        default: "pending"
      },
      transactionId: String,
      razorpayOrderId: String,
      razorpayPaymentId: String,
      razorpaySignature: String,
      paymentDate: Date,
      refundAmount: { type: Number, default: 0 },
      refundDate: Date
    },

    emiInfo: {
      enabled: { type: Boolean, default: false },
      tenure: { type: Number }, // months (3, 6, 9, 12 etc)
      monthlyAmount: { type: Number },
      totalEMIAmount: { type: Number },
      interestRate: { type: Number }, // percentage
      emiStatus: {
        type: String,
        enum: ["pending", "active", "completed", "failed"],
        default: "pending"
      },
      paidInstallments: { type: Number, default: 0 },
      nextPaymentDate: Date,
      installments: [
        {
          installmentNo: Number,
          amount: Number,
          dueDate: Date,
          paidDate: Date,
          status: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
          razorpayPaymentId: String,
          razorpayOrderId: String
        }
      ]
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
