import userModel from '../models/user.model.js';
import { comparePassword, hashPassword } from '../utils/bcrypt.utils.js';
import { checkRequired, sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from '../utils/response.utils.js';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import bcrypt from "bcryptjs";
import transporter from '../config/email.config.js';
import axios from "axios";
import mongoose from 'mongoose';
import { deleteFromS3, updateS3, uploadToS3 } from '../utils/s3Service.js';
import { sendSMS } from '../utils/sms.utils.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SCERET;

export const createUser = async (req, res) => {
  try {
    const { fullName, phone, email } = req.body;

    const missing = checkRequired(req.body, ["fullName", "phone", "email"]);
    if (missing.length > 0) {
      return sendBadRequestResponse(res, "Missing fields", 400, missing);
    }

    const existingPhone = await userModel.findOne({ phone });
    if (existingPhone) {
      return sendBadRequestResponse(res, "User with this phone number already exists. Please login.", 400);
    }

    const existingEmail = await userModel.findOne({ email });
    if (existingEmail) {
      return sendBadRequestResponse(res, "User with this email already exists. Please login.", 400);
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = Date.now() + 5 * 60 * 1000;

    const avatar = `https://ui-avatars.com/api/?name=${encodeURI(fullName)}&background=random`;

    const newUser = await userModel.create({
      fullName,
      phone,
      email,
      avatar,
      isSocialLogin: false,
      otp,
      otpExpiry: expiry
    });

    try {
      if (phone) {
        const message = `Your confirmation code is ${otp}. Valid for 5 minutes.`;
        await sendSMS(phone, message);
      }
    } catch (smsError) {
      console.error("SMS sending failed (proceeding for dev):", smsError.message);
      console.log("DEV MODE OTP:", otp);
    }

    return sendSuccessResponse(res, "User registered. OTP sent (check console if SMS failed).", {
      userId: newUser._id,
      phone: newUser.phone,
    });

  } catch (error) {
    return sendErrorResponse(res, 500, "Error while createUser", error);
  }
};

export const userLogin = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return sendBadRequestResponse(res, "Please provide phone number", 400);
    }

    const user = await userModel.findOne({ phone });

    if (!user) {
      return sendNotFoundResponse(res, "User not found with this phone number");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = Date.now() + 5 * 60 * 1000;

    user.otp = otp;
    user.otpExpiry = expiry;
    await user.save();

    try {
      const message = `Your login code is ${otp}. Valid for 5 minutes.`;
      await sendSMS(phone, message);
    } catch (smsError) {
      console.error("SMS sending failed (proceeding for dev):", smsError.message);
      console.log("DEV MODE OTP:", otp);
    }

    return sendSuccessResponse(res, "OTP sent (check console if SMS failed)", {
      userId: user._id,
      phone: user.phone
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while userLogin", error);
  }
};

export const socialLogin = async (req, res) => {
  try {
    const { email, fullName, avatar } = req.body;
    const missing = checkRequired(req.body, ["email"]);

    if (missing.length > 0) {
      return sendBadRequestResponse(res, "Missing email", 400, missing);
    }

    let user = await userModel.findOne({ email });

    if (!user) {
      user = await userModel.create({
        fullName: fullName || "",
        email,
        avatar: avatar || null,
        password: null,
        isSocialLogin: true,
        otp: null,
        otpExpiry: null
      });
    } else {
      if (!user.isSocialLogin) {
        return sendBadRequestResponse(res, "Manual registered users cannot use social login. Please use email/password login.", 400);
      }

      user.fullName = fullName || user.fullName;
      user.avatar = avatar || user.avatar;
      user.isSocialLogin = true;
      await user.save();
    }

    const payload = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    const safeUser = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      phone: user.phone,
      isSocialLogin: user.isSocialLogin
    };

    return sendSuccessResponse(res, "Social login successful", {
      user: safeUser,
      token
    });
  } catch (error) {
    console.log("Error while socialLogin: " + error.message);
    return sendErrorResponse(res, 500, "Error while socialLogin", error);
  }
};

export const getAllnewUser = async (req, res) => {
  try {
    const userData = await userModel.find({})

    if (!userData || userData.length == 0) {
      return sendNotFoundResponse(res, "User not found!!!!")
    }

    return sendSuccessResponse(res, "User fetched Successfully...", userData)

  } catch (error) {
    console.error("Data fetch Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error Fetching new user Data",
      error: error.message
    });
  }
}

