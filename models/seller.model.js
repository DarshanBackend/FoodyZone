import mongoose from "mongoose";

const sellerSchema = new mongoose.Schema({
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  mobileNo: { type: String, required: [true, "mobileNo iS Required to insert"], default: null },
  email: { type: String, required: [true, "email iS Required to insert"], default: null },
  password: { type: String, required: [true, "password iS Required to insert"], default: null },
  avatar: { type: String, default: null },
  otp: { type: String, default: null },
  otpExpiry: {
    type: Date,
    default: null
  },
  verified: { type: Boolean, default: false },
  brandId: [
    { type: mongoose.Schema.Types.ObjectId, ref: "brand" }
  ],
  pickUpAddr: [
    {
      houseNo: { type: String, default: null },
      street: { type: String, default: null },
      landmark: { type: String, default: null },
      pincode: { type: String, default: null },
      city: { type: String, default: null },
      state: { type: String, default: null }
    }
  ],
  products: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Product" }
  ],
  orders: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Order" }
  ],
  role: {
    type: String,
    enum: ["seller", "admin"],
    default: "seller"
  },
}, { timestamps: true });

const sellerModel = mongoose.model("seller", sellerSchema);

export default sellerModel;