import { localRandomIndex } from "../lib/random.js";
import redis from "../lib/redis.js";
import { READY_QUEUE_KEY } from "../lib/redisKeys.js";
import { images } from "../lib/mongo.js";
import answerList from "../lib/backup_answer.js";
async function sampleIndexes(wallet, listLength, count = 1) {
  try {
    if (!Number.isInteger(listLength) || listLength <= 0) return [];

    const target = Math.min(count, listLength);
    const picked = new Set();
    const maxAttempts = listLength * 3;
    let attempts = 0;

    while (picked.size < target && attempts < maxAttempts) {
      attempts += 1;
      const idx = localRandomIndex(listLength);
      picked.add(idx);
    }

    return Array.from(picked);
  } catch (error) {
    console.log("sampleIndexes error:", error);
    return [];
  }
}

async function fetchHashesByIndex(indexes) {
  if (!indexes.length) return [];
  const multi = redis.multi();
  indexes.forEach((i) => multi.lindex(READY_QUEUE_KEY, i));
  const rows = await multi.exec();
  return rows.map(([, v]) => v).filter(Boolean);
}

async function getImageIdFromMongo(hash) {
    const image = await images.findOne(
        { hash: hash },
        { projection: { _id: 1, hash: 1, label: 1 } }
    );;
    if (image?.imageId) return image.imageId;
}

export async function pick10RandomHashes(wallet) {
    try {
        const listLength = await redis.llen(READY_QUEUE_KEY);
        if (!listLength) {
            return { status: 204, body: null };
        }

        const indexes = await sampleIndexes(wallet, listLength, 10);
        if (!indexes.length) return { status: 204, body: null };
        const sampled = await fetchHashesByIndex(indexes);
        if (!sampled.length) return { status: 204, body: null };

        const image_list = await Promise.all(
            sampled.map(async (hash) => {
                const imageId = await getImageIdFromMongo(hash);
                return {
                    imageId: String(imageId ?? hash),
                    hash,
                    url: `/api/img/h/${encodeURIComponent(hash)}`,
                };
            })
        );

        return { status: 200, body: { image_list } };
    } catch (err) {
        console.error("[SERVICE] service: game; method: pick10RandomHashes; error: ", err);
        return { status: 204, body: null };
    }
}

export async function pickBackupImage(wallet) {
  const listLength = answerList.length;
  if (!listLength) return { status: 204, body: null };

  const [idx] = await sampleIndexes(wallet, listLength, 1);
  if (idx === null || idx === undefined) return { status: 204, body: null };

  const entry = answerList[idx];
  const name = entry?.file_name;
  if (!name) return { status: 204, body: null };

  return {
    status: 200,
    body: {
      imageId: name,
      hash: name,
      url: `/api/img/h/${encodeURIComponent(name)}`,
    },
  };
}