export const getUser = async (req, res) => {
  try {
    const { id } = req.user

    const checkUser = await userModel.findById(id).select("-password -tokens");
    if (!checkUser) {
      return sendNotFoundResponse(res, "User not found")
    }

    return sendSuccessResponse(res, "User fetched successfully...", checkUser)

  } catch (error) {
    console.error("Data fetch Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error Fetching new user Data",
      error: error.message
    });
  }
}

export const deleteUser = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendBadRequestResponse(res, "Invalid user ID");
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    if (user.avatar && !user.avatar.includes('ui-avatars.com')) {
      try {
        const avatarUrl = user.avatar;
        const bucketName = process.env.AWS_BUCKET_NAME;

        let avatarKey;
        if (avatarUrl.includes(`.s3.`)) {
          avatarKey = avatarUrl.split(`.s3.`)[1];
          avatarKey = avatarKey.substring(avatarKey.indexOf('/') + 1);
        } else if (avatarUrl.includes(bucketName)) {
          avatarKey = avatarUrl.split(`${bucketName}/`)[1];
        }

        if (avatarKey) {
          avatarKey = avatarKey.split('?')[0];
          await deleteFromS3(avatarKey);
        }
      } catch (s3Error) {
        console.error('Error deleting avatar from S3:', s3Error.message);
      }
    }

    await userModel.findByIdAndDelete(userId);

    return sendSuccessResponse(res, "Your account has been deleted successfully", {
      userId: user._id,
      email: user.email,
      fullName: user.fullName,
      deletedAt: new Date().toISOString()
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while deleting user account", error);
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendBadRequestResponse(res, "Email is required", 400);
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const otp = Math.floor(1000 + Math.random() * 9000);
    const expiry = Date.now() + 5 * 60 * 1000;

    user.otp = otp;
    user.otpExpiry = expiry;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER || "hit.kalathiyainfotech@gmail.com",
      to: email,
      subject: "Password Reset OTP",
      html: `
      <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
        <div style="max-width:520px;margin:auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 10px 35px rgba(0,0,0,0.08)">
        
        <div style="background:linear-gradient(135deg,#ff6b6b,#ee5253);padding:40px;text-align:center;position:relative">
          <img src="https://placehold.co/80x80?text=FZ" 
              style="width:80px;height:80px;border-radius:50%;background:white;padding:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2)">
          <h1 style="color:white;margin:20px 0 0;font-size:30px;font-weight:700;letter-spacing:0.5px">
            FoodyZone
          </h1>
          <p style="color:#ffeaa7;margin-top:8px;font-size:15px">
            Secure Password Reset Verification
          </p>
          <svg viewBox="0 0 500 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:50px">
            <path d="M0,0 C150,50 350,0 500,30 L500,50 L0,50 Z" style="fill:#ee5253"></path>
          </svg>
        </div>

        <div style="padding:35px 40px">
          <p style="color:#111;font-size:19px;font-weight:600;margin:0 0 12px;text-align:center">
            Your One-Time Password (OTP)
          </p>

          <p style="color:#555;font-size:15px;margin:0 0 28px;line-height:1.6;text-align:center">
            Enter the verification code below to reset your password. This ensures your account stays safe.
          </p>

          <div style="text-align:center;margin-bottom:35px">
            <div style="
              display:inline-block;
              font-size:40px;
              font-weight:700;
              letter-spacing:12px;
              padding:18px 0;
              color:#d63031;
              border-radius:14px;
              background:#ffeaa7;
              border:2px solid #fab1a0;
              min-width:180px;
              text-align:center;
            ">
              ${otp}
            </div>
          </div>

          <p style="text-align:center;color:#444;font-size:14px;margin-bottom:30px">
            This OTP will expire in <b>5 minutes</b>.
          </p>

          <div style="text-align:center;margin-bottom:35px">
             <img src="https://placehold.co/100x100?text=Foody" 
                style="width:10%;border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,0.12)">
          </div>

          <p style="font-size:13px;color:#888;text-align:center;line-height:1.5">
            If you didn’t request this, you can safely ignore this message.
          </p>
        </div>

        <div style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #eee;border-radius:0 0 18px 18px">
          <p style="margin:0;font-size:12px;color:#777">
            © ${new Date().getFullYear()} FoodyZone. All rights reserved.
          </p>
        </div>

      </div>
    </div>
      `
    });

    return sendSuccessResponse(res, "OTP sent successfully");
  } catch (error) {
    console.log(error.message)
    return sendErrorResponse(res, 500, "Error while forgotPassword", error);
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { phone, email, otp } = req.body;

    if ((!phone && !email) || !otp) {
      return sendBadRequestResponse(res, "Phone/Email and OTP are required", 400);
    }

    let user;
    if (phone) {
      user = await userModel.findOne({ phone });
    } else if (email) {
      user = await userModel.findOne({ email });
    }

    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    if (!user.otp || !user.otpExpiry) {
      return sendBadRequestResponse(res, "OTP not generated or expired", 400);
    }

    if (Date.now() > user.otpExpiry) {
      return sendBadRequestResponse(res, "OTP expired", 400);
    }

    if (Number(otp) !== user.otp) {
      return sendBadRequestResponse(res, "Invalid OTP", 400);
    }

    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const payload = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    const safeUser = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      isSocialLogin: user.isSocialLogin
    };

    return sendSuccessResponse(res, "OTP verified successfully. Login success.", {
      token,
      user: safeUser
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while verifyOtp", error);
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendBadRequestResponse(res, "Email and new password are required", 400);
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const hashedPassword = await hashPassword(password);

    user.password = hashedPassword;
    await user.save();

    return sendSuccessResponse(res, "Password reset successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while resetPassword", error);
  }
};

