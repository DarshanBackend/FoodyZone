import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import productModel from "../models/product.model.js";
import {
  sendBadRequestResponse,
  sendErrorResponse,
  sendNotFoundResponse,
  sendSuccessResponse
} from "../utils/response.utils.js";
import {
  createPaymentIntent,
  retrievePaymentIntent,
  confirmPaymentIntent,
  createStripeRefund
} from "../utils/stripe.config.js";

export const initiatePayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.status === "completed") {
      return sendBadRequestResponse(res, "Payment already completed for this order");
    }

    const onlineMethods = ["card", "upi", "netbanking"];
    if (!onlineMethods.includes(order.paymentInfo.method)) {
      return sendBadRequestResponse(res, "This order is not configured for online payment. Change payment method first.");
    }

    if (order.paymentInfo.stripePaymentIntentId) {
      try {
        const existingIntent = await retrievePaymentIntent(order.paymentInfo.stripePaymentIntentId);

        if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(existingIntent.status)) {
          return sendSuccessResponse(res, "Payment intent already exists", {
            orderId,
            stripePaymentIntentId: existingIntent.id,
            clientSecret: existingIntent.client_secret,
            amount: order.priceSummary.finalTotal,
            currency: "inr"
          });
        }
      } catch (err) {
      }
    }

    const paymentIntent = await createPaymentIntent(
      order.priceSummary.finalTotal,
      orderId
    );

    order.paymentInfo.stripePaymentIntentId = paymentIntent.id;
    order.paymentInfo.stripeClientSecret = paymentIntent.client_secret;
    await order.save();

    const existingPayment = await Payment.findOne({ orderId: order.orderId, userId });

    if (existingPayment) {
      existingPayment.stripePaymentIntentId = paymentIntent.id;
      existingPayment.stripeClientSecret = paymentIntent.client_secret;
      existingPayment.status = "pending";
      await existingPayment.save();
    } else {
      await Payment.create({
        userId,
        orderId: order.orderId,
        orderObjectId: order._id,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret,
        amount: order.priceSummary.finalTotal,
        currency: "INR",
        status: "pending",
        method: order.paymentInfo.method
      });
    }

    return sendSuccessResponse(res, "Payment initiated successfully", {
      orderId,
      stripePaymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: order.priceSummary.finalTotal,
      currency: "inr"
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.status === "completed") {
      return sendSuccessResponse(res, "Payment already verified", {
        orderId: order.orderId,
        paymentStatus: "completed",
        orderStatus: order.orderStatus.current
      });
    }

    const paymentIntentId = req.body?.paymentIntentId || order.paymentInfo.stripePaymentIntentId;

    if (!paymentIntentId) {
      return sendBadRequestResponse(res, "No payment intent found. Please initiate payment first.");
    }

    let paymentIntent = await retrievePaymentIntent(paymentIntentId);

    if (["requires_payment_method", "requires_confirmation"].includes(paymentIntent.status)) {
      try {
        paymentIntent = await confirmPaymentIntent(paymentIntentId);
      } catch (confirmErr) {
        return sendBadRequestResponse(res, `Payment confirmation failed: ${confirmErr.message}`);
      }
    }

    if (paymentIntent.status !== "succeeded") {
      const mappedStatus = paymentIntent.status === "requires_payment_method" ? "failed" : "processing";

      await Payment.findOneAndUpdate(
        { stripePaymentIntentId: paymentIntentId },
        { status: mappedStatus }
      );

      return sendBadRequestResponse(res, `Payment not completed. Stripe status: ${paymentIntent.status}`);
    }

    order.paymentInfo.status = "completed";
    order.paymentInfo.transactionId = paymentIntentId;
    order.paymentInfo.paymentDate = new Date();
    order.timeline.paymentCompleted = new Date();

    if (order.orderStatus.current === "pending") {
      order.orderStatus.current = "confirmed";

      order.items.forEach(item => {
        if (item.itemStatus === "pending") {
          item.itemStatus = "confirmed";
        }
      });

      order.orderStatus.history.push({
        status: "confirmed",
        timestamp: new Date(),
        notes: `Order confirmed. Payment via ${order.paymentInfo.method.toUpperCase()} (Stripe)`
      });
      order.timeline.orderConfirmed = new Date();
    }

    order.lastUpdated = new Date();
    await order.save();

    const latestCharge = paymentIntent.latest_charge;
    let cardDetails = null;
    let paymentMethodType = "card";

    if (latestCharge && typeof latestCharge === "object") {
      cardDetails = latestCharge.payment_method_details?.card || null;
      paymentMethodType = latestCharge.payment_method_details?.type || "card";
    }

    await Payment.findOneAndUpdate(
      { stripePaymentIntentId: paymentIntentId },
      {
        status: "succeeded",
        method: paymentMethodType,
        paymentDate: new Date(),
        ...(cardDetails && {
          card: {
            brand: cardDetails.brand,
            last4: cardDetails.last4,
            expMonth: cardDetails.exp_month,
            expYear: cardDetails.exp_year,
            funding: cardDetails.funding
          }
        })
      }
    );

    try {
      for (const item of order.items) {
        await productModel.findByIdAndUpdate(
          item.product,
          { $inc: { sold: item.quantity || 1 } },
          { new: true }
        );
      }
    } catch (err) {
    }

    return sendSuccessResponse(res, "Payment verified and order confirmed", {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      orderStatus: order.orderStatus.current,
      transactionId: paymentIntentId,
      method: order.paymentInfo.method
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId }).select(
      "orderId paymentInfo priceSummary"
    );

    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.status === "pending" && order.paymentInfo.stripePaymentIntentId) {
      try {
        const paymentIntent = await retrievePaymentIntent(order.paymentInfo.stripePaymentIntentId);

        if (paymentIntent.status === "succeeded") {
          order.paymentInfo.status = "completed";
          order.paymentInfo.paymentDate = new Date();
          order.paymentInfo.transactionId = paymentIntent.id;
          await order.save();
        }
      } catch (stripeErr) {
      }
    }

    const payment = await Payment.findOne({ orderId }).select(
      "status method card paymentDate refundId refundAmount refundStatus refundDate"
    );

    return sendSuccessResponse(res, "Payment status", {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      method: order.paymentInfo.method,
      amount: order.priceSummary.finalTotal,
      transactionId: order.paymentInfo.transactionId,
      stripePaymentIntentId: order.paymentInfo.stripePaymentIntentId,
      paymentDate: order.paymentInfo.paymentDate,
      refundAmount: order.paymentInfo.refundAmount,
      refundDate: order.paymentInfo.refundDate,
      paymentDetails: payment || null
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const processRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, reason } = req.body || {};
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const onlineMethods = ["card", "upi", "netbanking"];
    if (!onlineMethods.includes(order.paymentInfo.method)) {
      return sendBadRequestResponse(res, "COD orders cannot be refunded via Stripe");
    }

    if (order.paymentInfo.status !== "completed") {
      return sendBadRequestResponse(res, "Cannot refund — payment is not completed");
    }

    if (!order.paymentInfo.stripePaymentIntentId) {
      return sendBadRequestResponse(res, "No Stripe payment intent found for this order");
    }

    const refundAmount = amount ? Number(amount) : order.priceSummary.finalTotal;

    if (refundAmount <= 0) {
      return sendBadRequestResponse(res, "Refund amount must be greater than zero");
    }

    if (refundAmount > order.priceSummary.finalTotal) {
      return sendBadRequestResponse(res, `Refund amount cannot exceed order total (₹${order.priceSummary.finalTotal})`);
    }

    const refund = await createStripeRefund(
      order.paymentInfo.stripePaymentIntentId,
      refundAmount
    );

    order.paymentInfo.status = "refunded";
    order.paymentInfo.refundAmount = refundAmount;
    order.paymentInfo.refundDate = new Date();
    order.lastUpdated = new Date();

    if (order.orderStatus.current !== "returned") {
      order.orderStatus.current = "cancelled";
      order.orderStatus.history.push({
        status: "cancelled",
        timestamp: new Date(),
        notes: reason || "Refund processed: Order Cancelled"
      });
    } else {
      order.orderStatus.history.push({
        status: "refunded",
        timestamp: new Date(),
        notes: reason || "Refund processed for returned item"
      });
    }

    await order.save();

    await Payment.findOneAndUpdate(
      { stripePaymentIntentId: order.paymentInfo.stripePaymentIntentId },
      {
        status: "refunded",
        refundId: refund.id,
        refundAmount,
        refundStatus: refund.status,
        refundDate: new Date()
      }
    );

    return sendSuccessResponse(res, "Refund processed successfully", {
      orderId: order.orderId,
      refundId: refund.id,
      refundAmount,
      refundStatus: refund.status
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const handleStripeWebhook = async (req, res) => {
  try {
    const event = req.body;

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId) {
          const order = await Order.findOne({ orderId });

          if (order && order.paymentInfo.status !== "completed") {
            order.paymentInfo.status = "completed";
            order.paymentInfo.transactionId = paymentIntent.id;
            order.paymentInfo.paymentDate = new Date();
            order.timeline.paymentCompleted = new Date();

            if (order.orderStatus.current === "pending") {
              order.orderStatus.current = "confirmed";

              order.items.forEach(item => {
                if (item.itemStatus === "pending") {
                  item.itemStatus = "confirmed";
                }
              });

              order.timeline.orderConfirmed = new Date();
              order.orderStatus.history.push({
                status: "confirmed",
                timestamp: new Date(),
                notes: "Payment verified via Stripe Webhook"
              });
            }

            order.lastUpdated = new Date();
            await order.save();

            await Payment.findOneAndUpdate(
              { stripePaymentIntentId: paymentIntent.id },
              { status: "succeeded", paymentDate: new Date() }
            );

            try {
              for (const item of order.items) {
                await productModel.findByIdAndUpdate(
                  item.product,
                  { $inc: { sold: item.quantity || 1 } },
                  { new: true }
                );
              }
            } catch (e) {
            }
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId) {
          const order = await Order.findOne({ orderId });
          if (order) {
            order.paymentInfo.status = "failed";
            order.lastUpdated = new Date();
            await order.save();

            await Payment.findOneAndUpdate(
              { stripePaymentIntentId: paymentIntent.id },
              {
                status: "failed",
                errorCode: paymentIntent.last_payment_error?.code,
                errorMessage: paymentIntent.last_payment_error?.message
              }
            );
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        if (paymentIntentId) {
          await Payment.findOneAndUpdate(
            { stripePaymentIntentId: paymentIntentId },
            { status: "refunded", refundDate: new Date() }
          );
        }
        break;
      }

      default:
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

export const getMyPayments = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await Payment.find({ userId })
      .populate("orderObjectId", "orderId orderStatus priceSummary")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments({ userId });

    return sendSuccessResponse(res, "Payment history fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      payments
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await Payment.find({})
      .populate("orderObjectId", "orderId orderStatus priceSummary")
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments();

    return sendSuccessResponse(res, "All payments fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      payments
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  initiatePayment,
  verifyPayment,
  getPaymentStatus,
  processRefund,
  handleStripeWebhook,
  getMyPayments,
  getAllPayments
};
