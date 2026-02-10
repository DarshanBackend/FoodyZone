import Review from '../models/review.model.js';
import Product from '../models/product.model.js';
import mongoose from 'mongoose';
import { ThrowError } from '../utils/Error.utils.js';
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse } from '../utils/response.utils.js';

const updateProductRating = async (productId) => {
    try {
        const stats = await Review.aggregate([
            { $match: { productId: new mongoose.Types.ObjectId(productId) } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: "$overallRating" },
                    totalReviews: { $sum: 1 }
                }
            }
        ]);

        const result = stats.length ? stats[0] : { averageRating: 0, totalReviews: 0 };

        await Product.findByIdAndUpdate(productId, {
            rating: {
                average: Math.round(result.averageRating * 10) / 10,
                totalReviews: result.totalReviews
            }
        });
    } catch (error) {
        console.error("Error updating product rating:", error);
    }
};

const getRatingText = (rating) => {
    switch (Number(rating)) {
        case 1: return "Terrible";
        case 2: return "Bad";
        case 3: return "Okay";
        case 4: return "Good";
        case 5: return "Great";
        default: return "No Rating";
    }
};

export const createReview = async (req, res) => {
    try {
        const { productId, packSizeId, overallRating, comment } = req.body;
        const userId = req.user?._id;

        if (!productId || !overallRating) {
            return sendBadRequestResponse(res, "productId and overallRating are required!");
        }
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendBadRequestResponse(res, "Invalid or missing user ID. Please login first!");
        }
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return sendBadRequestResponse(res, "Invalid product ID!");
        }

        const existingReview = await Review.findOne({
            productId,
            userId
        });
        if (existingReview) {
            return sendBadRequestResponse(res, "You have already reviewed this product!");
        }

        const product = await Product.findById(productId);
        if (!product) return sendNotFoundResponse(res, "Product not found!");

        const rating = Number(overallRating);
        if (isNaN(rating) || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
            return sendBadRequestResponse(res, "Rating must be an integer between 1 and 5!");
        }

        const newReview = await Review.create({
            productId,
            packSizeId: packSizeId || null,
            userId,
            overallRating: rating,
            comment: comment || ""
        });

        await updateProductRating(productId);

        return sendSuccessResponse(res, "✅ Review submitted successfully!", newReview);

    } catch (error) {
        console.error("Create Review Error:", error);
        return ThrowError(res, 500, error.message);
    }
};

export const updateReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(reviewId))
            return sendBadRequestResponse(res, "Invalid review ID");

        const review = await Review.findOne({ _id: reviewId, userId });
        if (!review) return sendNotFoundResponse(res, "Review not found");

        if (req.body.overallRating !== undefined) {
            const rating = Number(req.body.overallRating);
            if (isNaN(rating) || rating < 1 || rating > 5 || !Number.isInteger(rating))
                return sendBadRequestResponse(res, "Rating must be an integer 1–5");
            review.overallRating = rating;
        }

        if (req.body.comment !== undefined) review.comment = req.body.comment;

        await review.save();

        await updateProductRating(review.productId);

        return sendSuccessResponse(res, "✅ Review updated successfully", review);
    } catch (err) {
        console.error("Update Review Error:", err);
        return ThrowError(res, 500, err.message);
    }
};

export const deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(reviewId))
            return sendBadRequestResponse(res, "Invalid review ID!");
        if (!userId || !mongoose.Types.ObjectId.isValid(userId))
            return sendBadRequestResponse(res, "Invalid user ID!");

        const review = await Review.findOne({ _id: reviewId, userId });
        if (!review)
            return sendNotFoundResponse(res, "Review not found or unauthorized!");

        await Review.findByIdAndDelete(reviewId);

        await updateProductRating(review.productId);

        return sendSuccessResponse(res, "✅ Review deleted successfully!");

    } catch (error) {
        console.error("Delete Review Error:", error);
        return ThrowError(res, 500, error.message);
    }
};

