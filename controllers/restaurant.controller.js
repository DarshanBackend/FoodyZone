import mongoose from "mongoose";
import restaurantModel from "../models/restaurant.model.js";
import { checkRequired, sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

export const createRestaurant = async (req, res) => {
    try {
        const { title, description, time, delivery, option, off, categoryId } = req.body;
        const { _id } = req.user;

        const files = req.files || {};
        const restaurantImage = files.restaurantImage ? files.restaurantImage[0] : null;
        const gImageFile = files.gImage ? files.gImage[0] : null;

        if (!title) {
            return sendBadRequestResponse(res, "Title is required");
        }

        const existingRestaurant = await restaurantModel.findOne({ title: title });
        if (existingRestaurant) {
            return sendBadRequestResponse(res, "Restaurant with this title already exists");
        }
        if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
            return sendBadRequestResponse(res, "Valid Category ID is required");
        }
        if (!restaurantImage) {
            return sendBadRequestResponse(res, "Restaurant Image is required");
        }

        let img = await uploadToS3(restaurantImage, "restaurants");

        let gImage = null;
        let gImageKey = null;
        if (gImageFile) {
            gImage = await uploadToS3(gImageFile, "restaurants/gallery");
            gImageKey = gImage.split(".amazonaws.com/")[1];
        }

        const restaurantData = {
            title,
            image: img,
            gImage,
            gImageKey,
            description: description || null,
            time: time || null,
            delivery: delivery || null,
            option: option || null,
            off: off || null,
            categoryId,
            sellerId: _id
        };

        const restaurant = await restaurantModel.create(restaurantData);

        return sendSuccessResponse(res, "Restaurant created successfully", restaurant);

    } catch (error) {
        return sendErrorResponse(res, 500, "Error while creating restaurant", error);
    }
};

export const getAllRestaurants = async (req, res) => {
    try {
        const { categoryId } = req.query;
        let filter = { isActive: true };

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            filter.categoryId = categoryId;
        }

        const restaurants = await restaurantModel.find(filter)
            .populate("categoryId", "name image")
            .populate("sellerId", "firstName mobileNo email")
            .sort({ createdAt: -1 });

        return sendSuccessResponse(res, "Restaurants fetched successfully", {
            total: restaurants.length,
            restaurants
        });

    } catch (error) {
        return sendErrorResponse(res, 500, "Error while fetching all restaurants", error);
    }
};

export const getRestaurantById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid restaurant ID");
        }

        const restaurant = await restaurantModel.findById(id)
            .populate("categoryId", "name image")
            .populate("sellerId", "firstName mobileNo email");

        if (!restaurant) {
            return sendErrorResponse(res, 404, "Restaurant not found");
        }

        return sendSuccessResponse(res, "Restaurant fetched successfully", restaurant);

    } catch (error) {
        return sendErrorResponse(res, 500, "Error while fetching restaurant", error);
    }
};

export const updateRestaurant = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, time, delivery, option, off, rating, categoryId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid restaurant ID");
        }

        let restaurant = await restaurantModel.findById(id);
        if (!restaurant) {
            return sendErrorResponse(res, 404, "Restaurant not found");
        }

        if (req.user.role === 'seller' && String(restaurant.sellerId) !== String(req.user._id)) {
            return sendErrorResponse(res, 403, "You can only update your own restaurant");
        }

        const files = req.files || {};
        const restaurantImageFile = files.restaurantImage ? files.restaurantImage[0] : null;
        const gImageFile = files.gImage ? files.gImage[0] : null;

        let img = restaurant.image;
        if (restaurantImageFile) {
            if (restaurant.image) {
                const key = restaurant.image.split(".amazonaws.com/")[1];
                if (key) {
                    img = await updateS3(key, restaurantImageFile, "restaurants");
                } else {
                    img = await uploadToS3(restaurantImageFile, "restaurants");
                }
            } else {
                img = await uploadToS3(restaurantImageFile, "restaurants");
            }
        }

        let gImage = restaurant.gImage;
        let gImageKey = restaurant.gImageKey;

        if (gImageFile) {
            if (restaurant.gImageKey) {
                gImage = await updateS3(restaurant.gImageKey, gImageFile, "restaurants/gallery");
                gImageKey = gImage.split(".amazonaws.com/")[1];
            } else {
                gImage = await uploadToS3(gImageFile, "restaurants/gallery");
                gImageKey = gImage.split(".amazonaws.com/")[1];
            }
        }

        restaurant.title = title || restaurant.title;
        restaurant.image = img;
        restaurant.gImage = gImage;
        restaurant.gImageKey = gImageKey;

        restaurant.description = description || restaurant.description;
        restaurant.time = time || restaurant.time;
        restaurant.delivery = delivery || restaurant.delivery;
        restaurant.option = option || restaurant.option;
        restaurant.off = off || restaurant.off;
        restaurant.rating = rating !== undefined ? Number(rating) : restaurant.rating;

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            restaurant.categoryId = categoryId;
        }

        await restaurant.save();

        return sendSuccessResponse(res, "Restaurant updated successfully", restaurant);

    } catch (error) {
        return sendErrorResponse(res, 500, "Error while updating restaurant", error);
    }
};

export const deleteRestaurant = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid restaurant ID");
        }

        const restaurant = await restaurantModel.findById(id);

        if (!restaurant) {
            return sendErrorResponse(res, 404, "Restaurant not found");
        }

        if (req.user.role === 'seller' && String(restaurant.sellerId) !== String(req.user._id)) {
            return sendErrorResponse(res, 403, "You can only delete your own restaurant");
        }

        await restaurantModel.findByIdAndDelete(id);

        if (restaurant.image) {
            const key = String(restaurant.image).split(".amazonaws.com/")[1];
            await deleteFromS3(key);
        }

        if (restaurant.gImageKey) {
            await deleteFromS3(restaurant.gImageKey);
        } else if (restaurant.gImage) {
            const key = String(restaurant.gImage).split(".amazonaws.com/")[1];
            if (key) await deleteFromS3(key);
        }

        return sendSuccessResponse(res, "Restaurant deleted successfully", restaurant);

    } catch (error) {
        return sendErrorResponse(res, 500, "Error while deleting restaurant", error);
    }
};

export const searchRestaurants = async (req, res) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;
        if (!q) {
            return sendBadRequestResponse(res, "Query parameter 'q' is required");
        }

        const skip = (page - 1) * limit;

        const result = await restaurantModel.find({
            title: { $regex: q, $options: "i" },
            isActive: true
        })
            .populate("categoryId", "name")
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 });

        return sendSuccessResponse(res, "Search results fetched successfully", {
            total: result.length,
            result
        });
    } catch (error) {
        return sendErrorResponse(res, 500, "Error while searching restaurants", error);
    }
}
