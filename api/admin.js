const { timingSafeEqual } = require('crypto');
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
const adminKey = process.env.ADMIN_API_KEY;
const CONTENT_KEY = 'meme-machine:custom-content';
const METRICS_KEY = 'meme-machine:metrics';
const ONLINE_KEY = 'meme-machine:online';
const BUILTIN_CATEGORIES = new Set(['Vegetables', 'Street food', 'Fruits', 'Phone apps', 'Animals', 'Sports', 'School stuff', 'Superpowers', 'Weekend plans', 'Movies', 'Travel', 'Space things', 'Kitchen items', 'Indian celebrations', 'Things that fly', 'Things at the beach', 'Weather', 'Music', 'Desserts', 'Gadgets', 'Jobs', 'Fashion', 'Breakfast', 'Transport', 'Internet', 'Indian landmarks', 'Mythical creatures', 'Birds', 'Chores', 'Party moments', 'In your backpack']);
const PROFANITY = /\b(fuck|shit|bitch|asshole|bastard|cunt|slut|porn)\w*/gi;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true }) : null;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function authorized(req) {
  const provided = String(req.headers['x-admin-key'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = String(adminKey || '');
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return !!expected && a.length === b.length && timingSafeEqual(a, b);
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw new Error('Send valid JSON in the request body.'); }
}

function text(value, max, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim().replace(/[<>]/g, '').replace(PROFANITY, '***');
  if (!result || result.length > max) throw new Error(`${label} must be 1–${max} characters.`);
  return result;
}

module.exports = async function admin(req, res) {
  if (!adminKey || !redis) return send(res, 503, { error: 'Admin API is not configured. Set ADMIN_API_KEY and REDIS_URL.' });
  if (!authorized(req)) return send(res, 401, { error: 'Admin key required.' });

  const action = String(req.query?.action || 'overview');
  try {
    await redis.connect().catch(err => { if (err.message !== 'Redis is already connecting/connected') throw err; });

    if (req.method === 'GET' && action === 'overview') {
      const now = Date.now();
      await redis.zremrangebyscore(ONLINE_KEY, '-inf', now - 60000);
      const [activeVisitors, metrics] = await Promise.all([redis.zcount(ONLINE_KEY, now - 60000, '+inf'), redis.hgetall(METRICS_KEY)]);
      return send(res, 200, {
        activeVisitorsLast60Seconds: Number(activeVisitors),
        totals: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Number(value)])),
        trackedActivities: ['uniqueVisitors', 'roomsCreated', 'playersJoined', 'matchesStarted', 'captionPicks', 'votes', 'dontCopyPicks', 'matchesCompleted'],
        updatedAt: new Date(now).toISOString()
      });
    }

    if (req.method === 'GET' && action === 'content') {
      const saved = await redis.get(CONTENT_KEY);
      const content = saved ? JSON.parse(saved) : { prompts: [], categories: {} };
      return send(res, 200, content);
    }

    if (req.method === 'POST' && action === 'add-prompt') {
      const input = await body(req);
      const question = text(input.question, 180, 'question');
      const botCaption = text(input.botCaption, 140, 'botCaption');
      if (!Array.isArray(input.captions) || input.captions.length !== 5) throw new Error('captions must contain exactly five answer options.');
      const captions = input.captions.map((caption, i) => text(caption, 140, `captions[${i}]`));
      const saved = await redis.get(CONTENT_KEY);
      const content = saved ? JSON.parse(saved) : { prompts: [], categories: {} };
      if (content.prompts.some(item => item[0].toLowerCase() === question.toLowerCase())) return send(res, 409, { error: 'That question already exists.' });
      if (content.prompts.length >= 100) return send(res, 409, { error: 'The custom prompt limit (100) has been reached.' });
      content.prompts.push([question, botCaption, captions]);
      await redis.set(CONTENT_KEY, JSON.stringify(content));
      return send(res, 201, { added: 'prompt', question, totalCustomPrompts: content.prompts.length });
    }

    if (req.method === 'POST' && action === 'add-category') {
      const input = await body(req);
      const name = text(input.category, 50, 'category');
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 12) throw new Error('options must contain 2–12 choices.');
      const options = input.options.map((option, i) => ({
        n: text(option && option.name, 40, `options[${i}].name`),
        e: text(option && option.emoji, 12, `options[${i}].emoji`),
        w: Number.isInteger(option.weight) && option.weight >= 1 && option.weight <= 5 ? option.weight : 1
      }));
      const saved = await redis.get(CONTENT_KEY);
      const content = saved ? JSON.parse(saved) : { prompts: [], categories: {} };
      if ([...BUILTIN_CATEGORIES].some(key => key.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Choose a category name that is not already built into the game.' });
      if (Object.keys(content.categories).some(key => key.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'That custom category already exists.' });
      if (Object.keys(content.categories).length >= 100) return send(res, 409, { error: 'The custom category limit (100) has been reached.' });
      content.categories[name] = options;
      await redis.set(CONTENT_KEY, JSON.stringify(content));
      return send(res, 201, { added: 'category', category: name, totalCustomCategories: Object.keys(content.categories).length });
    }

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'Use GET or POST.' });
    }
    return send(res, 400, { error: 'Unknown action. Use overview, content, add-prompt, or add-category.' });
  } catch (err) {
    const status = /body is too large|must be |must contain|valid JSON|options must/i.test(err.message) ? 400 : 500;
    return send(res, status, { error: err.message || 'Admin request failed.' });
  }
};
