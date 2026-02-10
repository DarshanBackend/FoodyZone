import mongoose from "mongoose";

const galleryImage = new mongoose.Schema({
    gImage: { type: String, default: null },
    gImageKey: { type: String, default: null }
});

// For different pack sizes
const packSizeSchema = new mongoose.Schema({
    weight: { type: Number, required: true },        // 250, 350, 500
    unit: {
        type: String,
        enum: ["g", "kg", "ml", "l", "pc"],
        required: true
    },
    price: { type: Number, required: true, min: 0 }, // Price for this pack
    stock: { type: Number, default: 0, min: 0 }      // Available units of this pack
});

const productSchema = new mongoose.Schema({
    productName: { type: String, default: null },

    category: {
        type: mongoose.Types.ObjectId,
        ref: "category",
        required: [true, "category ref id is required"],
    },
    sellerId: {
        type: mongoose.Types.ObjectId,
        ref: "seller",
        required: [true, "seller id is required"]
    },
    inStock: { type: Boolean, default: true }, // automatically update when stock changes

    // Base product pricing (optional, can be used as reference)
    price: { type: Number, default: null },
    originalPrice: { type: Number, default: null },
    discount: { type: Number, default: null },

    // Admin-side: total stock with unit
    totalQuantity: {
        value: { type: Number, required: true, min: 0 }, // e.g., 5
        unit: {
            type: String,
            enum: ["g", "kg", "ml", "l", "pc"],
            required: true
        }
    },
    soldCount: { type: Number, default: 0 },

    // User-side: available pack sizes
    packSizes: [packSizeSchema],

    // Product Type for delivery/grocery separation
    productType: {
        type: String,
        enum: ["delivery", "grocery"],
        default: "delivery"
    },

    productDesc: { type: String, default: null },

    productImage: { type: String, default: null },
    productImageKey: { type: String, default: null },
    gImage: [galleryImage],

    productHealthBenefit: { type: String, default: null },
    productStorage: { type: String, default: null },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

const productModel = mongoose.model("product", productSchema);

export default productModel;