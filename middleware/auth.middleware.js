import jwt from "jsonwebtoken";
import 'dotenv/config';
import userModel from "../models/user.model.js";
import { sendErrorResponse, sendForbiddenResponse, sendNotFoundResponse, sendUnauthorizedResponse } from "../utils/Response.utils.js";
import sellerModel from "../models/seller.model.js";

const JWT_SCERET = process.env.JWT_SCERET;

export const UserAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authorization token missing or invalid"
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(token, JWT_SCERET);

        const user = await userModel.findById(decoded._id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Authentication failed",
            error: error.message
        });
    }
};

export const sellerAndAdminAuth = async (req, res, next) => {
    try {
        if (!process.env.JWT_SCERET) {
            return sendErrorResponse(res, 500, 'Server configuration error');
        }

        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return sendUnauthorizedResponse(res, "Access denied. No token provided.");
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SCERET);

            const seller = await sellerModel.findById(decoded._id || decoded.id);
            if (!seller) {
                return sendNotFoundResponse(res, "User not found");
            }

            if (!['seller', 'admin'].includes(seller.role)) {
                return sendForbiddenResponse(res, "Access denied. Seller or Admin privileges required.");
            }

            req.user = seller;
            req.user.role = seller.role;
            next();
        } catch (err) {
            console.error('Token verification error:', err);
            return sendUnauthorizedResponse(res, "Invalid token.");
        }
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const adminAuth = async (req, res, next) => {
    try {
        const token = req.header("Authorization")?.replace("Bearer ", "");
        if (!token) return sendUnauthorizedResponse(res, "Access denied. No token provided.");

        const decoded = jwt.verify(token, process.env.JWT_SCERET);

        if (decoded.role !== "admin") {
            return sendForbiddenResponse(res, "Access denied. Admin privileges required.");
        }

        const admin = await sellerModel.findById(decoded._id || decoded.id);
        if (!admin) {
            return sendNotFoundResponse(res, "Admin not found");
        }
        req.user = admin;
        next();

    } catch (err) {
        return sendUnauthorizedResponse(res, "Invalid token");
    }
};

export const sellerAuth = async (req, res, next) => {
    try {
        const token = req.header("Authorization")?.replace("Bearer ", "");
        if (!token) return sendUnauthorizedResponse(res, "Access denied. No token provided.");

        const decoded = jwt.verify(token, process.env.JWT_SCERET);

        if (decoded.role !== "seller") {
            return sendForbiddenResponse(res, "Access denied. Seller privileges required.");
        }

        const seller = await sellerModel.findById(decoded._id || decoded.id);
        if (!seller) {
            return sendNotFoundResponse(res, "Seller not found");
        }

        req.user = seller;
        next();

    } catch (err) {
        return sendUnauthorizedResponse(res, "Invalid token");
    }
};

export const isAdmin = async (req, res, next) => {
    try {
        if (!req.user || req.user.role !== "admin") {
            return sendUnauthorizedResponse(res, "Access denied. Admin privileges required.");
        }
        next();
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const isUser = async (req, res, next) => {
    try {
        if (!req.user) {
            return sendUnauthorizedResponse(res, "Authentication required");
        }
        next();
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};
