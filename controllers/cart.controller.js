import mongoose from "mongoose";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Coupon from "../models/coupon.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";

export const addToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId, quantity } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (quantity === undefined || quantity === null) return sendBadRequestResponse(res, "Quantity required");
    if (typeof quantity !== "number") return sendBadRequestResponse(res, "quantity Type must be a Number");

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = await Cart.create({ userId, items: [] });

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return sendBadRequestResponse(res, "Valid productId required");

    const product = await Product.findById(productId).lean();
    if (!product) return sendNotFoundResponse(res, "Product not found");

    let stock = product.stock || 0;
    let price = 0;
    let discountedPrice = null;

    if (!product.inStock || stock <= 0) {
      return sendBadRequestResponse(res, "Product is out of stock");
    }

    price = product.price || 0;
    if (product.discount) {
      discountedPrice = Math.round(price * (1 - product.discount / 100));
    }

    if (stock < quantity) {
      return sendBadRequestResponse(res, `Insufficient stock. Available: ${stock}`);
    }

    const finalUnitPrice = discountedPrice !== null ? discountedPrice : price;

    const existingIndex = cart.items.findIndex(item => item.product.toString() === productId);

    if (existingIndex >= 0) {
      const newQty = cart.items[existingIndex].quantity + quantity;
      if (newQty <= 0) {
        cart.items.splice(existingIndex, 1);
      } else {
        if (stock && newQty > stock) return sendBadRequestResponse(res, `Max available: ${stock}`);
        cart.items[existingIndex].quantity = newQty;
        cart.items[existingIndex].totalPrice = cart.items[existingIndex].price * newQty;
        const unitP = cart.items[existingIndex].discountedPrice || cart.items[existingIndex].price;
        cart.items[existingIndex].totalDiscountedPrice = unitP * newQty;
      }
    } else {
      cart.items.push({
        product: productId,
        price: price || 0,
        discountedPrice: discountedPrice,
        quantity,
        totalPrice: (price || 0) * quantity,
        totalDiscountedPrice: finalUnitPrice * quantity,
        stock,
        sellerId: product.sellerId
      });
    }

    await cart.save();

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title image price stock docType restaurantId");

    return sendSuccessResponse(res, "Cart updated", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export const getCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let cart = await Cart.findOne({ userId })
      .populate({
        path: "items.product",
        populate: {
          path: "restaurantId",
          select: "title time delivery"
        }
      });

    if (!cart) {
      return sendSuccessResponse(res, "Cart fetched", cart);
    }

    recalculateCart(cart);
    await cart.save();

    const foodDeliveryItems = [];
    const groceryItems = [];

    cart.items.forEach(item => {
      const product = item.product;
      if (!product) return;

      const itemData = {
        _id: item._id,
        product: {
          _id: product._id,
          title: product.title,
          image: product.image,
          price: product.price,
          stock: product.stock,
          category: product.category
        },
        price: item.price,
        discountedPrice: item.discountedPrice,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        totalDiscountedPrice: item.totalDiscountedPrice,
        stock: item.stock,
        sellerId: item.sellerId,
        addedAt: item.addedAt
      };

      if (product.docType === "delivery") {
        const restaurant = product.restaurantId;
        itemData.product.restaurantId = restaurant ? {
          _id: restaurant._id,
          title: restaurant.title
        } : null;
        itemData.estimatedDeliveryTime = restaurant?.time || "25-35 min";
        foodDeliveryItems.push(itemData);
      } else {
        const now = new Date();
        const expectedDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const day = expectedDate.getDate();
        const month = expectedDate.toLocaleString("en-US", { month: "short" });
        const year = expectedDate.getFullYear();
        itemData.expectedDeliveryDate = `${day} ${month}, ${year}`;
        groceryItems.push(itemData);
      }
    });

    const response = {
      _id: cart._id,
      userId: cart.userId,
      foodDelivery: {
        items: foodDeliveryItems,
        itemCount: foodDeliveryItems.reduce((sum, i) => sum + i.quantity, 0)
      },
      grocery: {
        items: groceryItems,
        itemCount: groceryItems.reduce((sum, i) => sum + i.quantity, 0)
      },
      totalItems: cart.totalItems,
      totalPrice: cart.totalPrice,
      totalDiscountedPrice: cart.totalDiscountedPrice,
      totalSavings: cart.totalSavings,
      restaurantCharges: cart.restaurantCharges,
      couponDiscount: cart.couponDiscount,
      appliedCoupon: cart.appliedCoupon,
      subtotal: cart.subtotal,
      finalTotal: cart.finalTotal,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt
    };

    return sendSuccessResponse(res, "Cart fetched", response);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { cartItemId, quantity } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!cartItemId || !mongoose.Types.ObjectId.isValid(cartItemId)) {
      return sendBadRequestResponse(res, "Valid cartItemId required");
    }
    if (!quantity || quantity < 1) return sendBadRequestResponse(res, "Quantity must be at least 1");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);
    if (itemIndex < 0) return sendNotFoundResponse(res, "Item not in cart");

    const item = cart.items[itemIndex];

    if (quantity > item.stock) {
      return sendBadRequestResponse(res, `Insufficient stock. Available: ${item.stock}`);
    }

    item.quantity = quantity;
    item.totalPrice = item.price * quantity;
    const unitP = item.discountedPrice || item.price;
    item.totalDiscountedPrice = unitP * quantity;

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title image price stock docType");

    return sendSuccessResponse(res, "Cart item updated", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const removeFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { cartItemId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!cartItemId || !mongoose.Types.ObjectId.isValid(cartItemId)) {
      return sendBadRequestResponse(res, "Valid cartItemId required");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);
    if (itemIndex === -1) {
      return sendNotFoundResponse(res, "Item not found in cart");
    }

    cart.items.splice(itemIndex, 1);

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title image price stock docType");

    return sendSuccessResponse(res, "Item removed from cart", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const clearCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    await Cart.findOneAndDelete({ userId });

    return sendSuccessResponse(res, "Cart cleared successfully", null);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

const recalculateCart = (cart) => {
  if (cart.appliedCoupon && !cart.appliedCoupon.couponId) {
    cart.appliedCoupon = null;
  }

  if (!cart.items || cart.items.length === 0) {
    cart.totalItems = 0;
    cart.totalPrice = 0;
    cart.totalDiscountedPrice = 0;
    cart.totalSavings = 0;
    cart.restaurantCharges = 0;
    cart.couponDiscount = 0;
    cart.subtotal = 0;
    cart.finalTotal = 0;
    cart.appliedCoupon = null;
    return;
  }

  let totalItems = 0;
  let totalOriginal = 0;
  let totalDiscounted = 0;
  let restaurantCharges = 0;

  cart.items.forEach(i => {
    totalItems += i.quantity;
    totalOriginal += i.price * i.quantity;
    totalDiscounted += (i.discountedPrice || i.price) * i.quantity;

    const product = i.product;
    if (product && typeof product === "object" && product.docType === "delivery") {
      restaurantCharges += 10 * i.quantity;
    }
  });

  cart.totalItems = totalItems;
  cart.totalPrice = totalOriginal;
  cart.totalDiscountedPrice = totalDiscounted;
  cart.totalSavings = totalOriginal - totalDiscounted;
  cart.restaurantCharges = restaurantCharges;

  let couponDiscount = 0;
  if (cart.appliedCoupon && cart.appliedCoupon.discountApplied) {
    couponDiscount = cart.appliedCoupon.discountApplied;
  }
  cart.couponDiscount = couponDiscount;

  const afterDiscounts = totalDiscounted - couponDiscount;
  const subtotal = afterDiscounts + restaurantCharges;
  cart.subtotal = subtotal;
  cart.finalTotal = subtotal;
};


export const cartBillingPreview = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.product",
        select: "title image price stock docType restaurantId sellerId",
        populate: {
          path: "restaurantId",
          select: "title time"
        }
      })
      .populate("appliedCoupon.couponId", "code discountType discountValue");

    if (!cart || cart.items.length === 0) {
      return sendSuccessResponse(res, "Cart is empty", {
        foodDelivery: { items: [], subtotal: 0 },
        grocery: { items: [], subtotal: 0 },
        subtotal: 0,
        couponDiscount: 0,
        restaurantCharges: 0,
        finalTotal: 0
      });
    }

    let totalSubtotal = 0;
    let itemsDiscount = 0;
    let couponDiscount = 0;
    let restaurantCharges = 0;

    const foodItems = [];
    const groceryItemsList = [];

    let foodSubtotal = 0;
    let grocerySubtotal = 0;

    cart.items.forEach(item => {
      const product = item.product;
      totalSubtotal += item.totalDiscountedPrice;
      itemsDiscount += item.totalPrice - item.totalDiscountedPrice;

      const itemInfo = {
        productId: product._id,
        productTitle: product.title,
        unitPrice: item.price,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        discountedPrice: item.discountedPrice,
        totalDiscountedPrice: item.totalDiscountedPrice,
        itemDiscount: item.totalPrice - item.totalDiscountedPrice
      };

      if (product.docType === "delivery") {
        const restaurant = product.restaurantId;
        itemInfo.restaurant = restaurant ? restaurant.title : null;
        itemInfo.estimatedDeliveryTime = restaurant?.time || "25-35 min";
        itemInfo.restaurantCharges = 10 * item.quantity;
        restaurantCharges += 10 * item.quantity;
        foodSubtotal += item.totalDiscountedPrice;
        foodItems.push(itemInfo);
      } else {
        const now = new Date();
        const expectedDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const day = expectedDate.getDate();
        const month = expectedDate.toLocaleString("en-US", { month: "short" });
        const year = expectedDate.getFullYear();
        itemInfo.expectedDeliveryDate = `${day} ${month}, ${year}`;
        grocerySubtotal += item.totalDiscountedPrice;
        groceryItemsList.push(itemInfo);
      }
    });

    if (cart.appliedCoupon && cart.appliedCoupon.couponId) {
      couponDiscount = cart.appliedCoupon.discountApplied || 0;
    }

    const afterCoupon = Math.max(0, totalSubtotal - couponDiscount);
    const finalTotal = afterCoupon + restaurantCharges;

    const billingPreview = {
      userId,
      cartItems: cart.items.length,

      foodDelivery: {
        items: foodItems,
        subtotal: Math.round(foodSubtotal),
        restaurantCharges
      },

      grocery: {
        items: groceryItemsList,
        subtotal: Math.round(grocerySubtotal)
      },

      pricingSummary: {
        subtotal: Math.round(totalSubtotal),
        itemDiscount: Math.round(itemsDiscount),
        couponDiscount: Math.round(couponDiscount),
        restaurantCharges: Math.round(restaurantCharges),
        finalTotal: Math.round(finalTotal)
      },

      appliedOffers: {
        coupon: cart.appliedCoupon?.couponId ? {
          couponId: cart.appliedCoupon.couponId._id,
          code: cart.appliedCoupon.couponCode,
          type: cart.appliedCoupon.discountType,
          value: cart.appliedCoupon.discountValue,
          discountApplied: cart.appliedCoupon.discountApplied
        } : null
      },

      breakdown: {
        "Subtotal": Math.round(totalSubtotal),
        "Item Discounts": Math.round(-itemsDiscount),
        "Coupon Discount": Math.round(-couponDiscount),
        "Restaurant Charges": Math.round(restaurantCharges),
        "Final Total": Math.round(finalTotal)
      }
    };

    cart.subtotal = Math.round(totalSubtotal);
    cart.couponDiscount = Math.round(couponDiscount);
    cart.restaurantCharges = Math.round(restaurantCharges);
    cart.finalTotal = Math.round(finalTotal);
    await cart.save();

    return sendSuccessResponse(res, "Billing preview generated", billingPreview);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const applyCouponToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { couponCode } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!couponCode) return sendBadRequestResponse(res, "Coupon code required");

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) {
      return sendBadRequestResponse(res, "Cart is empty");
    }

    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() }).lean();
    if (!coupon) return sendNotFoundResponse(res, "Coupon not found");

    const now = new Date();
    if (!coupon.isActive) return sendBadRequestResponse(res, "Coupon is not active");
    if (coupon.endDate < now) return sendBadRequestResponse(res, "Coupon has expired");
    if (coupon.startDate > now) return sendBadRequestResponse(res, "Coupon is not yet valid");

    if (coupon.maxUsageLimit && coupon.usageCount >= coupon.maxUsageLimit) {
      return sendBadRequestResponse(res, "Coupon usage limit exceeded");
    }

    const userUsage = coupon.usedBy?.find(u => u.userId.toString() === userId.toString());
    if (userUsage && userUsage.usedCount >= (coupon.perUserLimit || 1)) {
      return sendBadRequestResponse(res, `You can use this coupon only ${coupon.perUserLimit} times`);
    }

    const subtotal = cart.totalPrice;
    if (coupon.minOrderValue && subtotal < coupon.minOrderValue) {
      return sendBadRequestResponse(res, `Minimum order value ₹${coupon.minOrderValue} required`);
    }

    let discountAmount = 0;
    if (coupon.discountType === "percentage") {
      discountAmount = Math.round(subtotal * (coupon.percentageValue / 100));
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else if (coupon.discountType === "flat") {
      discountAmount = coupon.flatValue;
    }

    if (cart.appliedCoupon?.couponId) {
      return sendBadRequestResponse(res, "A coupon is already applied. Remove it first.");
    }

    cart.appliedCoupon = {
      couponId: coupon._id,
      couponCode: coupon.code,
      discountApplied: discountAmount,
      discountType: coupon.discountType,
      discountValue: coupon.discountType === "percentage" ? coupon.percentageValue : coupon.flatValue,
      appliedAt: now
    };

    await Coupon.findByIdAndUpdate(
      coupon._id,
      {
        $inc: { usageCount: 1 },
        $push: {
          usedBy: {
            userId,
            usedCount: 1,
            lastUsedAt: now
          }
        }
      },
      { new: true }
    );

    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title image price stock docType")
      .populate("appliedCoupon.couponId", "code");

    return sendSuccessResponse(res, "Coupon applied successfully", {
      message: `Discount of ₹${discountAmount} applied`,
      couponCode: coupon.code,
      discountApplied: discountAmount,
      cart: populatedCart
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const removeCouponFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    if (!cart.appliedCoupon?.couponId) {
      return sendBadRequestResponse(res, "No coupon applied to cart");
    }

    cart.appliedCoupon = null;
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title image price stock docType");

    return sendSuccessResponse(res, "Coupon removed from cart", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  addToCart,
  getCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  cartBillingPreview,
  applyCouponToCart,
  removeCouponFromCart
};
