import notificationModel from "../models/notification.model.js";

/**
 * Helper to create a notification in the database
 */
export const createNotification = async ({
    userId,
    title,
    message,
    type = "SYSTEM",
    image = null,
    reference = null,
    expiresAt = null,
}) => {
    try {
        if (!userId || !title || !message) {
            throw new Error("userId, title, and message are required");
        }

        const notification = await notificationModel.create({
            userId,
            type,
            title,
            message,
            image,
            reference,
            expiresAt,
        });

        return notification;
    } catch (error) {
        console.error("Error creating notification:", error.message);
        throw error;
    }
};

/**
 * Get all notifications for a specific user
 */
export const getUserNotifications = async (userId) => {
    try {
        return await notificationModel
            .find({ userId, isActive: true })
            .sort({ createdAt: -1 })
            .lean();
    } catch (error) {
        console.error("Error fetching notifications:", error.message);
        throw error;
    }
};

/**
 * Mark a notification as read
 */
export const markNotificationAsRead = async (notificationId) => {
    try {
        return await notificationModel.findByIdAndUpdate(
            notificationId,
            { isRead: true },
            { new: true }
        );
    } catch (error) {
        console.error("Error marking notification as read:", error.message);
        throw error;
    }
};

/**
 * Soft delete a notification
 */
export const deleteNotification = async (notificationId) => {
    try {
        return await notificationModel.findByIdAndUpdate(
            notificationId,
            { isActive: false },
            { new: true }
        );
    } catch (error) {
        console.error("Error deleting notification:", error.message);
        throw error;
    }
};
