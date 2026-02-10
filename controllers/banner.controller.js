import mongoose from "mongoose";
import bannerModel from "../models/banner.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, uploadToS3 } from "../utils/s3Service.js";

export const createHomeBanner = async (req, res) => {
  try {
    const { name } = req.body;
    const files = req.files;

    if (!name) {
      return sendBadRequestResponse(res, "Banner name is required");
    }

    if (!files || files.length === 0) {
      return sendBadRequestResponse(res, "Banner images required");
    }

    const uploadedBanners = [];

    for (const file of files) {
      const uploaded = await uploadToS3(file, "home-banners");
      uploadedBanners.push({ banner: uploaded });
    }

    const banner = await bannerModel.create({
      name,
      banner: uploadedBanners
    });

    return sendSuccessResponse(
      res,
      "Home banner created successfully",
      banner
    );
  } catch (error) {
    return sendErrorResponse(res, 500, "Error creating home banner", error);
  }
};

export const getHomeBanners = async (req, res) => {
  try {
    const banners = await bannerModel.find({});

    const response = {
      heroBanner: null,
      offerBanner: null
    };

    banners.forEach((item) => {
      if (item.name === "heroBanner") {
        response.heroBanner = item.banner;
      }

      if (item.name === "offerBanner") {
        response.offerBanner = item.banner;
      }
    });

    return sendSuccessResponse(
      res,
      "Home banners fetched successfully",
      response
    );
  } catch (error) {
    return sendErrorResponse(res, 500, "Error fetching home banners", error);
  }
};

export const getAllBanners = async (req, res) => {
  try {
    const banner = await bannerModel.find({});

    return sendSuccessResponse(res, "banner Fetched Successfullty", banner)
  } catch (error) {
    console.log("Error while Get ALl Banner", error);
    return sendErrorResponse(res, 500, "Error while Get ALl Banner", error)
  }
}

export const updateBannerByName = async (req, res) => {
  try {
    const { name } = req.params;
    const files = req.files;

    const banner = await bannerModel.findOne({ name });
    if (!banner)
      return sendBadRequestResponse(res, "Banner not found");

    if (files && files.length > 0) {
      for (const b of banner.banner) {
        const key = b.banner.split(".amazonaws.com/")[1];
        await deleteFromS3(key);
      }

      banner.banner = [];

      for (const file of files) {
        const uploaded = await uploadToS3(file, "home-banners");
        banner.banner.push({ banner: uploaded });
      }
    }

    await banner.save();

    return sendSuccessResponse(res, "Banner updated", banner);
  } catch (error) {
    return sendErrorResponse(res, 500, "Update failed", error);
  }
};

export const deleteBannerByName = async (req, res) => {
  try {
    const { name } = req.params;

    if (!name)
      return sendBadRequestResponse(res, "Banner name required");

    const banner = await bannerModel.findOne({ name });
    if (!banner)
      return sendBadRequestResponse(res, "Banner not found");

    if (banner.banner?.length > 0) {
      for (const b of banner.banner) {
        const key = b.banner.split(".amazonaws.com/")[1];
        if (key) {
          await deleteFromS3(key);
        }
      }
    }

    await bannerModel.findOneAndDelete({ name });

    return sendSuccessResponse(
      res,
      "Banner deleted successfully",
      banner
    );
  } catch (error) {
    return sendErrorResponse(res, 500, "Error deleting banner", error);
  }
};