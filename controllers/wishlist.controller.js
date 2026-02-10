import mongoose from "mongoose";
import wishlistModel from "../models/wishlist.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import {
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendSuccessResponse,
} from "../utils/response.utils.js";
import productModel from "../models/product.model.js";

export const addToWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId, packSizeId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const product = await productModel.findById(productId);
    if (!product) return sendNotFoundResponse(res, "Product not found!");

    let validPackSizeId = undefined;

    if (packSizeId) {
      if (!mongoose.Types.ObjectId.isValid(packSizeId)) {
        return sendBadRequestResponse(res, "Invalid packSize ID!");
      }

      const packExists = product.packSizes && product.packSizes.id(packSizeId);
      if (!packExists) {
        return sendBadRequestResponse(res, "Pack size does not belong to this product!");
      }
      validPackSizeId = packSizeId;
    }

    let wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) {
      wishlist = new wishlistModel({ userId, items: [] });
    }

    if (!Array.isArray(wishlist.items)) {
      wishlist.items = [];
    }

    const exists = wishlist.items.some((item) => {
      const isSameProduct = item.productId.toString() === productId;
      const isSamePack = validPackSizeId
        ? item.packSizeId && item.packSizeId.toString() === validPackSizeId
        : !item.packSizeId;

      return isSameProduct && isSamePack;
    });

    if (exists) {
      return sendBadRequestResponse(res, "Product already in wishlist!");
    }

    wishlist.items.push({
      productId,
      packSizeId: validPackSizeId || undefined
    });

    await wishlist.save();

    return sendSuccessResponse(res, "Added to wishlist!", wishlist);
  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const getWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const wishlist = await wishlistModel
      .findOne({ userId })
      .populate({
        path: "items.productId",
        model: "product",
        populate: [
          {
            path: "category",
            model: "category",
          }
        ]
      })
      .lean();

    if (!wishlist || !wishlist.items?.length) {
      return sendSuccessResponse(res, "Your wishlist is empty!", {});
    }

    // Filter out items where product is null (deleted products)
    wishlist.items = wishlist.items.filter((item) => item.productId);

    // Map to include pack size details if packSizeId exists
    wishlist.items = wishlist.items.map(item => {
      if (item.packSizeId && item.productId && Array.isArray(item.productId.packSizes)) {
        const pack = item.productId.packSizes.find(p => p._id.toString() === item.packSizeId.toString());
        // Add selected pack details to the item if needed or just keep packSizeId
        // The frontend might need pack details alongside product
        if (pack) {
          item.selectedPack = pack;
        }
      }
      return item;
    });

    return sendSuccessResponse(res, "Wishlist fetched successfully!", wishlist);
  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId, packSizeId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) return sendNotFoundResponse(res, "Wishlist not found!");

    const existsIndex = wishlist.items.findIndex((item) => {
      const isSameProduct = item.productId.toString() === productId;
      const isSamePack = packSizeId
        ? item.packSizeId && item.packSizeId.toString() === packSizeId
        : !item.packSizeId;

      return isSameProduct && isSamePack;
    });

    if (existsIndex === -1) {
      return sendNotFoundResponse(res, "Product not found in wishlist!");
    }

    wishlist.items.splice(existsIndex, 1);

    await wishlist.save();

    return sendSuccessResponse(res, "Product removed from wishlist!", wishlist);
  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};