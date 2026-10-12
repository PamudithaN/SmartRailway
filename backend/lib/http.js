export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The JSON body for an HttpError; `code` is a stable string for device and Passenger clients.
export const errorBody = (err) => ({
  success: false,
  message: err.message,
  ...(err.code ? { code: err.code } : {}),
});

// Wraps an async route handler: HttpError becomes a { success: false, message } response,
// anything else goes to the Express error handler.
export const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json(errorBody(err));
    }
    next(err);
  }
};
