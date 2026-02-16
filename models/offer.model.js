import mongoose from "mongoose";

const offerModel = new mongoose.Schema({
  title: { type: String, default: "" },
  image: { type: String, default: null },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "product" },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "category" }
}, { timestamps: true });

export default mongoose.model("offer", offerModel);