export const userPasswordChangeController = async (req, res) => {
  try {
    const { id } = req?.user;
    const { oldPassword, newPassword } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid userId");
    }

    if (!oldPassword || !newPassword) {
      return sendBadRequestResponse(res, "Old password and new password required");
    }

    const user = await userModel.findById(id).select("password");

    if (!user) {
      return sendBadRequestResponse(res, "user not found");
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return sendBadRequestResponse(res, "Old password is incorrect");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    return sendSuccessResponse(res, "Password changed successfully");
  } catch (error) {
    console.error("Change Password Error:", error);
    return sendErrorResponse(res, 500, "Something went wrong while changing password", error);
  }
}

export const getAllCountry = async (req, res) => {
  try {
    const { data } = await axios.get(
      "https://restcountries.com/v3.1/all?fields=name,flags,idd"
    );

    const countries = data.map(country => {
      let code = "";
      if (country.idd?.root && country.idd?.suffixes?.length) {
        code = country.idd.suffixes.map(s => `${country.idd.root}${s}`).join(", ");
      }

      return {
        name: country.name.common,
        code,
        flag: country.flags?.png || null
      };
    });

    countries.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      message: "Countries fetched successfully",
      total: countries.length,
      countries
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while fetching countries",
      error: error.message
    });
  }
};

