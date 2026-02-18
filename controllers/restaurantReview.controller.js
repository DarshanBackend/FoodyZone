import RestaurantReview from '../models/restaurantReview.model.js';
import Restaurant from '../models/restaurant.model.js';
import mongoose from 'mongoose';
import { ThrowError } from '../utils/Error.utils.js';
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse } from '../utils/response.utils.js';

const updateRestaurantRating = async (restaurantId) => {
    try {
        const stats = await RestaurantReview.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: "$rating" }
                }
            }
        ]);

        const averageRating = stats.length ? Math.round(stats[0].averageRating * 10) / 10 : 0;

        await Restaurant.findByIdAndUpdate(restaurantId, { rating: averageRating });
    } catch (error) {
        console.error("Error updating restaurant rating:", error);
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

export const addRestaurantReview = async (req, res) => {
    try {
        const { restaurantId, rating, comment } = req.body;
        const userId = req.user?._id;

        if (!userId) return sendBadRequestResponse(res, "Login required");
        if (!restaurantId || !rating) return sendBadRequestResponse(res, "Restaurant ID and Rating are required");

        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return sendBadRequestResponse(res, "Invalid Restaurant ID");

        const existingReview = await RestaurantReview.findOne({ restaurantId, userId });
        if (existingReview) return sendBadRequestResponse(res, "You have already reviewed this restaurant");

        const numRating = Number(rating);
        if (isNaN(numRating) || numRating < 1 || numRating > 5) return sendBadRequestResponse(res, "Rating must be 1-5");

        const review = await RestaurantReview.create({
            restaurantId,
            userId,
            rating: numRating,
            comment
        });

        await updateRestaurantRating(restaurantId);

        return sendSuccessResponse(res, "Review submitted", review);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const getRestaurantReviews = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { page = 1, limit = 10, sort = "latest", rating } = req.query;

        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return sendBadRequestResponse(res, "Invalid Restaurant ID");

        const query = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };
        if (rating) query.rating = Number(rating);

        const skip = (Number(page) - 1) * Number(limit);
        const sortOptions = sort === "latest" ? { createdAt: -1 } : { rating: -1 };

        const reviews = await RestaurantReview.find(query)
            .populate("userId", "fullName avatar")
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const totalReviews = await RestaurantReview.countDocuments(query);

        const stats = await RestaurantReview.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            { $group: { _id: null, avg: { $avg: "$rating" }, total: { $sum: 1 }, distribution: { $push: "$rating" } } }
        ]);

        const statData = stats[0] || { avg: 0, total: 0, distribution: [] };
        const distributionCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        statData.distribution.forEach(r => distributionCount[Math.round(r)] = (distributionCount[Math.round(r)] || 0) + 1);

        let userReview = null;
        if (req.user?._id) {
            userReview = await RestaurantReview.findOne({ restaurantId, userId: req.user._id }).populate("userId", "fullName avatar").lean();
        }

        const response = {
            summary: {
                average: Math.round(statData.avg * 10) / 10,
                totalGlobalReviews: statData.total,
                distribution: distributionCount,
                filteredTotal: totalReviews
            },
            reviews: reviews.map(r => ({
                ...r,
                ratingText: getRatingText(r.rating),
                user: { name: r.userId?.fullName || "Anonymous", avatar: r.userId?.avatar },
                likesCount: r.likes?.length || 0,
                dislikesCount: r.dislikes?.length || 0,
                isLiked: req.user?._id && r.likes?.map(id => id.toString()).includes(req.user._id.toString()),
                isDisliked: req.user?._id && r.dislikes?.map(id => id.toString()).includes(req.user._id.toString())
            })),
            userReview,
            hasUserReviewed: !!userReview,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                totalReviews,
                totalPages: Math.ceil(totalReviews / Number(limit))
            }
        };

        return sendSuccessResponse(res, "Reviews fetched", response);

    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const updateRestaurantReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user?._id;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) return sendBadRequestResponse(res, "Invalid review ID");

        const review = await RestaurantReview.findOne({ _id: reviewId, userId });
        if (!review) return sendNotFoundResponse(res, "Review not found");

        if (rating) {
            const numRating = Number(rating);
            if (isNaN(numRating) || numRating < 1 || numRating > 5) return sendBadRequestResponse(res, "Rating must be 1-5");
            review.rating = numRating;
        }

        if (comment !== undefined) review.comment = comment;

        await review.save();
        await updateRestaurantRating(review.restaurantId);

        return sendSuccessResponse(res, "Review updated", review);
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};

export const deleteRestaurantReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const review = await RestaurantReview.findByIdAndDelete(reviewId);
        if (!review) return sendNotFoundResponse(res, "Review not found");

        await updateRestaurantRating(review.restaurantId);
        return sendSuccessResponse(res, "Review deleted");
    } catch (error) {
        return ThrowError(res, 500, error.message);
    }
};