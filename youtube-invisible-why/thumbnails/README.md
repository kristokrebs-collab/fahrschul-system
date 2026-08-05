# thumbnails/

`build-thumbnails.js` renders each pilot's thumbnail to a 1280x720 PNG with
headless Chromium. Run `node build-thumbnails.js` (add `--browser /path/to/chrome`
if it can't find one); output lands in `out/`.

They're built from code rather than drawn by hand because the rules that
decide whether a thumbnail works are mechanical, and easy to violate by eye:

- **one dominant object**, not a collage
- **one visible conflict** — the card is chained, the needle is in the red,
  the cart takes a long detour. A picture of the topic is not a thumbnail;
  a picture of the *tension* is.
- **2-3 words that do not repeat the title.** The title says what the video
  is; the thumbnail says why you can't not click. "CAN'T CANCEL" next to
  "Why Your Brain Refuses to Cancel Subscriptions" would be a wasted line
  — it works because the title explains and the thumbnail accuses.
- **legible at ~210px wide**, which is the size it actually appears at in a
  sidebar or on a phone. This is why the strokes are heavy and the palette
  is two colours plus ink — mid-tones and thin lines disappear at that size.

One trap worth knowing if you edit the SVG: a CSS class's `stroke` beats a
presentation attribute on the same element, which silently painted the
sleep-deprivation gauge needle accent-blue over its red zone. Override with
inline `style`, or don't put a conflicting class on the element.
