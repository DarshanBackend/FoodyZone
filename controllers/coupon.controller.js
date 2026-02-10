import mongoose from "mongoose";
import CouponModel from "../models/coupon.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse, sendErrorResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

export const createCoupon = async (req, res) => {
    try {
        const {
            code,
            description,
            discountType,
            flatValue,
            percentageValue,
            minOrderValue,
            expiryDate,
            isActive,
        } = req.body;

        const couponImage = req.file;

        if (!code || !description || !discountType || !expiryDate) {
            return sendBadRequestResponse(res, "All required fields must be provided");
        }

        if (!couponImage) {
            return sendBadRequestResponse(res, "Coupon Image is Required");
        }

        if (!["flat", "percentage"].includes(discountType)) {
            return sendBadRequestResponse(res, "Discount type must be either 'flat' or 'percentage'");
        }

        const parsedFlatValue = parseFloat(flatValue);
        const parsedPercentageValue = parseFloat(percentageValue);
        const parsedMinOrderValue = parseFloat(minOrderValue) || 0;

        let finalFlatValue = 0;
        let finalPercentageValue = 0;

        if (discountType === "flat") {
            if (!flatValue || isNaN(parsedFlatValue) || parsedFlatValue <= 0) {
                return sendBadRequestResponse(res, "Flat value must be provided and > 0 for flat type");
            }
            finalFlatValue = parsedFlatValue;
        } else {
            if (!percentageValue || isNaN(parsedPercentageValue) || parsedPercentageValue <= 0 || parsedPercentageValue > 100) {
                return sendBadRequestResponse(res, "Percentage value must be between 1–100 for percentage type");
            }
            finalPercentageValue = parsedPercentageValue;
        }

        const existCoupon = await CouponModel.findOne({ code: code.toUpperCase() });
        if (existCoupon) {
            return sendBadRequestResponse(res, "Coupon code already exists");
        }

        let expiry;
        let day, month, year;

        if (expiryDate.includes("-")) {
            const parts = expiryDate.split("-");
            if (parts.length === 3) {
                day = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10) - 1;
                year = parseInt(parts[2], 10);
            }
        } else if (expiryDate.includes("/")) {
            const parts = expiryDate.split("/");
            if (parts.length === 3) {
                day = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10) - 1;
                year = parseInt(parts[2], 10);
            }
        }

        if (!day || !month || !year ||
            isNaN(day) || isNaN(month) || isNaN(year) ||
            day < 1 || day > 31 ||
            month < 0 || month > 11 ||
            year < 2024 || year > 2100) {
            return sendBadRequestResponse(res, "Invalid expiry date format. Please use DD-MM-YYYY format (e.g., 07-12-2025)");
        }

        expiry = new Date(year, month, day, 23, 59, 59, 999);

        if (isNaN(expiry.getTime())) {
            return sendBadRequestResponse(res, "Invalid expiry date");
        }

        if (expiry.getDate() !== day ||
            expiry.getMonth() !== month ||
            expiry.getFullYear() !== year) {
            return sendBadRequestResponse(res, "Invalid expiry date. Please provide a valid date");
        }

        if (expiry < new Date()) {
            return sendBadRequestResponse(res, "Expiry date cannot be in the past");
        }

        let couponImageUrl = null;

        if (couponImage) {
            console.log("Uploading image to S3:", couponImage);
            console.log("File details:", {
                originalname: couponImage.originalname,
                mimetype: couponImage.mimetype,
                size: couponImage.size
            });

            try {
                const uploaded = await uploadToS3(couponImage, "coupons");
                console.log("S3 upload response:", uploaded);

                if (uploaded && uploaded.url) {
                    couponImageUrl = uploaded.url;
                } else if (uploaded && uploaded.Location) {
                    couponImageUrl = uploaded.Location;
                } else if (uploaded && uploaded.key) {
                    couponImageUrl = `https://your-bucket.s3.amazonaws.com/${uploaded.key}`;
                } else if (typeof uploaded === 'string') {
                    couponImageUrl = uploaded;
                } else {
                    console.error("Unexpected S3 response structure:", uploaded);
                }

                console.log("Final image URL:", couponImageUrl);
            } catch (s3Error) {
                console.error("S3 upload error:", s3Error);
                return sendBadRequestResponse(res, "Failed to upload image to S3");
            }
        }

        const newCoupon = await CouponModel.create({
            code: code.toUpperCase().trim(),
            description: description.trim(),
            discountType,
            flatValue: finalFlatValue,
            percentageValue: finalPercentageValue,
            minOrderValue: parsedMinOrderValue,
            expiryDate: expiry,
            isActive: isActive !== undefined ? (isActive === "true" || isActive === true) : true,
            couponImage: couponImageUrl,
        });

        console.log("Coupon created with image URL:", couponImageUrl);

        return sendSuccessResponse(res, "Coupon created successfully", newCoupon);
    } catch (error) {
        console.error("Error while creating coupon:", error.message);
        console.error("Full error stack:", error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return sendErrorResponse(res, 400, "Validation Error", messages.join(', '));
        }

        return sendErrorResponse(res, 500, "Error while creating coupon", error.message);
    }
};

