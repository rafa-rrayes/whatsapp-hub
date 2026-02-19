import { Response } from 'express';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}
