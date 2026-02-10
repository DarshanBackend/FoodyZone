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
  }
}, { timestamps: true })

const categoryModel = mongoose.model("category", categorySchema);

export default categoryModel