import notificationModel from "../models/notification.model.js";
import UserModel from "../models/user.model.js";
import mongoose from "mongoose";
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import { sendPushNotification, sendMulticastNotification } from '../utils/notification.sender.js';

export const getMyNotifications = async (req, res) => {
    try {
        const userId = req.user._id;
        const { page = 1, limit = 20, type, isRead } = req.query;

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const filter = {
            $and: [
                {
                    $or: [
                        { userId: userObjectId },
                        { isForAllUsers: true }
                    ]
                },
                {
                    $or: [
                        { expiresAt: null },
                        { expiresAt: { $gt: new Date() } }
                    ]
                }
            ],
            deletedBy: { $ne: userObjectId },
            isActive: true,
        };

        if (type) {
            filter.type = type;
        }

        const notifications = await notificationModel
            .find(filter)
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .populate('userId', 'firstName lastName email')
            .lean();

        const timeAgo = (date) => {
            const seconds = Math.floor((new Date() - new Date(date)) / 1000);
            let interval = seconds / 31536000;
            if (interval > 1) return Math.floor(interval) + " year ago";
            interval = seconds / 2592000;
            if (interval > 1) return Math.floor(interval) + " month ago";
            interval = seconds / 86400;
            if (interval > 1) return Math.floor(interval) + " day ago";
            interval = seconds / 3600;
            if (interval > 1) return Math.floor(interval) + " hours ago";
            interval = seconds / 60;
            if (interval > 1) return Math.floor(interval) + " min ago";
            return Math.floor(seconds) + " sec ago";
        };

        const processedNotifications = notifications.map(notification => {
            const isRead = notification.isForAllUsers
                ? notification.readBy.some(id => id.toString() === userId.toString())
                : notification.isRead;

            return {
                ...notification,
                isRead,
                timeAgo: timeAgo(notification.createdAt)
            };
        });

        let resultNotifications = processedNotifications;
        if (isRead !== undefined) {
            const isReadBool = isRead === 'true';
            resultNotifications = processedNotifications.filter(n => n.isRead === isReadBool);
        }

        const totalCount = await notificationModel.countDocuments(filter);
        const unreadCount = resultNotifications.filter(n => !n.isRead).length;

        res.status(200).json({
            success: true,
            message: resultNotifications.length
                ? "Notifications fetched successfully"
                : "No notifications found",
            count: resultNotifications.length,
            unreadCount,
            totalCount,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(totalCount / parseInt(limit))
            },
            result: resultNotifications,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await notificationModel.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        const userId = req.user._id;

        if (notification.isForAllUsers) {
            if (!notification.readBy.includes(userId)) {
                notification.readBy.push(userId);
                await notification.save();
            }
        } else {
            if (notification.userId && notification.userId.toString() === userId.toString()) {
                notification.isRead = true;
                await notification.save();
            }
        }

        res.status(200).json({
            success: true,
            message: "Notification marked as read",
            result: notification,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

export const createNotification = async (req, res) => {
    try {
        const {
            title,
            message,
            type,
            reference,
            expiresAt,
            sendToAll,
            userId: bodyUserId
        } = req.body;

        const targetUserId = bodyUserId ? bodyUserId.trim() : null;

        let image = req.body.image || null;

        if (req.file) {
            const uploadResult = await uploadToS3(req.file, "notifications");
            image = uploadResult;
        }

        if (!title?.trim() || !message?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Title and message are required",
            });
        }

        const isSendToAll = String(sendToAll) === 'true';

        if (!isSendToAll && !targetUserId) {
            return res.status(400).json({
                success: false,
                message: "userId is required when sendToAll is false",
            });
        }

        let notification;

        if (isSendToAll) {
            notification = await notificationModel.createBulkNotification({
                type: type || "SYSTEM",
                title: title.trim(),
                message: message.trim(),
                image: image || null,
                reference: reference || null,
                expiresAt: expiresAt || null,
            });

            (async () => {
                try {
                    const usersWithToken = await UserModel.find({
                        fcmToken: { $ne: null, $exists: true }
                    }).select('fcmToken');

                    const tokens = usersWithToken.map(u => u.fcmToken);

                    if (tokens.length > 0) {
                        await sendMulticastNotification(tokens, title, message, {
                            type: type || "SYSTEM",
                            image: image || "",
                            notificationId: notification._id.toString()
                        });
                    }
                } catch (pushError) {
                }
            })();

            return res.status(201).json({
                success: true,
                message: "Notification created for all users",
                notification,
            });
        }

        let userToken = null;
        if (!isSendToAll && targetUserId) {
            const user = await UserModel.findById(targetUserId).select("_id fcmToken");
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found with given userId",
                });
            }
            userToken = user.fcmToken;
        }

        notification = await notificationModel.create({
            userId: targetUserId,
            isForAllUsers: false,
            type: type || "SYSTEM",
            title: title.trim(),
            message: message.trim(),
            image: image || null,
            reference: reference || null,
            expiresAt: expiresAt || null,
        });

        let pushStatus = 'NOT_SENT';
        if (userToken) {
            const sent = await sendPushNotification(userToken, title, message, {
                type: type || "SYSTEM",
                image: image || "",
                notificationId: notification._id.toString()
            });
            pushStatus = sent === true ? 'SENT' : sent === 'INVALID_TOKEN' ? 'INVALID_TOKEN' : 'FAILED';
        } else {
            pushStatus = 'NO_FCM_TOKEN';
        }

        return res.status(201).json({
            success: true,
            message: "Notification created",
            pushStatus,
            notification,
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

export const getAllNotifications = async (req, res) => {
    try {
        const notifications = await notificationModel
            .find()
            .populate("userId", "firstName lastName email")
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({
            success: true,
            message: "All notifications fetched successfully",
            count: notifications.length,
            result: notifications,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

export const getNotificationById = async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await notificationModel.findById(id).populate("userId", "firstName lastName email");
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        res.status(200).json({ success: true, message: "Notification fetched", result: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

export const updateNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        const notification = await notificationModel.findById(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (req.file) {
            if (notification.imageKey) {
                await deleteFromS3(notification.imageKey);
            }
            const uploadResult = await uploadToS3(req.file, "notifications");
            updates.image = uploadResult;
        }

        const updated = await notificationModel.findByIdAndUpdate(id, updates, { new: true });

        res.status(200).json({
            success: true,
            message: "Notification updated successfully",
            result: updated,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await notificationModel.findById(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (notification.imageKey) {
            await deleteFromS3(notification.imageKey);
        }

        const deleted = await notificationModel.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Notification deleted",
            result: deleted,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

export const deleteMyNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const notification = await notificationModel.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (notification.isForAllUsers) {
            const updatedNotification = await notificationModel.findByIdAndUpdate(
                id,
                { $addToSet: { deletedBy: userId } },
                { new: true }
            );

            const totalUsers = await UserModel.countDocuments({});
            const deletedCount = updatedNotification.deletedBy.length;

            if (deletedCount >= totalUsers) {
                if (updatedNotification.imageKey) {
                    await deleteFromS3(updatedNotification.imageKey);
                }
                await notificationModel.findByIdAndDelete(id);
                return res.status(200).json({ success: true, message: "Notification deleted permanently (last user)" });
            }

            return res.status(200).json({ success: true, message: "Notification removed from your list" });
        } else {
            if (!notification.userId || notification.userId.toString() !== userId.toString()) {
                return res.status(403).json({ success: false, message: "You are not authorized to delete this notification" });
            }

            if (notification.imageKey) {
                await deleteFromS3(notification.imageKey);
            }

            await notificationModel.findByIdAndDelete(id);
            return res.status(200).json({ success: true, message: "Notification deleted successfully" });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};
