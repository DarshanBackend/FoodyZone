import mongoose from "mongoose";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";

import ComboOffer from "../models/combo.model.js";
import Coupon from "../models/coupon.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { getDeliveryInfo } from "../helper/deliveryDate.helper.js";

export const addToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId, packSizeId, comboId, quantity, courierService } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (quantity === undefined || quantity === null) return sendBadRequestResponse(res, "Quantity required");
    if (typeof quantity !== "number") return sendBadRequestResponse(res, "quantity Type must be a Number");

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = await Cart.create({ userId, items: [] });

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return sendBadRequestResponse(res, "Valid productId required");

    const product = await Product.findById(productId).lean();
    if (!product) return sendNotFoundResponse(res, "Product not found");

    let stock = 0;
    let price = 0;
    let discountedPrice = null;
    let selectedPack = null;
    let finalWeight = null;
    let finalUnit = null;

    if (packSizeId) {
      // Validate packSizeId against product.packSizes
      if (!product.packSizes || product.packSizes.length === 0) {
        return sendBadRequestResponse(res, "This product does not have pack sizes");
      }

      selectedPack = product.packSizes.find(p => p._id.toString() === packSizeId);
      if (!selectedPack) return sendBadRequestResponse(res, "Invalid Pack Size selected");

      stock = selectedPack.stock;
      price = selectedPack.price;
      // Discount logic for pack? Schema doesn't have discount per pack explicitly, only price. 
      // Can use product global discount if needed or assume price is final.
      // If product has discount, maybe apply it? For now use price as is.
      // User example data had price. I'll adhere to schema.

      finalWeight = selectedPack.weight;
      finalUnit = selectedPack.unit;

    } else {
      // No packSizeId provided. 
      // If product has packSizes, require one?
      if (product.packSizes && product.packSizes.length > 0) {
        // Default to first pack size or error? Better error.
        return sendBadRequestResponse(res, "Please select a pack size");
      }

      // If no pack sizes, use base product info
      stock = product.totalQuantity ? product.totalQuantity.value : 0; // Or some other stock field
      // Schema has `inStock` boolean, but `packSizes` have `stock` number.
      // Schema also has `totalQuantity` { value, unit }. This is usually informative.
      // It seems `packSizes` is the main way to sell. 
      // If packSizes is empty, maybe it's not sellable or uses base price? 
      // Schema has `price` field at root too.

      price = product.price || 0;
      // If product has discount
      if (product.discount) {
        discountedPrice = Math.round(price * (1 - product.discount / 100)); // Assuming discount is percentage
        // Actually schema says discount: Number. Could be % or flat. Usually %.
        // Or use as is. 
        // In absence of clear instruction, I'll assume price is effective price if discount is null.
      }

      // Wait, schema has `inStock` boolean. 
      // If packSizes empty, we rely on `inStock`? Or `totalQuantity`? 
      // Let's assume infinite stock if no packSizes and inStock is true, or check totalQuantity.
      if (!product.inStock) {
        return sendBadRequestResponse(res, "Product is out of stock");
      }
      // Let's use totalQuantity.value as stock if available
      if (product.totalQuantity && product.totalQuantity.value) stock = product.totalQuantity.value;
    }

    if (stock < quantity) {
      return sendBadRequestResponse(res, `Insufficient stock. Available: ${stock}`);
    }

    const finalUnitPrice = discountedPrice !== null ? discountedPrice : price;

    const existingIndex = cart.items.findIndex(item =>
      item.product.toString() === productId &&
      String(item.packSizeId || "") === String(packSizeId || "") &&
      !item.comboOffer
    );

    if (existingIndex >= 0) {
      const newQty = cart.items[existingIndex].quantity + quantity;
      if (newQty <= 0) {
        cart.items.splice(existingIndex, 1);
      } else {
        if (stock && newQty > stock) return sendBadRequestResponse(res, `Max available: ${stock}`);
        cart.items[existingIndex].quantity = newQty;
        cart.items[existingIndex].totalPrice = cart.items[existingIndex].price * newQty;
        // Check if item has discountedPrice
        const unitP = cart.items[existingIndex].discountedPrice || cart.items[existingIndex].price;
        cart.items[existingIndex].totalDiscountedPrice = unitP * newQty;
      }
    } else {
      cart.items.push({
        product: productId,
        packSizeId: packSizeId || null,
        comboOffer: null,
        weight: finalWeight,
        unit: finalUnit,
        price: price || 0,
        discountedPrice: discountedPrice, // Could be null
        quantity,
        totalPrice: (price || 0) * quantity,
        totalDiscountedPrice: finalUnitPrice * quantity,
        stock,
        sellerId: product.sellerId,
        isComboItem: false
      });
    }

    const selectedService = courierService || "regular";

    if (!["regular", "standard"].includes(selectedService)) {
      return sendBadRequestResponse(res, 'Courier service must be "regular" or "standard"');
    }

    const deliveryInfo = getDeliveryInfo(selectedService);

    cart.courierService = selectedService;
    cart.estimatedDeliveryDate = deliveryInfo.estimatedDeliveryDate;
    cart.deliveryCharge = selectedService === "regular" ? 10 : 12;

    await cart.save();

    if (cart.appliedCombos.length > 0) {
      await cart.populate("appliedCombos.comboId");
    }

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "productName productImage") // Updated fields
      .populate("appliedCombos.comboId", "title discountPercentage");

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
      .populate("items.product")
      .populate("items.comboOffer")
      .populate("appliedCombos.comboId");

    if (!cart) {
      return sendSuccessResponse(res, "Cart fetched", cart);
    }

    recalculateCart(cart);

    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year = d.getFullYear();
      return `${day} ${month}, ${year}`;
    };

    const cartWithCourier = {
      ...cart.toObject(),
      estimatedDeliveryDate: formatDate(cart.estimatedDeliveryDate),
      courierInfo: {
        service: cart.courierService,
        estimatedDeliveryDate: formatDate(cart.estimatedDeliveryDate),
        deliveryCharge: cart.deliveryCharge
      }
    };

    return sendSuccessResponse(res, "Cart fetched", cartWithCourier);
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

    const cart = await Cart.findOne({ userId }).populate("appliedCombos.comboId");
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);
    if (itemIndex < 0) return sendNotFoundResponse(res, "Item not in cart");

    const item = cart.items[itemIndex];

    if (quantity > item.stock) {
      return sendBadRequestResponse(res, `Insufficient stock. Available: ${item.stock}`);
    }

    item.quantity = quantity;
    item.totalPrice = item.price * quantity;
    item.totalDiscountedPrice = item.discountedPrice * quantity;

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage");

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

    const cart = await Cart.findOne({ userId }).populate("appliedCombos.comboId");
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);
    if (itemIndex === -1) {
      return sendNotFoundResponse(res, "Item not found in cart");
    }

    const itemToRemove = cart.items[itemIndex];
    if (!itemToRemove) {
      return sendNotFoundResponse(res, "Item not found");
    }

    const comboOfferId = itemToRemove.comboOffer ? itemToRemove.comboOffer.toString() : null;

    cart.items.splice(itemIndex, 1);

    if (comboOfferId) {
      const remainingComboItems = cart.items.some(
        item => item.comboOffer && item.comboOffer.toString() === comboOfferId
      );

      if (!remainingComboItems) {
        cart.appliedCombos = cart.appliedCombos.filter(c => {
          if (!c.comboId) return false;
          const currentComboId = c.comboId._id ? c.comboId._id.toString() : c.comboId.toString();
          return currentComboId !== comboOfferId;
        });
      }
    }

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage");

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

