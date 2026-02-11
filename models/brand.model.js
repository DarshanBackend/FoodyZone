import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    brandName: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    brandImage: {
      type: String,
      required: true
    },
    // categories removed as per user request
    sellerId: {
      type: mongoose.Types.ObjectId,
      ref: "seller"
    }
  },
  { timestamps: true }
);

brandSchema.index({ brandName: 1 });

const brandModel = mongoose.model("brand", brandSchema);

export default brandModel;
