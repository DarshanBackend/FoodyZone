import mongoose from "mongoose";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
import User from "../models/user.model.js";
import Restaurant from "../models/restaurant.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendForbiddenResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";

const generateOrderId = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${timestamp}-${random}`;
};

// Local recalculateCart to ensure fresh totals before order creation
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

// Strip docType from populated product and clean response
const cleanOrderResponse = (order) => {
  const obj = order.toObject ? order.toObject() : { ...order };
  if (obj.items) {
    obj.items.forEach(item => {
      if (item.product && item.product.docType !== undefined) {
        delete item.product.docType;
      }
      if (!item.restaurantName) delete item.restaurantName;
    });
  }
  delete obj.__v;
  return obj;
};

export const createOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { paymentMethod } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.product",
        select: "title image price stock docType sellerId restaurantId",
        populate: {
          path: "restaurantId",
          select: "title"
        }
      });

    if (!cart || cart.items.length === 0) {
      return sendBadRequestResponse(res, "Cart is empty. Cannot create order.");
    }

    recalculateCart(cart);
    await cart.save();

    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, "User not found");

    if (!user.selectedAddress) {
      return sendBadRequestResponse(res, "Please select a shipping address");
    }

    const validMethods = ["cod", "card", "upi", "netbanking"];
    if (!validMethods.includes(paymentMethod)) {
      return sendBadRequestResponse(res, "Invalid payment method. Allowed: COD, CARD, UPI, NETBANKING");
    }

    const selectedAddress = user.address?.find(
      a => a._id.toString() === user.selectedAddress.toString()
    );

    if (!selectedAddress) {
      return sendBadRequestResponse(res, "Selected address not found");
    }

    const orderId = generateOrderId();

    const subtotal = cart.totalPrice;
    const itemDiscount = cart.totalSavings;
    const couponDiscount = cart.couponDiscount || 0;
    const subtotalAfterDiscounts = cart.totalDiscountedPrice - couponDiscount;
    const deliveryCharge = cart.restaurantCharges || 0;
    const finalTotal = cart.finalTotal;

    const now = new Date();

    // Build order items with estimated delivery and restaurant name
    const orderItems = cart.items.map(item => {
      const product = item.product;
      const isDelivery = product?.docType === "delivery";

      // Estimated delivery per item
      let estimatedDelivery = null;
      let estimatedDeliveryDate = null;

      if (isDelivery) {
        estimatedDelivery = "30-45 min";
        estimatedDeliveryDate = new Date(now.getTime() + 45 * 60 * 1000); // 45 min from now
      } else {
        // Grocery — 2-3 days
        estimatedDelivery = "2-3 days";
        estimatedDeliveryDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
      }

      // Restaurant name for delivery items
      const restaurantName = isDelivery && product.restaurantId?.title
        ? product.restaurantId.title
        : null;

      return {
        product: product._id,
        price: item.price,
        discountedPrice: item.discountedPrice,
        quantity: item.quantity,
        totalPrice: item.price * item.quantity,
        totalDiscountedPrice: (item.discountedPrice || item.price) * item.quantity,
        sellerId: item.sellerId,
        restaurantName,
        estimatedDelivery,
        estimatedDeliveryDate,
        itemStatus: "pending"
      };
    });

    // Overall estimated delivery = latest item's estimated delivery
    const latestDeliveryDate = orderItems.reduce((latest, item) => {
      if (item.estimatedDeliveryDate && (!latest || item.estimatedDeliveryDate > latest)) {
        return item.estimatedDeliveryDate;
      }
      return latest;
    }, null);

    const newOrder = await Order.create({
      userId,
      orderId,
      items: orderItems,
      shippingAddress: {
        country: selectedAddress.country || "INDIA",
        houseDetails: selectedAddress.houseDetails || "",
        landmark: selectedAddress.landmark || "",
        state: selectedAddress.state || "",
        city: selectedAddress.city || "",
        postalCode: selectedAddress.pincode || "",
        mapUrl: selectedAddress.mapURL || ""
      },
      courierService: "regular",
      estimatedDeliveryDate: latestDeliveryDate,
      priceSummary: {
        subtotal,
        itemDiscount,
        couponDiscount,
        subtotalAfterDiscounts,
        deliveryCharge,
        finalTotal
      },
      appliedOffers: {
        coupon: cart.appliedCoupon?.couponId
          ? {
            couponId: cart.appliedCoupon.couponId._id || cart.appliedCoupon.couponId,
            code: cart.appliedCoupon.couponCode,
            discountType: cart.appliedCoupon.discountType,
            discountValue: cart.appliedCoupon.discountValue,
            discountApplied: cart.appliedCoupon.discountApplied
          }
          : null
      },
      paymentInfo: {
        method: paymentMethod,
        status: "pending"
      },
      orderStatus: {
        current: "pending",
        history: [
          {
            status: "pending",
            timestamp: new Date(),
            notes: "Order created successfully"
          }
        ]
      },
      timeline: {
        orderCreated: new Date()
      }
    });

    await Cart.updateOne(
      { userId },
      {
        $set: {
          items: [],
          totalItems: 0,
          totalPrice: 0,
          totalDiscountedPrice: 0,
          totalSavings: 0,
          appliedCoupon: {},
          couponDiscount: 0,
          finalTotal: 0
        }
      }
    );

    const populatedOrder = await Order.findById(newOrder._id)
      .populate("items.product", "title image price discountedPrice")
      .populate("appliedOffers.coupon.couponId", "code");

    return sendSuccessResponse(res, "Order created successfully", {
      orderId: newOrder.orderId,
      order: cleanOrderResponse(populatedOrder)
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { status, page = 1, limit = 10 } = req.query;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let query = { userId };
    if (status) {
      query["orderStatus.current"] = status;
    }

    const skip = (page - 1) * limit;

    const orders = await Order.find(query)
      .populate("items.product", "title image price discountedPrice")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year = d.getFullYear();
      return `${day} ${month}, ${year}`;
    };

    const formattedOrders = orders.map(order => {
      const obj = cleanOrderResponse(order);
      obj.estimatedDeliveryDate = formatDate(order.estimatedDeliveryDate);
      return obj;
    });

    return sendSuccessResponse(res, "Orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders: formattedOrders
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getOrderById = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId })
      .populate("items.product", "title image price discountedPrice")
      .populate("items.sellerId", "shopName email phone")
      .populate("appliedOffers.coupon.couponId", "code");

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'short' });
      const year = d.getFullYear();
      return `${day} ${month}, ${year}`;
    };

    const orderObj = cleanOrderResponse(order);
    orderObj.estimatedDeliveryDate = formatDate(order.estimatedDeliveryDate);

    return sendSuccessResponse(res, "Order fetched", orderObj);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getOrderByMongoId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid order ID format");
    }

    const order = await Order.findById(id)
      .populate("userId", "name email phone")
      .populate("items.product", "title image price discountedPrice")
      .populate("items.sellerId", "shopName email");

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    return sendSuccessResponse(res, "Order fetched", cleanOrderResponse(order));
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Update Order Status (Admin/Seller)
 * PATCH /order/:orderId/status
 * 
 * Body: { status, notes?, itemId? }
 * - If itemId is provided: only that item's status is updated
 * - If itemId is NOT provided: all items (matching seller) are updated
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role;
    const { orderId } = req.params;
    const { status, notes, itemId } = req.body;

    if (!userId || !orderId || !status) {
      return sendBadRequestResponse(res, "Missing required fields (orderId, status)");
    }

    const statusMap = { "Under Progress": "processing" };
    const normalizedStatus = statusMap[status] || status;

    const validStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
    if (!validStatuses.includes(normalizedStatus)) {
      return sendBadRequestResponse(res, `Invalid status. Allowed: ${validStatuses.join(", ")}`);
    }

    const order = await Order.findOne({ orderId }).populate("items.product", "title image price discountedPrice");
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const allItemsFinalized = order.items.every(i => ["delivered", "returned", "cancelled"].includes(i.itemStatus));
    if (allItemsFinalized && normalizedStatus !== "returned") {
      return sendBadRequestResponse(res, "Order is fully delivered/completed. No further updates allowed.");
    }

    const now = new Date();
    let updatedCount = 0;
    const updatedItemDetails = [];

    for (const item of order.items) {
      // If itemId is given, only update that specific item
      if (itemId && String(item._id) !== String(itemId)) continue;

      // Seller can only update their own items
      if (role === "seller" && String(item.sellerId) !== String(userId)) continue;
      if (role !== "admin" && role !== "seller") continue;

      if (item.itemStatus !== "cancelled" && item.itemStatus !== "returned") {
        const itemHierarchy = ["pending", "confirmed", "processing", "shipped", "delivered"];
        const oldItemIndex = itemHierarchy.indexOf(item.itemStatus);
        const newItemIndex = itemHierarchy.indexOf(normalizedStatus);

        // Allow cancellation/return from any state
        if (["cancelled", "returned"].includes(normalizedStatus)) {
          item.itemStatus = normalizedStatus;
          item.statusHistory.push({
            status: normalizedStatus,
            timestamp: now,
            notes: notes || `Item ${normalizedStatus}`
          });
          if (normalizedStatus === "cancelled") item.cancelledAt = now;
          updatedCount++;
          updatedItemDetails.push({ itemId: item._id, product: item.product, newStatus: normalizedStatus });
          continue;
        }

        if (newItemIndex === -1 || oldItemIndex === -1) continue;

        // Prevent backward movement
        if (newItemIndex < oldItemIndex) continue;

        // Prevent skipping steps
        if (newItemIndex > oldItemIndex + 1) {
          return sendBadRequestResponse(res,
            `Cannot update item directly to '${normalizedStatus}'. Follow sequence: ${itemHierarchy[oldItemIndex]} → ${itemHierarchy[oldItemIndex + 1]}`
          );
        }

        item.itemStatus = normalizedStatus;
        item.statusHistory.push({
          status: normalizedStatus,
          timestamp: now,
          notes: notes || `Item status updated to ${normalizedStatus}`
        });

        if (normalizedStatus === "delivered") item.deliveredAt = now;

        updatedCount++;
        updatedItemDetails.push({ itemId: item._id, product: item.product, newStatus: normalizedStatus });
      }
    }

    // Auto-confirm pending items when payment is completed
    if (order.paymentInfo.status === "completed") {
      order.items.forEach(item => {
        if (item.itemStatus === "pending") {
          item.itemStatus = "confirmed";
          item.statusHistory.push({
            status: "confirmed",
            timestamp: now,
            notes: "Auto-confirmed after payment"
          });
        }
      });
    }

    if (updatedCount === 0) {
      return sendBadRequestResponse(res, "No valid items found to update or permission denied");
    }

    // Determine global order status based on all items
    const hierarchy = ["pending", "confirmed", "processing", "shipped", "delivered"];
    const activeItems = order.items.filter(i => !["cancelled", "returned"].includes(i.itemStatus));

    if (activeItems.length === 0) {
      const allCancelled = order.items.every(i => i.itemStatus === "cancelled");
      order.orderStatus.current = allCancelled ? "cancelled" : "returned";
    } else {
      let minStatusIndex = hierarchy.length - 1;

      activeItems.forEach(item => {
        const idx = hierarchy.indexOf(item.itemStatus);
        if (idx !== -1 && idx < minStatusIndex) minStatusIndex = idx;
      });

      let determinedStatus = hierarchy[minStatusIndex];

      const hasDelivered = activeItems.some(i => i.itemStatus === "delivered");
      const hasShipped = activeItems.some(i => i.itemStatus === "shipped");
      const hasProcessing = activeItems.some(i => i.itemStatus === "processing");

      if (minStatusIndex < 2 && (hasProcessing || hasShipped || hasDelivered)) determinedStatus = "processing";
      if (minStatusIndex < 3 && (hasShipped || hasDelivered)) determinedStatus = "shipped";
      if (activeItems.every(i => i.itemStatus === "delivered")) determinedStatus = "delivered";

      // Don't go backward
      const oldIdx = hierarchy.indexOf(order.orderStatus.current);
      const newIdx = hierarchy.indexOf(determinedStatus);
      if (oldIdx !== -1 && newIdx !== -1 && newIdx < oldIdx) {
        determinedStatus = order.orderStatus.current;
      }

      order.orderStatus.current = determinedStatus;
    }

    // Push to global history if status changed
    const lastHistory = order.orderStatus.history[order.orderStatus.history.length - 1];
    if (!lastHistory || lastHistory.status !== order.orderStatus.current) {
      order.orderStatus.history.push({
        status: order.orderStatus.current,
        timestamp: now,
        notes: notes || `Status updated (${updatedCount} item${updatedCount > 1 ? 's' : ''} → ${normalizedStatus})`
      });
    }

    // Update global timeline
    const globalStatus = order.orderStatus.current;
    order.timeline = order.timeline || {};

    if (globalStatus === "confirmed") order.timeline.orderConfirmed = order.timeline.orderConfirmed || now;
    if (globalStatus === "processing") order.timeline.processingStarted = order.timeline.processingStarted || now;
    if (globalStatus === "shipped") order.timeline.orderShipped = order.timeline.orderShipped || now;
    if (globalStatus === "delivered") {
      order.timeline.orderDelivered = order.timeline.orderDelivered || now;
      order.actualDeliveryDate = order.actualDeliveryDate || now;

      if (order.paymentInfo.method === "cod" && order.paymentInfo.status !== "refunded") {
        order.paymentInfo.status = "completed";
      }
    }

    order.lastUpdated = now;
    await order.save();

    // Build response with all items and their current statuses
    const itemsSummary = order.items.map(item => ({
      itemId: item._id,
      product: item.product,
      quantity: item.quantity,
      price: item.price,
      itemStatus: item.itemStatus,
      deliveredAt: item.deliveredAt || null,
      cancelledAt: item.cancelledAt || null
    }));

    return sendSuccessResponse(res, "Order status updated successfully", {
      orderId: order.orderId,
      orderStatus: order.orderStatus.current,
      updatedItems: updatedCount,
      updatedItemDetails,
      allItems: itemsSummary
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


/**
 * Cancel Order
 * POST /order/:orderId/cancel
 */
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    if (!["pending", "confirmed"].includes(order.orderStatus.current)) {
      return sendBadRequestResponse(res, `Cannot cancel order with status: ${order.orderStatus.current}`);
    }

    order.orderStatus.current = "cancelled";
    order.orderStatus.history.push({
      status: "cancelled",
      timestamp: new Date(),
      notes: reason || "Cancelled by user"
    });
    order.cancellationReason = reason || "No reason provided";
    order.lastUpdated = new Date();

    await order.save();

    return sendSuccessResponse(res, "Order cancelled successfully", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Return Order
 * POST /order/:orderId/return
 */
export const returnOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!reason) return sendBadRequestResponse(res, "Return reason required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    if (order.orderStatus.current !== "delivered") {
      return sendBadRequestResponse(res, "Only delivered orders can be returned");
    }

    order.orderStatus.current = "returned";
    order.orderStatus.history.push({
      status: "returned",
      timestamp: new Date(),
      notes: reason
    });
    order.returnReason = reason;
    order.paymentInfo.status = "refunded";
    order.paymentInfo.refundAmount = order.priceSummary.finalTotal;
    order.paymentInfo.refundDate = new Date();
    order.lastUpdated = new Date();

    await order.save();

    return sendSuccessResponse(res, "Return initiated successfully", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get All Orders (Admin Only)
 * GET /order/admin/all-orders
 */

export const getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, sortBy = "createdAt", sortOrder = "-1" } = req.query;

    let query = {};
    if (status) {
      query["orderStatus.current"] = status;
    }

    const skip = (page - 1) * limit;
    const sortObj = {};
    sortObj[sortBy] = parseInt(sortOrder);

    const orders = await Order.find(query)
      .populate("userId", "name email phone")
      .populate("items.product", "title image price discountedPrice")
      .populate("items.sellerId", "shopName")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    return sendSuccessResponse(res, "All orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders: orders.map(o => cleanOrderResponse(o))
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};



/**
 * Get Seller's Orders
 * GET /order/seller/my-orders
 */
export const getSellerOrders = async (req, res) => {
  try {
    const sellerId = req.user?._id;
    const { status, page = 1, limit = 10 } = req.query;

    if (!sellerId) return sendForbiddenResponse(res, "Seller authentication required");

    let query = { "items.sellerId": sellerId };

    if (status) {
      query.items = {
        $elemMatch: {
          sellerId: sellerId,
          itemStatus: status
        }
      };
    }

    const skip = (page - 1) * limit;

    const orders = await Order.find(query)
      .populate("userId", "name email phone")
      .populate("items.product", "title image price discountedPrice")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Order.countDocuments(query);

    const sellerOrders = orders.map(order => {
      const sellerItems = order.items.filter(item =>
        String(item.sellerId) === String(sellerId) &&
        (!status || item.itemStatus === status)
      );

      // Strip docType from products (.lean() bypasses toJSON transforms)
      sellerItems.forEach(item => {
        if (item.product?.docType) delete item.product.docType;
      });

      const sellerSubtotal = sellerItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      const sellerTotalDiscounted = sellerItems.reduce((acc, item) => acc + ((item.discountedPrice || item.price) * item.quantity), 0);

      return {
        _id: order._id,
        orderId: order.orderId,
        userId: order.userId,
        items: sellerItems,
        shippingAddress: order.shippingAddress,
        paymentInfo: order.paymentInfo,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        sellerSummary: {
          subtotal: sellerSubtotal,
          totalDiscounted: sellerTotalDiscounted,
          count: sellerItems.length
        }
      };
    });

    return sendSuccessResponse(res, "Seller orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders: sellerOrders
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getOrderTimeline = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let order = await Order.findOne({ orderId, userId })
      .populate("items.product", "title image price discountedPrice");
    if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findOne({ _id: orderId, userId })
        .populate("items.product", "title image price discountedPrice");
    }

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    const { itemId } = req.query;

    const formatTimelineDate = (timestamp) => {
      if (!timestamp) return "";
      const date = new Date(timestamp);
      const mon = date.toLocaleString('en-US', { month: 'short' });
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      let hh = date.getHours();
      const min = String(date.getMinutes()).padStart(2, '0');
      const ampm = hh >= 12 ? 'PM' : 'AM';
      hh = hh % 12;
      hh = hh ? hh : 12;
      const strTime = String(hh).padStart(2, '0') + ':' + min + ' ' + ampm;
      return `${mon} ${dd} ${yyyy} ${strTime}`;
    };

    const validSteps = [
      { key: 'confirmed', label: 'Order Confirmed', msg: 'Seller has confirmed your order.' },
      { key: 'processing', label: 'Under Progress', msg: 'Seller is packing your order.' },
      { key: 'shipped', label: 'Shipped', msg: 'Your order has been shipped and is on its way.' },
      { key: 'delivered', label: 'Delivered', msg: 'Your order has been delivered successfully.' }
    ];

    // Determine which history and status to use
    let currentStatus;
    let historySource;

    if (itemId) {
      const item = order.items.find(i => String(i._id) === String(itemId));
      if (!item) return sendNotFoundResponse(res, "Item not found in this order");

      currentStatus = item.itemStatus;
      // Use item's own statusHistory if available, fallback to global
      historySource = (item.statusHistory && item.statusHistory.length > 0)
        ? item.statusHistory
        : order.orderStatus.history;
    } else {
      currentStatus = order.orderStatus.current;
      historySource = order.orderStatus.history || [];
    }

    const getHistoryEntry = (statusKey) => {
      return historySource.filter(h => h.status === statusKey).pop();
    };

    let finalTimeline = [];

    if (['cancelled', 'returned'].includes(currentStatus)) {
      // Show completed steps + the cancel/return step
      for (const step of validSteps) {
        const entry = getHistoryEntry(step.key);
        if (entry) {
          finalTimeline.push({
            status: step.label,
            statusKey: step.key,
            message: step.msg,
            timestamp: entry.timestamp,
            displayDate: formatTimelineDate(entry.timestamp),
            notes: entry.notes || "",
            isCompleted: true,
            isCurrent: false
          });
        }
      }

      const specialEntry = getHistoryEntry(currentStatus);
      finalTimeline.push({
        status: currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1),
        statusKey: currentStatus,
        message: currentStatus === 'cancelled' ? 'This item/order was cancelled.' : 'This item/order was returned.',
        timestamp: specialEntry ? specialEntry.timestamp : new Date(),
        displayDate: formatTimelineDate(specialEntry ? specialEntry.timestamp : new Date()),
        notes: specialEntry?.notes || "",
        isCompleted: true,
        isCurrent: true
      });

    } else {
      const statusKeys = validSteps.map(s => s.key);
      let currentIndex = statusKeys.indexOf(currentStatus);

      if (currentIndex === -1 && currentStatus === 'pending') {
        currentIndex = -1;
      }

      finalTimeline = validSteps.map((step, index) => {
        const isCompleted = index <= currentIndex;
        const isCurrent = index === currentIndex;
        let entry = getHistoryEntry(step.key);
        let validTimestamp = entry ? entry.timestamp : null;

        if (isCompleted && !validTimestamp) {
          for (let i = index + 1; i < validSteps.length; i++) {
            const nextEntry = getHistoryEntry(validSteps[i].key);
            if (nextEntry) {
              validTimestamp = nextEntry.timestamp;
              break;
            }
          }
        }

        return {
          status: step.label,
          statusKey: step.key,
          message: step.msg,
          timestamp: validTimestamp,
          displayDate: formatTimelineDate(validTimestamp),
          notes: entry?.notes || "",
          isCompleted,
          isCurrent
        };
      });
    }

    // All items summary
    const itemsSummary = order.items.map(item => ({
      itemId: item._id,
      product: item.product,
      quantity: item.quantity,
      price: item.price,
      discountedPrice: item.discountedPrice,
      itemStatus: item.itemStatus,
      deliveredAt: item.deliveredAt ? formatTimelineDate(item.deliveredAt) : null,
      cancelledAt: item.cancelledAt ? formatTimelineDate(item.cancelledAt) : null
    }));

    const responseData = {
      orderId: order.orderId,
      currentStatus,
      paymentMethod: order.paymentInfo?.method,
      paymentStatus: order.paymentInfo?.status,
      estimatedDeliveryDate: formatTimelineDate(order.estimatedDeliveryDate),
      timeline: finalTimeline,
      items: itemsSummary
    };

    if (itemId) responseData.itemId = itemId;

    return sendSuccessResponse(res, "Timeline fetched successfully", responseData);

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  createOrder,
  getUserOrders,
  getOrderById,
  getOrderByMongoId,
  updateOrderStatus,
  cancelOrder,
  returnOrder,
  getAllOrders,
  getSellerOrders,
  getOrderTimeline
};
