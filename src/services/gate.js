import { gateWallets } from "../lib/mongo";

export async function updateGateWalletCollection(snapshot) {
    const payload = {
      correctAnswers: snapshot.correctAnswers,
      currentStreak: snapshot.currentStreak,
      streak: snapshot.streak,
    };
    await gateWallets.updateOne(
        { walletAddress: snapshot.walletAddress },
        { $set: payload },
        { upsert: true }
    );
}