export const getAllCoupon = async (req, res) => {
    try {
        const coupons = await CouponModel.find({
            isActive: true,
            expiryDate: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!coupons || coupons.length === 0) {
            return sendNotFoundResponse(res, "No active coupons found!");
        }

        return sendSuccessResponse(res, "Active coupons fetched successfully", coupons);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const getCouponById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID");
        }

        const coupon = await CouponModel.findById(id);
        if (!coupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        return sendSuccessResponse(res, "Coupon fetched successfully", coupon);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const couponImage = req.file;
        const {
            code,
            description,
            discountType,
            flatValue,
            percentageValue,
            minOrderValue,
            expiryDate,
            isActive,
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID!");
        }

        let coupon = await CouponModel.findOne({ _id: id });
        if (!coupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        if (code && code !== coupon.code) {
            const existCoupon = await CouponModel.findOne({
                code: code.toUpperCase(),
                _id: { $ne: id },
            });
            if (existCoupon) {
                return sendBadRequestResponse(res, "Coupon code already exists");
            }
            coupon.code = code.toUpperCase();
        }

        if (description) coupon.description = description;
        if (minOrderValue !== undefined) coupon.minOrderValue = minOrderValue;
        if (isActive !== undefined) coupon.isActive = isActive;

        if (discountType) {
            if (!["flat", "percentage"].includes(discountType)) {
                return sendBadRequestResponse(res, "Discount type must be either 'flat' or 'percentage'");
            }
            coupon.discountType = discountType;
        }

        let finalFlatValue = flatValue !== undefined ? parseFloat(flatValue) : coupon.flatValue;
        let finalPercentageValue = percentageValue !== undefined ? parseFloat(percentageValue) : coupon.percentageValue;

        if (discountType || flatValue !== undefined || percentageValue !== undefined) {
            const type = discountType || coupon.discountType;

            if (type === "flat") {
                if (flatValue !== undefined && (isNaN(finalFlatValue) || finalFlatValue <= 0)) {
                    return sendBadRequestResponse(res, "Flat value must be greater than 0");
                }
                coupon.percentageValue = 0;
                if (flatValue !== undefined) coupon.flatValue = finalFlatValue;
            } else if (type === "percentage") {
                if (percentageValue !== undefined && (isNaN(finalPercentageValue) || finalPercentageValue <= 0 || finalPercentageValue > 100)) {
                    return sendBadRequestResponse(res, "Percentage value must be between 1 and 100");
                }
                coupon.flatValue = 0;
                if (percentageValue !== undefined) coupon.percentageValue = finalPercentageValue;
            }
        }

        if (expiryDate) {
            let expiry;
            let day, month, year;

            if (expiryDate.includes("-")) {
                const parts = expiryDate.split("-");
                if (parts.length === 3) {
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = parseInt(parts[2], 10);
                }
            } else if (expiryDate.includes("/")) {
                const parts = expiryDate.split("/");
                if (parts.length === 3) {
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = parseInt(parts[2], 10);
                }
            }

            if (!day || !month || !year ||
                isNaN(day) || isNaN(month) || isNaN(year) ||
                day < 1 || day > 31 ||
                month < 0 || month > 11 ||
                year < 2024 || year > 2100) {
                return sendBadRequestResponse(res, "Invalid expiry date format. Please use DD-MM-YYYY format");
            }

            expiry = new Date(year, month, day, 23, 59, 59, 999);

            if (isNaN(expiry.getTime())) {
                return sendBadRequestResponse(res, "Invalid expiry date");
            }

            if (expiry.getDate() !== day ||
                expiry.getMonth() !== month ||
                expiry.getFullYear() !== year) {
                return sendBadRequestResponse(res, "Invalid expiry date. Please provide a valid date");
            }

            if (expiry < new Date()) {
                return sendBadRequestResponse(res, "Expiry date cannot be in the past");
            }

            coupon.expiryDate = expiry;
        }

        if (couponImage) {
            let img = null;

            if (coupon.couponImage) {
                const key = coupon.couponImage.split(".amazonaws.com/")[1];
                img = await updateS3(key, couponImage);
            } else {
                const uploaded = await uploadToS3(couponImage, "coupons");
                if (uploaded && uploaded.url) {
                    img = uploaded.url;
                } else if (uploaded && uploaded.Location) {
                    img = uploaded.Location;
                } else if (typeof uploaded === 'string') {
                    img = uploaded;
                }
            }

            coupon.couponImage = img;
        }

        await coupon.save();

        return sendSuccessResponse(res, "Coupon updated successfully!", coupon);
    } catch (error) {
        console.error("Error updating coupon:", error);
        return sendErrorResponse(res, 500, "Error updating coupon", error.message);
    }
};

export const deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Coupon ID!");
        }

        const coupon = await CouponModel.findByIdAndDelete({ _id: id });

        if (!coupon) {
            return sendNotFoundResponse(res, "Coupon not found!");
        }

        if (coupon.couponImage) {
            const key = String(coupon.couponImage).split(".amazonaws.com/")[1];
            await deleteFromS3(key);
        }

        return sendSuccessResponse(res, "Coupon deleted successfully!", coupon);
    } catch (error) {
        console.error("Error deleting coupon:", error.message);
        return sendErrorResponse(res, 500, "Error deleting coupon", error);
    }
};

