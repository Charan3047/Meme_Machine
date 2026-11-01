const Redis = require('ioredis');
const { createFeedbackHandler } = require('../lib/feedback.cjs');

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true }) : null;
const saveFeedback = createFeedbackHandler(redis);

module.exports = async function feedback(req, res) {
  if (!redis) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Feedback storage is not configured.' }));
  }
  try {
    await redis.connect().catch(error => {
      if (error.message !== 'Redis is already connecting/connected') throw error;
    });
    return saveFeedback(req, res);
  } catch (error) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Feedback is temporarily unavailable.' }));
  }
};
