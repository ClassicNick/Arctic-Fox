/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

var { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

// Enable logging for all the tests. Both the debugger server and frontend will
// be affected by this pref.
var gEnableLogging = Services.prefs.getBoolPref("devtools.debugger.log");
Services.prefs.setBoolPref("devtools.debugger.log", false);

var { Task } = Cu.import("resource://gre/modules/Task.jsm", {});
var { gDevTools } = Cu.import("resource://devtools/client/framework/gDevTools.jsm", {});
var { require } = Cu.import("resource://devtools/shared/Loader.jsm", {});
var { TargetFactory } = require("devtools/client/framework/target");
var { DebuggerServer } = require("devtools/server/main");
var { generateUUID } = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);

var Promise = require("promise");
var { WebAudioFront } = require("devtools/server/actors/webaudio");
var DevToolsUtils = require("devtools/shared/DevToolsUtils");
var audioNodes = require("devtools/server/actors/utils/audionodes.json");
var mm = null;

const FRAME_SCRIPT_UTILS_URL = "chrome://devtools/content/shared/frame-script-utils.js";
const EXAMPLE_URL = "http://example.com/browser/devtools/client/webaudioeditor/test/";
const SIMPLE_CONTEXT_URL = EXAMPLE_URL + "doc_simple-context.html";
const COMPLEX_CONTEXT_URL = EXAMPLE_URL + "doc_complex-context.html";
const SIMPLE_NODES_URL = EXAMPLE_URL + "doc_simple-node-creation.html";
const MEDIA_NODES_URL = EXAMPLE_URL + "doc_media-node-creation.html";
const BUFFER_AND_ARRAY_URL = EXAMPLE_URL + "doc_buffer-and-array.html";
const DESTROY_NODES_URL = EXAMPLE_URL + "doc_destroy-nodes.html";
const CONNECT_PARAM_URL = EXAMPLE_URL + "doc_connect-param.html";
const CONNECT_MULTI_PARAM_URL = EXAMPLE_URL + "doc_connect-multi-param.html";
const IFRAME_CONTEXT_URL = EXAMPLE_URL + "doc_iframe-context.html";
const AUTOMATION_URL = EXAMPLE_URL + "doc_automation.html";

// All tests are asynchronous.
waitForExplicitFinish();

var gToolEnabled = Services.prefs.getBoolPref("devtools.webaudioeditor.enabled");

DevToolsUtils.testing = true;

registerCleanupFunction(() => {
  DevToolsUtils.testing = false;
  info("finish() was called, cleaning up...");
  Services.prefs.setBoolPref("devtools.debugger.log", gEnableLogging);
  Services.prefs.setBoolPref("devtools.webaudioeditor.enabled", gToolEnabled);
  Cu.forceGC();
});

/**
 * Call manually in tests that use frame script utils after initializing
 * the web audio editor. Call after init but before navigating to a different page.
 */
function loadFrameScripts () {
  mm = gBrowser.selectedBrowser.messageManager;
  mm.loadFrameScript(FRAME_SCRIPT_UTILS_URL, false);
}

function addTab(aUrl, aWindow) {
  info("Adding tab: " + aUrl);

  let deferred = Promise.defer();
  let targetWindow = aWindow || window;
  let targetBrowser = targetWindow.gBrowser;

  targetWindow.focus();
  let tab = targetBrowser.selectedTab = targetBrowser.addTab(aUrl);
  let linkedBrowser = tab.linkedBrowser;

  linkedBrowser.addEventListener("load", function onLoad() {
    linkedBrowser.removeEventListener("load", onLoad, true);
    info("Tab added and finished loading: " + aUrl);
    deferred.resolve(tab);
  }, true);

  return deferred.promise;
}

function removeTab(aTab, aWindow) {
  info("Removing tab.");

  let deferred = Promise.defer();
  let targetWindow = aWindow || window;
  let targetBrowser = targetWindow.gBrowser;
  let tabContainer = targetBrowser.tabContainer;

  tabContainer.addEventListener("TabClose", function onClose(aEvent) {
    tabContainer.removeEventListener("TabClose", onClose, false);
    info("Tab removed and finished closing.");
    deferred.resolve();
  }, false);

  targetBrowser.removeTab(aTab);
  return deferred.promise;
}

function once(aTarget, aEventName, aUseCapture = false) {
  info("Waiting for event: '" + aEventName + "' on " + aTarget + ".");

  let deferred = Promise.defer();

  for (let [add, remove] of [
    ["on", "off"], // Use event emitter before DOM events for consistency
    ["addEventListener", "removeEventListener"],
    ["addListener", "removeListener"]
  ]) {
    if ((add in aTarget) && (remove in aTarget)) {
      aTarget[add](aEventName, function onEvent(...aArgs) {
        aTarget[remove](aEventName, onEvent, aUseCapture);
        info("Got event: '" + aEventName + "' on " + aTarget + ".");
        deferred.resolve(...aArgs);
      }, aUseCapture);
      break;
    }
  }

  return deferred.promise;
}

