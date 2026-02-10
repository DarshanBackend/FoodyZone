import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    default: null
  },
  image: {
    type: String,
    default: null
  },
  parentCategory: {
    type: mongoose.Types.ObjectId,
    ref: "category",
    default: null
  },
  sellerId: {
    type: mongoose.Types.ObjectId,
    ref: "seller",
    default: null
  },
  type: {
    type: String,
    enum: ["delivery", "grocery"],
    default: "delivery"
  }
}, { timestamps: true })

const categoryModel = mongoose.model("category", categorySchema);

export default categoryModel