import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    houseDetails: { type: String, default: null },
    landmark: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    pincode: { type: String, default: null },
    saveAs: { type: String, enum: ["Home", "Office", "Other"], default: "Home" },
    mapURL: { type: String, default: null }
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      required: true
    },
    email: {
      type: String,
      lowercase: true,
      default: null,
      unique: true,
      sparse: true,
      required: true
    },
    password: {
      type: String,
      default: null
    },
    isSocialLogin: {
      type: Boolean,
      default: false
    },
    otp: {
      type: Number,
      default: null
    },
    otpExpiry: {
      type: Date,
      default: null
    },
    country: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    },
    address: [addressSchema],
    selectedAddress: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    }
  },
  { timestamps: true }
);

const userModel = mongoose.models.user || mongoose.model("user", userSchema);
export default userModel