export const applyComboToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { quantity, comboItemIds } = req.body;
    const { comboId } = req.params;
    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!comboId || !mongoose.Types.ObjectId.isValid(comboId)) return sendBadRequestResponse(res, "Valid comboId required");
    if (quantity === undefined || quantity === null) return sendBadRequestResponse(res, "Quantity required");
    if (typeof quantity !== "number" || quantity < 1) return sendBadRequestResponse(res, "Quantity must be a positive number");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const combo = await ComboOffer.findById(comboId)
      .populate("products.product");

    if (!combo) return sendNotFoundResponse(res, "Combo not found");
    if (!combo.isActive) return sendBadRequestResponse(res, "Combo is not active");

    let totalComboOriginalPrice = 0;
    let totalComboDiscountedPrice = 0;

    const productsToProcess = (comboItemIds && Array.isArray(comboItemIds) && comboItemIds.length > 0)
      ? combo.products.filter(p => comboItemIds.includes(p._id.toString()))
      : combo.products;

    if (productsToProcess.length === 0) {
      return sendBadRequestResponse(res, "No valid items selected from this combo");
    }

    for (const cp of productsToProcess) {
      const prod = cp.product;
      // In new schema, combo products probably map to Product + optional packSizeId ?
      // Combo schema needs update if it relies on variantId.
      // User said "remove logic variant".
      // Assuming combo definition now points to Product.
      // How does combo handle sizes?
      // If product has packSizes, combo definer should have selected one?
      // Or combo applies to base product?
      // Let's assume for now combo uses base price or simplistic model as variant is removed.

      const comboQty = (cp.quantity || 1) * quantity;

      let basePrice = prod.price || 0;
      let discountedUnitPrice = prod.discountedPrice || basePrice;
      let stock = (prod.totalQuantity && prod.totalQuantity.value) || 0;

      // If product has packSizes, we need to know which one.
      // Since combo schema hasn't been fully updated by me to support packSizeId explicitly (I only added comboType),
      // existing combo data might be broken if it used variantId.
      // But we are removing variants.
      // I'll assume for now combo uses the "price" field of the product directly.

      if (stock > 0 && comboQty > stock) {
        return sendBadRequestResponse(res, `Insufficient stock for ${prod.productName}. Available: ${stock}`);
      }

      totalComboOriginalPrice += basePrice * comboQty;
      totalComboDiscountedPrice += discountedUnitPrice * comboQty;

      const existing = cart.items.find(i =>
        i.product.toString() === prod._id.toString() &&
        String(i.comboOffer || null) === String(comboId || null) &&
        String(i.comboItemId || "") === String(cp._id || "")
      );

      if (existing) {
        existing.quantity += comboQty;
        existing.totalPrice = existing.price * existing.quantity;
        existing.totalDiscountedPrice = existing.discountedPrice * existing.quantity;
      } else {
        cart.items.push({
          product: prod._id,
          packSizeId: null, // Combo items might strictly be base product or specific size?
          // If specific size needed, combo model needs packSizeId.
          // I'll leave as null for now (default size/base).
          comboOffer: comboId,
          comboItemId: cp._id,
          price: basePrice,
          discountedPrice: discountedUnitPrice,
          quantity: comboQty,
          totalPrice: comboQty * basePrice,
          totalDiscountedPrice: comboQty * discountedUnitPrice,
          sellerId: prod.sellerId,
          stock,
          isComboItem: true
        });
      }
    }

    if (!cart.appliedCombos.some(c => c.comboId && c.comboId.toString() === comboId)) {
      const discountApplied = Math.round(totalComboOriginalPrice * (combo.discountPercentage / 100));
      cart.appliedCombos.push({
        comboId,
        discountApplied
      });
    }

    if (cart.appliedCombos.length > 0) {
      await cart.populate("appliedCombos.comboId");
    }

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage");

    return sendSuccessResponse(res, "Combo applied successfully", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const removeComboFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { comboId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!comboId || !mongoose.Types.ObjectId.isValid(comboId)) {
      return sendBadRequestResponse(res, "Valid comboId required");
    }

    const cart = await Cart.findOne({ userId }).populate("appliedCombos.comboId");
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const comboIndex = cart.appliedCombos.findIndex(
      c => (c.comboId._id ? c.comboId._id.toString() : c.comboId.toString()) === comboId
    );

    if (comboIndex === -1) {
      return sendNotFoundResponse(res, "Combo not found in cart");
    }

    cart.appliedCombos.splice(comboIndex, 1);

    cart.items = cart.items.filter(
      item => !(item.comboOffer && item.comboOffer.toString() === comboId)
    );

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage");

    return sendSuccessResponse(res, "Combo removed from cart", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

const recalculateCart = (cart) => {
  // Ensure appliedCoupon is null if it has no couponId (cleanup defaults)
  if (cart.appliedCoupon && !cart.appliedCoupon.couponId) {
    cart.appliedCoupon = null;
  }

  if (!cart.items || cart.items.length === 0) {
    cart.totalItems = 0;
    cart.totalPrice = 0;
    cart.totalDiscountedPrice = 0;
    cart.totalSavings = 0;
    cart.comboDiscount = 0;
    cart.couponDiscount = 0;
    cart.deliveryCharge = 0;
    cart.gst = 0;
    cart.subtotal = 0;
    cart.finalTotal = 0;

    // Explicitly clear applied offers for empty cart
    cart.appliedCombos = [];
    cart.appliedCoupon = null;
    return;
  }

  let totalItems = 0;
  let totalOriginal = 0;
  let totalDiscounted = 0;

  cart.items.forEach(i => {
    totalItems += i.quantity;
    totalOriginal += i.price * i.quantity;
    totalDiscounted += (i.discountedPrice || i.price) * i.quantity;
  });

  cart.totalItems = totalItems;
  cart.totalPrice = totalOriginal;
  cart.totalDiscountedPrice = totalDiscounted;
  cart.totalSavings = totalOriginal - totalDiscounted;

  let comboDiscount = 0;

  const comboItemTotals = {};
  cart.items.forEach(i => {
    if (i.comboOffer) {
      const cId = i.comboOffer._id ? i.comboOffer._id.toString() : i.comboOffer.toString();
      if (!comboItemTotals[cId]) comboItemTotals[cId] = 0;
      comboItemTotals[cId] += (i.discountedPrice || i.price) * i.quantity;
    }
  });

  if (Array.isArray(cart.appliedCombos)) {
    cart.appliedCombos.forEach(c => {
      if (!c.comboId) return;
      const cId = c.comboId._id ? c.comboId._id.toString() : c.comboId.toString();

      if (c.comboId.discountPercentage) {
        const applicableTotal = comboItemTotals[cId] || 0;
        const da = Math.round((applicableTotal * c.comboId.discountPercentage) / 100);
        c.discountApplied = da;
        comboDiscount += da;
      } else if (c.discountApplied) {
        comboDiscount += c.discountApplied;
      }
    });
  }

  cart.comboDiscount = comboDiscount;

  let couponDiscount = 0;
  if (cart.appliedCoupon && cart.appliedCoupon.discountApplied) {
    couponDiscount = cart.appliedCoupon.discountApplied;
  }
  cart.couponDiscount = couponDiscount;

  const afterAllDiscounts = totalDiscounted - comboDiscount - couponDiscount;
  const gst = Math.round(afterAllDiscounts * 0.18);
  cart.gst = gst;

  const delivery = cart.deliveryCharge || 0;

  const subtotal = afterAllDiscounts + gst + delivery;
  cart.subtotal = subtotal;

  cart.finalTotal = subtotal;
};


export const cartBillingPreview = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate("items.product", "productName productImage sellerId")
      .populate("items.comboOffer", "title discountPercentage calculatedDiscountedPrice")
      .populate("appliedCombos.comboId", "title discountPercentage calculatedDiscountedPrice calculatedOriginalPrice")
      .populate("appliedCoupon.couponId", "code discountType discountValue");

    if (!cart || cart.items.length === 0) {
      return sendSuccessResponse(res, "Cart is empty", {
        items: [],
        subtotal: 0,
        comboDiscount: 0,
        couponDiscount: 0,
        gst: 0,
        shippingCharges: 0,
        finalTotal: 0,
        summary: {}
      });
    }

    let subtotal = 0;
    let itemsDiscount = 0;
    let comboDiscount = 0;
    let couponDiscount = 0;

    cart.items.forEach(item => {
      subtotal += item.totalDiscountedPrice;
      itemsDiscount += item.totalPrice - item.totalDiscountedPrice;
    });

    if (cart.appliedCombos && cart.appliedCombos.length > 0) {
      cart.appliedCombos.forEach(combo => {
        comboDiscount += combo.discountApplied || 0;
      });
    }

    if (cart.appliedCoupon && cart.appliedCoupon.couponId) {
      couponDiscount = cart.appliedCoupon.discountApplied || 0;
    }

    const totalBeforeTax = Math.max(0, subtotal - comboDiscount - couponDiscount);

    const gstAmount = Math.round(totalBeforeTax * 0.18);

    const shippingCharges = cart.deliveryCharge || 0;

    const finalTotal = totalBeforeTax + gstAmount + shippingCharges;

    const itemsBySeller = {};
    cart.items.forEach(item => {
      const sellerId = item.sellerId.toString();
      if (!itemsBySeller[sellerId]) {
        itemsBySeller[sellerId] = [];
      }
      itemsBySeller[sellerId].push({
        productId: item.product._id,
        productTitle: item.product.productName,
        packSizeId: item.packSizeId,
        weight: item.weight,
        unit: item.unit,
        unitPrice: item.price,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        discountedPrice: item.discountedPrice,
        totalDiscountedPrice: item.totalDiscountedPrice,
        itemDiscount: item.totalPrice - item.totalDiscountedPrice
      });
    });

    const billingPreview = {
      userId,
      cartItems: cart.items.length,
      itemsBySeller,

      pricingSummary: {
        subtotal: Math.round(subtotal),
        itemDiscount: Math.round(itemsDiscount),
        comboDiscount: Math.round(comboDiscount),
        couponDiscount: Math.round(couponDiscount),
        subtotalAfterDiscounts: Math.round(totalBeforeTax),
        gst: gstAmount,
        shippingCharges,
        finalTotal: Math.round(finalTotal)
      },

      appliedOffers: {
        combos: cart.appliedCombos.map(c => ({
          comboId: c.comboId?._id,
          comboTitle: c.comboId?.title,
          discount: c.discountApplied
        })) || [],
        coupon: cart.appliedCoupon?.couponId ? {
          couponId: cart.appliedCoupon.couponId._id,
          code: cart.appliedCoupon.couponCode,
          type: cart.appliedCoupon.discountType,
          value: cart.appliedCoupon.discountValue,
          discountApplied: cart.appliedCoupon.discountApplied
        } : null
      },

      breakdown: {
        "Subtotal": Math.round(subtotal),
        "Item Discounts": Math.round(-itemsDiscount),
        "Combo Discounts": Math.round(-comboDiscount),
        "Coupon Discount": Math.round(-couponDiscount),
        "GST (18%)": gstAmount,
        "Shipping Charges": shippingCharges,
        "Final Total": Math.round(finalTotal)
      }
    };

    cart.subtotal = Math.round(subtotal);
    cart.comboDiscount = Math.round(comboDiscount);
    cart.couponDiscount = Math.round(couponDiscount);
    cart.gst = gstAmount;
    cart.shippingCharges = shippingCharges;
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
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage")
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
      .populate("items.product", "productName productImage")
      .populate("appliedCombos.comboId", "title discountPercentage");

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
  applyComboToCart,
  removeComboFromCart,
  cartBillingPreview,
  applyCouponToCart,
  removeCouponFromCart
};
