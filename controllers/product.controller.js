import mongoose from "mongoose";
import Product, { GroceryProduct, FoodDeliveryProduct } from "../models/product.model.js";
import Order from "../models/order.model.js";
import sellerModel from "../models/seller.model.js";
import CategoryModel from "../models/category.model.js";
import brandModel from "../models/brand.model.js";
import restaurantModel from "../models/restaurant.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

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

export const createGroceryProduct = async (req, res) => {
  try {
    const {
      title,
      category: categoryInput,
      categories,
      description,
      price,
      discountedPrice: discPriceInput,
      discountdPrice,

      // Grocery Specific
      brand,
      manufacturer,
      soldBy,
      netQty,
      productType: inputProductType,
      typeOfProduct,
      disclaimer,
      customerCareDetails,
      stock,
      inStock
    } = req.body;

    const category = categoryInput || categories;
    const discountedPrice = discPriceInput || discountdPrice;
    const finalProductType = inputProductType || typeOfProduct;
    // Force 'productType' to 'grocery' for discriminator via Model usage

    const sellerId = req.user?._id;

    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
      return sendBadRequestResponse(res, "Invalid or missing seller ID");
    }

    const seller = await sellerModel.findById(sellerId);
    if (!seller) return sendNotFoundResponse(res, "Seller not found");

    if (!title) return sendBadRequestResponse(res, "Product Title is required");
    if (!category) return sendBadRequestResponse(res, "Category is required");
    if (!price) return sendBadRequestResponse(res, "Price is required");

    // Validations
    if (brand) {
      if (!mongoose.Types.ObjectId.isValid(brand)) return sendBadRequestResponse(res, "Invalid Brand ID");
      const brandDoc = await brandModel.findById(brand);
      if (!brandDoc) return sendNotFoundResponse(res, "Brand not found");
      if (String(brandDoc.sellerId) !== String(sellerId)) return sendBadRequestResponse(res, "You can only use your own brands");
    }

    // Image Upload (Only 'image' for Grocery)
    let image = null;
    let imageKey = null;

    if (req.files) {
      if (req.files.image && req.files.image.length > 0) {
        const file = req.files.image[0];
        image = await uploadToS3(file, "products/cover");
        imageKey = image.split(".amazonaws.com/")[1];
      }
    }

    const newProduct = await GroceryProduct.create({
      title,
      category,
      sellerId,
      description,
      price,
      stock: stock || 0,
      inStock: inStock !== undefined ? inStock : (stock > 0),
      image,
      imageKey,
      isActive: true, // Default

      // Grocery Specifics
      discountedPrice: discountedPrice || 0,
      brand: brand || null,
      manufacturer,
      soldBy: soldBy || seller.shopName || `${seller.firstName} ${seller.lastName}`,
      netQty,
      productType: finalProductType,
      disclaimer,
      customerCareDetails
    });

    await sellerModel.findByIdAndUpdate(sellerId, { $push: { products: newProduct._id } });

    await newProduct.populate([
      { path: 'category', select: 'name image' },
      { path: 'brand', select: 'name' },
      { path: 'sellerId', select: 'shopName' }
    ]);

    return sendSuccessResponse(res, "Grocery Product created successfully", newProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const createFoodProduct = async (req, res) => {
  try {
    const {
      title,
      category,
      description,
      price,
      flavor,
      isVeg,
      restaurantId,
      stock,
      inStock
    } = req.body;

    // No discountedPrice, brand, etc for Food

    const sellerId = req.user?._id;
    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) return sendBadRequestResponse(res, "Invalid or missing seller ID");

    // Validate inputs...
    if (!title) return sendBadRequestResponse(res, "Title required");
    if (!category) return sendBadRequestResponse(res, "Category required");
    if (!price) return sendBadRequestResponse(res, "Price required");

    // Image Upload (Only 'image')
    let image = null, imageKey = null;

    if (req.files && req.files.image && req.files.image.length > 0) {
      const file = req.files.image[0];
      image = await uploadToS3(file, "products/cover");
      imageKey = image.split(".amazonaws.com/")[1];
    }

    let parsedFlavor = [];
    if (flavor) {
      if (Array.isArray(flavor)) parsedFlavor = flavor;
      else if (typeof flavor === 'string') {
        try { parsedFlavor = JSON.parse(flavor); }
        catch (e) { parsedFlavor = [flavor]; }
      }
    }

    const newProduct = await FoodDeliveryProduct.create({
      title,
      category,
      sellerId,
      description,
      price,
      stock: stock || 0,
      inStock: inStock !== undefined ? inStock : (stock > 0),
      image,
      imageKey,
      isActive: true,

      // Food Specifics
      flavor: parsedFlavor,
      isVeg: isVeg !== undefined ? isVeg : true,
      restaurantId: restaurantId || null
    });

    await sellerModel.findByIdAndUpdate(sellerId, { $push: { products: newProduct._id } });

    await newProduct.populate([
      { path: 'category', select: 'name image' },
      { path: 'restaurantId', select: 'title' },
      { path: 'sellerId', select: 'shopName' }
    ]);

    return sendSuccessResponse(res, "Food Product created successfully", newProduct);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllGroceryProducts = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true, docType: 'grocery' })
      .populate("sellerId", "firstName lastName email shopName")
      .populate("category", "name image")
      .populate("brand", "name")
      .sort({ createdAt: -1 });

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found" });
    }

    return res.status(200).json({ success: true, message: "Grocery Products fetched successfully", result: products || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllFoodProducts = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true, docType: 'delivery' })
      .populate("sellerId", "firstName lastName shopName")
      .populate("category", "name image")
      .sort({ createdAt: -1 });

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found" });
    }

    return res.status(200).json({ success: true, message: "Food Products fetched successfully", result: products || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getGroceryProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

    const product = await Product.findOne({ _id: id, docType: 'grocery' })
      .populate("sellerId", "firstName lastName shopName pickUpAddr")
      .populate("category", "name image")
      .populate("brand", "name");

    if (!product) return res.status(404).json({ success: false, message: "Grocery Product not found" });

    return res.status(200).json({ success: true, result: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFoodProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

    const product = await Product.findOne({ _id: id, docType: 'delivery' })
      .populate("sellerId", "firstName lastName shopName pickUpAddr")
      .populate("category", "name image");

    if (!product) return res.status(404).json({ success: false, message: "Food Product not found" });

    return res.status(200).json({ success: true, result: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getSellerGroceryProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const products = await Product.find({ sellerId, docType: 'grocery' })
      .populate("sellerId", "shopName")
      .populate("brand", "name")
      .populate("category", "name")
      .sort({ createdAt: -1 });

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found" });
    }

    return res.status(200).json({ success: true, message: "Seller Grocery Products fetched successfully", data: products || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getSellerFoodProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const products = await Product.find({ sellerId, docType: 'delivery' })
      .populate("sellerId", "shopName")
      .populate("category", "name")
      .sort({ createdAt: -1 });

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found" });
    }

    return res.status(200).json({ success: true, message: "Seller Food Products fetched successfully", data: products || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateGroceryProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      category: categoryInput,
      categories,
      description,
      isActive,
      price,
      // Grocery Specifics
      discountedPrice: discPriceInput,
      discountdPrice,
      brand,
      manufacturer,
      soldBy,
      netQty,
      productType: inputProductType,
      typeOfProduct,
      disclaimer,
      customerCareDetails,
      stock,
      inStock
    } = req.body;

    const category = categoryInput || categories;
    const discountedPrice = discPriceInput || discountdPrice;
    const finalProductType = inputProductType || typeOfProduct;

    const sellerId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid product ID");
    const product = await Product.findById(id);
    if (!product) return sendNotFoundResponse(res, "Product not found");

    if (product.docType !== 'grocery') return sendBadRequestResponse(res, "This is not a Grocery product");
    if (userRole === 'seller' && product.sellerId.toString() !== sellerId.toString()) return sendBadRequestResponse(res, "Unauthorized");

    let updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (price !== undefined) updateData.price = price;
    if (stock !== undefined) updateData.stock = stock;
    if (inStock !== undefined) updateData.inStock = inStock;
    if (category && mongoose.Types.ObjectId.isValid(category)) updateData.category = category;

    // Grocery fields
    if (discountedPrice !== undefined) updateData.discountedPrice = discountedPrice;
    if (manufacturer) updateData.manufacturer = manufacturer;
    if (soldBy) updateData.soldBy = soldBy;
    if (netQty) updateData.netQty = netQty;
    if (finalProductType) updateData.productType = finalProductType;
    if (disclaimer) updateData.disclaimer = disclaimer;
    if (customerCareDetails) updateData.customerCareDetails = customerCareDetails;

    if (brand) {
      if (!mongoose.Types.ObjectId.isValid(brand)) return sendBadRequestResponse(res, "Invalid Brand ID");
      const brandDoc = await brandModel.findById(brand);
      if (!brandDoc) return sendNotFoundResponse(res, "Brand not found");
      if (String(brandDoc.sellerId) !== String(sellerId)) return sendBadRequestResponse(res, "You can only use your own brands");
      updateData.brand = brand;
    }

    // Image (Grocery only has cover image)
    if (req.files && req.files.image && req.files.image.length > 0) {
      if (product.imageKey) await deleteFromS3(product.imageKey);
      const file = req.files.image[0];
      const url = await uploadToS3(file, "products/cover");
      updateData.image = url;
      updateData.imageKey = url.split(".amazonaws.com/")[1];
    }

    // Explicitly nullify gImage if somehow present in schema, though model handles schema.

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .populate('category', 'name image')
      .populate('brand', 'name')
      .populate('sellerId', 'shopName');

    return sendSuccessResponse(res, "Grocery Product updated", updatedProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const updateFoodProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      category,
      description,
      isActive,
      price,
      // Food Specifics
      flavor,
      isVeg,
      restaurantId,
      stock,
      inStock
    } = req.body;

    const sellerId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid product ID");
    const product = await Product.findById(id);
    if (!product) return sendNotFoundResponse(res, "Product not found");

    if (product.docType !== 'delivery') return sendBadRequestResponse(res, "This is not a Food Delivery product");
    if (userRole === 'seller' && product.sellerId.toString() !== sellerId.toString()) return sendBadRequestResponse(res, "Unauthorized");

    let updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (price !== undefined) updateData.price = price;
    if (stock !== undefined) updateData.stock = stock;
    if (inStock !== undefined) updateData.inStock = inStock;
    if (category && mongoose.Types.ObjectId.isValid(category)) updateData.category = category;

    // Food fields
    if (isVeg !== undefined) updateData.isVeg = isVeg;
    if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) updateData.restaurantId = restaurantId;

    if (flavor) {
      if (Array.isArray(flavor)) updateData.flavor = flavor;
      else if (typeof flavor === 'string') {
        try { updateData.flavor = JSON.parse(flavor); }
        catch (e) { updateData.flavor = [flavor]; }
      }
    }

    // Images (Cover Only)
    if (req.files && req.files.image && req.files.image.length > 0) {
      if (product.imageKey) await deleteFromS3(product.imageKey);
      const file = req.files.image[0];
      const url = await uploadToS3(file, "products/cover");
      updateData.image = url;
      updateData.imageKey = url.split(".amazonaws.com/")[1];
    }

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .populate('category', 'name image')
      .populate('restaurantId', 'title')
      .populate('sellerId', 'shopName');

    return sendSuccessResponse(res, "Food Product updated", updatedProduct);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteGroceryProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid ProductId");

    // Check for Grocery specifically
    const product = await Product.findOne({ _id: id, docType: 'grocery' });
    if (!product) return sendNotFoundResponse(res, "Grocery Product not found");

    if (userRole === 'seller' && product.sellerId.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "Unauthorized");
    }

    // Delete Cover Image
    if (product.imageKey) await deleteFromS3(product.imageKey);
    // Grocery has no gImage

    await Product.findByIdAndDelete(id);
    await sellerModel.findByIdAndUpdate(product.sellerId, { $pull: { products: product._id } });

    return sendSuccessResponse(res, "Grocery Product deleted successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteFoodProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid ProductId");

    // Check for Food specifically
    const product = await Product.findOne({ _id: id, docType: 'delivery' });
    if (!product) return sendNotFoundResponse(res, "Food Product not found");

    if (userRole === 'seller' && product.sellerId.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "Unauthorized");
    }

    // Delete Images
    if (product.imageKey) await deleteFromS3(product.imageKey);

    await Product.findByIdAndDelete(id);
    await sellerModel.findByIdAndUpdate(product.sellerId, { $pull: { products: product._id } });

    return sendSuccessResponse(res, "Food Product deleted successfully");
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
        { title: { $regex: q.trim(), $options: "i" } },
      ]
    }

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
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

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found" });
    }

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

export const getProductsByRestaurantId = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return sendBadRequestResponse(res, "Invalid Restaurant ID");
    }

    const filter = { isActive: true, docType: 'delivery', restaurantId };
    const skip = (page - 1) * limit;

    const products = await Product.find(filter)
      .populate("category", "name image")
      .populate("sellerId", "shopName")
      .populate("restaurantId", "title image gImage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    if (!products || products.length === 0) {
      return res.status(404).json({ success: false, message: "No products found for this restaurant" });
    }

    return res.status(200).json({
      success: true,
      message: "Restaurant products fetched successfully",
      result: products,
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
    const categories = await CategoryModel.find({}, { name: 1 });
    return sendSuccessResponse(res, "Product filters fetched successfully", {
      categories,
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while getProductFilters", error);
  }
};

export const getDealOfTheDay = async (req, res) => {
  try {
    const { category } = req.query; // 'grocery' or 'food delivery'

    // Determine the docType based on input
    let docType = null;
    if (category === 'grocery') {
      docType = 'grocery';
    } else if (category === 'food delivery') {
      docType = 'delivery';
    } else {
      return sendBadRequestResponse(res, "Invalid or missing category. Use 'grocery' or 'food delivery'.");
    }

    // Get Today's Date Range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Find orders created today
    const ordersToday = await Order.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).select('items');

    if (!ordersToday.length) {
      return sendSuccessResponse(res, "No products ordered today", []);
    }

    // Extract Product IDs
    let productIds = [];
    ordersToday.forEach(order => {
      order.items.forEach(item => {
        if (item.product) {
          productIds.push(item.product);
        }
      });
    });

    // Remove duplicates
    productIds = [...new Set(productIds.map(id => id.toString()))];

    // Find Products matching docType
    const products = await Product.find({
      _id: { $in: productIds },
      docType: docType
    })
      .populate('category', 'name image')
      .populate('sellerId', 'shopName') // Optional: add more details if needed
      .lean();

    return sendSuccessResponse(res, "Ordered products fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getFreshFruits = async (req, res) => {
  try {
    const category = await CategoryModel.findOne({ name: "Fresh Fruits" });

    if (!category) {
      return sendNotFoundResponse(res, "Category 'Fresh Fruits' not found");
    }

    const products = await Product.find({
      category: category._id,
      isActive: true,
      docType: 'grocery'
    })
      .populate('category', 'name image')
      .populate('sellerId', 'shopName')
      .sort({ createdAt: -1 });

    if (!products || products.length === 0) {
      return sendSuccessResponse(res, "No products found in Fresh Fruits", []);
    }

    return sendSuccessResponse(res, "Fresh Fruits fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getBestOffers = async (req, res) => {
  try {
    const products = await Product.aggregate([
      {
        $match: {
          isActive: true,
          docType: 'grocery',
          price: { $gt: 0 },
          discountedPrice: { $gt: 0 }
        }
      },
      {
        $addFields: {
          discountPercentage: {
            $round: [
              {
                $multiply: [
                  { $divide: [{ $subtract: ["$price", "$discountedPrice"] }, "$price"] },
                  100
                ]
              },
              0
            ]
          }
        }
      },
      {
        $match: {
          discountPercentage: { $gt: 0 }
        }
      },
      {
        $sort: { discountPercentage: -1 }
      },
      {
        $limit: 20 // Reasonable limit for "top deals"
      }
    ]);

    // Populate the results manually as aggregate returns POJOs
    await Product.populate(products, [
      { path: 'category', select: 'name image' },
      { path: 'sellerId', select: 'shopName' }
    ]);

    if (!products || products.length === 0) {
      return sendSuccessResponse(res, "No discounted grocery products found", []);
    }

    return sendSuccessResponse(res, "Discounted grocery products fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductsSoldInEvening = async (req, res) => {
  try {
    const startOfEvening = new Date();
    startOfEvening.setHours(17, 0, 0, 0); // 5 PM

    const endOfEvening = new Date();
    endOfEvening.setHours(21, 0, 0, 0); // 9 PM

    // Find orders created in the evening with completed payment
    const orders = await Order.find({
      createdAt: { $gte: startOfEvening, $lt: endOfEvening },
      "paymentInfo.status": "completed"
    }).select('items');

    if (!orders || orders.length === 0) {
      return sendSuccessResponse(res, "No products sold this evening", []);
    }

    // Extract Product IDs
    let productIds = [];
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.product) {
          productIds.push(item.product);
        }
      });
    });

    // Remove duplicates
    productIds = [...new Set(productIds.map(id => id.toString()))];

    // Find Products using aggregation to calculate discount percentage and filter for grocery
    const products = await Product.aggregate([
      {
        $match: {
          _id: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) },
          isActive: true,
          docType: 'grocery'
        }
      },
      {
        $addFields: {
          discountPercentage: {
            $cond: {
              if: { $and: [{ $gt: ["$price", 0] }, { $gt: ["$discountedPrice", 0] }] },
              then: {
                $round: [
                  {
                    $multiply: [
                      { $divide: [{ $subtract: ["$price", "$discountedPrice"] }, "$price"] },
                      100
                    ]
                  },
                  0
                ]
              },
              else: 0
            }
          }
        }
      },
      {
        $sort: { discountPercentage: -1 }
      }
    ]);

    // Populate the results manually
    await Product.populate(products, [
      { path: 'category', select: 'name image' },
      { path: 'sellerId', select: 'shopName' }
    ]);

    return sendSuccessResponse(res, "Evening sold grocery products fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getPopularRestaurants = async (req, res) => {
  try {
    const popularRestaurants = await Order.aggregate([
      { $unwind: "$items" },

      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDetails"
        }
      },

      { $unwind: "$productDetails" },

      {
        $match: {
          "productDetails.docType": "delivery"
        }
      },

      {
        $group: {
          _id: "$productDetails.restaurantId",
          orderCount: { $sum: 1 }
        }
      },

      { $sort: { orderCount: -1 } },

      { $limit: 10 },

      {
        $lookup: {
          from: "restaurants",
          localField: "_id",
          foreignField: "_id",
          as: "restaurantInfo"
        }
      },

      { $unwind: "$restaurantInfo" },

      {
        $project: {
          _id: 1,
          orderCount: 1,
          title: "$restaurantInfo.title",
          image: "$restaurantInfo.image",
          gImage: "$restaurantInfo.gImage",
          description: "$restaurantInfo.description",
          rating: "$restaurantInfo.rating",
          time: "$restaurantInfo.time",
          delivery: "$restaurantInfo.delivery",
          off: "$restaurantInfo.off"
        }
      }
    ]);

    if (!popularRestaurants || popularRestaurants.length === 0) {
      return sendSuccessResponse(res, "No popular restaurants found yet", []);
    }

    return sendSuccessResponse(res, "Popular restaurants fetched successfully", popularRestaurants);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getFilteredFoodProducts = async (req, res) => {
  try {
    const { sort, isVeg, rating, fastDelivery, offer } = req.query;

    const pipeline = [
      {
        $match: {
          docType: 'delivery',
          isActive: true
        }
      }
    ];

    pipeline.push(
      {
        $lookup: {
          from: "restaurants",
          localField: "restaurantId",
          foreignField: "_id",
          as: "restaurantDetails"
        }
      },
      { $unwind: "$restaurantDetails" }
    );

    // 1. Veg/Non-Veg Filter
    if (isVeg === 'true') {
      pipeline.push({ $match: { isVeg: true } });
    } else if (isVeg === 'false') {
      pipeline.push({ $match: { isVeg: false } });
    }

    // 2. Dynamic Rating Filter
    if (rating) {
      const ratingValue = Number(rating);
      if (!isNaN(ratingValue)) {
        pipeline.push({
          $match: {
            "rating.average": { $gte: ratingValue }
          }
        });
      }
    }

    // 3. Fast Delivery Filter
    if (fastDelivery === 'true') {
      pipeline.push({
        $match: {
          "restaurantDetails.time": { $regex: /^[1-3][0-9]|4[0-4]/ } // Matches 10-44 roughly
        }
      });
    }

    // --- Sorting ---

    pipeline.push({
      $addFields: {
        discountPercentage: {
          $cond: {
            if: { $and: [{ $gt: ["$price", 0] }, { $gt: ["$discountedPrice", 0] }] },
            then: {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $subtract: ["$price", "$discountedPrice"] }, "$price"] },
                    100
                  ]
                },
                0
              ]
            },
            else: 0
          }
        }
      }
    });

    // 4. Offer Filter (Show products with discount > 0)
    if (offer === 'true') {
      pipeline.push({
        $match: {
          discountPercentage: { $gt: 0 }
        }
      });
    }

    let sortStage = {};

    if (sort === 'price_low_high') {
      sortStage = { price: 1 };
    } else if (sort === 'price_high_low') {
      sortStage = { price: -1 };
    } else if (sort === 'rating') {
      sortStage = { "rating.average": -1 };
    } else if (sort === 'discount') {
      sortStage = { discountPercentage: -1 };
    } else {
      // Default Sort (e.g., newest first)
      sortStage = { createdAt: -1 };
    }

    pipeline.push({ $sort: sortStage });

    // Populate Category (lookup)
    pipeline.push(
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails"
        }
      },
      { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } }
    );

    // Final Projection to structure the response
    pipeline.push({
      $project: {
        title: 1,
        description: 1,
        price: 1,
        discountedPrice: 1,
        discountPercentage: 1,
        rating: 1,
        isVeg: 1,
        image: 1,
        // Category Details
        category: {
          name: "$categoryDetails.name",
          image: "$categoryDetails.image"
        },
        // Restaurant Details
        restaurantId: {
          _id: "$restaurantDetails._id",
          title: "$restaurantDetails.title",
          image: "$restaurantDetails.image",
          time: "$restaurantDetails.time",
          rating: "$restaurantDetails.rating"
        }
      }
    });

    const products = await Product.aggregate(pipeline);

    return sendSuccessResponse(res, "Filtered products fetched successfully", products);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};