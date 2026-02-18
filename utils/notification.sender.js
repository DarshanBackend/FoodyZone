import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isFirebaseInitialized = false;

try {
    const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');

    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin Initialized Successfully");
        }
        isFirebaseInitialized = true;
    } else {
        console.warn("⚠️ Firebase Service Account Key not found at:", serviceAccountPath);
        console.warn("⚠️ Push notifications will NOT be sent until 'serviceAccountKey.json' is added.");
    }
} catch (error) {
    console.error("❌ Firebase Initialization Error:", error.message);
}

const stringifyData = (data) => {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) {
            result[key] = '';
        } else {
            result[key] = String(value);
        }
    }
    return result;
};

export const sendPushNotification = async (token, title, body, data = {}) => {
    if (!isFirebaseInitialized) {
        console.error("❌ Firebase is not initialized. Cannot send notification.");
        return false;
    }

    if (!token) {
        console.error("❌ No token provided for notification.");
        return false;
    }

    try {
        const stringifiedData = stringifyData({
            ...data,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default",
            status: "done",
        });

        const message = {
            notification: {
                title,
                body
            },
            data: stringifiedData,
            token,
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'high_importance_channel',
                    priority: 'high',
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                        'content-available': 1,
                    }
                },
                headers: {
                    'apns-priority': '10',
                }
            }
        };

        const response = await admin.messaging().send(message);
        console.log("✅ Notification sent successfully:", response);
        return true;
    } catch (error) {
        console.error("❌ Error sending notification:", error.code, error.message);
        if (error.code === 'messaging/registration-token-not-registered') {
            return 'INVALID_TOKEN';
        }
        return false;
    }
};

export const sendMulticastNotification = async (tokens, title, body, data = {}) => {
    if (!isFirebaseInitialized) {
        console.error("❌ Firebase is not initialized. Cannot send multicast notification.");
        return false;
    }

    if (!tokens || tokens.length === 0) {
        console.error("❌ No tokens provided for multicast notification.");
        return false;
    }

    const validTokens = tokens.filter(t => t && typeof t === 'string' && t.trim().length > 0);
    if (validTokens.length === 0) {
        console.error("❌ No valid tokens after filtering.");
        return false;
    }

    const stringifiedData = stringifyData({
        ...data,
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        sound: "default",
    });

    const batchSize = 500;
    const batches = [];

    for (let i = 0; i < validTokens.length; i += batchSize) {
        batches.push(validTokens.slice(i, i + batchSize));
    }

    let successCount = 0;
    let failureCount = 0;

    for (const batchTokens of batches) {
        try {
            const message = {
                notification: {
                    title,
                    body
                },
                data: stringifiedData,
                tokens: batchTokens,
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channelId: 'high_importance_channel',
                        priority: 'high',
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1,
                            'content-available': 1,
                        }
                    },
                    headers: {
                        'apns-priority': '10',
                    }
                }
            };

            const response = await admin.messaging().sendEachForMulticast(message);
            successCount += response.successCount;
            failureCount += response.failureCount;

            if (response.failureCount > 0) {
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        console.warn(`⚠️ Failed token: ${batchTokens[idx]?.substring(0, 20)}... | Error: ${resp.error?.code} - ${resp.error?.message}`);
                    }
                });
            }
        } catch (error) {
            console.error("❌ Error sending multicast batch:", error.code, error.message);
        }
    }

    console.log(`✅ Multicast Summary: Sent ${successCount}, Failed ${failureCount}`);
    return { successCount, failureCount };
};
