#!/usr/bin/env node
// Builds storyboard.json for pilots 4-6.
//
// Two things here are deliberate reactions to how the first three pilots
// looked on screen:
//
// 1. SCENES ARE SHORT. A script beat of 45s used to be ONE scene, so the
//    page finished drawing after ~15s and then sat there for 30. Every beat
//    is split into 9-14s scenes instead, which means new line work is always
//    arriving. This is the single biggest change to how fast it feels.
//
// 2. SCENES CARRY 3-6 ELEMENTS, not 1-2. SceneRenderer's layouts are built
//    to fill a 1920x1080 page at those counts; below three the composition
//    has holes in it no matter where the pieces sit.
//
// Durations are estimated from the narration word count at 155 wpm (the
// channel target). They are ESTIMATES — when real narration exists, re-time
// against measured segment durations the way pilots 1-3 were, because the
// generated voice does not hit the written target on its own. See
// channel-bible/retention-playbook.md.
//
// Usage: node build-storyboards-v2.js

const fs = require("fs");
const path = require("path");

const WPM = 155;
const secondsFor = (text) => Math.max(4, (text.trim().split(/\s+/).length / WPM) * 60);

// scene = [narration, [elements], on_screen_text|null, camera]
const PILOTS = {
  "pilot-04-phone-variable-reward": {
    accent: "#00A99A",
    scenes: [
      ["You just picked up your phone. You don't remember deciding to.", ["phone", "person", "question-mark"], null, "slow zoom in"],
      ["Your hand moved, the screen lit up, and somewhere in that half-second, a decision got made without you.", ["phone", "notification-dot", "brain", "arrow-down"], null, "static"],
      ["That gap — between your hand moving and you noticing — is engineered. And the blueprint is eighty years old.", ["clock", "brain", "grid"], "1948", "slow zoom out"],
      ["In the nineteen-forties, a psychologist named B.F. Skinner put pigeons in boxes with a lever. Press the lever, get food.", ["wall", "lever", "pellet"], null, "static"],
      ["The pigeons learned fast, pressed when hungry, stopped when full. Predictable. Boring.", ["lever", "pellet", "checkmark", "clock"], null, "static"],
      ["Then he changed one thing. The food stopped coming every time. Now it came sometimes. Randomly.", ["lever", "pellet", "question-mark", "x-mark"], null, "slow zoom in"],
      ["The pigeon couldn't tell which press would pay. The pigeons didn't press less. They pressed more. A lot more.", ["lever", "bar-chart", "arrow-up", "pellet"], null, "static"],
      ["Some kept pressing thousands of times after the food stopped entirely.", ["lever", "line-graph", "arrow-up"], "2,800 PRESSES", "static"],
      ["The obvious answer is that the pigeon is confused. It isn't. It's doing something rational under bad information.", ["brain", "x-mark", "checkmark", "question-mark"], null, "static"],
      ["When a reward is reliable, you learn when to stop. Full stomach, stop pressing.", ["pellet", "checkmark", "clock"], null, "static"],
      ["But when a reward is random, there's no signal that says not now. Every press is a fresh coin flip.", ["coin-flip", "coin", "question-mark", "lever"], null, "slow zoom in"],
      ["And the only way to lose the flip you might have won is to stop flipping.", ["coin-flip", "arrow-down", "x-mark"], null, "static"],
      ["Skinner called it a variable ratio schedule. It is the most persistent pattern of behavior psychology has ever produced in a laboratory.", ["bar-chart", "line-graph", "brain"], "VARIABLE RATIO", "static"],
      ["And it did not stay in the laboratory. Slot machines run on it. That's not a metaphor — it's the actual design principle.", ["slot-reel", "lever", "coin"], null, "slow zoom in"],
      ["It's why a slot machine pays out constantly in small amounts instead of rarely in large ones.", ["slot-reel", "coin", "coin", "bar-chart"], null, "static"],
      ["Now look at the gesture you make to refresh a feed. Pull down. Release. Wait for the reels to stop.", ["phone", "slot-reel", "arrow-down", "lever"], "SAME MOTION", "zoom out to reveal"],
      ["Here's where it gets more careful than the usual version of this story. Nobody sat in a meeting and said let's build a slot machine.", ["person", "wall", "x-mark"], null, "static"],
      ["They didn't have to. What actually happened is that thousands of design variations got tested against a single number: how often people come back.", ["grid", "phone", "bar-chart", "clock"], null, "static"],
      ["Variations that produced unpredictable rewards kept people coming back more. So those variations survived. Nobody needed to know why.", ["grid", "arrow-up", "checkmark", "slot-reel"], null, "zoom out to reveal"],
      ["That's the uncomfortable part. This isn't a conspiracy that requires villains. It's a selection process that produces the same result as a conspiracy.", ["grid", "wall", "lever", "brain"], null, "slow zoom out"],
      ["It's worth saying what this doesn't mean. Your phone isn't a slot machine, and you aren't a pigeon.", ["phone", "checkmark", "person"], null, "static"],
      ["Most of what arrives on it is genuinely wanted — messages from people you love, work you're waiting on, news you asked for.", ["phone", "notification-dot", "person", "checkmark"], null, "static"],
      ["And the popular claim that every notification gives you a dopamine hit oversimplifies what dopamine actually does.", ["brain", "x-mark", "question-mark"], null, "static"],
      ["The honest version is narrower and more interesting: dopamine tracks anticipation more than reward. It spikes before you look, not after.", ["line-graph", "brain", "arrow-up", "eye"], "BEFORE, NOT AFTER", "slow zoom in"],
      ["That's the thing to sit with. The pull isn't the reward. The pull is the maybe.", ["coin-flip", "question-mark", "brain"], "THE MAYBE", "static"],
      ["You check, there's nothing there, you feel briefly flat — and then you check again nine minutes later.", ["phone", "x-mark", "clock", "person"], null, "static"],
      ["If the reward were the point, an empty check would teach you to stop. It doesn't, because the empty check isn't a failure of the system. It's the system working.", ["phone", "x-mark", "lever", "checkmark"], null, "static"],
      ["If the mechanism runs on unpredictability, then willpower is the wrong tool. You can't out-discipline a coin flip — you can only stop flipping.", ["coin-flip", "x-mark", "brain"], null, "static"],
      ["What works is making the reward predictable again. Not use your phone less — that's the pigeon pressing harder.", ["phone", "arrow-down", "x-mark", "lever"], null, "static"],
      ["Instead: check on a schedule you choose, not on a feeling. Turn off the notifications that arrive at random and keep the ones that arrive for a reason.", ["clock", "calendar", "notification-dot", "checkmark"], "ON A SCHEDULE", "static"],
      ["Both do the same thing — they take the randomness out, and randomness was the whole engine.", ["pellet", "clock", "checkmark", "lever"], null, "static"],
      ["You're not weak. You're running correct software on a problem it was never built for, against a system that found the exploit by accident and kept it because it worked.", ["brain", "phone", "slot-reel", "lever", "coin-flip", "line-graph"], null, "zoom out to reveal"],
    ],
  },

  "pilot-05-decoy-effect": {
    accent: "#C62828",
    scenes: [
      ["There's a price on this page that exists only to make you pick a different one.", ["price-box", "price-box", "price-box"], null, "slow zoom in"],
      ["It isn't there to be bought. It's there to be rejected.", ["price-box", "x-mark", "question-mark"], null, "static"],
      ["Once you can see it, you can't stop seeing it. It's in almost every pricing page you've ever looked at.", ["price-tag", "grid", "eye"], "THE DECOY", "static"],
      ["In two thousand eight, the behavioural economist Dan Ariely found a subscription offer from The Economist and thought it looked like a mistake.", ["person", "price-box", "question-mark"], null, "static"],
      ["Three options. Web only, fifty-nine dollars. Print only, one hundred and twenty-five.", ["price-box", "price-box", "coin"], null, "static"],
      ["Print and web — also one hundred and twenty-five dollars. Read that again.", ["price-box", "price-box", "price-box", "question-mark"], "$125 = $125", "slow zoom in"],
      ["Print alone cost exactly the same as print plus web. Nobody would choose print alone. It's strictly worse for the identical price.", ["price-box", "x-mark", "scale"], null, "static"],
      ["So Ariely ran it on a hundred students. Sixteen chose web only. Zero chose print only. Eighty-four chose the combo.", ["bar-chart", "person", "checkmark"], "16 / 0 / 84", "static"],
      ["Then he deleted the useless option and ran it again on a fresh hundred.", ["price-box", "x-mark", "person", "bar-chart"], null, "static"],
      ["Logically, nothing should change. Nobody wanted it. Removing it should just leave the same two choices and the same split.", ["price-box", "price-box", "question-mark"], null, "static"],
      ["The result flipped. Without the decoy, sixty-eight chose web only and just thirty-two chose the combo.", ["bar-chart", "arrow-down", "arrow-up"], "68 / 32", "slow zoom in"],
      ["The expensive option lost more than half its buyers — because a product nobody bought stopped standing next to it.", ["bar-chart", "price-box", "x-mark", "arrow-down"], null, "static"],
      ["Because you are very bad at judging what something is worth, and very good at judging which of two things is better.", ["brain", "scale", "question-mark"], null, "static"],
      ["Ask someone what a hundred and twenty-five dollars of journalism is worth and they have no idea. There's no internal price list.", ["coin", "question-mark", "brain"], null, "static"],
      ["But put print-only next to print-plus-web and the comparison is trivial: same money, more stuff. Obviously better.", ["price-box", "price-box", "checkmark", "arrow-up"], null, "static"],
      ["That comparison feels like a judgement about value. It isn't. It's a judgement about those two options.", ["scale", "price-box", "price-box", "x-mark"], null, "static"],
      ["And someone chose which two options you'd be comparing.", ["person", "price-box", "price-box", "grid"], null, "zoom out to reveal"],
      ["The recipe is precise. You need a target — the thing you want sold.", ["price-box", "spotlight", "checkmark"], "TARGET", "static"],
      ["Then you add a decoy that is clearly worse than the target, but not clearly worse than the third option.", ["price-box", "price-box", "arrow-down"], "DECOY", "static"],
      ["The decoy's whole job is to be dominated by exactly one option.", ["price-box", "spotlight", "arrow-up", "price-box"], null, "static"],
      ["It makes the target look like a win, and a win is much easier to choose than a value judgement.", ["checkmark", "scale", "brain", "spotlight"], null, "static"],
      ["Popcorn sizes work this way. Phone storage tiers work this way.", ["price-box", "phone", "grid"], null, "static"],
      ["So does almost every three-tier software page where the middle plan is mysteriously the best deal.", ["price-box", "price-box", "price-box", "spotlight"], "MIDDLE = BEST?", "slow zoom in"],
      ["Worth being careful here. A three-tier pricing page is not automatically a trick.", ["price-box", "checkmark", "x-mark"], null, "static"],
      ["Sometimes the middle plan genuinely is the best fit for most people, and saying so is helpful, not manipulative.", ["price-box", "checkmark", "person", "scale"], null, "static"],
      ["And the effect is smaller in the wild than in the lab. Real buyers have budgets, brand loyalty, and a habit of leaving the page entirely.", ["bar-chart", "person", "exit-door", "coin"], null, "static"],
      ["The Economist study is a clean demonstration of a real mechanism — not a promise that it works on everyone, every time.", ["bar-chart", "question-mark", "scale"], null, "static"],
      ["The defence is almost annoyingly simple, because the effect only works while all the options sit next to each other.", ["price-box", "price-box", "price-box", "eye"], null, "static"],
      ["Before you look at the tiers, decide what you actually need. Write the number down if you have to. Then look.", ["coin", "checkmark", "price-tag"], "DECIDE FIRST", "static"],
      ["The decoy can only move you if you arrive without a position, because it works by supplying one.", ["price-box", "arrow-up", "x-mark", "brain"], null, "static"],
      ["And when one option is transparently worse than another at the same price, that's not a bad deal you're being offered. That's a signpost.", ["price-box", "signpost", "arrow-up"], null, "slow zoom in"],
      ["Pointing at the option someone would like you to take. You're not being fooled about value. You're being handed a comparison, and comparisons are the one thing your brain never refuses.", ["signpost", "price-box", "price-box", "scale", "brain", "bar-chart"], null, "zoom out to reveal"],
    ],
  },

  "pilot-06-waiting-time": {
    accent: "#6A3FB5",
    scenes: [
      ["An airport got so many complaints about baggage delays that it hired more staff.", ["carousel", "person", "bar-chart"], null, "slow zoom in"],
      ["Bags came out faster. The complaints didn't stop. So they tried something that shouldn't have worked.", ["carousel", "arrow-up", "question-mark", "person"], null, "static"],
      ["The fix took no extra staff, no new equipment, and made the wait objectively longer.", ["clock", "arrow-up", "checkmark"], "LONGER", "static"],
      ["Start with the thing everyone gets wrong about waiting. You don't experience a wait as a length of time.", ["clock", "hourglass", "question-mark"], null, "static"],
      ["You experience it as a length of attention.", ["brain", "eye", "hourglass"], "ATTENTION", "slow zoom in"],
      ["Researchers have measured this repeatedly. People asked to wait with nothing to do consistently overestimate how long they waited — often by a lot.", ["empty-room", "clock", "person", "bar-chart"], null, "static"],
      ["Give them something to occupy attention and the same wait shrinks.", ["clock", "checkmark", "brain", "hourglass"], null, "static"],
      ["This is why the wait for a lift feels endless and the walk to a further lift doesn't, even when the walk takes more of your life.", ["person", "corridor", "clock", "exit-door"], null, "static"],
      ["There's a second layer, and it's the reason a wait can feel unfair rather than just long.", ["queue", "question-mark", "scale"], null, "static"],
      ["Waits feel worse when you can't see the end, when you don't know why you're waiting.", ["queue", "corridor", "question-mark", "x-mark"], null, "static"],
      ["And — most powerfully — when someone who arrived after you gets served first.", ["queue", "person", "arrow-up", "x-mark"], "UNFAIR", "slow zoom in"],
      ["That last one is why a single winding queue feeding several tills feels fairer than separate lines, even though the average wait is the same.", ["queue", "queue", "scale", "checkmark"], null, "static"],
      ["The single queue removes the possibility of picking wrong.", ["queue", "checkmark", "exit-door"], null, "static"],
      ["The airport looked at the numbers and found something strange.", ["carousel", "bar-chart", "question-mark"], null, "static"],
      ["Passengers walked about one minute from the gate to baggage claim, then stood at the carousel for about seven.", ["corridor", "carousel", "clock", "person"], "1 + 7", "static"],
      ["Roughly eight minutes total. But only one of those minutes was occupied.", ["clock", "bar-chart", "hourglass"], null, "static"],
      ["Seven were spent doing nothing but waiting, which is exactly the kind of time that stretches.", ["empty-room", "hourglass", "person", "clock"], null, "slow zoom in"],
      ["So they moved the arrival gates further from the terminal, and routed the bags to the most distant carousel.", ["corridor", "carousel", "arrow-up", "exit-door"], null, "static"],
      ["Passengers now walked about six minutes and waited about two.", ["corridor", "person", "clock", "carousel"], "6 + 2", "static"],
      ["Complaints dropped to near zero.", ["bar-chart", "arrow-down", "checkmark"], "ZERO", "slow zoom in"],
      ["Nothing got faster. The total journey was the same or slightly worse.", ["clock", "scale", "hourglass"], null, "static"],
      ["They simply converted empty waiting into occupied walking, and the experience of the wait collapsed.", ["corridor", "empty-room", "checkmark", "person"], null, "zoom out to reveal"],
      ["Which raises the obvious objection: isn't this just manipulation? You're not being served faster. You're being managed.", ["person", "question-mark", "x-mark", "scale"], null, "static"],
      ["Sometimes, yes. A progress bar that lies about progress is a lie.", ["progress-bar", "x-mark", "clock"], null, "static"],
      ["And a made-up your call is important to us queue position is worse than silence.", ["phone", "queue", "x-mark"], null, "static"],
      ["But a wait with a visible end, a stated reason, and something to do is genuinely a better experience — not a trick.", ["progress-bar", "checkmark", "clock", "eye"], null, "static"],
      ["Just a design that accounts for the fact that a person is standing there. The line is whether the design respects the wait or disguises it.", ["person", "scale", "checkmark", "x-mark"], "RESPECT vs DISGUISE", "static"],
      ["Two useful things. The first is diagnostic. When a wait feels unbearable, check whether it's actually long or merely empty.", ["hourglass", "empty-room", "question-mark"], null, "static"],
      ["Because those have completely different fixes, and you've probably been applying the wrong one.", ["hourglass", "empty-room", "x-mark", "checkmark"], null, "static"],
      ["The second is that you can do to yourself what the airport did to its passengers. Not distraction for its own sake — occupation.", ["person", "corridor", "checkmark", "brain"], null, "static"],
      ["Deciding in advance what the wait is for turns dead time into something with a shape.", ["clock", "calendar", "checkmark", "hourglass"], null, "static"],
      ["And when a company makes you wait in a blank room with no information and no estimate, now you know that's a choice.", ["empty-room", "person", "x-mark", "question-mark"], null, "slow zoom in"],
      ["Every one of those is fixable, cheaply, and they've decided not to. The wait was never the problem. It was the emptiness inside it.", ["empty-room", "clock", "carousel", "queue", "corridor", "bar-chart"], null, "zoom out to reveal"],
    ],
  },
};

for (const [id, def] of Object.entries(PILOTS)) {
  let t = 0;
  const scenes = def.scenes.map(([narration, drawing_elements, on_screen_text, camera], i) => {
    const duration = Math.round(secondsFor(narration) * 100) / 100;
    const scene = {
      scene: i + 1,
      start: Math.round(t * 100) / 100,
      duration,
      narration,
      visual: `${drawing_elements.join(", ")} — drawn in order, pen only`,
      drawing_elements,
      on_screen_text: on_screen_text ?? null,
      camera,
      sound_effect: null,
    };
    t += duration;
    return scene;
  });

  const out = { video_id: id, accent_color: def.accent, scenes };
  const file = path.join(__dirname, id, "storyboard.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const mm = Math.floor(t / 60);
  const ss = String(Math.round(t % 60)).padStart(2, "0");
  console.log(`${id}: ${scenes.length} scenes, ${mm}:${ss}`);
}
