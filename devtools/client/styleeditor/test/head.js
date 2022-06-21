/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

const FRAME_SCRIPT_UTILS_URL = "chrome://devtools/content/shared/frame-script-utils.js"
const TEST_BASE = "chrome://mochitests/content/browser/devtools/client/styleeditor/test/";
const TEST_BASE_HTTP = "http://example.com/browser/devtools/client/styleeditor/test/";
const TEST_BASE_HTTPS = "https://example.com/browser/devtools/client/styleeditor/test/";
const TEST_HOST = 'mochi.test:8888';

var {require} = Cu.import("resource://gre/modules/devtools/shared/Loader.jsm", {});
var {TargetFactory} = require("devtools/client/framework/target");
var {console} = Cu.import("resource://gre/modules/devtools/shared/Console.jsm", {});
var promise = require("promise");
var DevToolsUtils = require("devtools/shared/DevToolsUtils");

// Import the GCLI test helper
var testDir = gTestPath.substr(0, gTestPath.lastIndexOf("/"));
Services.scriptloader.loadSubScript(testDir + "../../../commandline/test/helpers.js", this);

DevToolsUtils.testing = true;
SimpleTest.registerCleanupFunction(() => {
  DevToolsUtils.testing = false;
});

/**
 * Add a new test tab in the browser and load the given url.
 * @param {String} url The url to be loaded in the new tab
 * @return a promise that resolves to the tab object when the url is loaded
 */
function addTab(url) {
  info("Adding a new tab with URL: '" + url + "'");
  let def = promise.defer();

  let tab = gBrowser.selectedTab = gBrowser.addTab();
  gBrowser.selectedBrowser.addEventListener("load", function onload() {
    gBrowser.selectedBrowser.removeEventListener("load", onload, true);
    info("URL '" + url + "' loading complete");
    def.resolve(tab);
  }, true);
  content.location = url;

  return def.promise;
}

/**
 * Navigate the currently selected tab to a new URL and wait for it to load.
 * @param {String} url The url to be loaded in the current tab.
 * @return a promise that resolves when the page has fully loaded.
 */
function navigateTo(url) {
  let navigating = promise.defer();
  gBrowser.selectedBrowser.addEventListener("load", function onload() {
    gBrowser.selectedBrowser.removeEventListener("load", onload, true);
    navigating.resolve();
  }, true);
  content.location = url;
  return navigating.promise;
}

function* cleanup()
{
  gPanelWindow = null;
  while (gBrowser.tabs.length > 1) {
    let target = TargetFactory.forTab(gBrowser.selectedTab);
    yield gDevTools.closeToolbox(target);

    gBrowser.removeCurrentTab();
  }
}

function addTabAndOpenStyleEditors(count, callback, uri) {
  let deferred = promise.defer();
  let currentCount = 0;
  let panel;
  addTabAndCheckOnStyleEditorAdded(p => panel = p, function (editor) {
    currentCount++;
    info(currentCount + " of " + count + " editors opened: "
         + editor.styleSheet.href);
    if (currentCount == count) {
      if (callback) {
        callback(panel);
      }
      deferred.resolve(panel);
    }
  });

  if (uri) {
    content.location = uri;
  }
  return deferred.promise;
}

function addTabAndCheckOnStyleEditorAdded(callbackOnce, callbackOnAdded) {
  gBrowser.selectedTab = gBrowser.addTab();
  gBrowser.selectedBrowser.addEventListener("load", function onLoad() {
    gBrowser.selectedBrowser.removeEventListener("load", onLoad, true);
    openStyleEditorInWindow(window, function (panel) {
      // Execute the individual callback with the panel argument.
      callbackOnce(panel);
      // Report editors that already opened while loading.
      for (let editor of panel.UI.editors) {
        callbackOnAdded(editor);
      }
      // Report new editors added afterwards.
      panel.UI.on("editor-added", (event, editor) => callbackOnAdded(editor));
    });
  }, true);
}

function openStyleEditorInWindow(win, callback) {
  let target = TargetFactory.forTab(win.gBrowser.selectedTab);
  win.gDevTools.showToolbox(target, "styleeditor").then(function(toolbox) {
    let panel = toolbox.getCurrentPanel();
    gPanelWindow = panel._panelWin;

    panel.UI._alwaysDisableAnimations = true;
    callback(panel);
  });
}

function checkDiskCacheFor(host, done)
{
  let foundPrivateData = false;

  Visitor.prototype = {
    onCacheStorageInfo: function(num, consumption)
    {
      info("disk storage contains " + num + " entries");
    },
    onCacheEntryInfo: function(uri)
    {
      var urispec = uri.asciiSpec;
      info(urispec);
      foundPrivateData |= urispec.contains(host);
    },
    onCacheEntryVisitCompleted: function()
    {
      is(foundPrivateData, false, "web content present in disk cache");
      done();
    }
  };
  function Visitor() {}

  var storage = cache.diskCacheStorage(LoadContextInfo.default, false);
  storage.asyncVisitStorage(new Visitor(), true /* Do walk entries */);
}

registerCleanupFunction(cleanup);
