const FEEDBACK_KEY = 'meme-machine:feedback';
const METRICS_KEY = 'meme-machine:metrics';
const ACTIVITY_KEY = 'meme-machine:activity';
const PROFANITY = /\b(fuck|shit|bitch|asshole|bastard|cunt|slut|porn)\w*/gi;

function send(res, status, data) {
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  if (typeof res.json === 'function') return res.status(status).json(data);
  return res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000) throw new Error('Feedback is too large.');
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw new Error('Send feedback as JSON.'); }
}

function createFeedbackHandler(redis, localFeedback = []) {
  return async function feedback(req, res) {
    if (req.method !== 'POST') {
      if (typeof res.setHeader === 'function') res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'Use POST to send feedback.' });
    }
    try {
      const input = await readBody(req);
      const rating = Number(input.rating || 0);
      const message = String(input.message || '').trim().replace(/[<>]/g, '').replace(PROFANITY, '***').slice(0, 600);
      if (!Number.isInteger(rating) || rating < 0 || rating > 5) return send(res, 400, { error: 'Choose a rating from 1 to 5, or leave it blank.' });
      if (!rating && !message) return send(res, 400, { error: 'Add a rating or a short comment before sending.' });
      const entry = { rating, message, at: Date.now() };

      if (redis) {
        await redis.multi()
          .lpush(FEEDBACK_KEY, JSON.stringify(entry))
          .ltrim(FEEDBACK_KEY, 0, 499)
          .hincrby(METRICS_KEY, 'feedbackSubmitted', 1)
          .lpush(ACTIVITY_KEY, JSON.stringify({ name: 'feedbackSubmitted', at: entry.at }))
          .ltrim(ACTIVITY_KEY, 0, 39)
          .exec();
      } else {
        localFeedback.unshift(entry);
        localFeedback.length = Math.min(localFeedback.length, 500);
      }
      return send(res, 201, { ok: true, message: 'Thanks for the feedback!' });
    } catch (error) {
      const status = /too large|JSON/i.test(error.message) ? 400 : 500;
      return send(res, status, { error: error.message || 'Could not save feedback.' });
    }
  };
}

module.exports = { createFeedbackHandler, FEEDBACK_KEY };
