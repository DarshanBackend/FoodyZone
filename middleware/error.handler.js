export default function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation Error",
      details: err.errors
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      error: "Invalid ID Format",
      details: err.message
    });
  }

  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      error: "Duplicate Key",
      key: err.keyValue
    });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, error: "Invalid Token" });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, error: "Token Expired" });
  }

  return res.status(status).json({
    success: false,
    message
  });
}
