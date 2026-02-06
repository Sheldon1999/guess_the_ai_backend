/**
 * Image Routes
 * Route definitions for image serving endpoints
 */

import { imageByHashHandler } from '../controllers/imageController.js';

export default function imageRoutes(app) {
  app.get('/api/img/h/:hash', imageByHashHandler);
}
