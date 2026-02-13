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
        const { productId, overallRating, comment } = req.body;
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

        // Check if user already reviewed this product
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

        const query = { productId: new mongoose.Types.ObjectId(productId) };
        if (rating) {
            query.overallRating = Number(rating);
        }

        // 1. Get filtered reviews with pagination
        const skip = (Number(page) - 1) * Number(limit);
        const sortOptions = sort === "latest" ? { createdAt: -1 } : { overallRating: -1 };

        const reviewsPromise = Review.find(query)
            .populate("userId", "name avatar")
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit))
            .lean();

        // 2. Get Total count for pagination
        const totalPromise = Review.countDocuments(query);

        // 3. Get Stats (Average & Distribution) - UNFILTERED (always shows global stats)
        const statsPromise = Review.aggregate([
            { $match: { productId: new mongoose.Types.ObjectId(productId) } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: "$overallRating" },
                    totalReviews: { $sum: 1 },
                    distribution: {
                        $push: "$overallRating"
                    }
                }
            }
        ]);

        const [reviews, totalReviews, statsResult] = await Promise.all([
            reviewsPromise,
            totalPromise,
            statsPromise
        ]);

        // Process Stats
        const stats = statsResult[0] || { averageRating: 0, totalReviews: 0, distribution: [] };

        const distributionCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        if (stats.distribution) {
            stats.distribution.forEach(r => {
                const key = Math.round(r);
                if (distributionCount[key] !== undefined) distributionCount[key]++;
            });
        }

        // Check if current logged-in user has reviewed
        let userReview = null;
        if (req.user?._id) {
            const myReview = await Review.findOne({ productId, userId: req.user._id })
                .populate("userId", "name avatar")
                .lean();

            if (myReview) {
                userReview = {
                    _id: myReview._id,
                    rating: myReview.overallRating,
                    ratingText: getRatingText(myReview.overallRating),
                    comment: myReview.comment,
                    createdAt: myReview.createdAt,
                    user: {
                        name: myReview.userId?.name || "Anonymous",
                        avatar: myReview.userId?.avatar || null
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

        const response = {
            summary: {
                average: stats.averageRating ? Number(stats.averageRating.toFixed(1)) : 0,
                totalGlobalReviews: stats.totalReviews, // Total reviews irrespective of filter
                distribution: distributionCount,
                filteredTotal: totalReviews // Total reviews matching current filter
            },
            reviews: formattedReviews,
            userReview,
            hasUserReviewed: !!userReview,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(totalReviews / Number(limit)),
                totalReviews: totalReviews,
                hasNext: (skip + reviews.length) < totalReviews,
                hasPrev: Number(page) > 1
            }
        };

        return sendSuccessResponse(res, "Reviews fetched successfully", response);

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
            return sendBadRequestResponse(res, "Invalid product ID");
        }
        if (!userId) {
            return sendBadRequestResponse(res, "User authentication required");
        }

        const review = await Review.findOne({ productId, userId })
            .populate("userId", "name avatar")
            .lean();

        if (review) {
            return sendSuccessResponse(res, "Review found", {
                hasReviewed: true,
                review: {
                    _id: review._id,
                    rating: review.overallRating,
                    ratingText: getRatingText(review.overallRating),
                    comment: review.comment,
                    createdAt: review.createdAt,
                    user: {
                        name: review.userId?.name || "Anonymous",
                        avatar: review.userId?.avatar || null
                    }
                }
            });
        }

        return sendSuccessResponse(res, "No review found", {
            hasReviewed: false,
            review: null
        });

    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};