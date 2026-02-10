import Offer from "../models/offer.model.js";
import { uploadToS3, deleteFromS3, updateS3 } from "../utils/s3Service.js";
import productModel from "../models/product.model.js";

export const createOfferBanner = async (req, res) => {
  try {
    const { title, productId } = req.body;

    const product = await productModel.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const image = await uploadToS3(req.file, "offerBanners");
    if (!image) return res.status(400).json({ success: false, message: "Image required" });

    const offer = await Offer.create({ title, productId, image });

    return res.status(201).json({ success: true, message: "Offer banner created", data: offer });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Create offer banner error", error });
  }
};

export const getAllOfferBanners = async (req, res) => {
  try {
    const data = await Offer.find({})
    return res.status(200).json({ success: true, message: "All offer banners", data });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Get offer banners error", error });
  }
};

export const deleteOfferBanner = async (req, res) => {
  try {
    const { id } = req.params;

    const banner = await Offer.findById(id);
    if (!banner) return res.status(404).json({ success: false, message: "Offer banner not found" });

    const key = banner.image.split(".amazonaws.com/")[1];
    await deleteFromS3(key);

    await Offer.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: "Offer banner deleted" });
  }
  catch (error) {
    return res.status(500).json({ success: false, message: "Delete offer banner error", error });
  }
};

export const updateOfferBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, productId } = req.body;

    const banner = await Offer.findById(id);
    if (!banner) return res.status(404).json({ success: false, message: "Offer banner not found" });

    let image = banner.image;

    if (req.file) {
      const oldKey = banner.image.split(".amazonaws.com/")[1];
      image = await updateS3(oldKey, req.file, "offerBanners");
    }

    const updated = await Offer.findByIdAndUpdate(
      id,
      { title, productId, image },
      { new: true }
    );

    return res.status(200).json({ success: true, message: "Offer banner updated", data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Update offer banner error", error });
  }
};
