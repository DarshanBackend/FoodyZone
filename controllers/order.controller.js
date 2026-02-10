import mongoose from "mongoose";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
import User from "../models/user.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendForbiddenResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";

const generateOrderId = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${timestamp}-${random}`;
};

export const createOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { paymentMethod } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate("items.product", "productName productImage price emi") // Updated fields
      .populate("appliedCombos.comboId", "title discountPercentage")
      .populate("appliedCoupon.couponId", "code");

    if (!cart || cart.items.length === 0) {
      return sendBadRequestResponse(res, "Cart is empty. Cannot create order.");
    }

    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, "User not found");

    if (!user.selectedAddress) {
      return sendBadRequestResponse(res, "Please select a shipping address");
    }

    const validMethods = ["cod", "card", "emi", "upi", "netbanking"];
    if (!validMethods.includes(paymentMethod)) {
      return sendBadRequestResponse(res, "Invalid payment method. Allowed: COD, CARD, EMI, UPI, NETBANKING");
    }

    if (paymentMethod === "emi") {
      let eligibleEmiTotal = 0;

      cart.items.forEach(item => {
        let isEmiAllowed = true;
        // Check product level emi flag
        if (item.product && item.product.emi !== undefined) {
          isEmiAllowed = item.product.emi;
        }

        if (isEmiAllowed !== false) {
          const itemPrice = item.discountedPrice || item.price;
          eligibleEmiTotal += itemPrice * item.quantity;
        }
      });

      if (eligibleEmiTotal < 3000) {
        if (eligibleEmiTotal === 0) {
          return sendBadRequestResponse(res, "None of the items in your cart are available for EMI.");
        }
        return sendBadRequestResponse(res, `EMI is only available for orders with eligible items totaling ₹3000 or more. Your eligible amount is ₹${eligibleEmiTotal}`);
      }
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
    const comboDiscount = cart.comboDiscount || 0;
    const couponDiscount = cart.couponDiscount || 0;
    const subtotalAfterDiscounts =
      cart.totalDiscountedPrice - comboDiscount - couponDiscount;
    const gst = cart.gst;
    const deliveryCharge = cart.deliveryCharge || 0;
    const finalTotal = cart.finalTotal;

    const newOrder = await Order.create({
      userId,
      orderId,
      items: cart.items.map(item => ({
        product: item.product._id,
        packSizeId: item.packSizeId || null,
        weight: item.weight,
        unit: item.unit,
        price: item.price,
        discountedPrice: item.discountedPrice,
        quantity: item.quantity,
        totalPrice: item.price * item.quantity,
        totalDiscountedPrice: (item.discountedPrice || item.price) * item.quantity,
        sellerId: item.sellerId,
        itemStatus: "pending"
      })),
      shippingAddress: {
        country: selectedAddress.country || "INDIA",
        houseDetails: selectedAddress.houseDetails || "",
        landmark: selectedAddress.landmark || "",
        state: selectedAddress.state || "",
        city: selectedAddress.city || "",
        postalCode: selectedAddress.pincode || "",
        mapUrl: selectedAddress.mapURL || ""
      },
      courierService: cart.courierService || "regular",
      estimatedDeliveryDate: cart.estimatedDeliveryDate,
      priceSummary: {
        subtotal,
        itemDiscount,
        comboDiscount,
        couponDiscount,
        subtotalAfterDiscounts,
        gst,
        deliveryCharge,
        finalTotal
      },
      appliedOffers: {
        combos:
          cart.appliedCombos?.map(c => ({
            comboId: c.comboId,
            title: c.comboId?.title || "",
            discountApplied: c.discountApplied || 0
          })) || [],
        coupon: cart.appliedCoupon?.couponId
          ? {
            couponId: cart.appliedCoupon.couponId,
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
          appliedCombos: [],
          appliedCoupon: {},
          deliveryCharge: 0,
          comboDiscount: 0,
          couponDiscount: 0,
          gst: 0,
          finalTotal: 0
        }
      }
    );

    const populatedOrder = await Order.findById(newOrder._id)
      .populate("items.product", "productName productImage price")
      .populate("appliedOffers.combos.comboId", "title")
      .populate("appliedOffers.coupon.couponId", "code");

    return sendSuccessResponse(res, "Order created successfully", {
      orderId: newOrder.orderId,
      order: populatedOrder
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
      .populate("items.product", "productName productImage price")
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
      const obj = order.toObject();
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
      .populate("items.product", "productName productImage price hasTotalStock") // Assuming hasTotalStock helps 
      .populate("items.sellerId", "shopName email phone")
      .populate("appliedOffers.combos.comboId", "title discountPrice")
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

    const orderObj = order.toObject();
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
      .populate("items.product", "productName productImage price")
      .populate("items.sellerId", "shopName email");

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    return sendSuccessResponse(res, "Order fetched", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Update Order Status
 * PATCH /order/:orderId/status
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role;
    const { orderId } = req.params;
    const { status, notes, itemId } = req.body;

    if (!userId || !orderId || !status) {
      return sendBadRequestResponse(res, "Missing required fields");
    }

    const statusMap = { "Under Progress": "processing" };
    const normalizedStatus = statusMap[status] || status;

    const validStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
    if (!validStatuses.includes(normalizedStatus)) {
      return sendBadRequestResponse(res, `Invalid status. Allowed: ${validStatuses.join(", ")}`);
    }

    const order = await Order.findOne({ orderId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const allItemsFinalized = order.items.every(i => ["delivered", "returned", "cancelled"].includes(i.itemStatus));
    if (allItemsFinalized && normalizedStatus !== "returned") {
      return sendBadRequestResponse(res, "Order is fully delivered/completed. No further updates allowed.");
    }

    const now = new Date();
    let updatedCount = 0;

    for (const item of order.items) {
      if (itemId && String(item._id) !== String(itemId)) continue;

      if (role === "seller" && String(item.sellerId) !== String(userId)) continue;
      if (role !== "admin" && role !== "seller") continue;

      if (item.itemStatus !== "cancelled" && item.itemStatus !== "returned") {
        const itemHierarchy = ["pending", "confirmed", "processing", "shipped", "delivered"];
        const oldItemIndex = itemHierarchy.indexOf(item.itemStatus);
        const newItemIndex = itemHierarchy.indexOf(normalizedStatus);

        // Allow cancellation/return from any state typically, but if normalizedStatus IS one of them
        // we should just let it pass or handle separately. Here "normalizedStatus" is usually one of the validStatuses.
        // If normalizedStatus is "cancelled" or "returned", let it update.
        if (["cancelled", "returned"].includes(normalizedStatus)) {
          item.itemStatus = normalizedStatus;
          updatedCount++;
          continue;
        }

        // If trying to set a status that is not in hierarchy (and not cancelled/returned), skip or error.
        if (newItemIndex === -1) continue;

        // If current status is not in hierarchy (e.g. cancelled), skip
        if (oldItemIndex === -1) continue;

        // Prevent Backward movement
        if (newItemIndex < oldItemIndex) {
          continue;
        }

        // Prevent Skipping Steps (e.g. Confirmed -> Shipped)
        // Allowed: 0->1, 1->2, 2->3, 3->4
        // Logic: newItemIndex must be <= oldItemIndex + 1
        if (newItemIndex > oldItemIndex + 1) {
          return sendBadRequestResponse(res, `Cannot update status directly to '${status}'. Please follow the sequence: ${itemHierarchy[oldItemIndex]} -> ${itemHierarchy[oldItemIndex + 1]}.`);
        }

        item.itemStatus = normalizedStatus;
        updatedCount++;
      }
    }

    if (order.paymentInfo.status === "completed") {
      order.items.forEach(item => {
        if (item.itemStatus === "pending") {
          item.itemStatus = "confirmed";
        }
      });
    }

    if (updatedCount === 0) {
      return sendBadRequestResponse(res, "No valid items found to update or permission denied");
    }

    const hierarchy = ["pending", "confirmed", "processing", "shipped", "delivered"];

    let minStatusIndex = hierarchy.length - 1;

    const activeItems = order.items.filter(i => !["cancelled", "returned"].includes(i.itemStatus));

    if (activeItems.length === 0) {
      const allCancelled = order.items.every(i => i.itemStatus === "cancelled");
      order.orderStatus.current = allCancelled ? "cancelled" : "returned";
    } else {
      let hasProcessing = false;
      let hasShipped = false;
      let hasDelivered = false;

      activeItems.forEach(item => {
        const idx = hierarchy.indexOf(item.itemStatus);
        if (idx !== -1) {
          if (idx < minStatusIndex) minStatusIndex = idx;
          if (item.itemStatus === 'processing') hasProcessing = true;
          if (item.itemStatus === 'shipped') hasShipped = true;
          if (item.itemStatus === 'delivered') hasDelivered = true;
        }
      });

      let determinedStatus = hierarchy[minStatusIndex];

      const hasActivity = hasProcessing || hasShipped || hasDelivered;
      const hasShippingActivity = hasShipped || hasDelivered;

      if (minStatusIndex < 2 && hasActivity) {
        determinedStatus = "processing";
      }

      if (minStatusIndex < 3 && hasShippingActivity) {
        determinedStatus = "shipped";
      }
      if (minStatusIndex < 4 && hasDelivered) {
        determinedStatus = "delivered";
      }

      const oldStatusIndex = hierarchy.indexOf(order.orderStatus.current);
      const newStatusIndex = hierarchy.indexOf(determinedStatus);

      if (oldStatusIndex !== -1 && newStatusIndex !== -1) {
        if (newStatusIndex < oldStatusIndex) {
          determinedStatus = order.orderStatus.current;
        }
      }

      order.orderStatus.current = determinedStatus;
    }

    const lastHistory = order.orderStatus.history[order.orderStatus.history.length - 1];
    if (!lastHistory || lastHistory.status !== order.orderStatus.current) {
      order.orderStatus.history.push({
        status: order.orderStatus.current,
        timestamp: now,
        notes: notes || `Status updated via item update (${updatedCount} items)`
      });
    }

    const globalStatus = order.orderStatus.current;
    order.timeline = order.timeline || {};

    if (globalStatus === "confirmed") order.timeline.orderConfirmed = order.timeline.orderConfirmed || now;
    if (globalStatus === "processing") order.timeline.processingStarted = order.timeline.processingStarted || now;
    if (globalStatus === "shipped") order.timeline.orderShipped = order.timeline.orderShipped || now;
    if (globalStatus === "delivered") {
      order.timeline.orderDelivered = order.timeline.orderDelivered || now;
      order.actualDeliveryDate = order.actualDeliveryDate || now;

      if (order.paymentInfo.method === "cod" && order.paymentInfo.status !== "completed") {
        order.paymentInfo.status = "completed";
      }
      if (order.paymentInfo.status !== "refunded") {
        order.paymentInfo.status = "completed";
      }
    }

    order.lastUpdated = now;
    await order.save();

    return sendSuccessResponse(res, "Order status updated successfully", {
      orderId: order.orderId,
      currentStatus: order.orderStatus.current,
      updatedItems: updatedCount
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
      .populate("items.product", "productName price")
      .populate("items.sellerId", "shopName")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    return sendSuccessResponse(res, "All orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders
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
      .populate("items.product", "productName productImage price")
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

/**
 * Get Order Timeline
 * GET /order/:orderId/timeline
 */
export const getOrderTimeline = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let order = await Order.findOne({ orderId, userId });
    if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findOne({ _id: orderId, userId });
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

    let currentStatus = order.orderStatus.current;

    if (itemId) {
      const item = order.items.find(i => String(i._id) === String(itemId));
      if (item) {
        currentStatus = item.itemStatus;
      }
    }

    const actualHistory = order.orderStatus.history || [];
    let finalTimeline = [];

    const getHistoryEntry = (statusKey) => {
      return actualHistory.filter(h => h.status === statusKey).pop();
    };

    if (['cancelled', 'returned'].includes(currentStatus)) {
      for (const step of validSteps) {
        const entry = getHistoryEntry(step.key);
        if (entry) {
          finalTimeline.push({
            status: step.label,
            statusKey: step.key,
            message: step.msg,
            timestamp: entry.timestamp,
            displayDate: formatTimelineDate(entry.timestamp),
            isCompleted: true,
            isCurrent: false
          });
        }
      }
      const specialStatus = currentStatus;
      const specialEntry = getHistoryEntry(specialStatus);
      finalTimeline.push({
        status: specialStatus.charAt(0).toUpperCase() + specialStatus.slice(1),
        statusKey: specialStatus,
        message: specialStatus === 'cancelled' ? 'Your order was cancelled.' : 'Your order was returned.',
        timestamp: specialEntry ? specialEntry.timestamp : new Date(),
        displayDate: formatTimelineDate(specialEntry ? specialEntry.timestamp : new Date()),
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
            const nextKey = validSteps[i].key;
            const nextEntry = getHistoryEntry(nextKey);
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
          isCompleted: isCompleted,
          isCurrent: isCurrent
        };
      });
    }

    const responseData = {
      orderId: order.orderId,
      currentStatus: currentStatus,
      paymentMethod: order.paymentInfo?.method,
      paymentStatus: order.paymentInfo?.status,
      estimatedDeliveryDate: formatTimelineDate(order.estimatedDeliveryDate),
      timeline: finalTimeline
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
