import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },

    overallRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        validate: { validator: Number.isInteger, message: 'Rating must be an integer between 1-5' }
    },

    comment: { type: String, trim: true, maxlength: 1000, default: "" },
}, { timestamps: true });

reviewSchema.index({ productId: 1, userId: 1 }, { unique: true }); // One review per product per user

reviewSchema.statics.getProductRatingStats = async function (productId) {
    const result = await this.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(productId) } },
        {
            $group: {
                _id: null,
                averageRating: { $avg: "$overallRating" },
                totalReviews: { $sum: 1 }
            }
        }
    ]);
    return {
        averageRating: result.length ? Math.round(result[0].averageRating * 10) / 10 : 0,
        totalReviews: result.length ? result[0].totalReviews : 0
    };
};

export default mongoose.model("Review", reviewSchema);