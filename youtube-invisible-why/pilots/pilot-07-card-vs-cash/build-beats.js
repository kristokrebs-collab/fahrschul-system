#!/usr/bin/env node
// Builds beats.json for pilot-07: cinematic still-photo beats, each with an
// image prompt, a Ken Burns camera move, and the EXACT narration text it
// covers. The narration fields below are verbatim from script.md — beats
// must carry real sentences, not paraphrases, because the concatenated
// beat narration IS what gets sent to the TTS, and word-count-proportional
// timing (used for both scene cuts and burned captions) only stays accurate
// if the words here are the words actually spoken.
//
// v1 of this file used short paraphrased summaries per beat and undershot
// the 1480-word script by nearly 40% (948 words), which would have produced
// a 6-minute video against a 9-12 minute target. Fixed by pulling every
// sentence from script.md verbatim.
//
// Format: photoreal cinematic stills (Ken Burns), NOT the pen-on-paper
// format used by pilots 1-6 — see pilots/pilot-07-card-vs-cash/README.md.

const fs = require("fs");
const path = require("path");

const STYLE = "cinematic 3D render, dramatic single-source spotlight or rim lighting, shallow depth of field, volumetric haze, teal and amber color grade, heavy film grain, anamorphic lens character, photoreal materials, moody, high contrast, 35mm film look, no text, no watermark, no logos";

