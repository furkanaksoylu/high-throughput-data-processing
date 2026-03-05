export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "APP_ERROR",
  ) {
    super(message);
    this.name = "AppError";
    // Maintain proper prototype chain in ES5 transpilation
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, "BAD_REQUEST");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(413, message, "PAYLOAD_TOO_LARGE");
  }
}

export class BadGatewayError extends AppError {
  constructor(message: string) {
    super(502, message, "BAD_GATEWAY");
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message: string) {
    super(504, message, "GATEWAY_TIMEOUT");
  }
}
