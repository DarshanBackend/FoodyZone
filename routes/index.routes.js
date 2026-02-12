import express from 'express';
import { addNewAddress, createUser, deleteUser, deleteUserAddress, forgotPassword, getAllCountry, getAllnewUser, getAllUserAddress, getUser, getUserAddressById, getUserProfile, resetPassword, searchAddress, selectCountry, selectUserAddress, socialLogin, updateUserAddress, userLogin, userPasswordChangeController, userUpdateProfile, verifyOtp } from '../controllers/user.controller.js';
import { adminAuth, sellerAndAdminAuth, sellerAuth, UserAuth } from '../middleware/auth.middleware.js';
import { createAdminController, getAllSeller, getSeller, newSellerController, sellerForgetPasswordController, sellerLoginController, sellerPasswordChangeController, sellerPasswordResetController, sellerPickUpAddressSetController, sellerVerifyForgetOtpController, updateProfile } from '../controllers/seller.controller.js';
import { sendResponse, sendSuccessResponse, sendBadRequestResponse, sendNotFoundResponse, sendErrorResponse } from '../utils/response.utils.js';
import { deleteFromS3, deleteManyFromS3, listBucketObjects, updateS3, uploadToS3 } from '../utils/s3Service.js';
import { upload } from '../helper/imageUplode.js';
import { createNewCategory, deleteCategory, getAllCategory, getCategoryById, searchCategory, updateCategory } from '../controllers/category.controller.js';
import { createBrand, deleteBrand, getAllBrands, getBrandsById, getProductsByBrandId, getSellerBrands, searchBrand, updateBrandById } from '../controllers/brand.controller.js';
import { addToWishlist, getWishlist, removeFromWishlist } from '../controllers/wishlist.controller.js';
import { createGroceryProduct, createFoodProduct, updateGroceryProduct, updateFoodProduct, getAllGroceryProducts, getAllFoodProducts, getGroceryProductById, getFoodProductById, getSellerGroceryProducts, getSellerFoodProducts, deleteGroceryProduct, deleteFoodProduct, searchProducts, getProductByCategory, getProductsByRestaurantId, getProductFilters } from '../controllers/product.controller.js';
import cartController from '../controllers/cart.controller.js';
import orderController from '../controllers/order.controller.js';
import paymentController from '../controllers/payment.controller.js';
import { applyCouponController, createCoupon, deleteCoupon, getAllCoupon, getAllCouponAdmin, getCouponById, removeCouponController, updateCoupon } from '../controllers/coupon.controller.js';
import { createHomeBanner, deleteBannerByName, getAllBanners, getHomeBanners, updateBannerByName } from '../controllers/banner.controller.js';
import { bestSeller, getFiltteredProducts, grabNowDeals, newArrival, newProducts, trendingDeals } from '../controllers/home.controller.js';
import { checkUserReview, createReview, deleteReview, getProductReviews, updateReview } from '../controllers/review.controller.js';
import { createOfferBanner, deleteOfferBanner, getAllOfferBanners, updateOfferBanner } from '../controllers/offer.controller.js';
import { createRestaurant, deleteRestaurant, getAllRestaurants, getRestaurantById, searchRestaurants, updateRestaurant } from '../controllers/restaurant.controller.js';

const indexRoutes = express.Router();

indexRoutes.post("/createUser", createUser);
indexRoutes.post("/userLogin", userLogin);
indexRoutes.post("/deleteUser", UserAuth, deleteUser);

indexRoutes.post("/socialLogin", socialLogin)
indexRoutes.post("/userUpdateProfile", UserAuth, upload.single("avatar"), userUpdateProfile)

indexRoutes.post("/forgotPassword", forgotPassword)
indexRoutes.post("/verifyOtp", verifyOtp)
indexRoutes.post("/resetPassword", resetPassword)
indexRoutes.put("/userPasswordChange", UserAuth, userPasswordChangeController)

indexRoutes.get("/getAllCountry", getAllCountry);
indexRoutes.get("/selectCountry/:country", UserAuth, selectCountry);

indexRoutes.post("/addNewAddress", UserAuth, addNewAddress);
indexRoutes.patch("/updateUserAddress/:id", UserAuth, updateUserAddress);
indexRoutes.get("/getAllUserAddress", UserAuth, getAllUserAddress);
indexRoutes.get("/getUserAddressById/:id", UserAuth, getUserAddressById);
indexRoutes.delete("/deleteUserAddress/:id", UserAuth, deleteUserAddress);
indexRoutes.post("/selectUserAddress", UserAuth, selectUserAddress);
indexRoutes.get("/searchAddress", UserAuth, searchAddress);

