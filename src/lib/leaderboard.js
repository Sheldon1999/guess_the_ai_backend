import { users } from "./mongo.js";

/**
 * Get all-time leaderboard with pagination
 * @param {number} limit - Max entries per page (default 10)
 * @param {number} page - Page number (1-based, default 1)
 * @param {string} currentWallet - Optional wallet to find user's rank
 * @returns {Promise<Object>} Leaderboard result with pagination info
 */
export async function topAllTime(limit = 10, page = 1, currentWallet = null) {
    try {
        // Calculate offset from page
        const offset = (page - 1) * limit;

        // Get total count
        const totalCount = await users.countDocuments({});

        // Get paginated leaderboard
        const leaderboard = await users.find(
            {},
            {
                projection: {
                    walletAddress: 1,
                    username: 1,
                    correctAnswers: 1,
                    currentStreak: 1,
                    streak: 1,
                    rank: 1,
                    dungeonTitle: 1
                }
            }
        ).sort({ correctAnswers: -1, streak: -1, currentStreak: -1 })
         .skip(offset)
         .limit(limit)
         .toArray();

        // Calculate total pages
        const totalPages = Math.ceil(totalCount / limit);

        // Find current user's rank if wallet provided
        let currentUserRank = null;
        if (currentWallet) {
            // Count how many users have more correct answers than the current user
            const currentUser = await users.findOne(
                { walletAddress: currentWallet.toLowerCase() },
                { projection: { correctAnswers: 1, streak: 1, currentStreak: 1 } }
            );

            if (currentUser) {
                const higherRanked = await users.countDocuments({
                    $or: [
                        { correctAnswers: { $gt: currentUser.correctAnswers } },
                        {
                            correctAnswers: currentUser.correctAnswers,
                            streak: { $gt: currentUser.streak }
                        },
                        {
                            correctAnswers: currentUser.correctAnswers,
                            streak: currentUser.streak,
                            currentStreak: { $gt: currentUser.currentStreak }
                        }
                    ]
                });
                currentUserRank = higherRanked + 1;
            }
        }

        return {
            success: true,
            data: leaderboard,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },
            currentUserRank
        };
    } catch (error) {
        console.error('[leaderboard] topAllTime error:', error);
        return {
            success: false,
            message: 'Something went wrong'
        };
    }
}