export const selectCountry = async (req, res) => {
  try {
    const { country } = req.params;
    const { _id: userId } = req.user;
    if (!userId || !country) {
      return res.status(400).json({
        success: false,
        message: "userId and country Name are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.country = country;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Country selected successfully",
      country: user.country
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while selecting country",
      error: error.message
    });
  }
};

export const addNewAddress = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { houseDetails, landmark, city, state, pincode, saveAs, long, lati, setAsSelected } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!houseDetails || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: "houseDetails, city, state, and pincode are required" });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let mapURL = null;

    if (long && lati) {
      mapURL = `https://www.google.com/maps?q=${lati},${long}`;
    }

    const newAddress = {
      houseDetails,
      landmark: landmark || null,
      city,
      state,
      pincode,
      saveAs: saveAs || "Home",
      mapURL
    };

    user.address.push(newAddress);

    if (setAsSelected) {
      user.selectedAddress = user.address[user.address.length - 1]._id;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Address added successfully",
      address: user.address,
      selectedAddress: user.selectedAddress
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while adding address",
      error: error.message
    });
  }
};

export const updateUserAddress = async (req, res) => {
  try {
    const addressId = req.params.id;
    const updateData = req.body;

    let mapURL = null;
    if (updateData.long && updateData.lati) {
      mapURL = `https://www.google.com/maps?q=${updateData.lati},${updateData.long}`;
    }

    const setData = {};
    if (updateData.houseDetails) setData["address.$.houseDetails"] = updateData.houseDetails;
    if (updateData.landmark) setData["address.$.landmark"] = updateData.landmark;
    if (updateData.city) setData["address.$.city"] = updateData.city;
    if (updateData.state) setData["address.$.state"] = updateData.state;
    if (updateData.pincode) setData["address.$.pincode"] = updateData.pincode;
    if (updateData.saveAs) setData["address.$.saveAs"] = updateData.saveAs;
    if (mapURL) setData["address.$.mapURL"] = mapURL;

    const updatedUser = await userModel.findOneAndUpdate(
      { _id: req.user._id, "address._id": addressId },
      { $set: setData },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: updatedUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error while updating address",
      error: error.message
    });
  }
};

export const getAllUserAddress = async (req, res) => {
  try {
    const { _id } = req.user
    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return sendBadRequestResponse(res, "_id somthing went wrong");
    }

    const address = await userModel.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(_id) } },
      {
        $project: {
          address: { $sortArray: { input: "$address", sortBy: { updatedAt: -1 } } }
        }
      }
    ]);


    if (!address || address.length > 0) {
      return sendSuccessResponse(res, "Address Not Found", address)
    }

    return sendSuccessResponse(res, `user Address Featched SuccessFully`, address)

  } catch (error) {
    console.log("Error while getAllUserAddress" + error.message)
    return sendErrorResponse(res, 500, "Error while getAllUserAddress", error);
  }
}

export const getUserAddressById = async (req, res) => {
  try {
    const userId = req.user._id;
    const addressId = req.params.id;

    const user = await userModel.findOne(
      { _id: userId, "address._id": addressId },
      { "address.$": 1 }
    );

    if (!user || !user.address.length) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    return sendSuccessResponse(res, "User address featched Successful By id", user.address[0])
  } catch (error) {
    console.log("Error while GetUserAddressById: " + error.message);
    return sendErrorResponse(res, 500, "Error while fetching address", error)
  }
};

export const deleteUserAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const addressId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      return sendBadRequestResponse(res, "Invalid address ID");
    }

    const user = await userModel.findById(userId);

    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const addressIndex = user.address.findIndex(addr => addr._id.toString() === addressId);

    if (addressIndex === -1) {
      return sendNotFoundResponse(res, "Address not found");
    }

    user.address.splice(addressIndex, 1);

    if (user.selectedAddress && user.selectedAddress.toString() === addressId) {
      user.selectedAddress = null;
    }

    await user.save();

    return sendSuccessResponse(res, "Address deleted successfully", {
      address: user.address,
      selectedAddress: user.selectedAddress
    });

  } catch (error) {
    console.log("Error while delete User Address: " + error.message);
    return sendErrorResponse(res, 500, "Error while deleting address", error);
  }
};

