import mongoose from "mongoose";
import brandModel from "../models/brand.model.js";
import productModel from "../models/product.model.js";
import { sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import reviewModel from "../models/review.model.js";

export const newArrival = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = { isActive: true };
    if (type) filter.productType = type;

    const products = await productModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(15);

    return sendSuccessResponse(
      res,
      "New Arrivals fetched successfully",
      products
    );
  } catch (error) {
    return sendErrorResponse(res, 500, "error while get newArrival", error);
  }
};

export const bestSeller = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = {};
    if (type) filter.productType = type;

    const products = await productModel
      .find(filter)
      .sort({ soldCount: -1 })
      .limit(15);

    return sendSuccessResponse(res, "best selling Products", products);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while bestSeller", error)
  }
}

export const newProducts = async (req, res) => {
  try {
    const { type } = req.query;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const filter = {
      isActive: true,
      createdAt: { $lt: thirtyDaysAgo }
    };
    if (type) filter.productType = type;

    const products = await productModel
      .find(filter)
      .sort({ createdAt: -1, soldCount: -1 })
      .limit(6);

    return sendSuccessResponse(res, "New Products fetched successfully", products);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching new products", error);
  }
}

export const trendingDeals = async (req, res) => {
  try {
    const { type } = req.query;
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const matchStage = {};
    if (type) matchStage.productType = type;

    const pipeline = [];
    if (type) {
      pipeline.push({ $match: { productType: type } });
    }

    pipeline.push(
      {
        $addFields: {
          trendingScore: {
            $add: [
              { $multiply: ["$soldCount", 2] },
              {
                $cond: [
                  { $gte: ["$createdAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                  50,
                  0
                ]
              }
            ]
          }
        }
      },
      { $sort: { trendingScore: -1 } },
      { $skip: skip },
      { $limit: limit }
    );

    const products = await productModel.aggregate(pipeline);

    const ids = products.map(x => x._id);

    const finalProducts = await productModel
      .find({ _id: { $in: ids }, isActive: true });

    return sendSuccessResponse(res, "Trending Deals Products", finalProducts);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching trending deals", error);
  }
};

export const grabNowDeals = async (req, res) => {
  try {
    const { type } = req.query;

    const filter = { isActive: true };
    if (type) filter.productType = type;

    const products = await productModel.find(filter);

    const deals = products.map(p => {
      let maxDiscount = 0;
      let minPrice = Infinity;

      if (p.packSizes && p.packSizes.length > 0) {
        p.packSizes.forEach(s => {
          if (s.price < minPrice) minPrice = s.price;
        });
      }

      if (p.discount) maxDiscount = p.discount;

      return {
        ...p._doc,
        dealDetails: {
          discountPercent: maxDiscount || 0,
          price: minPrice !== Infinity ? minPrice : p.price
        }
      };
    }).filter(d => d.dealDetails.discountPercent > 0);

    deals.sort((a, b) => b.dealDetails.discountPercent - a.dealDetails.discountPercent);

    return sendSuccessResponse(res, "Grab Now Deals Fetched", deals.slice(0, 10));
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getFiltteredProducts = async (req, res) => {
  try {
    const {
      q,
      categoryId,
      minPrice,
      maxPrice,
      rating,
      sort,
      type
    } = req.query;

    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    const minRating = rating ? Number(rating) : null;

    const matchQuery = { isActive: true };
    if (type) matchQuery.productType = type;

    if (q && q.trim()) {
      matchQuery.$or = [
        { productName: { $regex: q.trim(), $options: "i" } },
        { productDesc: { $regex: q.trim(), $options: "i" } }
      ];
    }

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      matchQuery.category = new mongoose.Types.ObjectId(categoryId);
    }

    if (min !== null || max !== null) {
      matchQuery['packSizes.price'] = {};
      if (min !== null) matchQuery['packSizes.price'].$gte = min;
      if (max !== null) matchQuery['packSizes.price'].$lte = max;
    }

    let products = await productModel.find(matchQuery)
      .sort({ createdAt: -1 });

    if (minRating !== null) {
      const productIds = products.map(p => p._id);
      const ratingAgg = await reviewModel.aggregate([
        { $match: { productId: { $in: productIds } } },
        {
          $group: {
            _id: "$productId",
            avgRating: { $avg: "$overallRating" },
            totalReviews: { $sum: 1 }
          }
        },
        { $match: { avgRating: { $gte: minRating } } }
      ]);

      const validIds = new Set(ratingAgg.map(r => r._id.toString()));
      products = products.filter(p => validIds.has(p._id.toString()));
    }

    if (sort) {
      if (sort === "latest") {
        products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      if (sort === "priceLow") {
        products.sort((a, b) => (getMinPrice(a) - getMinPrice(b)));
      }
      if (sort === "priceHigh") {
        products.sort((a, b) => (getMaxPrice(b) - getMaxPrice(a)));
      }
    }

    return sendSuccessResponse(res, "Products fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, "Error while filtering products", error);
  }
};

function getMinPrice(product) {
  if (product.packSizes && product.packSizes.length > 0) {
    return Math.min(...product.packSizes.map(s => s.price));
  }
  return product.price || 0;
}

function getMaxPrice(product) {
  if (product.packSizes && product.packSizes.length > 0) {
    return Math.max(...product.packSizes.map(s => s.price));
  }
  return product.price || 0;
}