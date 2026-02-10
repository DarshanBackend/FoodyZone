import mongoose from "mongoose";
import categoryModel from "../models/category.model.js";
import { checkRequired, sendBadRequestResponse, sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js"
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";


export const createNewCategory = async (req, res) => {
  try {
    const { name, parentCategory, type } = req.body;
    const { _id } = req.user;
    const categoryImage = req.file;


    if (!name) {
      return sendBadRequestResponse(res, "Category Name is Required")
    }

    if (!categoryImage) {
      return sendBadRequestResponse(res, "Category Image is Required")
    }
    let img = null;
    if (categoryImage) {
      img = await uploadToS3(categoryImage, "uploads")
    }

    const categoryData = {
      name: name,
      image: img,
      sellerId: _id,
      type: type || "delivery"
    };

    if (parentCategory && mongoose.Types.ObjectId.isValid(parentCategory)) {
      categoryData.parentCategory = parentCategory;
    }

    const category = await categoryModel.create(categoryData);

    await category.save();

    return sendSuccessResponse(res, "Category Add Successfully", category);

  } catch (error) {

    return sendErrorResponse(res, 500, "error while create category", error)
  }
}

export const getAllCategory = async (req, res) => {
  try {
    const { parentCategory } = req.query;
    let filter = {};

    // Filter by parentCategory if provided (use 'null' string for root categories)
    if (parentCategory === "null") {
      filter.parentCategory = null;
    } else if (parentCategory) {
      filter.parentCategory = parentCategory;
    }

    const { type } = req.query;
    if (type) {
      filter.type = type;
    }

    const category = await categoryModel.find(filter)
      .populate("sellerId", "firstName mobileNo email avatar role")
      .sort({ createdAt: -1 })

    return sendSuccessResponse(res, "All Category Fetched Successfully", {
      total: category.length,
      category
    })
  } catch (error) {

    return sendErrorResponse(res, 500, "error While Get All Category", error)
  }
}

export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid category id")
    }

    const category = await categoryModel.findById(id)
      .populate("sellerId", "firstName mobileNo email avatar role")
      .populate("parentCategory", "name image")

    if (!category) {
      return sendBadRequestResponse(res, "Category not found")
    }

    // Level 1: Get direct children (e.g., "Mobile Phones", "Mobile Accessories")
    const sections = await categoryModel.find({ parentCategory: id });

    // Level 2: Get children of those sections (e.g., "Android", "iOS" under "Mobile Phones")
    const categoryTree = await Promise.all(sections.map(async (section) => {
      const subCategories = await categoryModel.find({ parentCategory: section._id });
      return {
        ...section.toObject(),
        childCategories: subCategories // These are the actual items like Android, iOS
      }
    }));

    return sendSuccessResponse(res, "Category fetched successfully", {
      category,
      sections: categoryTree,
      hasChild: categoryTree.length > 0
    })

  } catch (error) {

    return sendErrorResponse(res, 500, "error while getCategoryById", error)
  }
}

export const updateCategory = async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;

    let category = await categoryModel.findOne({ _id: id });
    if (!category) {
      return sendErrorResponse(res, 404, "Category not found");
    }

    let img = null;

    if (req.file) {
      const key = category.image.split(".amazonaws.com/")[1];
      img = await updateS3(key, req.file);
    }

    category.name = name || category.name;
    category.image = img || category.image;

    await category.save();

    return sendSuccessResponse(res, "Category updated", category);
  } catch (error) {

    return sendErrorResponse(res, 500, "Error while update Category", error);
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid ID format")
    }

    const hasChildren = await categoryModel.findOne({ parentCategory: id });
    if (hasChildren) {
      return sendBadRequestResponse(res, "Cannot delete category containing sub-categories. Delete children first.");
    }


    const category = await categoryModel.findByIdAndDelete({ _id: id });
    let key = String(category.image).split(".amazonaws.com/")[1];
    await deleteFromS3(key)

    return sendSuccessResponse(res, "Category deleted Successfully", category)

  } catch (error) {

    return sendErrorResponse(res, 500, "error while Delete Category", error)
  }
}

export const searchCategory = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    if (!q) {
      return sendBadRequestResponse(res, "q is required for request");
    }

    const skip = (page - 1) * limit;

    const result = await categoryModel.find({
      name: { $regex: q, $options: "i" }
    }).skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 })

    return sendSuccessResponse(res, "Search result featched Successfully", {
      total: result.length,
      result
    })
  } catch (error) {

    return sendErrorResponse(res, 500, "Error while Search category", error);
  }
}