export const selectUserAddress = async (req, res) => {
  try {
    const { addressId } = req.body;
    const { _id } = req.user;

    if (!mongoose.Types.ObjectId.isValid(_id) && !mongoose.Types.ObjectId.isValid(addressId)) {
      return sendBadRequestResponse(res, "addressId & userId something went wrong")
    }

    const user = await userModel.findOne(
      { _id: _id, "address._id": addressId },
      { "address.$": 1 }
    );

    if (!user || !user.address.length) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    user.selectedAddress = addressId;
    await user.save();

    return sendSuccessResponse(res, "address selected successfully", user);
  } catch (error) {
    console.log("error while select User Address" + error.message)
    return sendErrorResponse(res, 'error while select user address', error)
  }
}

export const searchAddress = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ success: false, message: "Query is required" });
  }

  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q,
        format: "json",
        addressdetails: 1,
        limit: 10
      },
      headers: {
        "User-Agent": "YourAppName/1.0"
      }
    });

    const results = response.data.map(item => ({
      place_id: item.place_id,
      name: item.display_name.split(",")[0],
      address: item.display_name,
      location: {
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      },
      type: item.type,
      category: item.class
    }));

    res.json({
      success: true,
      query: q,
      results,
      count: results.length,
      status: results.length ? "OK" : "ZERO_RESULTS"
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching address", error: err.message });
  }
};

export const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user._id;

    if (!fcmToken) {
      return sendBadRequestResponse(res, "FCM Token is required");
    }

    await userModel.findByIdAndUpdate(userId, { fcmToken });

    return sendSuccessResponse(res, "FCM Token updated successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, "Error updating FCM token", error);
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const { _id: id } = req.user;
    const user = await userModel.findOne({ _id: id });

    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const selectedAddressId = user.selectedAddress;
    const selectedAddressDetails = user.addresses?.find(addr => addr._id.toString() === selectedAddressId?.toString());

    const userProfile = {
      _id: user._id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      country: user.country,
      avatar: user.avatar,
      isSocialLogin: user.isSocialLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      addresses: user.addresses || [],
      selectedAddress: selectedAddressDetails || null,
      selectedAddressId: selectedAddressId || null
    };

    return sendSuccessResponse(res, `${user.fullName} profile Fetched Successfully`, userProfile);
  } catch (error) {
    console.log("Error while get User Profile : " + error.message);
    return sendErrorResponse(res, 500, "Error while Get User Profile " + error.message);
  }
}

export const userUpdateProfile = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendBadRequestResponse(res, "Invalid User ID");
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const { fullName, email, phone } = req.body || {};

    if (fullName !== undefined) user.fullName = fullName;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;

    if (req.file) {
      let newAvatarUrl;

      if (user.avatar?.includes(".amazonaws.com/")) {
        const oldKey = user.avatar.split(".amazonaws.com/")[1];

        try {
          await deleteFromS3(oldKey);
        } catch (error) {
          return sendErrorResponse(
            res,
            500,
            "Failed to delete old profile image"
          );
        }
      }

      try {
        const uploaded = await uploadToS3(req.file, "users");
        newAvatarUrl =
          typeof uploaded === "string"
            ? uploaded
            : uploaded?.Location;

      } catch (error) {
        return sendErrorResponse(
          res,
          500,
          "Failed to upload new profile image"
        );
      }

      user.avatar = newAvatarUrl;
    }

    await user.save();

    const safeUser = user.toObject();
    delete safeUser.password;
    delete safeUser.__v;

    return sendSuccessResponse(
      res,
      "Profile updated successfully",
      safeUser
    );

  } catch (error) {
    console.error("Profile update error:", error);
    return sendErrorResponse(
      res,
      500,
      "Error while updating profile",
      error.message
    );
  }
};