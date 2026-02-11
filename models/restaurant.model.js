import mongoose from "mongoose";

const restaurantSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Restaurant title is required"],
        trim: true
    },
    image: {
        type: String,
        default: null
    },
    gImage: {
        type: String,
        default: null
    },
    gImageKey: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: null
    },
    time: {
        type: String,
        default: null
    },
    delivery: {
        type: String,
        default: null
    },
    option: {
        type: String,
        default: null
    },
    off: {
        type: String,
        default: null
    },
    rating: {
        type: Number,
        default: 0
    },
    categoryId: {
        type: mongoose.Types.ObjectId,
        ref: "category",
        required: [true, "Category ID is required"]
    },
    sellerId: {
        type: mongoose.Types.ObjectId,
        ref: "seller",
        required: [true, "Seller ID is required"]
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            delete ret.gImageKey;
            return ret;
        }
    }
});

const restaurantModel = mongoose.model("restaurant", restaurantSchema);

export default restaurantModel;
