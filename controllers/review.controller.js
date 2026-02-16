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

        const existingReview = await Review.findOne({ productId, userId });
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

        if (!mongoose.Types.ObjectId.isValid(reviewId)) return sendBadRequestResponse(res, "Invalid review ID!");
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return sendBadRequestResponse(res, "Invalid user ID!");

        const review = await Review.findOne({ _id: reviewId, userId });
        if (!review) return sendNotFoundResponse(res, "Review not found or unauthorized!");

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
        if (rating) query.overallRating = Number(rating);

        const skip = (Number(page) - 1) * Number(limit);
        const sortOptions = sort === "latest" ? { createdAt: -1 } : { overallRating: -1 };

        const reviewsPromise = Review.find(query)
            .populate("userId", "fullName avatar")
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const totalPromise = Review.countDocuments(query);

        const statsPromise = Review.aggregate([
            { $match: { productId: new mongoose.Types.ObjectId(productId) } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: "$overallRating" },
                    totalReviews: { $sum: 1 },
                    distribution: { $push: "$overallRating" }
                }
            }
        ]);

        const [reviews, totalReviews, statsResult] = await Promise.all([reviewsPromise, totalPromise, statsPromise]);

        const stats = statsResult[0] || { averageRating: 0, totalReviews: 0, distribution: [] };

        const distributionCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        if (stats.distribution) {
            stats.distribution.forEach(r => {
                const key = Math.round(r);
                if (distributionCount[key] !== undefined) distributionCount[key]++;
            });
        }

        let userReview = null;
        if (req.user?._id) {
            const myReview = await Review.findOne({ productId, userId: req.user._id })
                .populate("userId", "fullName avatar")
                .lean();

            if (myReview) {
                userReview = {
                    _id: myReview._id,
                    rating: myReview.overallRating,
                    ratingText: getRatingText(myReview.overallRating),
                    comment: myReview.comment,
                    createdAt: myReview.createdAt,
                    user: {
                        name: myReview.userId?.fullName || "Anonymous",
                        avatar: myReview.userId?.avatar || null
                    },
                    likesCount: myReview.likes ? myReview.likes.length : 0,
                    dislikesCount: myReview.dislikes ? myReview.dislikes.length : 0,
                    isLiked: req.user?._id && myReview.likes ? myReview.likes.map(id => id.toString()).includes(req.user._id.toString()) : false,
                    isDisliked: req.user?._id && myReview.dislikes ? myReview.dislikes.map(id => id.toString()).includes(req.user._id.toString()) : false
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
                name: r.userId?.fullName || "Anonymous",
                avatar: r.userId?.avatar || null
            },
            likesCount: r.likes ? r.likes.length : 0,
            dislikesCount: r.dislikes ? r.dislikes.length : 0,
            isLiked: req.user?._id && r.likes ? r.likes.map(id => id.toString()).includes(req.user._id.toString()) : false,
            isDisliked: req.user?._id && r.dislikes ? r.dislikes.map(id => id.toString()).includes(req.user._id.toString()) : false
        }));

        const response = {
            summary: {
                average: stats.averageRating ? Number(stats.averageRating.toFixed(1)) : 0,
                totalGlobalReviews: stats.totalReviews,
                distribution: distributionCount,
                filteredTotal: totalReviews
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
            .populate("userId", "fullName avatar")
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
                        name: review.userId?.fullName || "Anonymous",
                        avatar: review.userId?.avatar || null
                    },
                    likesCount: review.likes ? review.likes.length : 0,
                    dislikesCount: review.dislikes ? review.dislikes.length : 0,
                    isLiked: userId && review.likes ? review.likes.map(id => id.toString()).includes(userId.toString()) : false,
                    isDisliked: userId && review.dislikes ? review.dislikes.map(id => id.toString()).includes(userId.toString()) : false
                }
            });
        }

        return sendSuccessResponse(res, "No review found", { hasReviewed: false, review: null });

    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const likeReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) return sendBadRequestResponse(res, "Invalid review ID!");

        const review = await Review.findById(reviewId);
        if (!review) return sendNotFoundResponse(res, "Review not found!");

        if (review.dislikes.includes(userId)) return sendBadRequestResponse(res, "You cannot like a review you already disliked!");

        if (review.likes.includes(userId)) review.likes.pull(userId);
        else review.likes.push(userId);

        await review.save();

        return sendSuccessResponse(res, "Review like updated successfully!", {
            likes: review.likes.length,
            dislikes: review.dislikes.length
        });

    } catch (err) {
        return ThrowError(res, 500, err.message);
    }
};

export const dislikeReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) return sendBadRequestResponse(res, "Invalid review ID!");

        const review = await Review.findById(reviewId);
        if (!review) return sendNotFoundResponse(res, "Review not found!");

        if (review.likes.includes(userId)) return sendBadRequestResponse(res, "You cannot dislike a review you already liked!");

        if (review.dislikes.includes(userId)) review.dislikes.pull(userId);
        else review.dislikes.push(userId);

        await review.save();

        return sendSuccessResponse(res, "Review dislike updated successfully!", {
            likes: review.likes.length,
            dislikes: review.dislikes.length
        });

    } catch (err) {
        return ThrowError(res, 500, err.message);
    }
};