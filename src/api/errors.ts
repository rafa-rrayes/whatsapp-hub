import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') { super(404, message); }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request') { super(400, message); }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') { super(403, message); }
}

export class NotConnectedError extends ApiError {
  constructor() { super(503, 'WhatsApp is not connected'); }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}