function reload(aTarget, aWaitForTargetEvent = "navigate") {
  aTarget.activeTab.reload();
  return once(aTarget, aWaitForTargetEvent);
}

function navigate(aTarget, aUrl, aWaitForTargetEvent = "navigate") {
  executeSoon(() => aTarget.activeTab.navigateTo(aUrl));
  return once(aTarget, aWaitForTargetEvent);
}

/**
 * Adds a new tab, and instantiate a WebAudiFront object.
 * This requires calling removeTab before the test ends.
 */
function initBackend(aUrl) {
  info("Initializing a web audio editor front.");

  if (!DebuggerServer.initialized) {
    DebuggerServer.init();
    DebuggerServer.addBrowserActors();
  }

  return Task.spawn(function*() {
    let tab = yield addTab(aUrl);
    let target = TargetFactory.forTab(tab);

    yield target.makeRemote();

    let front = new WebAudioFront(target.client, target.form);
    return { target, front };
  });
}

/**
 * Adds a new tab, and open the toolbox for that tab, selecting the audio editor
 * panel.
 * This requires calling teardown before the test ends.
 */
function initWebAudioEditor(aUrl) {
  info("Initializing a web audio editor pane.");

  return Task.spawn(function*() {
    let tab = yield addTab(aUrl);
    let target = TargetFactory.forTab(tab);

    yield target.makeRemote();

    Services.prefs.setBoolPref("devtools.webaudioeditor.enabled", true);
    let toolbox = yield gDevTools.showToolbox(target, "webaudioeditor");
    let panel = toolbox.getCurrentPanel();
    return { target, panel, toolbox };
  });
}

/**
 * Close the toolbox, destroying all panels, and remove the added test tabs.
 */
function teardown(aTarget) {
  info("Destroying the web audio editor.");

  return gDevTools.closeToolbox(aTarget).then(() => {
    while (gBrowser.tabs.length > 1) {
      gBrowser.removeCurrentTab();
    }
  });
}

// Due to web audio will fire most events synchronously back-to-back,
// and we can't yield them in a chain without missing actors, this allows
// us to listen for `n` events and return a promise resolving to them.
//
// Takes a `front` object that is an event emitter, the number of
// programs that should be listened to and waited on, and an optional
// `onAdd` function that calls with the entire actors array on program link
function getN (front, eventName, count, spread) {
  let actors = [];
  let deferred = Promise.defer();
  front.on(eventName, function onEvent (...args) {
    let actor = args[0];
    if (actors.length !== count) {
      actors.push(spread ? args : actor);
    }
    if (actors.length === count) {
      front.off(eventName, onEvent);
      deferred.resolve(actors);
    }
  });
  return deferred.promise;
}

function get (front, eventName) { return getN(front, eventName, 1); }
function get2 (front, eventName) { return getN(front, eventName, 2); }
function get3 (front, eventName) { return getN(front, eventName, 3); }
function getSpread (front, eventName) { return getN(front, eventName, 1, true); }
function get2Spread (front, eventName) { return getN(front, eventName, 2, true); }
function get3Spread (front, eventName) { return getN(front, eventName, 3, true); }
function getNSpread (front, eventName, count) { return getN(front, eventName, count, true); }

/**
 * Waits for the UI_GRAPH_RENDERED event to fire, but only
 * resolves when the graph was rendered with the correct count of
 * nodes and edges.
 */
function waitForGraphRendered (front, nodeCount, edgeCount, paramEdgeCount) {
  let deferred = Promise.defer();
  let eventName = front.EVENTS.UI_GRAPH_RENDERED;
  front.on(eventName, function onGraphRendered (_, nodes, edges, pEdges) {
    let paramEdgesDone = paramEdgeCount != null ? paramEdgeCount === pEdges : true;
    if (nodes === nodeCount && edges === edgeCount && paramEdgesDone) {
      front.off(eventName, onGraphRendered);
      deferred.resolve();
    }
  });
  return deferred.promise;
}

