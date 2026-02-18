import mongoose from "mongoose";
import wishlistModel from "../models/wishlist.model.js";
import productModel from "../models/product.model.js";
import restaurantModel from "../models/restaurant.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import {
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendSuccessResponse,
} from "../utils/response.utils.js";

export const addToWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId, restaurantId } = req.body;

    let targetRestaurantId = null;
    let targetProductId = null;

    if (restaurantId) {
      if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        return sendBadRequestResponse(res, "Invalid restaurant ID!");
      }
      const restaurant = await restaurantModel.findById(restaurantId);
      if (!restaurant) return sendNotFoundResponse(res, "Restaurant not found!");
      targetRestaurantId = restaurantId;

    } else if (productId) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return sendBadRequestResponse(res, "Invalid product ID!");
      }
      const product = await productModel.findById(productId);
      if (!product) return sendNotFoundResponse(res, "Product not found!");

      if (product.restaurantId) {
        targetRestaurantId = product.restaurantId;
      } else {
        targetProductId = productId;
      }
    } else {
      return sendBadRequestResponse(res, "Provide productId or restaurantId!");
    }

    let wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) {
      wishlist = new wishlistModel({
        userId,
        products: [],
        restaurants: []
      });
    }

    if (targetRestaurantId) {
      const exists = wishlist.restaurants.some(item =>
        item.restaurantId.toString() === targetRestaurantId.toString()
      );
      if (exists) {
        return sendBadRequestResponse(res, "Restaurant already in wishlist!");
      }
      wishlist.restaurants.push({ restaurantId: targetRestaurantId });
      await wishlist.save();
      return sendSuccessResponse(res, "Restaurant added to wishlist!", wishlist);

    } else if (targetProductId) {
      const exists = wishlist.products.some(item =>
        item.productId.toString() === targetProductId.toString()
      );
      if (exists) {
        return sendBadRequestResponse(res, "Product already in wishlist!");
      }
      wishlist.products.push({ productId: targetProductId });
      await wishlist.save();
      return sendSuccessResponse(res, "Product added to wishlist!", wishlist);
    }

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
        path: "products.productId",
        model: "product",
        populate: [
          {
            path: "category",
            model: "category",
          }
        ]
      })
      .populate({
        path: "restaurants.restaurantId",
        model: "restaurant"
      })
      .lean();

    if (!wishlist) {
      return sendSuccessResponse(res, "Your wishlist is empty!", { products: [], restaurants: [] });
    }

    if (wishlist.products) {
      wishlist.products = wishlist.products.filter(item => item.productId);
    } else {
      wishlist.products = [];
    }

    if (wishlist.restaurants) {
      wishlist.restaurants = wishlist.restaurants.filter(item => item.restaurantId);
    } else {
      wishlist.restaurants = [];
    }

    const responseData = {
      _id: wishlist._id,
      userId: wishlist.userId,
      products: wishlist.products,
      restaurants: wishlist.restaurants
    };

    return sendSuccessResponse(res, "Wishlist fetched successfully!", responseData);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId, restaurantId } = req.body;

    let targetRestaurantId = null;
    let targetProductId = null;

    if (restaurantId) {
      targetRestaurantId = restaurantId;
    } else if (productId) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return sendBadRequestResponse(res, "Invalid product ID!");
      }
      const product = await productModel.findById(productId);
      if (product && product.restaurantId) {
        targetRestaurantId = product.restaurantId;
      } else {
        targetProductId = productId;
      }
    } else {
      return sendBadRequestResponse(res, "Provide productId or restaurantId!");
    }

    const wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) return sendNotFoundResponse(res, "Wishlist not found!");

    let modified = false;

    if (targetRestaurantId) {
      const initialLength = wishlist.restaurants.length;
      wishlist.restaurants = wishlist.restaurants.filter(item =>
        item.restaurantId.toString() !== targetRestaurantId.toString()
      );
      if (wishlist.restaurants.length !== initialLength) modified = true;

    } else if (targetProductId) {
      const initialLength = wishlist.products.length;
      wishlist.products = wishlist.products.filter(item =>
        item.productId.toString() !== targetProductId.toString()
      );
      if (wishlist.products.length !== initialLength) modified = true;
    }

    if (!modified) {
      return sendNotFoundResponse(res, "Item not found in wishlist!");
    }

    await wishlist.save();
    return sendSuccessResponse(res, "Removed from wishlist!", wishlist);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};