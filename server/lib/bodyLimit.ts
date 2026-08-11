/**
 * CP6.2C — R04 JSON body safety ceiling.
 *
 * express.json is installed globally with a 10 MiB safety ceiling (down from
 * 50mb). This is a deliberate behavior change: multi-file JSON bodies larger
 * than 10 MiB that were previously accepted now return HTTP 413. It is NOT
 * claimed as backward compatible. File-count bounding remains R06.
 *
 * jsonBodyErrorHandler turns body-parser size/parse failures into small,
 * fixed public JSON responses with no raw body, stack, or err.message leak.
 */
import type { ErrorRequestHandler } from "express";

export const JSON_BODY_LIMIT = 10 * 1024 * 1024; // 10 MiB safety ceiling

export function jsonBodyErrorMessage(): string {
  return `Request body too large. Maximum allowed size is ${JSON_BODY_LIMIT / (1024 * 1024)}MB.`;
}

export const jsonBodyErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const errType = (err as { type?: string } | undefined)?.type;
  if (errType === "entity.too.large") {
    return res.status(413).json({ error: jsonBodyErrorMessage() });
  }
  if (errType === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  return next(err);
};
