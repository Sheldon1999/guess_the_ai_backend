import { users } from "./mongo.js";

export async function topAllTime(limit = 50, offset = 0) {

    try {
      const leaderboard = await users.find().sort({ correctAnswers: -1 }).limit(limit).skip(offset).toArray();
      return ({success:true,data:leaderboard});
    }
    catch(error) {
      return ({
        success: false,
        message: 'Something went wrong'
    })
    }
}