function checkVariableView (view, index, hash, description = "") {
  info("Checking Variable View");
  let scope = view.getScopeAtIndex(index);
  let variables = Object.keys(hash);

  // If node shouldn't display any properties, ensure that the 'empty' message is
  // visible
  if (!variables.length) {
    ok(isVisible(scope.window.$("#properties-empty")),
      description + " should show the empty properties tab.");
    return;
  }

  // Otherwise, iterate over expected properties
  variables.forEach(variable => {
    let aVar = scope.get(variable);
    is(aVar.target.querySelector(".name").getAttribute("value"), variable,
      "Correct property name for " + variable);
    let value = aVar.target.querySelector(".value").getAttribute("value");

    // Cast value with JSON.parse if possible;
    // will fail when displaying Object types like "ArrayBuffer"
    // and "Float32Array", but will match the original value.
    try {
      value = JSON.parse(value);
    }
    catch (e) {}
    if (typeof hash[variable] === "function") {
      ok(hash[variable](value),
        "Passing property value of " + value + " for " + variable + " " + description);
    }
    else {
      is(value, hash[variable],
        "Correct property value of " + hash[variable] + " for " + variable + " " + description);
    }
  });
}

function modifyVariableView (win, view, index, prop, value) {
  let deferred = Promise.defer();
  let scope = view.getScopeAtIndex(index);
  let aVar = scope.get(prop);
  scope.expand();

  win.on(win.EVENTS.UI_SET_PARAM, handleSetting);
  win.on(win.EVENTS.UI_SET_PARAM_ERROR, handleSetting);

  // Focus and select the variable to begin editing
  win.focus();
  aVar.focus();
  EventUtils.sendKey("RETURN", win);

  // Must wait for the scope DOM to be available to receive
  // events
  executeSoon(() => {
    info("Setting " + value + " for " + prop + "....");
    for (let c of (value + "")) {
      EventUtils.synthesizeKey(c, {}, win);
    }
    EventUtils.sendKey("RETURN", win);
  });

  function handleSetting (eventName) {
    win.off(win.EVENTS.UI_SET_PARAM, handleSetting);
    win.off(win.EVENTS.UI_SET_PARAM_ERROR, handleSetting);
    if (eventName === win.EVENTS.UI_SET_PARAM)
      deferred.resolve();
    if (eventName === win.EVENTS.UI_SET_PARAM_ERROR)
      deferred.reject();
  }

  return deferred.promise;
}

function findGraphEdge (win, source, target, param) {
  let selector = ".edgePaths .edgePath[data-source='" + source + "'][data-target='" + target + "']";
  if (param) {
    selector += "[data-param='" + param + "']";
  }
  return win.document.querySelector(selector);
}

function findGraphNode (win, node) {
  let selector = ".nodes > g[data-id='" + node + "']";
  return win.document.querySelector(selector);
}

function click (win, element) {
  EventUtils.sendMouseEvent({ type: "click" }, element, win);
}

function mouseOver (win, element) {
  EventUtils.sendMouseEvent({ type: "mouseover" }, element, win);
}

function command (button) {
  let ev = button.ownerDocument.createEvent("XULCommandEvent");
  ev.initCommandEvent("command", true, true, button.ownerDocument.defaultView, 0, false, false, false, false, null);
  button.dispatchEvent(ev);
}

function isVisible (element) {
  return !element.getAttribute("hidden");
}

/**
 * Used in debugging, returns a promise that resolves in `n` milliseconds.
 */
function wait (n) {
  let { promise, resolve } = Promise.defer();
  setTimeout(resolve, n);
  info("Waiting " + n/1000 + " seconds.");
  return promise;
}

/**
 * Clicks a graph node based on actorID or passing in an element.
 * Returns a promise that resolves once UI_INSPECTOR_NODE_SET is fired and
 * the tabs have rendered, completing all RDP requests for the node.
 */
function clickGraphNode (panelWin, el, waitForToggle = false) {
  let { promise, resolve } = Promise.defer();
  let promises = [
   once(panelWin, panelWin.EVENTS.UI_INSPECTOR_NODE_SET),
   once(panelWin, panelWin.EVENTS.UI_PROPERTIES_TAB_RENDERED),
   once(panelWin, panelWin.EVENTS.UI_AUTOMATION_TAB_RENDERED)
  ];

  if (waitForToggle) {
    promises.push(once(panelWin, panelWin.EVENTS.UI_INSPECTOR_TOGGLED));
  }

  // Use `el` as the element if it is one, otherwise
  // assume it's an ID and find the related graph node
  let element = el.tagName ? el : findGraphNode(panelWin, el);
  click(panelWin, element);

  return Promise.all(promises);
}

/**
 * Returns the primitive value of a grip's value, or the
 * original form that the string grip.type comes from.
 */
function getGripValue (value) {
  if (~["boolean", "string", "number"].indexOf(typeof value)) {
    return value;
  }

  switch (value.type) {
    case "undefined": return undefined;
    case "Infinity": return Infinity;
    case "-Infinity": return -Infinity;
    case "NaN": return NaN;
    case "-0": return -0;
    case "null": return null;
    default: return value;
  }
}

