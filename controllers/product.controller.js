import mongoose from "mongoose";
import Product from "../models/product.model.js";
import sellerModel from "../models/seller.model.js";
import CategoryModel from "../models/category.model.js";
import brandModel from "../models/brand.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";
import reviewModel from "../models/review.model.js";

// Helper to recursively get all child category IDs
const getAllChildCategoryIds = async (categoryId) => {
  const children = await CategoryModel.find({ parentCategory: categoryId }).select("_id");
  let allIds = children.map(c => c._id);

  for (const child of children) {
    const subChildren = await getAllChildCategoryIds(child._id);
    allIds = [...allIds, ...subChildren];
  }
  return allIds;
};

export const createProduct = async (req, res) => {
  try {
    // Form data fields
    const {
      productName,
      category,
      totalQuantity,
      packSizes,
      productDesc,
      productHealthBenefit,
      productStorage,
      price,
      originalPrice, // Add this if sent from frontend
      discount // Add this if sent from frontend
    } = req.body;

    const sellerId = req.user?._id;

    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
      return sendBadRequestResponse(res, "Invalid or missing seller ID");
    }

    const seller = await sellerModel.findById(sellerId);
    if (!seller) return sendNotFoundResponse(res, "Seller not found");

    if (!productName) return sendBadRequestResponse(res, "Product Name is required");
    if (!category) return sendBadRequestResponse(res, "Category is required");

    let productType = "delivery";
    if (mongoose.Types.ObjectId.isValid(category)) {
      const cat = await CategoryModel.findById(category);
      if (cat) productType = cat.type || "delivery";
    }

    // Parse JSON fields if they are strings (multipart/form-data often sends JSON as strings)
    let parsedTotalQuantity = totalQuantity;
    let parsedPackSizes = packSizes;

    if (typeof totalQuantity === 'string') {
      try { parsedTotalQuantity = JSON.parse(totalQuantity); } catch (e) { }
    }
    if (typeof packSizes === 'string') {
      try { parsedPackSizes = JSON.parse(packSizes); } catch (e) { }
    }

    // Image Upload Handling
    let productImage = null;
    let productImageKey = null;
    let gImages = [];

    // req.files is expected to be an object due to upload.fields() user likely uses
    // fields: [{ name: 'productImage', maxCount: 1 }, { name: 'gImage', maxCount: 5 }]

    if (req.files) {
      if (req.files.productImage && req.files.productImage.length > 0) {
        const file = req.files.productImage[0];
        productImage = await uploadToS3(file, "products/cover");
        productImageKey = productImage.split(".amazonaws.com/")[1];
      }

      if (req.files.gImage && req.files.gImage.length > 0) {
        for (const file of req.files.gImage) {
          const url = await uploadToS3(file, "products/gallery");
          const key = url.split(".amazonaws.com/")[1];
          gImages.push({ gImage: url, gImageKey: key });
        }
      }
    }

    const newProduct = await Product.create({
      productName,
      category,
      sellerId,
      totalQuantity: parsedTotalQuantity,
      packSizes: parsedPackSizes,
      productDesc,
      productHealthBenefit,
      productStorage,
      productImage,
      productImageKey,
      gImage: gImages,
      productType,
      price: price || null,
      originalPrice: originalPrice || null,
      discount: discount || null
    });

    await sellerModel.findByIdAndUpdate(
      sellerId,
      { $push: { products: newProduct._id } },
      { new: true }
    );

    return sendSuccessResponse(res, "Product created successfully", newProduct);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllProduct = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = { isActive: true };
    if (type) filter.productType = type;

    const products = await Product.find(filter)
      .populate("sellerId", "firstName lastName email shopName")
      .populate("category", "name image type")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      result: products || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Product ID" });
    }

    const product = await Product.findById(id)
      .populate("sellerId", "firstName lastName email mobileNo shopName pickUpAddr")
      .populate("category", "name image type");

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // Update view count if needed (not in new schema, but useful)
    // new schema doesn't have 'view' field explicitly but I didn't add it. 
    // If strict schema is on, it won't save. 
    // User schema didn't have 'view' field. I will skip view count update to be safe or add it if strictly needed.
    // User said "product ma j badhu krvanu che", and provided specific schema. 
    // I will stick to provided schema.

    return res.status(200).json({ success: true, message: "Product fetched successfully", result: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

export const getSellerProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const products = await Product.find({ sellerId })
      .populate("sellerId", "firstName lastName email shopName")
      .populate("category", "name image")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Seller products fetched",
      length: products.length,
      data: products || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      productName,
      category,
      totalQuantity,
      packSizes,
      productDesc,
      productHealthBenefit,
      productStorage,
      isActive,
      price,
      originalPrice,
      discount
    } = req.body;

    const sellerId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid product ID");
    }

    const product = await Product.findById(id);
    if (!product) {
      return sendNotFoundResponse(res, "Product not found");
    }

    if (userRole === 'seller' && product.sellerId.toString() !== sellerId.toString()) {
      return sendBadRequestResponse(res, "You can only update your own products");
    }

    let updateData = {};
    if (productName) updateData.productName = productName;
    if (productDesc) updateData.productDesc = productDesc;
    if (productHealthBenefit) updateData.productHealthBenefit = productHealthBenefit;
    if (productStorage) updateData.productStorage = productStorage;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (price !== undefined) updateData.price = price;
    if (originalPrice !== undefined) updateData.originalPrice = originalPrice;
    if (discount !== undefined) updateData.discount = discount;

    if (category) {
      if (!mongoose.Types.ObjectId.isValid(category)) {
        return sendBadRequestResponse(res, "Invalid Category ID");
      }
      updateData.category = category;
      const cat = await CategoryModel.findById(category);
      if (cat) updateData.productType = cat.type || "delivery";
    }

    if (totalQuantity) {
      try { updateData.totalQuantity = typeof totalQuantity === 'string' ? JSON.parse(totalQuantity) : totalQuantity; } catch (e) { }
    }
    if (packSizes) {
      try { updateData.packSizes = typeof packSizes === 'string' ? JSON.parse(packSizes) : packSizes; } catch (e) { }
    }

    // Handle Images
    if (req.files) {
      if (req.files.productImage && req.files.productImage.length > 0) {
        // Delete old if exists
        if (product.productImageKey) {
          await deleteFromS3(product.productImageKey);
        }
        const file = req.files.productImage[0];
        const url = await uploadToS3(file, "products/cover");
        updateData.productImage = url;
        updateData.productImageKey = url.split(".amazonaws.com/")[1];
      }

      if (req.files.gImage && req.files.gImage.length > 0) {
        // Append or replace? Usually append or replace specific logic. 
        // For simplicity, let's just append for now or if user logic usually implies replace?
        // "product ma image add kri dyo" - user said add image. 
        // I will append new images to existing gallery.
        let newGImages = [];
        for (const file of req.files.gImage) {
          const url = await uploadToS3(file, "products/gallery");
          const key = url.split(".amazonaws.com/")[1];
          newGImages.push({ gImage: url, gImageKey: key });
        }
        updateData.gImage = [...(product.gImage || []), ...newGImages];
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('category', 'name');

    return sendSuccessResponse(res, "Product updated successfully", updatedProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid ProductId");
    }

    const product = await Product.findById(id);
    if (!product) return sendNotFoundResponse(res, "Product not found");

    if (userRole === 'seller' && product.sellerId.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only delete your own products");
    }

    // Delete Images from S3
    if (product.productImageKey) {
      await deleteFromS3(product.productImageKey);
    }
    if (product.gImage && product.gImage.length > 0) {
      for (const img of product.gImage) {
        if (img.gImageKey) await deleteFromS3(img.gImageKey);
      }
    }

    await Product.findByIdAndDelete(id);

    await sellerModel.findByIdAndUpdate(
      product.sellerId,
      { $pull: { products: product._id } },
      { new: true }
    );

    return sendSuccessResponse(res, "Product deleted successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const searchProducts = async (req, res) => {
  try {
    const { q, categoryId, type } = req.query

    const matchQuery = { isActive: true }
    if (type) matchQuery.productType = type;

    if (q && q.trim()) {
      matchQuery.$or = [
        { productName: { $regex: q.trim(), $options: "i" } },
        { productDesc: { $regex: q.trim(), $options: "i" } }
      ]
    }

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      // Handle child categories if needed, but for now simple match
      matchQuery.category = categoryId;
    }

    const products = await Product.find(matchQuery)
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccessResponse(res, "Products fetched successfully", products)
  } catch (error) {
    return sendErrorResponse(res, 500, "error while searchProducts", error)
  }
}

// getProductVraintByproductId -> REMOVED
// getVraintSizesByColorName -> REMOVED

export const getProductByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return sendBadRequestResponse(res, "Invalid Category ID");
    }

    const filter = { isActive: true, category: categoryId };
    if (type) filter.productType = type;

    const skip = (page - 1) * limit;

    const products = await Product.find(filter)
      .populate("category", "name image type")
      .populate("sellerId", "shopName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    return res.status(200).json({
      success: true,
      message: "Products fetched by category",
      result: products || [],
      total,
      page,
      limit
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductFilters = async (req, res) => {
  try {
    // Basic implementation for now
    const categories = await CategoryModel.find({}, { name: 1 });
    // Brands might be less relevant if not in new schema (User schema didn't show brand field!)
    // Wait, user schema allows 'category' but didn't show 'brand'.
    // User said "product ma j badhu krvanu che". 
    // Checking provided schema: 
    // category: { type: ObjectId ... }
    // sellerId: { ... }
    // No Brand field in provided schema.
    // So I should remove brand logic unless I implicitly keep it?
    // User said "variant nu rmove kri nakho ... and product ma j badhu krvanu che"
    // and provided a schema. The schema DOES NOT have brand.
    // So I should assume Brand is removed or ignored for now.

    return sendSuccessResponse(res, "Product filters fetched successfully", {
      categories,
      // prices/sizes could be aggregated from packSizes if needed
    });

  } catch (error) {
    return sendErrorResponse(res, 500, "Error while getProductFilters", error);
  }
};
