import { sendError, sendServerError, sendSuccess } from "../utils/response.js";
import { submitDaBatch } from "../services/daWriterService.js";

const DA_INTERNAL_API_KEY = (
  process.env.DA_INTERNAL_API_KEY ||
  process.env.DA_API_KEY ||
  ""
).trim();

function isAuthorized(req) {
  if (!DA_INTERNAL_API_KEY) return true;
  const auth = String(req.headers?.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token === DA_INTERNAL_API_KEY;
}

export async function submitInternalDaBatchHandler(req, res) {
  try {
    if (!isAuthorized(req)) {
      return sendError(res, "Unauthorized DA submit", 401, "UNAUTHORIZED");
    }

    const events = req.body?.events;
    if (!Array.isArray(events) || !events.length) {
      return sendError(res, "events array is required", 400, "VALIDATION_ERROR");
    }

    const result = await submitDaBatch({ events });
    return sendSuccess(res, result);
  } catch (error) {
    return sendServerError(res, error, "InternalDaController.submit");
  }
}

