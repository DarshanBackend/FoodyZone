import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
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

    stock: { type: Number, required: true },

    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller",
      required: true
    },

    addedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      unique: true
    },
    items: [cartItemSchema],

    totalItems: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    totalDiscountedPrice: { type: Number, default: 0 },
    totalSavings: { type: Number, default: 0 },

    appliedCoupon: {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "coupon"
      },
      couponCode: { type: String },
      discountApplied: { type: Number, default: 0 },
      discountType: { type: String, enum: ["flat", "percentage"] },
      discountValue: { type: Number },
      appliedAt: { type: Date }
    },

    restaurantCharges: { type: Number, default: 0 },

    subtotal: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    finalTotal: { type: Number, default: 0 }
  },
  { timestamps: true }
);

cartSchema.index({ userId: 1 });

export default mongoose.model("cart", cartSchema);