// profile section
indexRoutes.get("/getUserProfile", UserAuth, getUserProfile)


//seller.router.js
indexRoutes.post("/new/admin", createAdminController)
indexRoutes.post("/new/seller", newSellerController)
indexRoutes.post("/seller/login", sellerLoginController)
indexRoutes.post("/seller/updateProfile", sellerAndAdminAuth, upload.single("avatar"), updateProfile)
indexRoutes.post("/seller/forget/password", sellerForgetPasswordController);
indexRoutes.post("/seller/verify/forget/password", sellerVerifyForgetOtpController);
indexRoutes.post("/seller/reset/password", sellerPasswordResetController);
indexRoutes.put("/seller/change/password", sellerAndAdminAuth, sellerPasswordChangeController);
indexRoutes.post("/seller/pickup/address", sellerAuth, sellerPickUpAddressSetController)


//admin api
indexRoutes.get("/getAllnewUser", getAllnewUser)
indexRoutes.get("/getUser", UserAuth, getUser)
indexRoutes.get("/getAllSeller", adminAuth, getAllSeller)
indexRoutes.get("/getSeller", sellerAndAdminAuth, getSeller)


//category
indexRoutes.post("/createNewCategory", adminAuth, upload.single("categoryImage"), createNewCategory)
indexRoutes.get("/getAllCategory", getAllCategory)
indexRoutes.get("/getCategoryById/:id", getCategoryById)
indexRoutes.patch("/updateCategoryById/:id", adminAuth, upload.single("categoryImage"), updateCategory)
indexRoutes.delete("/deleteCategory/:id", adminAuth, deleteCategory)
indexRoutes.get("/searchCategory", searchCategory)


//restaurant
indexRoutes.post("/createRestaurant", sellerAndAdminAuth, upload.fields([{ name: "restaurantImage", maxCount: 1 }, { name: "gImage", maxCount: 1 }]), createRestaurant);
indexRoutes.get("/getAllRestaurants", getAllRestaurants);
indexRoutes.get("/getRestaurantById/:id", getRestaurantById);
indexRoutes.get("/searchRestaurants", searchRestaurants);
indexRoutes.patch("/updateRestaurantById/:id", sellerAndAdminAuth, upload.fields([{ name: "restaurantImage", maxCount: 1 }, { name: "gImage", maxCount: 1 }]), updateRestaurant);
indexRoutes.delete("/deleteRestaurant/:id", sellerAndAdminAuth, deleteRestaurant);


//brand 
indexRoutes.post("/createBrand", sellerAndAdminAuth, upload.single("brandImage"), createBrand)
indexRoutes.get("/getAllBrands", getAllBrands)
indexRoutes.get("/getSellerBrand", sellerAuth, getSellerBrands);
indexRoutes.get("/getBrandsById/:id", getBrandsById)
indexRoutes.put("/updateBrandById/:id", sellerAndAdminAuth, upload.single("brandImage"), updateBrandById)
indexRoutes.delete("/deleteBrand/:id", sellerAndAdminAuth, deleteBrand)
indexRoutes.get("/searchBrand", searchBrand)
indexRoutes.get("/getProductsByBrandId/:id", getProductsByBrandId)

//product
indexRoutes.post("/createGroceryProduct", sellerAndAdminAuth, upload.fields([{ name: "image", maxCount: 1 }]), createGroceryProduct);
indexRoutes.post("/createFoodProduct", sellerAndAdminAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "gImage", maxCount: 10 }]), createFoodProduct);

indexRoutes.get("/getAllGroceryProducts", getAllGroceryProducts)
indexRoutes.get("/getAllFoodProducts", getAllFoodProducts)

indexRoutes.get("/getGroceryProductById/:id", getGroceryProductById);
indexRoutes.get("/getFoodProductById/:id", getFoodProductById);

indexRoutes.get("/getSellerGroceryProducts", sellerAndAdminAuth, getSellerGroceryProducts);
indexRoutes.get("/getSellerFoodProducts", sellerAndAdminAuth, getSellerFoodProducts);

