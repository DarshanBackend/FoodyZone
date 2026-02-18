import mongoose from "mongoose";

const galleryImage = new mongoose.Schema({
    gImage: { type: String, default: null },
    gImageKey: { type: String, default: null }
});

const baseProductSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: null },

    category: {
        type: mongoose.Types.ObjectId,
        ref: "category",
        required: [true, "Category is required"],
    },
    sellerId: {
        type: mongoose.Types.ObjectId,
        ref: "seller",
        required: [true, "Seller ID is required"]
    },

    image: { type: String, default: null },
    imageKey: { type: String, default: null },

    price: { type: Number, required: true, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    inStock: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true },
    rating: {
        average: { type: Number, default: 0 },
        totalReviews: { type: Number, default: 0 }
    }

}, {
    timestamps: true,
    discriminatorKey: 'docType',
    toJSON: {
        transform: function (doc, ret) {
            delete ret.docType;
            return ret;
        }
    }
});

const ProductModel = mongoose.model("product", baseProductSchema);

const GroceryProduct = ProductModel.discriminator('grocery', new mongoose.Schema({
    brand: {
        type: mongoose.Types.ObjectId,
        ref: "brand",
        default: null
    },
    discountedPrice: { type: Number, default: 0 },
    manufacturer: { type: String, default: null },
    soldBy: { type: String, default: null },
    netQty: { type: String, default: null },
    productType: { type: String, default: null },
    disclaimer: { type: String, default: null },
    customerCareDetails: { type: String, default: null },
}));

const FoodDeliveryProduct = ProductModel.discriminator('delivery', new mongoose.Schema({
    flavor: [{ type: String }],
    isVeg: { type: Boolean, default: true },

    restaurantId: {
        type: mongoose.Types.ObjectId,
        ref: "restaurant",
        default: null
    }
}));

export default ProductModel;
export { GroceryProduct, FoodDeliveryProduct };