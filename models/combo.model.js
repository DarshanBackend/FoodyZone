import mongoose from "mongoose";

const comboProductSchema = new mongoose.Schema(
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
    quantity: { type: Number, default: 1 }
  }
);

const comboOfferSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    products: {
      type: [comboProductSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, "At least one product required"]
    },
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },

    calculatedOriginalPrice: { type: Number, default: 0 },
    calculatedDiscountedPrice: { type: Number, default: 0 },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller",
      required: true
    },

    isActive: { type: Boolean, default: true },

    bannerImage: { type: String },
    comboType: {
      type: String,
      enum: ["delivery", "grocery"],
      default: "delivery"
    }
  },
  { timestamps: true }
);

comboOfferSchema.index({ createdBy: 1 });

const comboModel = mongoose.model("comboOffer", comboOfferSchema);

export default comboModel

