export const sendResponse = (res, statusCode, success, message, result = null) => {
    return res.status(statusCode).json({
        success,
        message,
        result
    });
};

export const sendSuccessResponse = (res, message, result = []) => {
    return res.status(200).json({
        success: true,
        message,
        result: result || []
    });
};

export const sendErrorResponse = (res, statusCode = 500, message = "Server error", error = null) => {
    return res.status(statusCode).json({
        success: false,
        message,
        error: error ? error.message || error : undefined
    });
};


export const sendCreatedResponse = (res, message, result = []) => {
    return res.status(201).json({
        success: true,
        message,
        result: result || []
    });
};

export const sendNotFoundResponse = (res, message) => {
    return res.status(404).json({
        success: false,
        message,
        result: []
    });
};

export const sendBadRequestResponse = (res, message) => {
    return res.status(400).json({
        success: false,
        message,
        result: []
    });
};

export const sendUnauthorizedResponse = (res, message) => {
    return res.status(401).json({
        success: false,
        message,
        result: []
    });
};

export const sendForbiddenResponse = (res, message) => {
    return res.status(403).json({
        success: false,
        message,
        result: []
    });
}; 

export const checkRequired = (body, fields = []) => {
  const bodyKeys = Object.keys(body);
  const missing = [];

  fields.forEach((f) => {
    if (!bodyKeys.includes(f) || body[f] === "" || body[f] === null || body[f] === undefined) {
      missing.push(f);
    }
  });

  return missing;
};
