import jwt from 'jsonwebtoken';
import { promisify } from 'util';

// Load environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
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
 * Middleware to restrict access to certain roles
 * @param {...string} roles - Roles that are allowed to access the route
 * @returns {Function} Middleware function
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to perform this action'
      });
    }
    next();
  };
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
      id: user._id,
      walletAddress: user.walletAddress,
      username: user.username,
      role: user.role || 'user',
      // Add any other user data you want to include
    },
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );

  return token;
};

// Example usage in your auth controller:
/*
  // After successful authentication
  const token = await generateAuthToken(user);
  
  // Send token to client
  res.status(200).json({
    status: 'success',
    token,
    data: {
      user: {
        id: user._id,
        walletAddress: user.walletAddress,
        username: user.username,
        // other non-sensitive user data
      }
    }
  });
*/

// Example protected route:
/*
  import { protect } from '../middleware/jwt';
  
  router.get('/protected-route', protect, (req, res) => {
    // req.user contains the decoded token data
    res.status(200).json({
      status: 'success',
      data: {
        user: req.user
      }
    });
  });
*/

// Example role-based route:
/*
  import { protect, restrictTo } from '../middleware/jwt';
  
  // Only users with 'admin' role can access this route
  router.get('/admin-route', protect, restrictTo('admin'), (req, res) => {
    // Your admin logic here
  });
*/