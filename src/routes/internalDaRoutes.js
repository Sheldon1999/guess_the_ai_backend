import { submitInternalDaBatchHandler } from "../controllers/internalDaController.js";

export default function internalDaRoutes(app) {
  app.post("/api/internal/da/submit", submitInternalDaBatchHandler);
}

