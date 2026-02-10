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
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "category"
      }
    ],
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
