import mongoose from 'mongoose';
import 'dotenv/config';
import categoryModel from '../models/category.model.js';
import sellerModel from '../models/seller.model.js';
import productModel from '../models/product.model.js';
import userModel from '../models/user.model.js';

const fixUrls = async () => {
    try {
        await mongoose.connect(process.env.DB_URL);
        console.log('Connected to DB');

        const oldRegion = 'ap-south-1';
        const newRegion = 'eu-north-1';

        // Category
        const categories = await categoryModel.find({ image: { $regex: oldRegion } });
        for (const cat of categories) {
            cat.image = cat.image.replace(oldRegion, newRegion);
            await cat.save();
            console.log(`Updated Category ${cat._id}`);
        }

        // Seller
        const sellers = await sellerModel.find({ avatar: { $regex: oldRegion } });
        for (const sel of sellers) {
            sel.avatar = sel.avatar.replace(oldRegion, newRegion);
            await sel.save();
            console.log(`Updated Seller ${sel._id}`);
        }

        // User
        const users = await userModel.find({ avatar: { $regex: oldRegion } });
        for (const usr of users) {
            usr.avatar = usr.avatar.replace(oldRegion, newRegion);
            await usr.save();
            console.log(`Updated User ${usr._id}`);
        }

        // Product
        const products = await productModel.find({});
        for (const prod of products) {
            let changed = false;

            if (prod.productImage && prod.productImage.includes(oldRegion)) {
                prod.productImage = prod.productImage.replace(oldRegion, newRegion);
                changed = true;
            }

            // Check gImage array which contains objects { gImage: string, ... }
            if (prod.gImage && prod.gImage.length > 0) {
                prod.gImage.forEach(imgObj => {
                    if (imgObj.gImage && imgObj.gImage.includes(oldRegion)) {
                        imgObj.gImage = imgObj.gImage.replace(oldRegion, newRegion);
                        changed = true;
                    }
                });
            }

            if (changed) {
                await prod.save();
                console.log(`Updated Product ${prod._id}`);
            }
        }

        console.log('Done');
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixUrls();
