/**
 * User Routes
 * Route definitions - only call controllers
 */

import { protect, decodeBrowserJwtOptional } from '../middleware/jwt.js';
import { putWalletAdd } from '../middleware/login.js';
import {
  loginV2Handler,
  loginHandler,
  updateUsernameHandler,
  getProfileHandler
} from '../controllers/userController.js';

export default function userRoutes(app) {
  // V2 Login (Privy-aware)
  app.post('/api/v2/login', decodeBrowserJwtOptional, loginV2Handler);

  // Legacy Login
  app.post('/api/user/login', putWalletAdd, loginHandler);

  // Update Username
  app.put('/api/user/updateUsername', protect, updateUsernameHandler);

  // Get Profile
  app.get('/api/user/profile', protect, getProfileHandler);
}