/**
 * Counts how many nodes and edges are currently in the graph.
 */
function countGraphObjects (win) {
  return {
    nodes: win.document.querySelectorAll(".nodes > .audionode").length,
    edges: win.document.querySelectorAll(".edgePaths > .edgePath").length
  }
}

/**
* Forces cycle collection and GC, used in AudioNode destruction tests.
*/
function forceCC () {
  SpecialPowers.DOMWindowUtils.cycleCollect();
  SpecialPowers.DOMWindowUtils.garbageCollect();
  SpecialPowers.DOMWindowUtils.garbageCollect();
}

/**
 * Takes a `values` array of automation value entries,
 * looking for the value at `time` seconds, checking
 * to see if the value is close to `expected`.
 */
function checkAutomationValue (values, time, expected) {
  // Remain flexible on values as we can approximate points
  let EPSILON = 0.01;

  let value = getValueAt(values, time);
  ok(Math.abs(value - expected) < EPSILON, "Timeline value at " + time + " with value " + value + " should have value very close to " + expected);

  /**
   * Entries are ordered in `values` according to time, so if we can't find an exact point
   * on a time of interest, return the point in between the threshold. This should
   * get us a very close value.
   */
  function getValueAt (values, time) {
    for (let i = 0; i < values.length; i++) {
      if (values[i].delta === time) {
        return values[i].value;
      }
      if (values[i].delta > time) {
        return (values[i - 1].value + values[i].value) / 2;
      }
    }
    return values[values.length - 1].value;
  }
}

/**
 * Wait for all inspector tabs to complete rendering.
 */
function waitForInspectorRender (panelWin, EVENTS) {
  return Promise.all([
    once(panelWin, EVENTS.UI_PROPERTIES_TAB_RENDERED),
    once(panelWin, EVENTS.UI_AUTOMATION_TAB_RENDERED)
  ]);
}

/**
 * Takes a string `script` and evaluates it directly in the content
 * in potentially a different process.
 */
function evalInDebuggee (script) {
  let deferred = Promise.defer();

  if (!mm) {
    throw new Error("`loadFrameScripts()` must be called when using MessageManager.");
  }

  let id = generateUUID().toString();
  mm.sendAsyncMessage("devtools:test:eval", { script: script, id: id });
  mm.addMessageListener("devtools:test:eval:response", handler);

  function handler ({ data }) {
    if (id !== data.id) {
      return;
    }

    mm.removeMessageListener("devtools:test:eval:response", handler);
    deferred.resolve(data.value);
  }

  return deferred.promise;
}

/**
 * List of audio node properties to test against expectations of the AudioNode actor
 */

const NODE_DEFAULT_VALUES = {
  "AudioDestinationNode": {},
  "MediaElementAudioSourceNode": {},
  "MediaStreamAudioSourceNode": {},
  "MediaStreamAudioDestinationNode": {
    "stream": "MediaStream"
  },
  "AudioBufferSourceNode": {
    "playbackRate": 1,
    "loop": false,
    "loopStart": 0,
    "loopEnd": 0,
    "buffer": null
  },
  "ScriptProcessorNode": {
    "bufferSize": 4096
  },
  "AnalyserNode": {
    "fftSize": 2048,
    "minDecibels": -100,
    "maxDecibels": -30,
    "smoothingTimeConstant": 0.8,
    "frequencyBinCount": 1024
  },
  "GainNode": {
    "gain": 1
  },
  "DelayNode": {
    "delayTime": 0
  },
  "BiquadFilterNode": {
    "type": "lowpass",
    "frequency": 350,
    "Q": 1,
    "detune": 0,
    "gain": 0
  },
  "WaveShaperNode": {
    "curve": null,
    "oversample": "none"
  },
  "PannerNode": {
    "panningModel": "equalpower",
    "distanceModel": "inverse",
    "refDistance": 1,
    "maxDistance": 10000,
    "rolloffFactor": 1,
    "coneInnerAngle": 360,
    "coneOuterAngle": 360,
    "coneOuterGain": 0
  },
  "ConvolverNode": {
    "buffer": null,
    "normalize": true
  },
  "ChannelSplitterNode": {},
  "ChannelMergerNode": {},
  "DynamicsCompressorNode": {
    "threshold": -24,
    "knee": 30,
    "ratio": 12,
    "reduction": 0,
    "attack": 0.003000000026077032,
    "release": 0.25
  },
  "OscillatorNode": {
    "type": "sine",
    "frequency": 440,
    "detune": 0
  },
  "StereoPannerNode": {
    "pan": 0
  }
};
