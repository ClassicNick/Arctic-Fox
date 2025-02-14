/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Check that the timeline shows correct time graduations in the header.

const {
  findOptimalTimeInterval,
  TimeScale
} = require("devtools/client/animationinspector/utils");
// Should be kept in sync with TIME_GRADUATION_MIN_SPACING in animation-timeline.js
const TIME_GRADUATION_MIN_SPACING = 40;

add_task(function*() {
  yield addTab(TEST_URL_ROOT + "doc_simple_animation.html");
  let {panel} = yield openAnimationInspector();

  let timeline = panel.animationsTimelineComponent;
  let headerEl = timeline.timeHeaderEl;

  info("Find out how many time graduations should there be");
  let width = headerEl.offsetWidth;
  let scale = width / (TimeScale.maxEndTime - TimeScale.minStartTime);
  // Note that findOptimalTimeInterval is tested separately in xpcshell test
  // test_findOptimalTimeInterval.js, so we assume that it works here.
  let interval = findOptimalTimeInterval(scale, TIME_GRADUATION_MIN_SPACING);
  let nb = Math.ceil(width / interval);

  is(headerEl.querySelectorAll(".time-tick").length, nb,
     "The expected number of time ticks were found");

  info("Make sure graduations are evenly distributed and show the right times");
  [...headerEl.querySelectorAll(".time-tick")].forEach((tick, i) => {
    let left = parseFloat(tick.style.left);
    let expectedPos = i * interval * 100 / width;
    is(Math.round(left), Math.round(expectedPos),
      "Graduation " + i + " is positioned correctly");

    // Note that the distancetoRelativeTime and formatTime functions are tested
    // separately in xpcshell test test_timeScale.js, so we assume that they
    // work here.
    let formattedTime = TimeScale.formatTime(
      TimeScale.distanceToRelativeTime(expectedPos, width));
    is(tick.textContent, formattedTime,
      "Graduation " + i + " has the right text content");
  });
});
