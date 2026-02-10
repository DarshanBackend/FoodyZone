import mongoose from "mongoose";

const offerModel = new mongoose.Schema({
  title: { type: String, default: "" },
  image: { type: String, default: "" },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "product" }
}, { timestamps: true });

export default mongoose.model("offer", offerModel);
