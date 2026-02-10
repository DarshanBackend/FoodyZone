import productModel from "../models/product.model.js"

export const increaseProductSold = async (order) => {
  if (!order || !order.items) return

  for (const item of order.items) {
    await productModel.findByIdAndUpdate(
      item.product,
      { $inc: { sold: item.quantity } },
      { new: true }
    )
  }
}
