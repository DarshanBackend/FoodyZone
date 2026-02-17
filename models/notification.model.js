import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: false,
        },

        isForAllUsers: {
            type: Boolean,
            default: false,
        },

        readBy: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
        }],

        deletedBy: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
        }],

        type: {
            type: String,
            enum: [
                "ORDER",
                "OFFER",
                "PRICE_DROP",
                "SYSTEM",
                "ADMIN",
                "WALLET",
                "PROMOTION",
                "DELIVERY",
                "REVIEW_REMINDER"
            ],
            default: "SYSTEM",
        },

        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },

        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },

        image: {
            type: String,
            default: null,
            validate: {
                validator: function (v) {
                    return v === null || v === '' || /^https?:\/\/.+\..+/.test(v);
                },
                message: 'Image must be a valid URL'
            }
        },

        reference: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },

        isRead: {
            type: Boolean,
            default: false,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        expiresAt: {
            type: Date,
            default: null,
            validate: {
                validator: function (v) {
                    if (!v) return true;
                    return v instanceof Date && v > new Date();
                },
                message: 'expiresAt must be a future date'
            }
        },
    },
    {
        timestamps: true,
    }
);

notificationSchema.index({
    expiresAt: 1
}, {
    expireAfterSeconds: 0,
    partialFilterExpression: {
        expiresAt: { $type: "date", $ne: null }
    }
});

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ isForAllUsers: 1, createdAt: -1 });
notificationSchema.index({ isActive: 1, createdAt: -1 });

notificationSchema.virtual('isReadByUser').get(function () {
    return function (userId) {
        if (this.isForAllUsers) {
            return this.readBy.includes(userId);
        }
        return this.isRead;
    };
});

notificationSchema.methods.markAsRead = function (userId) {
    if (this.isForAllUsers) {
        if (!this.readBy.includes(userId)) {
            this.readBy.push(userId);
        }
    } else {
        this.isRead = true;
    }
    return this.save();
};

notificationSchema.statics.createBulkNotification = function (notificationData) {
    return this.create({
        ...notificationData,
        userId: null,
        isForAllUsers: true,
        readBy: []
    });
};

notificationSchema.statics.getUserNotifications = function (userId, options = {}) {
    const { limit = 50, page = 1 } = options;
    const skip = (page - 1) * limit;

    return this.find({
        $and: [
            {
                $or: [
                    { userId: userId },
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
        isActive: true,
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email')
        .exec();
};

const notificationModel = mongoose.model("Notification", notificationSchema);

export default notificationModel;