export const getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const { page = 1, limit = 10, sort = "latest", rating } = req.query;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return sendBadRequestResponse(res, "Invalid product ID!");
        }

        const query = { productId };

        if (rating) {
            query.overallRating = Number(rating);
        }

        const skip = (Number(page) - 1) * Number(limit);

        const reviews = await Review.find(query)
            .populate("userId", "name avatar")
            .sort(sort === "latest" ? { createdAt: -1 } : { overallRating: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const totalReviews = await Review.countDocuments(query);

        const distributionResult = await Review.aggregate([
            {
                $match: {
                    productId: new mongoose.Types.ObjectId(productId),
                    ...(rating && { overallRating: Number(rating) })
                }
            },
            {
                $group: {
                    _id: "$overallRating",
                    count: { $sum: 1 }
                }
            }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        distributionResult.forEach(item => {
            const ratingKey = Number(item._id);
            if ([1, 2, 3, 4, 5].includes(ratingKey)) {
                distribution[ratingKey] = item.count;
            }
        });

        const avgData = await Review.aggregate([
            {
                $match: {
                    productId: new mongoose.Types.ObjectId(productId),
                    ...(rating && { overallRating: Number(rating) })
                }
            },
            {
                $group: {
                    _id: null,
                    avg: { $avg: "$overallRating" },
                    total: { $sum: 1 }
                }
            }
        ]);

        const average = avgData.length > 0 ? Number(avgData[0].avg.toFixed(1)) : 0;

        let userReview = null;
        if (req.user && req.user._id) {
            const userReviewDoc = await Review.findOne({ productId, userId: req.user._id })
                .populate("userId", "name avatar")
                .lean();

            if (userReviewDoc) {
                userReview = {
                    _id: userReviewDoc._id,
                    rating: userReviewDoc.overallRating,
                    ratingText: getRatingText(userReviewDoc.overallRating),
                    comment: userReviewDoc.comment,
                    createdAt: userReviewDoc.createdAt,
                    user: {
                        name: userReviewDoc.userId?.name || "Anonymous",
                        avatar: userReviewDoc.userId?.avatar || null
                    }
                };
            }
        }

        const formattedReviews = reviews.map(r => ({
            _id: r._id,
            rating: r.overallRating,
            ratingText: getRatingText(r.overallRating),
            comment: r.comment,
            createdAt: r.createdAt,
            user: {
                name: r.userId?.name || "Anonymous",
                avatar: r.userId?.avatar || null
            }
        }));

        let filterInfo = [];
        if (rating) filterInfo.push(`${rating} star${rating > 1 ? 's' : ''}`);
        const filteredBy = filterInfo.length > 0 ? filterInfo.join(', ') : 'all reviews';

        const response = {
            summary: {
                average: average,
                totalReviews: totalReviews,
                distribution: distribution,
                filteredBy: filteredBy
            },
            reviews: formattedReviews,
            userReview: userReview,
            hasUserReviewed: !!userReview,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(totalReviews / Number(limit)),
                totalReviews: totalReviews,
                hasNext: (skip + Number(limit)) < totalReviews,
                hasPrev: Number(page) > 1
            }
        };

        return sendSuccessResponse(res, "Review data fetched successfully!", response);

    } catch (error) {
        console.error("Get Product Reviews Error:", error);
        return ThrowError(res, 500, error.message);
    }
};

export const checkUserReview = async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return sendBadRequestResponse(res, "Invalid product ID!");
        }

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendBadRequestResponse(res, "Invalid user ID!");
        }

        const userReview = await Review.findOne({
            productId,
            userId
        })
            .populate("userId", "name avatar")
            .lean();

        if (userReview) {
            const formattedReview = {
                _id: userReview._id,
                rating: userReview.overallRating,
                ratingText: getRatingText(userReview.overallRating),
                comment: userReview.comment,
                createdAt: userReview.createdAt,
                user: {
                    name: userReview.userId?.name || "Anonymous",
                    avatar: userReview.userId?.avatar || null
                }
            };

            return sendSuccessResponse(res, "User review found!", {
                hasReviewed: true,
                review: formattedReview
            });
        } else {
            return sendSuccessResponse(res, "User has not reviewed this product", {
                hasReviewed: false,
                review: null
            });
        }

    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};