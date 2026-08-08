#!/usr/bin/env node
// Builds beats.json for pilot-08 (loss aversion): cinematic-stills pipeline,
// same lineage as pilot-07, with two changes learned from Pilot 7's
// reception ("sichtbar KI, zu teuer, keine Bewegungstiefe"):
//
// 1. FEWER, LONGER-HELD SHOTS. Pilot 7 used ~101 beats (~1 per sentence,
//    ~4s each) — 300+ credits and each shot too short to register as more
//    than a flash. This file groups 2-4 sentences per still beat instead,
//    targeting ~50 stills instead of ~100 for the same runtime.
//
// 2. REAL VIDEO CLIPS AT HERO MOMENTS. `shot_type: "video"` beats are
//    rendered with an actual AI video model (real camera motion/depth,
//    not a Ken-Burns zoom on a flat image) instead of ffmpeg zoompan. Kept
//    to single striking sentences so clip length matches spoken duration
//    without needing to freeze-extend. ~10 of ~61 beats are video — the
//    "Ziel" cost tier from the planning doc (~290 credits total).
//
// Narration fields are VERBATIM from script.md (lesson from pilot-07 v1,
// which paraphrased and undershot word count by ~40%) — concatenated
// narration IS the TTS input and word-count-proportional timing depends
// on these being the actual spoken words.

const fs = require("fs");
const path = require("path");

// Same cinematic-grade suffix as pilot-07 for cross-video channel
// consistency (per plan: "denselben Cinematic-Grade-Suffix wie Pilot 7").
const STYLE = "cinematic 3D render, dramatic single-source spotlight or rim lighting, shallow depth of field, volumetric haze, teal and amber color grade, heavy film grain, anamorphic lens character, photoreal materials, moody, high contrast, 35mm film look, no text, no watermark, no logos";

// Recurring visual leitmotif (plan requirement: "ein festes visuelles
// Leitmotiv, in jedem Prompt referenziert" — the closest we can get to
// character consistency without Soul training, which needs a credit
// decision first). Two recurring props tied directly to the two central
// experiments: a coin (the coin-flip bet) and a plain ceramic mug (the
// endowment-effect experiment) bookend the video.
const MOTIF = "a single well-worn silver coin and a plain white ceramic mug recurring as visual motifs";

// Video model for hero-moment clips: real camera motion/depth instead of
// zoom-on-still. std mode, sound on (per cost preflight: ~7.5cr/5s).
const VIDEO_MODEL = "cinematic_studio_video_v2";

