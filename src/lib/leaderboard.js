import { users } from "./mongo.js";
import { findCanonicalUserByWallet } from "./userStore.js";

function buildCanonicalLeaderboardPipeline() {
    return [
        {
            $sort: {
                walletAddress: 1,
                nameUpdated: -1,
                correctAnswers: -1,
                streak: -1,
                currentStreak: -1,
                updatedAt: -1,
                lastUpdatedAt: -1,
                createdAt: 1,
                _id: 1
            }
        },
        {
            $group: {
                _id: "$walletAddress",
                doc: { $first: "$$ROOT" }
            }
        },
        {
            $replaceRoot: { newRoot: "$doc" }
        },
        {
            $sort: {
                correctAnswers: -1,
                streak: -1,
                currentStreak: -1,
                updatedAt: -1,
                _id: 1
            }
        }
    ];
}

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

        const totalCountResult = await users.aggregate([
            ...buildCanonicalLeaderboardPipeline(),
            { $count: "totalCount" }
        ]).toArray();
        const totalCount = totalCountResult[0]?.totalCount || 0;

        // Get paginated leaderboard
        const leaderboard = await users.aggregate([
            ...buildCanonicalLeaderboardPipeline(),
            {
                $project: {
                    walletAddress: 1,
                    username: 1,
                    correctAnswers: 1,
                    currentStreak: 1,
                    streak: 1,
                    rank: 1,
                    dungeonTitle: 1
                }
            },
            { $skip: offset },
            { $limit: limit }
        ]).toArray();

        // Calculate total pages
        const totalPages = Math.ceil(totalCount / limit);

        // Find current user's rank if wallet provided
        let currentUserRank = null;
        if (currentWallet) {
            // Count how many users have more correct answers than the current user
            const currentUser = await findCanonicalUserByWallet(currentWallet, {
                projection: { correctAnswers: 1, streak: 1, currentStreak: 1 },
                logLabel: "leaderboard.topAllTime.currentUser"
            });

            if (currentUser) {
                const higherRankedResult = await users.aggregate([
                    ...buildCanonicalLeaderboardPipeline(),
                    {
                        $match: {
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
                        }
                    },
                    { $count: "higherRanked" }
                ]).toArray();
                currentUserRank = (higherRankedResult[0]?.higherRanked || 0) + 1;
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