indexRoutes.patch("/updateGroceryProduct/:id", sellerAndAdminAuth, upload.fields([{ name: "image", maxCount: 1 }]), updateGroceryProduct);
indexRoutes.patch("/updateFoodProduct/:id", sellerAndAdminAuth, upload.fields([{ name: "image", maxCount: 1 }, { name: "gImage", maxCount: 10 }]), updateFoodProduct);

indexRoutes.delete("/deleteGroceryProduct/:id", sellerAndAdminAuth, deleteGroceryProduct)
indexRoutes.delete("/deleteFoodProduct/:id", sellerAndAdminAuth, deleteFoodProduct)

indexRoutes.get("/getProductByCategory/:categoryId", getProductByCategory)
indexRoutes.get("/getProductsByRestaurantId/:restaurantId", getProductsByRestaurantId)
indexRoutes.get("/productFilters", getProductFilters);
indexRoutes.get("/searchProduct", searchProducts)

// filtter producrts
indexRoutes.get("/filter", getFiltteredProducts)

// Coupon
indexRoutes.post("/admin/createCoupon", upload.single("couponImage"), adminAuth, createCoupon);
indexRoutes.get("/getAllCoupon", getAllCoupon);
indexRoutes.get("/getAllCouponAdmin", adminAuth, getAllCouponAdmin);
indexRoutes.get("/getCouponById/:id", getCouponById);
indexRoutes.patch("/admin/updateCoupon/:id", adminAuth, upload.single("couponImage"), updateCoupon);
indexRoutes.delete("/admin/deleteCoupon/:id", adminAuth, deleteCoupon);
indexRoutes.post("/apply-coupon", UserAuth, applyCouponController);
indexRoutes.post("/remove-coupon", UserAuth, removeCouponController);

//wishlist
indexRoutes.post("/addToWishlist", UserAuth, addToWishlist)
indexRoutes.get("/getWishlist", UserAuth, getWishlist)
indexRoutes.delete("/removeFromWishlist", UserAuth, removeFromWishlist)



// Cart endpoints
indexRoutes.post("/cart/add", UserAuth, cartController.addToCart);
indexRoutes.get("/myCart", UserAuth, cartController.getCart);
indexRoutes.patch("/cart/update", UserAuth, cartController.updateCartItem);
indexRoutes.delete("/cart/remove/:cartItemId", UserAuth, cartController.removeFromCart);
indexRoutes.delete("/cart/clear", UserAuth, cartController.clearCart);
indexRoutes.get("/billing/preview", UserAuth, cartController.cartBillingPreview);
indexRoutes.post("/cart/apply-coupon", UserAuth, cartController.applyCouponToCart);
indexRoutes.delete("/cart/remove-coupon", UserAuth, cartController.removeCouponFromCart);


// Order endpoints
indexRoutes.post("/order/create", UserAuth, orderController.createOrder);
indexRoutes.get("/order/my-orders", UserAuth, orderController.getUserOrders);
indexRoutes.get("/order/seller/my-orders", sellerAuth, orderController.getSellerOrders);
indexRoutes.get("/order/:orderId", UserAuth, orderController.getOrderById);
indexRoutes.get("/order/:orderId/timeline", UserAuth, orderController.getOrderTimeline);
indexRoutes.get("/order/details/:id", orderController.getOrderByMongoId);
indexRoutes.patch("/order/:orderId/status", sellerAndAdminAuth, orderController.updateOrderStatus);
indexRoutes.post("/order/:orderId/cancel", UserAuth, orderController.cancelOrder);
indexRoutes.post("/order/:orderId/return", UserAuth, orderController.returnOrder);
indexRoutes.get("/order/admin/all-orders", adminAuth, orderController.getAllOrders);

// Payment endpoints (Razorpay)
indexRoutes.post("/payment/:orderId/initiate", UserAuth, paymentController.initiatePayment);
indexRoutes.post("/payment/:orderId/initiate-emi", UserAuth, paymentController.initiateEMIPayment);
indexRoutes.post("/payment/:orderId/verify", UserAuth, paymentController.verifyPayment);
indexRoutes.get("/payment/:orderId/status", UserAuth, paymentController.getPaymentStatus);
indexRoutes.post("/payment/:orderId/refund", UserAuth, paymentController.processRefund);
indexRoutes.post("/payment/webhook", paymentController.handleRazorpayWebhook);
indexRoutes.post("/payment/:orderId/pay-installment", UserAuth, paymentController.payEMIInstallment);
indexRoutes.post("/payment/:orderId/verify-installment", UserAuth, paymentController.verifyInstallmentPayment);