// [narration (verbatim), subject prompt, camera move OR video motion description, shot_type]
const BEATS = [
  // COLD OPEN
  ["Imagine someone offers you a coin flip: heads, you win 150 dollars; tails, you lose 100.",
    "a silver coin flipping slowly in mid-air above an open palm in a dark room, single dramatic spotlight, suspended motion",
    "the coin tumbles in slow motion through a shaft of light, camera orbiting slightly, extreme shallow focus, dust particles catching the beam", "video"],
  ["Any calculator will tell you this is a good bet — on average, you come out ahead.",
    "a glowing green plus-150 and red minus-100 hovering in dark space on either side of a balance scale, scale tilted toward the green side", "push-in", "still"],
  ["Most people turn it down anyway, and not because they're bad at math.",
    "a closed fist hovering just above the coin on a dark table, hesitation, dramatic top light, shallow depth of field", "static", "still"],
  ["There's a specific asymmetry wired into how your brain values a loss compared to an equal-sized gain, discovered in an experiment that eventually won a Nobel Prize —",
    "a stylized glowing human brain floating in dark space, one hemisphere pulsing sharp red, the other calm amber, asymmetric", "zoom-in", "still"],
  ["and once you know where it lives, you'll notice it running almost every decision you make about money.",
    "a single glowing coin resting at the center of a wide dark room, spotlight from directly above, long shadows radiating outward", "zoom-out", "still"],

  // PROMISE
  ["This isn't about being cautious, or risk-averse in some vague sense.",
    "a steady open hand under warm even light, dark background, calm and deliberate, nothing dramatic", "static", "still"],
  ["It's a specific, measurable ratio between how much a loss hurts and how much an equivalent gain feels good — and by the end of this, you'll know exactly what that ratio is, and the one reframe that can shrink it.",
    "a brass balance scale in dark space, one side weighted heavier and dipped lower, glowing faint numbers above each side", "push-in", "still"],

  // SETUP
  ["In the late 1970s, two psychologists named Daniel Kahneman and Amos Tversky ran a version of exactly that coin flip on real people, with real stakes, across dozens of variations.",
    "a dim university office at night, papers and coin-flip charts spread across a wooden desk, single desk lamp, dust in the light", "pan-left", "still"],
  ["The pattern held up over and over: most people need the potential win to be roughly twice the size of the potential loss before the bet starts to feel fair, even though, mathematically, a much smaller ratio would already make the bet worth taking.",
    "a glowing brass balance scale, one side loaded with two coin-stacks, the other with one, slowly settling into imbalance", "zoom-in", "still"],
  ["Kahneman and Tversky mapped this pattern onto a curve — plotting how good a gain feels against how bad an equivalent loss feels, using the same person's own ratings.",
    "a glowing amber line graph curve hovering in dark space, faint grid lines, one axis crossing at a bright zero point", "static", "still"],
  ["If gains and losses felt symmetrical, the curve would look the same on both sides of zero. It doesn't.",
    "a glowing line graph curve in dark volumetric space, camera pushes in as the curve's left side steepens sharply red while the right side stays shallow amber",
    "slow push-in as the curve visibly steepens on one side, dramatic reveal, particles drifting through the light", "video"],
  ["The loss side of the curve is steeper — a lot steeper — meaning the exact same amount of money produces a stronger emotional reaction when you're losing it than when you're gaining it.",
    "extreme close-up of the steep red half of a glowing graph curve, sharp angle, dramatic rim light, dark background", "zoom-in", "still"],
  ["They called this loss aversion, and the finding was significant enough that Kahneman won the Nobel Prize in Economics for it in 2002 — one of psychology's few direct crossovers into an economics prize.",
    "a gold medal slowly rotating in a shaft of spotlight, dark velvet background, dust motes, reverent and cinematic",
    "slow orbit around the rotating medal, light catching each facet, shallow depth of field, dark stage", "video"],

  // FIRST EXPLANATION
  ["The obvious explanation is that people are just naturally cautious about money, and losses simply feel bad.",
    "a single dim candle flame in a dark room, small and steady, barely illuminating a coin beside it", "static", "still"],
  ["True, but incomplete — because caution alone doesn't explain why the loss side of the curve is specifically steeper than the gain side, rather than the two simply being smaller overall.",
    "a wide crack of light splitting across a dark wall, one side of the crack brighter and sharper than the other", "zoom-out", "still"],
  ["If it were pure caution, you'd expect people to undervalue both gains and losses evenly — a flatter curve overall, not a lopsided one. That's not the shape researchers keep finding.",
    "two glowing line graphs side by side in dark space, one flat and symmetrical, one sharply lopsided, comparison", "pan-right", "still"],
  ["The asymmetry is specific: losing a given amount consistently registers as worse than gaining that same amount feels good, at a ratio that shows up again and again across completely different kinds of decisions.",
    "a series of glowing balance scales receding into darkness, each one tilted the same direction, repeating pattern", "push-in", "still"],
  ["Something is happening that treats \"losing what you have\" as a fundamentally different kind of event than \"not gaining something new\" — and that difference turns out to be measurable in a much more direct way than a coin-flip questionnaire.",
    "a closed hand releasing a single coin into darkness versus an open hand reaching for one, split composition, dramatic light", "zoom-in", "still"],

  // TURN — endowment effect
  ["Kahneman, along with economists Jack Knetsch and Richard Thaler, ran a now-famous experiment to test this directly.",
    "a plain white ceramic mug resting alone on a dark wooden table, single warm spotlight, shallow depth of field", "static", "still"],
  ["They gave one group of people a coffee mug, for free, and asked the lowest price they'd be willing to sell it for.",
    "a hand placing a plain white ceramic mug into another open palm, warm light, dark background, tactile close-up",
    "slow handoff of the mug between two hands, camera drifting alongside, warm light catching the ceramic surface", "video"],
  ["A second group, who never received a mug, was asked the highest price they'd pay to buy the identical one.",
    "an identical plain white ceramic mug alone on a dark shelf, unreachable behind a thin sheet of glass, cool blue light", "pan-left", "still"],
  ["Basic economics says these two numbers should land close together — it's the same mug, same market, same people, chosen at random. They didn't.",
    "two identical mugs on a balance scale, scale tilted heavily toward one side despite both mugs looking identical", "zoom-in", "still"],
  ["The people who already owned the mug demanded roughly twice as much to give it up as the other group was willing to pay to get one.",
    "a glowing price tag hovering above a mug, the number visibly doubling, amber glow intensifying, dark background", "push-in", "still"],
  ["Nothing about the mug had changed. The only difference was which side of ownership a person happened to be standing on —",
    "a single mug lit from two opposite sides simultaneously, one warm one cold, symmetrical dramatic lighting", "static", "still"],
  ["and simply possessing something, even for a few minutes, was enough to make losing it feel like a bigger deal than never having had it at all.",
    "a hand's shadow closing protectively around a mug on a dark table, dramatic single light, tension in the fingers", "zoom-in", "still"],
  ["Researchers now call this the endowment effect, and it's the same steep loss-side curve from the coin flip, showing up in a completely different kind of decision.",
    "a mug and a coin resting together on black velvet under one spotlight, connected by a faint glowing line between them", "zoom-out", "still"],

  // TURN continued — amygdala / neuroscience
  ["Brain-imaging researchers have gone looking for where this asymmetry actually lives, and they've found that how a choice is framed — as a potential loss versus a potential gain, even when the underlying numbers are identical — changes activity in the amygdala, a region closely tied to processing fear and threat.",
    "a glowing human brain in dark volumetric space, deep red light igniting sharply at the amygdala region near the center",
    "slow push-in on the brain as the amygdala region flares bright red, pulsing, dramatic medical-cinematic lighting", "video"],
  ["Present the exact same financial choice as \"keep 40 percent\" instead of \"lose 60 percent,\" and people's decisions shift, along with the brain activity underlying them, even though both phrases describe precisely the same outcome.",
    "two glowing readouts hovering side by side in dark space, identical pie charts, one lit amber one lit red, same proportions", "pan-right", "still"],
  ["Your brain isn't just calculating the number. It's reacting to whether the sentence around the number sounds like a threat.",
    "a single glowing red warning-shaped light pulsing softly in a dark room, no text, ominous but abstract", "zoom-in", "still"],
  ["That reaction isn't a flaw in an otherwise rational system, either — it likely comes from somewhere sensible.",
    "an ancient stone hearth glowing with the last embers of a fire in complete darkness, primal and warm", "static", "still"],
  ["For most of human history, losing food, shelter, or safety you already had could be a matter of survival, while a missed opportunity for more just meant staying at the same level.",
    "a lone figure silhouette standing at the mouth of a dark cave, faint firelight behind them, vast darkness ahead", "zoom-out", "still"],
  ["A brain that treats losses as more urgent than equivalent missed gains would have had good reason to evolve that way, long before anyone was flipping coins for money.",
    "a single ember slowly fading against overwhelming darkness, protective cupped hands moving to shield it", "push-in", "still"],

  // DEEPER CAUSE
  ["So once this asymmetry was documented, who started building around it on purpose?",
    "a dark control room wall of small glowing screens, each showing a different checkout interface, cold blue light", "static", "still"],
  ["Look at how a checkout page tells you there are only two seats left, or that your cart is about to expire, or that a price goes up in ten minutes.",
    "a glowing countdown timer ticking down in extreme close-up, red digits, dark background, urgency in the light flicker",
    "the countdown timer ticks down rapidly, camera pushing in tight, red light pulsing faster with each passing second", "video"],
  ["None of that information changes what the product actually does for you.",
    "an identical product sitting calmly under steady light, unchanged, while a chaotic countdown blurs in the background", "static", "still"],
  ["What it does is reframe a normal purchase decision into a potential loss — miss this, and you lose the deal — which, on the steep side of the curve, produces more urgency than the equivalent gain-framed message ever could.",
    "a glowing steep red curve looming over a small shopping cart icon in dark space, dramatic scale contrast", "push-in", "still"],
  ["Apps that track a login streak or a point balance are running the same play from a different angle.",
    "a glowing streak counter climbing upward in dark space, each digit igniting brighter as it climbs, amber light", "zoom-in", "still"],
  ["The moment you have a streak, you own it, in exactly the sense the mug experiment measured — and breaking it now registers as a loss of something you already had, not simply a missed future gain.",
    "a tall glowing chain of connected light-links suddenly cracking and shattering at one point, dark background, dramatic",
    "the glowing chain snaps at its center, light fracturing outward in slow motion, dark volumetric space", "video"],
  ["That's a large part of why a broken streak feels disproportionately bad, and why the apps that track them rarely let you forget how many days you're currently sitting on.",
    "a single glowing number hovering persistently in a dark room, refusing to fade, quietly insistent light", "static", "still"],
  ["Subscription cancellation pages lean on the same asymmetry in plainer language: you'll lose access to your saved data, you'll lose your current price, you'll lose the progress you've made.",
    "three glowing padlocks closing one by one over dark shapes in space, each closing with a small flash of red light", "pan-left", "still"],
  ["Every one of those sentences is a fact restated as a loss instead of a neutral change, aimed at the exact steeper half of the curve Kahneman and Tversky mapped.",
    "the same steep glowing graph curve from earlier, now with small red loss-icons stacked along its steepest edge", "zoom-in", "still"],
  ["None of this requires a single person who read the research and decided to weaponize it.",
    "an empty dark boardroom table, single overhead light, no one seated, quiet and unremarkable", "static", "still"],
  ["It requires only that a business test its messaging against one number — completions, renewals, click-throughs — and loss-framed language keeps winning that test, whether or not anyone on the team could name the underlying mechanism.",
    "a glowing bar chart in dark space, the tallest bar labeled only by a small red loss-icon, others fading beside it", "zoom-out", "still"],

  // FAIRNESS BEAT
  ["It's worth being fair to loss aversion itself here.",
    "a balanced brass scale resting perfectly level in soft even light, calm and neutral, dark background", "static", "still"],
  ["This isn't a design flaw in your brain that only costs you money — the same steep reaction to loss is part of what makes people appropriately cautious about real risks, and evolutionarily, a brain with zero loss aversion would take genuinely reckless bets with its safety.",
    "a figure silhouette standing safely back from a glowing chasm edge in the dark, cautious posture, dramatic depth", "zoom-out", "still"],
  ["The effect also isn't a fixed, universal multiplier.",
    "a glowing ratio symbol hovering in dark space, its proportions gently shifting and reforming, unstable but present", "static", "still"],
  ["The commonly cited ratio — roughly double — is an average across many studies and many kinds of decisions, not a constant you can apply to every single choice you'll ever face; the size of the asymmetry moves with the stakes, the person, and the context, and some individuals measure as barely loss-averse at all.",
    "a cluster of small glowing balance scales at slightly different tilts, some barely tipped, one nearly level, variation", "pan-right", "still"],
  ["Researchers have also found that loss aversion isn't fixed even within one person.",
    "a single glowing scale slowly shifting its tilt over time, subtle continuous motion, dark contemplative space", "zoom-in", "still"],
  ["People with more trading experience, for instance, have been measured making decisions with visibly less loss aversion than novices, at least within their area of expertise — meaning the pattern can shift with practice and framing, not just with brain chemistry you're stuck with permanently.",
    "a steady, experienced hand calmly placing a coin on a nearly level balance scale, composed and deliberate, warm light", "push-in", "still"],

  // PAYOFF SETUP
  ["So if the mechanism is a steeper reaction to losses than to equivalent gains, the fix isn't telling yourself to \"just be less emotional about money.\"",
    "a closed fist slowly, deliberately opening in warm light, dark background, calm resolve", "static", "still"],
  ["That asks you to override a reaction that's been useful for most of human history, every time it fires, through sheer willpower — that's not a plan, that's a New Year's resolution.",
    "a single candle guttering against wind in a dark room, struggling but not going out, fragile persistence", "zoom-out", "still"],
  ["What actually works is changing how the choice gets framed before you react to it.",
    "a picture frame in dark space slowly widening its borders, revealing more of the scene behind it as it expands",
    "the frame's borders pull outward smoothly, revealing a much larger scene beyond, calm deliberate camera pull-back", "video"],

  // PAYOFF
  ["One well-documented fix is what Kahneman himself called broad framing — evaluating a single gain or loss as part of your whole financial picture, instead of in isolation.",
    "a single glowing coin at the center of a much larger constellation of faint coins spreading into the darkness", "zoom-out", "still"],
  ["A hundred-dollar loss feels enormous when you consider it by itself.",
    "one glowing coin looming enormous and close to camera, filling the dark frame, oppressive scale", "push-in", "still"],
  ["The same hundred dollars, considered against your total monthly income or your total savings, shrinks back down to its actual proportional size — and that shrinking isn't dishonest, it's simply the more accurate frame.",
    "the same coin now revealed as one small point among a vast calm field of identical glowing coins stretching into dark space",
    "camera pulls back steadily and continuously, the single coin shrinking into proportion among the full field, serene", "video"],
  ["Researchers who study professional traders found something similar happening naturally in people who make risky bets for a living:",
    "a calm, steady hand resting near a stack of coins, composed posture, dim trading-floor light in the background", "static", "still"],
  ["framing each individual decision as one bet in a long running series, rather than a single make-or-break event, measurably reduced how loss-averse they behaved, compared to novices evaluating the exact same bets one at a time.",
    "a long, orderly row of small glowing coins receding into the distance, each one equal and unremarkable, calm rhythm", "pan-right", "still"],
  ["You can borrow that same reframe outside of trading.",
    "a single warm light steadily illuminating a plain wooden table, honest and unadorned, dark surroundings", "static", "still"],
  ["Before a decision that feels urgent because you're about to \"lose\" something — a deal, a streak, a subscription price — try asking what the choice looks like as one line in a much longer list, instead of the single moment the interface is designing itself around.",
    "a glowing countdown timer from earlier now shown small and calm, one item among a long steady list of similar items", "zoom-in", "still"],
  ["You didn't imagine that losing things hurts more than gaining the equivalent feels good. It's measurable, it's steep, and it has a name.",
    "the mug and the coin from earlier resting together again on black velvet, now calmly lit, steady even light", "static", "still"],
  ["You're not bad with money.",
    "a steady, calm open hand under warm even light, dark background, nothing dramatic, simply present", "static", "still"],
  ["You're a normal brain running a very old, mostly useful reaction — inside a world that has gotten very good at pointing it at you on purpose.",
    "the opening coin now resting still and settled on an open palm, warm resolved light, calm final composition",
    "slow, gentle push-in as the coin rests motionless on the palm, warm light steadying, calm cinematic resolution", "video"],
];