export const applyCouponController = async (req, res) => {
    try {
        const { code } = req.body;
        const { id: userId } = req.user;

        if (!code) {
            return sendBadRequestResponse(res, "Coupon code is required");
        }

        const cart = await cartModel.findOne({ userId })
            .populate({
                path: "items.productId",
                model: "Product",
                select: "productName title description isActive productDetails shippingReturn rating brand mainCategory category subCategory",
                populate: [
                    {
                        path: "brand",
                        model: "Brand",
                        select: "brandName brandImage",
                    },
                    {
                        path: "mainCategory",
                        model: "MainCategory",
                        select: "mainCategoryName mainCategoryImage",
                    },
                    {
                        path: "category",
                        model: "Category",
                        select: "categoryName categoryImage",
                    },
                    {
                        path: "subCategory",
                        model: "SubCategory",
                        select: "subCategoryName subCategoryImage",
                    },
                ],
            })
            .populate({
                path: "items.productVarientId",
                model: "ProductVariant",
                select: "color images sku Artical_Number",
            });

        if (!cart) {
            return sendNotFoundResponse(res, "Cart not found");
        }

        if (cart.items.length === 0) {
            return sendBadRequestResponse(res, "Cart is empty. Add products to apply coupon.");
        }

        let cartTotal = 0;
        cart.items.forEach((item) => {
            const variant = item.productVarientId;

            if (variant?.color?.sizes && variant.color.sizes.length > 0 && item.selectedSize) {
                const selectedSizeObj = variant.color.sizes.find(size => size.sizeValue === item.selectedSize);
                if (selectedSizeObj) {
                    const effectivePrice = selectedSizeObj.discountedPrice && selectedSizeObj.discountedPrice > 0 ? selectedSizeObj.discountedPrice : selectedSizeObj.price;
                    cartTotal += effectivePrice * item.quantity;
                }
            } else if (variant?.color) {
                const effectivePrice = variant.color.discountedPrice && variant.color.discountedPrice > 0 ? variant.color.discountedPrice : variant.color.price;
                cartTotal += effectivePrice * item.quantity;
            }
        });

        const coupon = await CouponModel.findOne({
            code: code.toUpperCase(),
            isActive: true
        });

        if (!coupon) {
            return sendNotFoundResponse(res, "Invalid or inactive coupon");
        }

        if (coupon.expiryDate < new Date()) {
            return sendBadRequestResponse(res, "Coupon has expired");
        }

        if (cartTotal < coupon.minOrderValue) {
            return sendBadRequestResponse(res, `Minimum order value for this coupon is $${coupon.minOrderValue}`);
        }

        let discount = 0;
        let finalAmount = cartTotal;

        if (coupon.discountType === "percentage") {
            discount = (cartTotal * coupon.percentageValue) / 100;
        } else if (coupon.discountType === "flat") {
            discount = coupon.flatValue;
        }

        if (discount > cartTotal) {
            discount = cartTotal;
        }

        finalAmount = cartTotal - discount;

        cart.appliedCoupon = {
            code: coupon.code,
            couponId: coupon._id,
            discount: discount,
            discountType: coupon.discountType,
            percentageValue: coupon.percentageValue,
            flatValue: coupon.flatValue,
            originalAmount: cartTotal,
            finalAmount: finalAmount
        };

        await cart.save();

        return sendSuccessResponse(res, "Coupon applied successfully", {
            cartId: cart._id,
            items: cart.items,
            appliedCoupon: cart.appliedCoupon,
            originalAmount: cartTotal,
            discount,
            finalAmount,
            discountType: coupon.discountType,
            percentageValue: coupon.percentageValue,
            flatValue: coupon.flatValue,
            minOrderValue: coupon.minOrderValue,
            expiryDate: coupon.expiryDate,
            orderInstruction: cart.orderInstruction,
            isGiftWrap: cart.isGiftWrap
        });

    } catch (error) {
        console.error("applyCouponController error:", error);
        return sendErrorResponse(res, 500, "Error applying coupon", error.message);
    }
};