//reviw.routes.js
indexRoutes.post('/createReview', UserAuth, createReview);
indexRoutes.patch('/updateReview/:reviewId', UserAuth, updateReview);
indexRoutes.delete('/deleteReview/:reviewId', UserAuth, deleteReview);
indexRoutes.get('/getProductReviews/:productId', getProductReviews);
indexRoutes.get('/checkUserReview/:productId/:variantId', UserAuth, checkUserReview);

//home page api's
indexRoutes.post("/heroBanner", adminAuth, upload.array("banners"), createHomeBanner)
indexRoutes.get("/getHomeBanners", getHomeBanners)
indexRoutes.get("/getAllBanner", getAllBanners)
indexRoutes.patch("/updateBannerByName/:name", adminAuth, upload.array("banners"), updateBannerByName);
indexRoutes.delete("/deleteBannerByName/:name", adminAuth, deleteBannerByName);

indexRoutes.get("/newArrival", newArrival)
indexRoutes.get("/bestSellers", bestSeller)
indexRoutes.get("/newProducts", newProducts)
indexRoutes.get("/trending-deals", trendingDeals)
indexRoutes.get("/grabNowDeals", grabNowDeals)

//offer
indexRoutes.post("/createOfferBanner", adminAuth, upload.single("offerImage"), createOfferBanner)
indexRoutes.get("/getAllOfferBanners", getAllOfferBanners)
indexRoutes.put("/updateOfferBanner/:id", adminAuth, upload.single("offerImage"), updateOfferBanner)
indexRoutes.delete("/deleteOfferBanner/:id", adminAuth, deleteOfferBanner)

//aws
indexRoutes.get("/list", async (req, res) => {
  try {
    const images = await listBucketObjects();

    return sendSuccessResponse(res, "Get all images successfully", {
      total: images.length,
      images: images.map((e, index) => { return `${e.url}` })
    })
  } catch (error) {
    console.log("ERROR WHIWL GET ALL IMAGE FROM S3");
    return sendResponse(res, 500, "ERROR WHILE GET ALL IMAGE FROM S3", error)
  }
});

indexRoutes.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return sendResponse(res, 400, "File required");

    const url = await uploadToS3(file, "uploads");
    return sendSuccessResponse(res, "Uploaded successfully", { url });
  } catch (error) {
    return sendResponse(res, 500, "Upload error", error);
  }
});

indexRoutes.delete("/delete", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return sendResponse(res, 400, "URL required");

    const key = url.split(".amazonaws.com/")[1];
    if (!key) return sendResponse(res, 400, "Invalid S3 URL");

    await deleteFromS3(key);

    return sendSuccessResponse(res, "Deleted successfully", { key });
  } catch (error) {
    return sendResponse(res, 500, "Delete error", error);
  }
});

indexRoutes.delete("/deleteMany", async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || !images.length) return sendResponse(res, 400, "URLs array required");

    const keys = images.map(url => {
      const key = String(url).split(".amazonaws.com/")[1];
      return key;
    }).filter(Boolean);

    if (!keys.length) return sendResponse(res, 400, "Invalid S3 URLs");

    await deleteManyFromS3(keys);

    return sendSuccessResponse(res, "Deleted multiple files", {
      deleted: keys.length,
      keys
    });
  } catch (error) {
    return sendResponse(res, 500, "Delete many error", error);
  }
});


indexRoutes.put("/update", upload.single("file"), async (req, res) => {
  try {
    const { oldKey } = req.body;
    const newFile = req.file;

    if (!oldKey || !newFile) {
      return sendResponse(res, 400, "oldKey and new file required");
    }

    let key = oldKey;

    if (oldKey.includes(".amazonaws.com")) {
      key = oldKey.split(".amazonaws.com/")[1];
    }

    if (!key) {
      return sendResponse(res, 400, "Invalid S3 URL or key");
    }

    const url = await updateS3(key, newFile, "uploads");

    return sendSuccessResponse(res, "Updated successfully", { url });
  } catch (error) {
    return sendResponse(res, 500, "Update error", error);
  }
});

export default indexRoutes;