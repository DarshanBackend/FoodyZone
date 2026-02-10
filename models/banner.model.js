import mongoose from "mongoose";

const singleBannerSchema = new mongoose.Schema({
  banner: {
    type: String,
    required: true
  }
});

const bannerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  banner: {
    type: [singleBannerSchema],
    default: []
  }
});

const bannerModel = mongoose.model("banner", bannerSchema);

export default bannerModel;
