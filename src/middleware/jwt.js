// src/middleware/jwt.js
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { normalizeWallet as normalizeWalletUtil } from '../utils/normalize.js';

// Load environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const BROWSER_JWT_SECRET = process.env.BROWSER_JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_ALGORITHM = 'HS256';

/**
 * Signs a JWT token with the provided payload
 * @param {Object} payload - The data to include in the token
 * @param {Object} options - Additional options for token generation
 * @returns {Promise<string>} The generated JWT token
 */
export const signToken = async (payload, options = {}) => {
  const sign = promisify(jwt.sign);
  return sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: JWT_ALGORITHM,
      ...options
    }
  );
};

/**
 * Verifies and decodes a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Promise<Object>} The decoded token payload
 * @throws {Error} If token is invalid or expired
 */
export const verifyToken = async (token) => {
  const verify = promisify(jwt.verify);
  return verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
};

/**
 * Verifies and decodes a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Promise<Object>} The decoded token payload
 * @throws {Error} If token is invalid or expired
 */
export const verifyBrowserToken = async (token) => {
  const verify = promisify(jwt.verify);
  return verify(token, BROWSER_JWT_SECRET, { algorithms: 'HS256' });
};

const normalizeWallet = (value) => normalizeWalletUtil(value) || "";

// Optionally decode browser JWT for /v2/login flows and attach the wallet to the request.
export const decodeBrowserJwtOptional = async (req, res, next) => {
  req.walletFromJwt = "";
  const jwtToken = req.body?.jwt;
  if (!jwtToken) return next();

  if (req.body?.source !== "browser") {
    return res.status(401).json({ success: false, message: "invalid request" });
  }

  try {
    const decodedData = await verifyBrowserToken(jwtToken);
    const walletFromJwt = normalizeWallet(decodedData?.walletAddress);
    if (!walletFromJwt) {
      return res.status(400).json({ success: false, message: "invalid walletAddress" });
    }
    req.walletFromJwt = walletFromJwt;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "invalid token" });
  }
};


/**
 * Middleware to protect routes by verifying JWT token
 * Attaches the decoded user to the request object
 */
export const protect = async (req, res, next) => {
  try {
    // 1) Get token from header
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in! Please log in to get access.'
      });
    }

    // 2) Verify token
    const decoded = await verifyToken(token);
    if (decoded?.exp && Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({
        status: 'error',
        message: 'Token expired. Please log in again.'
      });
    }

    // 3) Check if user still exists (optional, if you want to invalidate tokens for deleted users)
    // const currentUser = await User.findById(decoded.id);
    // if (!currentUser) {
    //   return res.status(401).json({
    //     status: 'error',
    //     message: 'The user belonging to this token no longer exists.'
    //   });
    // }

    // 4) Grant access to protected route
    req.user = decoded;
    res.locals.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token or token expired. Please log in again.'
    });
  }
};

/**
 * Generates a JWT token for a user
 * @param {Object} user - User object to include in the token
 * @returns {Promise<string>} The generated JWT token
 */
export const generateAuthToken = async (user) => {
  // Create token with user data
  const token = await signToken(
    {
      _id: user._id,
      walletAddress: user.wallet,
      username: user.username,
      role: user.role || 'user',
    }
    ,
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );

  return token;
};