const scenes = BEATS.map(([narration, subject, motion, shot_type], i) => {
  const base = {
    index: i,
    narration,
    shot_type,
  };
  if (shot_type === "video") {
    return {
      ...base,
      video_model: VIDEO_MODEL,
      video_prompt: `${subject}, ${motion}, ${STYLE}`,
    };
  }
  return {
    ...base,
    camera: motion,
    image_prompt: `${subject}, ${STYLE}`,
  };
});

const outPath = path.join(__dirname, "beats.json");
fs.writeFileSync(
  outPath,
  JSON.stringify({ video_id: "pilot-08-loss-aversion", accent_color: "#C24545", motif: MOTIF, scenes }, null, 2)
);

const totalWords = scenes.reduce((a, s) => a + s.narration.trim().split(/\s+/).length, 0);
const stillCount = scenes.filter((s) => s.shot_type === "still").length;
const videoCount = scenes.filter((s) => s.shot_type === "video").length;
console.log(
  `${scenes.length} beats (${stillCount} still, ${videoCount} video), ${totalWords} words, ` +
  `${(totalWords / 155).toFixed(1)} min at 155wpm`
);
console.log(
  `Estimated cost: ${stillCount}*3 + ${videoCount}*7.5 (images+video) = ` +
  `${(stillCount * 3 + videoCount * 7.5).toFixed(0)} credits (images+video only, excludes narration)`
);
