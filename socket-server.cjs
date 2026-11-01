const express = require('express'), http = require('http'), path = require('path'), { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
// Keep the Socket.IO endpoint on the exact Vercel function route. Nested paths
// under /api/socket-io are not mapped to this function automatically.
const socketPath = '/api/socket-io';
const io = new Server(srv, { path: socketPath, addTrailingSlash: false });
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const redisUrl = process.env.REDIS_URL;
if (process.env.VERCEL && !redisUrl) throw new Error('REDIS_URL is required for shared Meme Machine rooms on Vercel.');
const stateRedis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null;
if (redisUrl) {
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));
}
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '4kb' }));
// Local fallback for the static homepage; Vercel serves public/ through its CDN.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/health', (_req, res) => res.json({ ok: true, game: 'meme-machine' }));
const localFeedback = [];
const { createFeedbackHandler } = require('./lib/feedback.cjs');
app.post('/api/feedback', createFeedbackHandler(stateRedis, localFeedback));

const R = {}; // hot room cache; Redis is authoritative when REDIS_URL is configured
const roomKey = code => `meme-machine:room:${code}`;
const lockKey = code => `meme-machine:lock:${code}`;
const contentKey = 'meme-machine:custom-content';
const metricsKey = 'meme-machine:metrics';
const onlineKey = 'meme-machine:online';
const activityKey = 'meme-machine:activity';
const emptyContent = () => ({ prompts: P, categories: CATS });
async function loadGameContent() {
  if (!stateRedis) return emptyContent();
  const raw = await stateRedis.get(contentKey);
  if (!raw) return emptyContent();
  const extra = JSON.parse(raw);
  return {
    prompts: [...P, ...(Array.isArray(extra.prompts) ? extra.prompts : [])],
    categories: { ...CATS, ...(extra.categories && typeof extra.categories === 'object' ? extra.categories : {}) }
  };
}
function recordActivity(name) {
  if (!stateRedis) return;
  stateRedis.multi()
    .hincrby(metricsKey, name, 1)
    .lpush(activityKey, JSON.stringify({ name, at: Date.now() }))
    .ltrim(activityKey, 0, 39)
    .exec()
    .catch(err => console.error('Activity metric:', err.message));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withRoomLock(code, work) {
  if (!stateRedis) return work(R[code] || null);
  const token = randomUUID(), key = lockKey(code);
  let locked = false;
  for (let i = 0; i < 80; i++) {
    if (await stateRedis.set(key, token, 'PX', 12000, 'NX') === 'OK') { locked = true; break; }
    await wait(20 + Math.random() * 35);
  }
  if (!locked) throw new Error('This room is busy. Please try again.');
  try {
    const raw = await stateRedis.get(roomKey(code));
    let r = raw ? JSON.parse(raw) : null;
    if (r) {
      if (!r.content) r.content = emptyContent();
      const local = R[code];
      r.d = new Set(r.d || []);
      r.tm = local && local.ph === r.ph && local.end === r.end ? local.tm : 0;
      R[code] = r;
    } else delete R[code];
    const result = await work(r);
    if (!r && R[code]) r = R[code];
    if (r) {
      const saved = { ...r, d: [...r.d], tm: undefined, fn: undefined };
      await stateRedis.set(roomKey(code), JSON.stringify(saved), 'EX', 86400);
      ensureTimer(r);
    }
    return result;
  } finally {
    await stateRedis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }
}

function withPlayerRoom(s, handler) {
  return (...args) => {
    const code = s.data && s.data.c, id = s.data && s.data.i;
    if (!code || !id) return;
    withRoomLock(code, async r => {
      if (!r || !r.p[id]) return;
      const p = r.p[id];
      await handler(r, p, ...args);
    }).catch(err => s.emit('err', err.message || 'Room update failed. Please reconnect.'));
  };
}
const shuf = a => a.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

// [prompt, bot caption used in 2-player mode, five ready-made captions]
const P = [
  ["POV: your mom walks in while you're 'studying'", "Me: yes, this reel is part of the syllabus", ["I was studying the ancient art of scrolling", "This is a very visual textbook", "The phone is helping me focus. On the phone", "I can explain. Actually, no I can't", "I was just checking if the Wi-Fi works"]],
  ["When the teacher asks 'any doubts?' and the whole class goes silent", "Doubts? Sir, I have a whole life crisis", ["My doubt is where the last 40 minutes went", "I have doubts, but they need their own classroom", "If I ask, does the chapter start over?", "My brain has left the meeting", "I understood the question. That's progress"]],
  ["Your phone is at 1% and the charger is across the room", "Time to meet my maker. Goodbye, group chat", ["It was nice knowing all 847 open tabs", "Nobody move. Maybe the battery will feel safe", "I am now emotionally attached to this outlet", "One last scroll. Famous final words", "If I run, the battery will sense fear"]],
  ["Group project, the night before the deadline", "Four of us. One doing everything. Guess who isn't me", ["Our group chat has seen more action than the project", "I made the title slide. Leadership", "We work best under panic and poor lighting", "The document is blank, but the vibes are strong", "Can we submit the group chat instead?"]],
  ["Wi-Fi says 'connected' but there's no internet", "Connected to nothing, just like my plans", ["The router is giving us the silent treatment", "My signal has commitment issues", "I have never felt more offline while online", "Loading... just like my career", "The Wi-Fi and I are both trying our best"]],
  ["Hostel mess serving the same dish for the 5th day", "It's giving 'you'll eat what you get'", ["At this point, the dish knows my name", "Today's special: yesterday with confidence", "Five days in and we're basically family", "I asked for variety. They rotated the spoon", "The menu has one season and it is this"]],
  ["You said 'just 5 more minutes' of sleep", "Alarm: 7:00 am. Me: 7:00 pm", ["I snoozed so hard I time-travelled", "My blanket has filed a custody request", "Five minutes passed in dream time", "I woke up tired from sleeping", "The alarm and I are no longer on speaking terms"]],
  ["Your friend replies 'k' to your 10-paragraph message", "Message delivered. Emotional damage also delivered", ["I have received a full review from one letter", "That 'k' had a lot of punctuation energy", "I will now write a 10-paragraph reply to 'k'", "Seen by them. Felt by me", "At least they didn't send a thumbs-up"]]
];
P.push(
  ["Your friend says 'I'm outside' but is still choosing an outfit", "Outside spiritually, still inside physically", ["I can see your typing bubble from the gate", "The outside is waiting. So is my patience", "I have aged three seasons on this doorstep", "Send a fit check, not a location pin", "The cab driver and I are now friends"]],
  ["The group chat tries to pick a place to eat", "We have discussed 40 places and chosen hunger", ["Let's meet where the last message was sent", "I vote for somewhere with a shorter poll", "The restaurant closed while we were deciding", "I'll eat anything except the 27 things I suggested", "Democracy has made us all hungry"]],
  ["You unmute yourself to say something and forget what it was", "A brave speech with no content", ["I had a point. It has left the call", "Thank you, everyone, for attending my silence", "I opened my mouth and the thought logged out", "Let me share my screen instead of my idea", "I will now return to being a mysterious icon"]],
  ["The teacher says 'this will be a quick quiz'", "Quick for whom? The quiz has 12 pages", ["My confidence has left the classroom", "I studied the chapter next to this one", "Is there a lifeline for the whole row?", "My pen is ready. My brain is on airplane mode", "Can we define quick in academic terms?"]],
  ["Someone asks how your exam went", "I wrote my name with excellent handwriting", ["The questions and I had different expectations", "We both showed up. That is a start", "I think question four knows what it did", "My answers were creative, if not correct", "Let's celebrate the parts I remember"]],
  ["Your camera turns on during an online meeting", "Breaking news: I was not camera-ready", ["This broadcast is brought to you by panic", "I have never sat up so quickly", "That was the face of someone reading the agenda", "Please enjoy this exclusive ceiling view", "I am now dressed from the shoulders up"]],
  ["You send a screenshot to the person in the screenshot", "A bold new form of direct communication", ["The evidence has been delivered to the suspect", "I meant to send that to my lawyer", "Well, now we can discuss it together", "I have invented face-to-face texting", "Going offline until the next software update"]],
  ["You send 'love you' to the family group by accident", "My affection has no undo button", ["That was meant for the food delivery app", "We are a loving family. Let's never speak of this", "The group chat has reacted with 18 hearts", "I have made the family announcement of the year", "Please consider this a scheduled message"]],
  ["You open the front camera by mistake", "A jump scare with no warning label", ["The camera caught me between characters", "I was not prepared for this documentary", "This is why mirrors have a loading screen", "Who gave my phone this kind of power?", "Delete the footage and the memory"]],
  ["You try to cook something from a 20-second video", "The recipe forgot to mention the smoke alarm", ["The comments said it was easy", "Mine has entered its abstract art phase", "The kitchen is now a live experiment", "I followed every step except the important ones", "Dinner is ready for a very brave person"]],
  ["A relative asks when you'll get married", "I was hoping to finish lunch first", ["I am currently in a committed relationship with naps", "Please ask my calendar. It is also confused", "After I recover from this question", "I would like to consult the family committee", "Can we get through dessert before the sequel?"]],
  ["The power goes out during the big match", "The whole neighborhood just yelled at the darkness", ["Even the lights couldn't watch that replay", "I will now provide commentary from memory", "Someone check the score using a candle", "This is the most dramatic timeout ever", "The TV has chosen a side"]],
  ["Your first day at the gym", "I have lifted one water bottle and need a break", ["The treadmill and I have agreed to stay strangers", "I came for fitness and left with a new towel", "Is there a machine for carrying my bag?", "My warm-up needs its own warm-up", "I am building strength by reading the labels"]],
  ["The food delivery map says the rider is one minute away", "I have been standing by the door for 11 minutes", ["That little scooter icon is my closest friend", "I can hear the app breathing heavily", "The food is touring the city before meeting me", "I have put on shoes for a doorbell", "We are both almost there emotionally"]],
  ["The online exam asks you to show the room on camera", "Time to reveal my very suspicious collection of laundry", ["The desk has never looked this innocent", "I am panning slowly past the snack evidence", "Please ignore the wall behind my confidence", "This room is under renovation since Monday", "My bookshelf has prepared an alibi"]],
  ["You reach the ATM and realize you forgot your card", "I came all this way to check the weather", ["The machine and I had a lovely conversation", "My wallet is here in spirit", "I will withdraw some patience instead", "This queue has seen my character arc", "At least I remembered my PIN. Probably"]],
  ["You upload the wrong file for an assignment", "My final-final-actually-final file has betrayed me", ["The blank draft is now representing my work", "I submitted the director's cut by mistake", "The upload button moved faster than my thoughts", "I hope the teacher enjoys my desktop wallpaper", "This is a bold opening statement"]],
  ["Your phone says storage full while you take a photo", "The moment has been saved to my memory only", ["I must delete 4,000 screenshots of recipes", "My phone has reached emotional capacity", "The camera has asked for a little space", "I have a museum of blurry photos to curate", "This memory is now exclusive to my brain"]],
  ["The teacher says 'take out a blank sheet of paper'", "The most expensive sentence in school", ["My handwriting is about to become evidence", "A blank page and I both have questions", "I knew I should have brought a second personality", "This paper looks more prepared than me", "Can the sheet take the test for us?"]],
  ["A customer asks to speak to the manager", "I am the manager, the team, and the printer technician", ["Let me transfer you to my other personality", "The manager is currently in a meeting with me", "I will escalate this to the snack department", "Would you like to speak to the chairperson?", "I can offer you a very sincere nod"]],
  ["Your friend asks you to share your live location", "I am walking in circles so the map looks exciting", ["The blue dot is having a personal day", "Please follow the tiny dot to my snack stop", "I am exactly where the signal says I am", "The map knows my route better than I do", "Location shared. Dignity still private"]],
  ["Your family says 'guests are coming in five minutes'", "The house has entered emergency-cleaning mode", ["Hide everything in the room we said was clean", "I have never folded a blanket this quickly", "The guests are early. The dust is not", "Put the random chair in a different room", "Everyone act like this is where we sit"]],
  ["You come up with the perfect comeback three hours later", "The shower has excellent debate coaching", ["I have won the argument in a different time zone", "Please schedule a rematch for my next shampoo", "My brain has excellent after-hours service", "I will save this line for the next imaginary fight", "The audience in my head loved it"]],
  ["You reply 'you too' when the waiter says 'enjoy your meal'", "I hope the waiter enjoys their shift and my confusion", ["We are both having a meal now, apparently", "That was my customer-service autopilot", "I have wished the menu a nice evening too", "The waiter has heard worse. I hope", "I will now eat quietly and reflect"]],
  ["You wave back at someone who was waving to the person behind you", "I have made a new friend without consent", ["That wave had a very confident beginning", "I will now pretend it was a stretch", "We have shared a moment. They do not know", "The person behind me owes me an explanation", "I have greeted the entire bus"]],
  ["You listen to a voice message at double speed", "My friend now sounds like a very fast auctioneer", ["I understood every third word with confidence", "Please resend that in human mode", "The message has become a tiny podcast", "I have learned to speak in 2x", "That was 40 seconds of competitive listening"]],
  ["The office meeting ends with 'let's circle back'", "We are now trapped in a geometric loop", ["I will circle back after lunch and a new identity", "That circle has more meetings than my calendar", "Let's turn this into a rectangle and finish", "I have circled back to the same spreadsheet", "The loop is now part of company culture"]],
  ["A friend texts 'we need to talk'", "My brain has written a 12-season drama", ["I have apologized to everyone just in case", "Can you send the genre before I panic?", "The typing bubble has become a thriller", "I am preparing three snacks and one speech", "I hope this is about choosing dinner"]],
  ["Your mom calls you by your full name", "The middle name means the meeting is serious", ["I have been summoned by the full legal orchestra", "My childhood just opened a support ticket", "I am answering before the final syllable", "The whole house knows I am in trouble", "Can I get a hint from the first name?"]],
  ["The group tries to take one perfect photo", "Everyone blinked at a different moment", ["We have 63 photos and one open eye", "The best one is the photo before the photo", "Someone's hand is now the main character", "Can we hire a photographer and a therapist?", "This is our album cover, apparently"]],
  ["You walk into a room and forget why you came in", "The doorway has erased my entire mission", ["I will stand here until the memory respawns", "This room has no clues and no snacks", "I have arrived with absolutely no plot", "Let me walk out and reload the thought", "The mission was probably something important"]],
  ["The elevator stops and someone asks which floor", "I have been trusted with too much power", ["I press the button like I own the building", "We are all on this journey together", "I will choose a floor based on vibes", "The elevator has made me team captain", "Nobody panic. I have seen buttons before"]],
  ["You accidentally like a photo from five years ago", "I have time-travelled straight into the notifications", ["The evidence is now public and historic", "I was researching the archives", "Please accept my accidental museum tour", "That was a very deep scroll for science", "I have acknowledged the past"]],
  ["You try to leave a party without saying goodbye", "I have been caught in three farewell conversations", ["The exit is visible but not emotionally available", "I said bye to one person and met six more", "This is my third last goodbye", "I am slowly migrating toward the door", "Please turn off the lights so I can escape"]],
  ["Someone says 'quick question' and opens a 40-minute story", "The question has a prequel and a spin-off", ["I have aged through the entire backstory", "We may need a map and a snack break", "The quick part was the opening sentence", "I will answer after the director's cut", "That question has its own season finale"]],
  ["Your alarm rings and you negotiate with it", "The alarm has rejected my counteroffer", ["Five more minutes is a legally binding treaty", "We have reached a snooze ceasefire", "I will get up after this very short dream", "The alarm is loud because it lacks empathy", "I am awake in theory"]],
  ["You get dressed for the weather app, not the actual weather", "The forecast and sky have unfollowed each other", ["I brought a jacket to a heatwave", "The clouds changed plans without notifying me", "My umbrella is now a fashion accessory", "I trusted a tiny icon with my whole outfit", "Today has a surprise climate update"]],
  ["You open the fridge for the fourth time hoping new food appeared", "The fridge is still showing the same episode", ["I am checking for a plot twist", "The leftovers and I are avoiding eye contact", "Maybe the snacks loaded late", "I came for inspiration and found a light", "The fridge has no new content today"]],
  ["Your friend says 'one last game' at 2 a.m.", "The sun is about to join the lobby", ["We have entered the bonus round of tomorrow", "My sleep schedule has left the party", "One last game is a very flexible unit", "The birds are already spectating", "I will stop after this definitely final match"]]
);
// emoji + name : how likely the machine is to pick it (obvious picks weigh more)
const CATS = {};
Object.entries({
  Vegetables: "🍅Tomato:5,🥔Potato:4,🧅Onion:4,🍆Brinjal:2,🎃Pumpkin:1,🥕Carrot:3,🥬Cabbage:1,🌶️Chilli:2",
  'Street food': "🥟Samosa:5,🍟Fries:3,🍜Maggi:5,🌯Roll:2,🥣Golgappa:4,🍕Pizza:4,🍔Burger:3,🌽Corn:1",
  Fruits: "🍎Apple:5,🍌Banana:4,🥭Mango:5,🍇Grapes:3,🍉Watermelon:3,🍍Pineapple:1,🍓Strawberry:2,🥥Coconut:1",
  'Phone apps': "📸Instagram:5,▶️YouTube:5,💬WhatsApp:4,👻Snapchat:2,🎵Spotify:3,🎮Games:3,🛍️Shopping:1,🗺️Maps:1",
  Animals: "🐶Dog:5,🐱Cat:5,🦁Lion:3,🐘Elephant:3,🐧Penguin:2,🦒Giraffe:1,🐒Monkey:4,🐢Turtle:2",
  Sports: "🏏Cricket:5,⚽Football:5,🏀Basketball:3,🎾Tennis:2,🏸Badminton:4,🏊Swimming:2,🥊Boxing:1,🏐Volleyball:2",
  'School stuff': "✏️Pencil:5,📚Books:5,🎒Backpack:4,📏Ruler:3,🧮Abacus:1,🖍️Crayon:2,📓Notebook:4,🔔Bell:2",
  Superpowers: "🦸Flying:5,👁️Invisibility:4,💪Super strength:3,⏳Time travel:5,🧠Mind reading:2,🦎Shape shifting:1,⚡Super speed:4,🫧Teleporting:3",
  'Weekend plans': "🛌Sleep in:5,🎬Movie night:4,🍕Order food:5,🏞️Go outside:2,🎮Gaming:4,🧹Clean room:1,🛍️Shopping:3,📱Do nothing:5",
  Movies: "🦖Jurassic Park:3,🕷️Spider-Man:5,🧙Harry Potter:5,🚢Titanic:3,🦁The Lion King:4,👽E.T.:1,🧊Frozen:4,🚀Interstellar:2",
  Travel: "🏖️Beach:5,🏔️Mountains:4,🏙️Big city:3,🏕️Camping:2,🚂Train trip:4,🚢Cruise:2,🛣️Road trip:5,🏰Theme park:3",
  'Space things': "🌙Moon:5,🪐Saturn:4,🚀Rocket:5,👨‍🚀Astronaut:3,☄️Comet:2,🛸UFO:4,🌌Galaxy:3,🛰️Satellite:1",
  'Kitchen items': "🍳Pan:5,🥄Spoon:5,🧊Ice tray:2,🍞Toaster:3,🫖Kettle:4,🥥Coconut scraper:1,🔪Knife:4,🧽Sponge:3",
  'Indian celebrations': "🪔Diwali:5,🎨Holi:5,🪁Makar Sankranti:3,🌙Eid:4,🎄Christmas:4,🥁Navratri:3,🎆New Year:5,🍬Onam:2",
  'Things that fly': "🐦Bird:5,🪁Kite:4,✈️Airplane:5,🦋Butterfly:3,🚁Helicopter:2,🦇Bat:2,🪰Fly:4,🎈Balloon:3",
  'Things at the beach': "🏖️Sand:5,🐚Seashell:4,🦀Crab:3,🏄Surfboard:2,🩴Flip-flop:4,🪼Jellyfish:2,🪣Bucket:3,🧴Sunscreen:1",
  Weather: "☀️Sunny:5,🌧️Rainy:5,⛈️Thunderstorm:3,🌈Rainbow:4,❄️Snowy:2,🌫️Foggy:1,🌬️Windy:3,🌤️Partly cloudy:4",
  Music: "🎸Guitar:5,🥁Drums:4,🎹Piano:4,🎤Microphone:5,🎻Violin:2,🪘Tabla:3,🎺Trumpet:1,🪇Maracas:2",
  Desserts: "🍰Cake:5,🍦Ice cream:5,🍩Doughnut:4,🍮Pudding:3,🧁Cupcake:4,🍫Chocolate:5,🥧Pie:2,🍧Ice gola:3",
  Gadgets: "📱Phone:5,💻Laptop:5,🎧Headphones:4,⌚Smartwatch:3,📷Camera:3,🖨️Printer:1,🎮Console:4,🔋Power bank:2",
  Jobs: "👩‍⚕️Doctor:5,👨‍🍳Chef:4,👩‍🚀Astronaut:3,🧑‍🏫Teacher:5,🕵️Detective:3,🧑‍🎤Singer:4,🧑‍🚒Firefighter:2,🧙‍♂️Wizard:1",
  Fashion: "👟Sneakers:5,🧢Cap:4,🕶️Sunglasses:5,🧥Jacket:3,🧦Socks:2,👗Dress:4,🎒Backpack:3,🧣Scarf:1",
  Breakfast: "🥞Pancakes:4,🍳Eggs:5,🥣Cereal:4,🍞Toast:5,🧇Waffles:3,🍌Banana:2,☕Coffee:5,🫓Paratha:4",
  Transport: "🚌Bus:5,🚲Bicycle:4,🚕Taxi:5,🚂Train:5,🛵Scooter:4,🚀Rocket:1,🚜Tractor:2,🛺Auto rickshaw:5",
  Internet: "📧Email:4,📸Selfie:5,🎥Video call:5,🧵Thread:2,💬Group chat:5,🛒Online shopping:4,🧩Meme:5,🔍Search:3",
  'Indian landmarks': "🕌Taj Mahal:5,🗿Gateway of India:4,🛕Golden Temple:4,🏰Red Fort:5,🕉️Varanasi ghats:3,🌉Howrah Bridge:3,🪨Hampi:2,🏔️India Gate:4",
  'Mythical creatures': "🐉Dragon:5,🧜Mermaid:4,🦄Unicorn:5,🧞Genie:4,🧛Vampire:3,🧟Zombie:3,🧚Fairy:4,👹Ogre:2",
  Birds: "🦚Peacock:5,🦜Parrot:4,🦉Owl:4,🦩Flamingo:3,🦅Eagle:5,🐦Sparrow:3,🦆Duck:4,🐓Rooster:2",
  Chores: "🧹Sweeping:5,🧺Laundry:4,🍽️Dishes:5,🪴Water plants:3,🧼Bathroom:2,🛏️Make bed:4,🧽Dusting:3,🗑️Take out trash:2",
  'Party moments': "🎂Birthday cake:5,🎈Balloon pop:4,🎤Karaoke:5,🕺Dance battle:4,🎁Gift opening:5,📸Group photo:3,🎲Board game:2,🍕Late-night snacks:4",
  'In your backpack': "📓Notebook:5,🍎Apple:3,🔌Charger:5,🧦One sock:1,🧴Water bottle:4,🪙Loose coins:3,🍪Secret snack:5,🧻Random receipt:2"
}).forEach(([k, v]) => CATS[k] = v.split(',').map(s => {
  const i = s.search(/[A-Za-z]/), weightAt = s.lastIndexOf(':');
  return { e: s.slice(0, i), n: s.slice(i, weightAt), w: Number(s.slice(weightAt + 1)) };
}));

const AV = ['😎', '🤪', '👻', '🦊', '🐼', '🦄', '🤖', '🐸', '🔥', '👽', '🐯', '🧋'];
const BAD = /\b(fuck|shit|bitch|asshole|bastard|cunt|slut|porn)\w*/gi; // starter list, extend before public launch
const clean = t => String(t || '').replace(/[<>]/g, '').replace(BAD, '***').trim().slice(0, 80);
const nm = x => String(x || '').replace(/[<>]/g, '').trim().slice(0, 12) || 'Player';
const L = 'BCDFGHJKLMNPQRSTVWXZ';
const mkcode = () => { let c; do c = [0, 0, 0, 0].map(() => L[Math.random() * L.length | 0]).join(''); while (R[c]); return c; };
const wpick = o => { let t = o.reduce((a, x) => a + x.w, 0) * Math.random(); for (const x of o) if ((t -= x.w) < 0) return x.n; return o[0].n; };

// Each player only ever receives their own view. The machine's pick is never sent before the reveal.
function view(r, pid) {
  const content = r.content || emptyContent();
  const v = {
    code: r.code, ph: r.ph, host: r.host, round: r.round, total: r.total, type: r.type, mult: r.mult,
    content: { prompts: content.prompts.length, categories: Object.keys(content.categories).length },
    t: r.end ? Math.max(0, r.end - Date.now()) : 0,
    pl: Object.values(r.p).map(p => ({ id: p.id, n: p.n, a: p.a, s: p.s, on: p.on, d: r.d.has(p.id) }))
  };
  if (r.type === 'C' && ['intro', 'write', 'vote', 'results'].includes(r.ph)) v.prompt = r.prompt;
  if (r.type === 'C' && ['intro', 'write'].includes(r.ph)) { v.choices = content.prompts[r.pr][2]; if (r.ph === 'write') v.mineCap = r.caps[pid]; }
  if (r.type === 'D' && ['intro', 'pick', 'results'].includes(r.ph)) {
    v.cat = r.cat; v.opts = (r.opts || content.categories[r.cat] || []).map(o => ({ n: o.n, e: o.e }));
    if (r.ph === 'pick') v.minePick = r.picks[pid] || null;
  }
  if (r.ph === 'vote') {
    v.en = r.en.map(e => ({ k: e.k, t: e.t }));
    v.mine = r.en.filter(e => (e.authors || (e.by ? [e.by] : [])).includes(pid)).map(e => e.k);
  }
  if (r.ph === 'results') v.res = r.res;
  return v;
}
function push(r) { for (const p of Object.values(r.p)) if (p.on && p.sid) io.to(p.sid).emit('s', view(r, p.id)); }
function ensureTimer(r) {
  if (!r || !r.end || r.tm) return;
  const code = r.code, phase = r.ph, end = r.end;
  r.tm = setTimeout(() => expireRoom(code, phase, end), Math.max(0, end - Date.now()));
}
function go(r, ph, ms) {
  clearTimeout(r.tm); r.tm = 0; r.ph = ph; r.d = new Set(); r.end = ms ? Date.now() + ms : 0;
  ensureTimer(r); push(r);
}
function early(r) { // everyone online has acted, so skip the wait
  const on = Object.values(r.p).filter(p => p.on);
  if (on.length && on.every(p => r.d.has(p.id)) && ['write', 'vote', 'pick'].includes(r.ph)) {
    clearTimeout(r.tm); r.tm = 0; r.end = Date.now(); advance(r);
  }
}
function reset(r) {
  Object.values(r.p).forEach(p => p.s = 0);
  const content = r.content || emptyContent();
  r.round = 0; r.pq = shuf(content.prompts.map((_, i) => i)); r.cq = shuf(Object.keys(content.categories)); r.ci = 0; r.di = 0;
}

// Match plan: Caption, Caption, Don't Copy Me, repeat. The last round is worth double.
function next(r) {
  if (r.round >= r.total) { clearTimeout(r.tm); r.tm = 0; r.ph = 'final'; r.end = 0; r.d = new Set(); recordActivity('matchesCompleted'); return push(r); }
  r.round++; r.type = r.round % 3 === 0 ? 'D' : 'C'; r.mult = r.round === r.total ? 2 : 1;
  r.caps = {}; r.picks = {}; r.votes = {};
  if (r.type === 'C') { r.pr = r.pq[r.ci++ % r.pq.length]; r.prompt = r.content.prompts[r.pr][0]; }
  else { r.cat = r.cq[r.di++ % r.cq.length]; r.opts = r.content.categories[r.cat]; r.secret = wpick(r.opts); }
  go(r, 'intro', 1200);
}
function toVote(r) {
  const prompts = r.content.prompts;
  const submissions = Object.entries(r.caps)
    .filter(([, choice]) => Number.isInteger(choice) && prompts[r.pr][2][choice])
    .map(([by, choice]) => ({ by, t: prompts[r.pr][2][choice] }));
  if (Object.keys(r.p).length === 2) submissions.push({ by: null, t: prompts[r.pr][1] }); // bot caption keeps 2-player rounds votable

  // Identical choices become one anonymous voting option. Their authors share its caption points.
  const grouped = new Map();
  for (const submission of submissions) {
    let group = grouped.get(submission.t);
    if (!group) { group = { t: submission.t, authors: [], bot: false }; grouped.set(submission.t, group); }
    if (submission.by) group.authors.push(submission.by);
    else group.bot = true;
  }
  r.en = shuf([...grouped.values()]).map((e, k) => ({ ...e, authors: shuf(e.authors), k }));
  if (r.en.length < 2) { r.res = { en: [], dl: {} }; return go(r, 'results', 5000); }
  go(r, 'vote', 12000);
}
function tally(r) {
  const dl = {}; Object.keys(r.p).forEach(i => dl[i] = 0);
  const voters = Object.keys(r.votes).length, cnt = r.en.map(e => Object.values(r.votes).filter(k => k === e.k).length), mx = Math.max(...cnt);
  const share = (points, authors) => {
    if (!authors.length) return;
    const each = Math.floor(points / authors.length), extra = points % authors.length;
    authors.forEach((id, i) => { if (dl[id] !== undefined) dl[id] += each + (i < extra ? 1 : 0); });
  };
  r.en.forEach((e, i) => {
    const authors = e.authors || (e.by ? [e.by] : []);
    if (!authors.length) return;
    let points = cnt[i] * 20;                                  // +20 per vote
    if (mx > 0 && cnt[i] === mx) points += 10;                 // round winner
    if (mx >= 2 && cnt[i] === voters) points += 20;           // clean sweep
    share(points, authors);
  });
  for (const [pid, k] of Object.entries(r.votes)) if (mx > 0 && cnt[k] === mx) dl[pid] += 5; // good taste
  for (const i in dl) { dl[i] *= r.mult; r.p[i].s += dl[i]; }
  r.res = { en: r.en.map((e, i) => ({ k: e.k, t: e.t, by: e.by, authors: e.authors || (e.by ? [e.by] : []), bot: !!e.bot || (!e.authors && !e.by), v: cnt[i], w: mx > 0 && cnt[i] === mx })), dl };
  go(r, 'results', 5000);
}
function reveal(r) {
  const dl = {};
  for (const p of Object.values(r.p)) { const k = r.picks[p.id]; dl[p.id] = !k ? 0 : (k === r.secret ? -10 : 20) * r.mult; p.s += dl[p.id]; }
  r.res = { secret: r.secret, picks: { ...r.picks }, dl };
  go(r, 'results', 5000);
}

function advance(r) {
  const phase = r.ph; r.end = 0;
  if (phase === 'intro') return r.type === 'C' ? go(r, 'write', 20000) : go(r, 'pick', 12000);
  if (phase === 'write') return toVote(r);
  if (phase === 'vote') return tally(r);
  if (phase === 'pick') return reveal(r);
  if (phase === 'results') return next(r);
}

function expireRoom(code, phase, end) {
  withRoomLock(code, r => {
    if (!r || r.ph !== phase || r.end !== end || Date.now() < end) return;
    r.tm = 0; advance(r);
  }).catch(err => console.error('Room timer:', err.message));
}

const pid = x => String(x || '').slice(0, 40);
io.on('connection', s => {
  s.on('activity', d => {
    if (!stateRedis) return;
    const id = pid(d && d.id);
    if (!id) return;
    const now = Date.now();
    Promise.all([
      stateRedis.zadd(onlineKey, now, id),
      stateRedis.zremrangebyscore(onlineKey, '-inf', now - 60000),
      stateRedis.set(`meme-machine:visitor:${id}`, '1', 'EX', 2592000, 'NX')
    ]).then(([, , firstVisit]) => {
      if (firstVisit === 'OK') recordActivity('uniqueVisitors');
    }).catch(err => console.error('Activity heartbeat:', err.message));
  });
  const enter = (r, id, n, a) => {
    let p = r.p[id];
    if (p) { p.sid = s.id; p.on = true; }
    else r.p[id] = { id, n, a: AV.includes(a) ? a : AV[0], s: 0, on: true, sid: s.id };
    if (!r.host || !r.p[r.host] || !r.p[r.host].on) r.host = id;
    s.data = { c: r.code, i: id }; s.emit('in', { code: r.code, id }); push(r); ensureTimer(r);
  };

  s.on('create', d => {
    const id = pid(d && d.id); if (!id) return s.emit('err', 'Choose a player name and try again.');
    (async () => {
      let code;
      do { code = mkcode(); } while (stateRedis && await stateRedis.exists(roomKey(code)));
      await withRoomLock(code, r => {
        if (r) return;
        const room = R[code] = { code, host: id, p: {}, ph: 'lobby', round: 0, total: 6, end: 0, d: new Set(), votes: {}, caps: {}, picks: {} };
        room.content = emptyContent(); reset(room); enter(room, id, nm(d.n), d.a); recordActivity('roomsCreated');
      });
    })().catch(err => s.emit('err', err.message || 'Could not create a room.'));
  });

  s.on('join', d => {
    const code = String(d && d.code || '').toUpperCase(), id = pid(d && d.id);
    if (!/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(code) || !id) return s.emit('err', 'Enter a valid room code and player name.');
    withRoomLock(code, r => {
      if (!r) return s.emit('err', 'Room not found. Check the code.');
      const isNew = !r.p[id];
      if (isNew && r.ph !== 'lobby') return s.emit('err', 'That game has already started.');
      if (isNew && Object.keys(r.p).length >= 8) return s.emit('err', 'Room is full (8 players).');
      enter(r, id, nm(d.n), d.a);
      if (isNew) recordActivity('playersJoined');
    }).catch(err => s.emit('err', err.message || 'Could not join this room.'));
  });

  s.on('cfg', withPlayerRoom(s, (r, p, t) => {
    if (r.host !== p.id || r.ph !== 'lobby') return;
    r.total = [4, 6, 8].includes(+t) ? +t : 6; push(r);
  }));
  s.on('start', withPlayerRoom(s, async (r, p) => {
    if (r.host !== p.id || r.ph !== 'lobby' || Object.keys(r.p).length < 2) return;
    r.content = await loadGameContent(); reset(r); next(r); recordActivity('matchesStarted');
  }));
  s.on('cap', withPlayerRoom(s, (r, p, t) => {
    if (r.ph !== 'write' || r.d.has(p.id)) return;
    const choice = Number(t);
    const prompts = (r.content || emptyContent()).prompts;
    if (!Number.isInteger(choice) || choice < 0 || choice >= prompts[r.pr][2].length) return;
    r.caps[p.id] = choice; r.d.add(p.id); recordActivity('captionPicks'); push(r); early(r);
  }));
  s.on('vote', withPlayerRoom(s, (r, p, k) => {
    if (r.ph !== 'vote') return; const e = r.en.find(e => e.k === k);
    if (!e || (e.authors || (e.by ? [e.by] : [])).includes(p.id)) return;
    r.votes[p.id] = k; r.d.add(p.id); recordActivity('votes'); push(r); early(r);
  }));
  s.on('pick', withPlayerRoom(s, (r, p, n) => {
    if (r.ph !== 'pick' || !(r.opts || []).some(o => o.n === n)) return;
    r.picks[p.id] = n; r.d.add(p.id); recordActivity('dontCopyPicks'); push(r); early(r);
  }));
  s.on('tick', withPlayerRoom(s, r => {
    if (!r.end || Date.now() < r.end) return;
    clearTimeout(r.tm); r.tm = 0; advance(r);
  }));
  s.on('again', withPlayerRoom(s, (r, p) => {
    if (r.host !== p.id || r.ph !== 'final') return;
    reset(r); go(r, 'lobby', 0);
  }));
  s.on('leave', () => {
    const code = s.data && s.data.c, id = s.data && s.data.i;
    if (!code || !id) return;
    s.data = {};
    withRoomLock(code, r => {
      const p = r && r.p[id];
      if (!p || p.sid !== s.id) return;
      p.on = false;
      if (r.ph === 'lobby') delete r.p[id];
      if (r.host === id) {
        const nextHost = Object.values(r.p).find(q => q.on);
        r.host = nextHost ? nextHost.id : null;
      }
      push(r); early(r);
    }).catch(err => s.emit('err', err.message || 'Could not leave the room cleanly.'));
  });
  s.on('disconnect', withPlayerRoom(s, (r, p) => {
    if (p.sid !== s.id) return;
    p.on = false; if (r.ph === 'lobby') delete r.p[p.id];
    if (r.host === p.id) { const n = Object.values(r.p).find(q => q.on); if (n) r.host = n.id; }
    push(r); early(r);
  }));
});

module.exports = srv;