// [narration (verbatim from script.md), subject prompt, camera move]
const BEATS = [
  // COLD OPEN
  ["There's a version of you that spends more money.",
    "a silhouetted figure standing at a dark counter, single spotlight from above, reaching a hand forward into the light", "push-in"],
  ["It has the same income, the same self-control, the same intentions.",
    "two identical wallets side by side on a dark reflective table, one leather one unopened, dramatic side light", "pan-right"],
  ["The only difference is what's in your hand when you pay.",
    "extreme close-up of a hand, one side holding folded cash, other side a credit card, dramatic split lighting", "zoom-in"],
  ["Researchers have now measured this so many times that the number isn't really in question anymore:",
    "a glowing bar chart made of light hovering in dark space, two bars, one twice the height of the other, amber glow", "push-in"],
  ["people bidding with a credit card will pay close to double what they'll pay in cash, for the exact same item,",
    "extreme macro of a credit card corner tapping a payment terminal, blue NFC glow radiating outward, dark background", "zoom-out"],
  ["in the exact same room, minutes apart.",
    "a single ticket stub glowing under a spotlight on black velvet, dust particles floating in the light beam", "static"],

  // PROMISE
  ["This isn't a metaphor about discipline.",
    "a closed fist over a dark table, dramatic top light, tension in the knuckles, shallow depth of field", "push-in"],
  ["It's a measurable gap in how your brain processes a plastic tap versus watching bills leave your hand.",
    "a stylized glowing human brain floating in dark space, one region pulsing bright amber, rest dim blue", "zoom-in"],
  ["By the end of this, you'll know exactly where that gap lives — and the one change that closes it without you having to feel virtuous about it.",
    "a single door glowing faintly at the end of a long dark corridor, warm light spilling from underneath", "push-in"],

  // SETUP
  ["In 2001, two researchers ran an auction at MIT.",
    "a dim university lecture hall at night, empty wooden seats lit by a single podium lamp, dust in the light shaft", "pan-left"],
  ["Real students, real money, bidding on real tickets to a sold-out basketball game — something they actually wanted.",
    "a basketball ticket stub spinning slowly in mid-air under a spotlight, dark background, motion blur trail", "zoom-out"],
  ["Half the room was told: if you win, you pay in cash, right now, out of your wallet.",
    "a worn leather wallet opening under dramatic light, folded bills visible inside, dust motes, dark background", "zoom-in"],
  ["The other half was told: if you win, it goes on your card.",
    "a single credit card resting on black glass, sharp reflection, cold blue rim light from behind", "static"],
  ["Same tickets. Same room. Same students, on average, with the same money in the bank.",
    "two identical spotlight beams crossing on an empty dark stage, symmetrical composition, haze", "pan-right"],
  ["The card bidders didn't bid a little more.",
    "close-up of anonymous hands raising a paddle in a dim auction room, warm rim light from one side", "push-in"],
  ["They bid, on average, more than double what the cash bidders were willing to pay for the identical seat.",
    "a glowing amber number counting upward rapidly in dark space, motion blur on the digits, volumetric light", "zoom-in"],
  ["Nobody told them to bid more, and nobody made the tickets worth more to one group than the other.",
    "a scale balancing perfectly in dark space, two identical glowing orbs on each side, teal light", "static"],
  ["The only variable that changed was the motion their hand was about to make.",
    "extreme macro of a hand mid-motion reaching toward a card reader, blue glow, shallow focus", "zoom-in"],

  // FIRST EXPLANATION
  ["The obvious explanation is that a card just feels abstract —",
    "a translucent glass credit card floating and slowly dissolving into particles of light, dark background", "push-in"],
  ["you're not \"really\" spending until the bill arrives.",
    "a stack of unopened envelopes on a dark table lit by one hard light, one envelope glowing faintly", "pan-left"],
  ["True, but incomplete, because it doesn't explain the size of the gap.",
    "a wide crack of light splitting across a dark wall, dramatic single beam, volumetric dust", "zoom-out"],
  ["A vague sense of abstraction should shave a little off your caution.",
    "a small dim candle flame in a dark room, barely illuminating a coin beside it", "static"],
  ["It shouldn't double what you're willing to pay.",
    "two identical candle flames, one twice the size and brightness of the other, dark symmetrical composition", "pan-right"],
  ["Something more specific is happening in the half-second before you commit to a cash payment that simply does not happen with a card.",
    "extreme macro of a fingertip an inch above a single banknote on black glass, tension, dramatic side light", "push-in"],
  ["And it turns out neuroscientists can actually watch it happen.",
    "a glowing translucent brain scan floating in dark space, cross-section visible, cold blue light with one warm spot", "zoom-in"],

  // TURN
  ["Researchers have scanned people's brains while they made purchase decisions,",
    "a dark medical scanning room, a soft blue ring of light glowing in the center, clinical and cold, haze", "zoom-out"],
  ["and they found that looking at a price and deciding to pay it in cash activates the insula —",
    "a glowing human brain in dark space, deep central region pulsing bright red-amber like a heartbeat", "push-in"],
  ["the same brain region that lights up when you experience physical pain or something viscerally unpleasant —",
    "a single drop of red-amber light falling in slow motion into dark water, rippling outward, macro", "zoom-in"],
  ["not a metaphor, an overlapping neural signature you can actually see on a scan.",
    "two translucent glowing brain shapes overlapping precisely in dark space, one red one amber, shared core", "push-in"],
  ["Behavioral economists have a name for this: the pain of paying.",
    "a single banknote crumpling slowly in mid-air, dramatic top light, dark background, dust particles", "zoom-in"],
  ["And it turns out the pain isn't really about the money leaving.",
    "a wallet lying open and empty on a dark table, single spotlight, long dramatic shadow", "pan-left"],
  ["It's about noticing the money leaving.",
    "extreme close-up of an eye reflecting a small glowing amber light, sharp focus on the iris, dark surroundings", "zoom-in"],
  ["Cash makes you notice, every single time, because you physically hand over a diminishing, countable object.",
    "a hand slowly counting out banknotes one by one under a warm spotlight, dark background, each bill catching light", "push-in"],
  ["A card tap produces almost no sensory trace at all —",
    "a credit card tapping a terminal in complete silence, a faint blue pulse of light, everything else pitch black", "static"],
  ["same amount of money, a completely different amount of noticing.",
    "two identical stacks of glowing light-coins, one sharply in focus and detailed, one blurred into a soft haze", "pan-right"],

  // TURN CONTINUED — casinos
  ["This is where casinos come in, and it is not a coincidence.",
    "a dim casino floor at night, rows of empty tables lit by low hanging lamps, red and gold ambient glow, haze", "pan-left"],
  ["Casinos replace your cash with chips at the door —",
    "a stack of casino chips glowing under a single spotlight on green felt, dramatic shadow, dark background", "zoom-in"],
  ["and researchers studying gambling behavior have found that people wager more, and lose track of losses more easily,",
    "casino chips sliding across a dark table in slow motion, motion blur trail, dramatic low angle light", "push-in"],
  ["when they're playing with chips instead of cash, even though a chip has an identical, printed dollar value.",
    "extreme macro of a single casino chip's engraved value number, sharp focus, dark reflective surface", "static"],
  ["The chip is doing exactly what the credit card does.",
    "a casino chip and a credit card resting side by side on black glass, matched dramatic lighting, symmetrical", "push-in"],
  ["It's a token that represents money without triggering the physical loss signal that real cash produces.",
    "a glowing translucent token hovering above an open hand, casting no visible weight or shadow, dark background", "zoom-in"],
  ["You are, in a very real sense, gambling in chips every time you tap a card at a coffee shop.",
    "a steaming coffee cup beside a credit card on a dark cafe counter, warm spotlight, shallow depth of field", "pan-right"],

  // DEEPER CAUSE
  ["So who benefits from this gap, and did anyone design it on purpose?",
    "an empty dark boardroom table lit by a single overhead light, no people, long shadows, tension", "zoom-out"],
  ["Card networks didn't invent the pain of paying — it's a real, old feature of how human brains process loss.",
    "an old brass scale in a dark archive room, dust falling through a single shaft of light", "static"],
  ["But once it was documented, it became something you could build a business around.",
    "a weathered antique coin resting in an open palm, dramatic warm side light, dark background", "push-in"],
  ["Contactless payment wasn't made faster because faster is inherently better.",
    "a payment terminal's screen glowing green in an otherwise pitch black room, dramatic isolated light", "push-in"],
  ["It was made faster because every extra second of friction — a signature, a PIN, counting change —",
    "a hand counting loose coins on a dark wooden table, warm low light, shallow depth of field", "static"],
  ["is a second in which your brain has a chance to notice what's happening and reconsider.",
    "a single grain of sand falling in an hourglass, macro, dramatic rim light, dark background", "zoom-in"],
  ["You can watch this being engineered on purpose, in public, with a patent number attached.",
    "an old patent document glowing under a desk lamp in a dark archive, dust motes, sepia light", "push-in"],
  ["In 1999, Amazon patented \"1-Click\" checkout — a system whose entire stated purpose was removing every remaining step",
    "a single glowing button floating in dark space, a finger approaching it, dramatic blue light", "zoom-in"],
  ["between wanting something and having bought it —",
    "a glowing shopping cart icon dissolving instantly into a single point of light, dark background", "zoom-out"],
  ["not making the product better, not making the price lower, just making the moment of paying disappear.",
    "a credit card fading to transparent and vanishing entirely against a dark background, slow dissolve", "static"],
  ["It worked well enough that Amazon licensed the patent to Apple for its own checkout,",
    "two glowing interlocking rings of light in dark space, representing a licensing handoff, cold blue tone", "push-in"],
  ["and the entire e-commerce industry spent the next decade building toward the same idea under different names.",
    "a long dark corridor of glowing arches receding into the distance, each one dimmer than the last", "push-in"],
  ["The newest version of this is buy-now-pay-later.",
    "a single banknote splitting apart into four smaller glowing fragments drifting in dark space", "zoom-in"],
  ["Instead of one payment you'd feel once, the price gets split into four smaller ones, spread across weeks,",
    "four small glowing coins arranged in a row, each dimmer than a single large one beside them, dark background", "pan-right"],
  ["each individually too small to trigger much of a pain response at all.",
    "a tiny spark of light fading almost instantly against total darkness, barely visible", "static"],
  ["The total amount you owe doesn't change.",
    "a glowing total number holding perfectly steady in dark space, unmoving, quiet emphasis", "static"],
  ["What changes is how many separate moments of noticing you'd have to sit through to feel the whole thing.",
    "a calendar page glowing faintly with four small marked dates, dark background, soft warm light", "zoom-out"],
  ["The entire design history of payment technology — tap to pay, one-click checkout, saved card details, stored balances in an app, installments —",
    "a smartphone glowing in a dark room, a single payment icon pulsing softly, shallow depth of field", "zoom-in"],
  ["moves in exactly one direction: removing the moments where you'd feel the money leave.",
    "a hand releasing a glowing coin that dissolves into light particles before it lands, dark background", "zoom-out"],
  ["This isn't a conspiracy with a villain in a room.",
    "a single empty chair in a vast dark boardroom, spotlight from above, nobody present", "static"],
  ["It's thousands of independent product decisions, each one tested against a single number — completed transactions —",
    "hundreds of tiny glowing dots of light scattered in dark space, slowly converging toward one bright point", "push-in"],
  ["that all happened to point the same way.",
    "a glowing arrow made of light, formed from many small converging particles, pointing forward in darkness", "zoom-in"],
  ["The system didn't need to understand your insula to exploit it.",
    "a translucent glowing brain silhouette dissolving into abstract light particles, dark background", "zoom-out"],
  ["It only needed to notice that friction loses money.",
    "a single drop of liquid light sliding down a dark pane of glass, leaving a faint glowing trail", "static"],

  // FAIRNESS
  ["It's worth being fair to the technology here.",
    "two hands open and empty, facing upward under soft even light, dark neutral background", "zoom-out"],
  ["Cards and contactless payment solved real problems — carrying cash is genuinely unsafe in some places,",
    "a dark alley at night, a single dropped coin catching a sliver of streetlight, tension", "static"],
  ["splitting a bill is genuinely easier,",
    "several credit cards fanned out neatly on a restaurant table, warm ambient light, shallow depth of field", "pan-left"],
  ["and for a lot of purchases the convenience is a real, legitimate benefit, not a trick.",
    "a smartphone tapping a payment terminal with a warm green checkmark glow, clean and simple lighting", "zoom-in"],
  ["And the effect isn't infinite or uniform.",
    "a glowing gradient bar fading smoothly from bright amber to dim blue in dark space", "pan-right"],
  ["It's strongest for discretionary, in-the-moment purchases — the coffee, the impulse buy, the extra round —",
    "a hand impulsively grabbing a small glowing object off a shelf in a dim store aisle", "push-in"],
  ["and weaker for large, planned purchases where you've already done the mental math before you ever reach the counter.",
    "a large stack of paper documents and a calculator under a focused desk lamp, deep dark background", "zoom-out"],
  ["This is a bias in the margins of your spending, not a hypnosis that doubles your mortgage.",
    "a house key resting heavily on a dark table under a single grounded, steady light, no glow, solid and real", "static"],
  ["It's also worth saying that the doubled bid from that one MIT auction is a striking headline number, not a universal constant —",
    "a single bright number slowly dimming to a more modest glow in dark space, honest correction", "zoom-in"],
  ["the size of the gap moves with the product, the price range, and who's buying.",
    "several glowing bars of varying, uneven heights hovering in dark space, irregular and real", "pan-right"],
  ["What researchers studying this have found consistently, across many separate studies using different purchases and different methods,",
    "many small glowing data points scattered across dark space, loosely aligned in one general direction", "zoom-out"],
  ["is the direction, not a fixed multiplier: cash payment reliably produces more caution than card payment, for the same person, buying the same thing.",
    "a single steady compass needle glowing faintly, pointing consistently in one direction in dark space", "push-in"],
  ["Treat \"double\" as a real, measured result from a real study — not as the number you should expect on every purchase you make.",
    "a glowing asterisk symbol floating quietly beside a large number in dark space, careful and precise", "static"],

  // PAYOFF SETUP
  ["So if the mechanism is \"less noticing equals more spending,\" the fix isn't willpower.",
    "a clenched fist slowly opening under dramatic light, releasing into an open, relaxed hand", "push-in"],
  ["Telling yourself to \"be more careful with the card\" asks you to manually override a gap in sensory feedback, every single time, forever —",
    "a glowing warning icon flickering weakly and fading out in dark space, losing intensity over time", "zoom-in"],
  ["that's not a plan, that's a New Year's resolution.",
    "an old clock with no hands, glowing faintly, suspended in dark space, quietly useless", "zoom-out"],
  ["What actually works is putting the noticing back in, deliberately, somewhere you'll actually encounter it.",
    "a single candle being relit in total darkness, the flame catching and steadily growing brighter", "push-in"],

  // PAYOFF
  ["Some people do this by paying cash for exactly the categories where they overspend most —",
    "a hand deliberately placing folded cash into a small labeled dark envelope, warm focused light", "static"],
  ["the ones this effect hits hardest — and leaving cards for the planned, deliberate purchases where the bias barely applies anyway.",
    "a credit card resting calmly in a drawer, soft even light, orderly and deliberate composition", "pan-left"],
  ["That alone tends to shrink the gap without you white-knuckling your way through every single transaction.",
    "an open hand simply resting, relaxed, under soft warm light, nothing forced or tense", "static"],
  ["Others go a step further and use a spending app that shows a running total every time they tap,",
    "a smartphone screen glowing softly with a rising numeric total, warm ambient light, shallow focus", "zoom-in"],
  ["or a card that sends an instant notification with the new balance the moment it's charged.",
    "a phone screen lighting up in a dark room with a single soft notification glow", "push-in"],
  ["Neither of those is a gimmick — they're rebuilding, on purpose, a version of the same signal cash used to give you for free:",
    "a glowing digital counter ticking downward steadily in dark space, each digit change catching light", "push-in"],
  ["a number, changing, that you actually saw.",
    "a single eye slowly opening in extreme close-up, catching a warm point of light in the iris", "zoom-in"],
  ["A weekly ritual works too — sitting down once a week and looking at exactly what left your account",
    "a calm desk lit by a single warm lamp at night, a notebook open, quiet and deliberate", "static"],
  ["produces a smaller version of the same effect as handing over bills, just delayed by a few days instead of happening in real time.",
    "a warm lamp slowly dimming and steadying into a calm, constant glow, dark room, peaceful", "zoom-out"],
  ["Neither of those requires more discipline.",
    "a steady, calm open hand under warm even light, dark background, nothing dramatic, simply present", "static"],
  ["They just put a form of noticing back into a system that was specifically engineered to remove it.",
    "a single warm light steadily illuminating a plain wooden table, honest and unadorned, dark surroundings", "zoom-out"],
  ["Here's the part worth sitting with.",
    "a single spotlight slowly widening to reveal more of a dark room, quiet and deliberate reveal", "zoom-out"],
  ["You didn't imagine that spending felt different with a card. It is different —",
    "a credit card and folded cash side by side, one glowing faintly, one solid and matte, dramatic split light", "static"],
  ["measurably, at the level of which part of your brain lights up.",
    "a glowing human brain silhouette in dark space, one clear region pulsing warm and bright, rest calm", "push-in"],
  ["You're not bad at money.",
    "a steady, calm open hand under warm even light, dark background, nothing dramatic, simply present", "static"],
  ["You're a person with a normal, well-documented brain, tapping a piece of plastic",
    "a single warm light steadily illuminating a plain wooden table, honest and unadorned, dark surroundings", "zoom-out"],
  ["that was engineered, gradually and mostly by accident, to feel like nothing at all.",
    "a credit card tap fading into pure silence and darkness, the blue glow dimming completely to black", "zoom-in"],
  ["Now you know exactly what that nothing is standing in for.",
    "a wide, slow reveal of a dark room where a single spotlight now clearly illuminates an open wallet full of cash and a credit card together, calm, resolved, cinematic final composition", "zoom-out"],
];

const scenes = BEATS.map(([narration, subject, camera], i) => ({
  index: i,
  narration,
  camera,
  image_prompt: `${subject}, ${STYLE}`,
}));

const outPath = path.join(__dirname, "beats.json");
fs.writeFileSync(outPath, JSON.stringify({ video_id: "pilot-07-card-vs-cash", accent_color: "#E4A62E", scenes }, null, 2));

const totalWords = scenes.reduce((a, s) => a + s.narration.trim().split(/\s+/).length, 0);
console.log(`${scenes.length} beats, ${totalWords} words, ${(totalWords / 155 / 60 * 60).toFixed(1)} min at 155wpm`);