export const removeCouponController = async (req, res) => {
    try {
        const { id: userId } = req.user;

        const cart = await cartModel.findOne({ userId })
            .populate({
                path: "items.productId",
                model: "Product",
                select: "productName title description isActive productDetails shippingReturn rating brand mainCategory category subCategory",
                populate: [
                    {
                        path: "brand",
                        model: "Brand",
                        select: "brandName brandImage",
                    },
                    {
                        path: "mainCategory",
                        model: "MainCategory",
                        select: "mainCategoryName mainCategoryImage",
                    },
                    {
                        path: "category",
                        model: "Category",
                        select: "categoryName categoryImage",
                    },
                    {
                        path: "subCategory",
                        model: "SubCategory",
                        select: "subCategoryName subCategoryImage",
                    },
                ],
            })
            .populate({
                path: "items.productVarientId",
                model: "ProductVariant",
                select: "color images sku Artical_Number",
            });

        if (!cart) {
            return sendNotFoundResponse(res, "Cart not found");
        }

        let cartTotal = 0;
        cart.items.forEach((item) => {
            const variant = item.productVarientId;

            if (variant?.color?.sizes && variant.color.sizes.length > 0 && item.selectedSize) {
                const selectedSizeObj = variant.color.sizes.find(size => size.sizeValue === item.selectedSize);
                if (selectedSizeObj) {
                    const effectivePrice = selectedSizeObj.discountedPrice && selectedSizeObj.discountedPrice > 0 ? selectedSizeObj.discountedPrice : selectedSizeObj.price;
                    cartTotal += effectivePrice * item.quantity;
                }
            } else if (variant?.color) {
                const effectivePrice = variant.color.discountedPrice && variant.color.discountedPrice > 0 ? variant.color.discountedPrice : variant.color.price;
                cartTotal += effectivePrice * item.quantity;
            }
        });

        const removedCoupon = cart.appliedCoupon;
        cart.appliedCoupon = undefined;
        await cart.save();

        return sendSuccessResponse(res, "Coupon removed successfully", {
            cartId: cart._id,
            items: cart.items,
            originalAmount: cartTotal,
            finalAmount: cartTotal,
            discount: 0,
            removedCoupon: removedCoupon,
            orderInstruction: cart.orderInstruction,
            isGiftWrap: cart.isGiftWrap
        });

    } catch (error) {
        console.error("removeCouponController error:", error);
        return sendErrorResponse(res, 500, "Error removing coupon", error.message);
    }
};