import mongoose from "mongoose";

const restaurantReviewSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'restaurant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        validate: { validator: Number.isInteger, message: 'Rating must be an integer between 1-5' }
    },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }]
}, { timestamps: true, versionKey: false });

restaurantReviewSchema.index({ restaurantId: 1, userId: 1 }, { unique: true });

export default mongoose.model("RestaurantReview", restaurantReviewSchema);
