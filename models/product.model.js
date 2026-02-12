import mongoose from "mongoose";

const galleryImage = new mongoose.Schema({
    gImage: { type: String, default: null },
    gImageKey: { type: String, default: null }
});

// 1. Base Product Schema (Common Fields)
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

    // Common Image Fields
    image: { type: String, default: null },
    imageKey: { type: String, default: null },
    // gImage removed from base, specific to Food now as per request

    price: { type: Number, required: true, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    inStock: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true },
    rating: { type: Number, default: 0 }

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

// 2. Grocery Product Schema
const GroceryProduct = ProductModel.discriminator('grocery', new mongoose.Schema({
    // Grocery specific fields
    brand: {
        type: mongoose.Types.ObjectId,
        ref: "brand",
        default: null
    },
    discountedPrice: { type: Number, default: 0 }, // Specific to Grocery
    manufacturer: { type: String, default: null },
    soldBy: { type: String, default: null },
    netQty: { type: String, default: null },
    productType: { type: String, default: null }, // Renamed from typeOfProduct
    disclaimer: { type: String, default: null },
    customerCareDetails: { type: String, default: null },
    // User explicitly said "image nathi" for grocery, so no image field here.
}));

// 3. Food Delivery Product Schema
const FoodDeliveryProduct = ProductModel.discriminator('delivery', new mongoose.Schema({
    // Food specific fields
    // gImage removed

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