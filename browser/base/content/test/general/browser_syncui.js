/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

var {Log} = Cu.import("resource://gre/modules/Log.jsm", {});
var {Weave} = Cu.import("resource://services-sync/main.js", {});
var {Notifications} = Cu.import("resource://services-sync/notifications.js", {});

var stringBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                   .getService(Ci.nsIStringBundleService)
                   .createBundle("chrome://weave/locale/services/sync.properties");

// ensure test output sees log messages.
Log.repository.getLogger("browserwindow.syncui").addAppender(new Log.DumpAppender());

// Send the specified sync-related notification and return a promise that
// resolves once gSyncUI._promiseUpateUI is complete and the UI is ready to check.
function notifyAndPromiseUIUpdated(topic) {
  return new Promise(resolve => {
    // Instrument gSyncUI so we know when the update is complete.
    let oldPromiseUpdateUI = gSyncUI._promiseUpdateUI.bind(gSyncUI);
    gSyncUI._promiseUpdateUI = function() {
      return oldPromiseUpdateUI().then(() => {
        // Restore our override.
        gSyncUI._promiseUpdateUI = oldPromiseUpdateUI;
        // Resolve the promise so the caller knows the update is done.
        resolve();
      });
    };
    // Now send the notification.
    Services.obs.notifyObservers(null, topic, null);
  });
}

// Sync manages 3 broadcasters so the menus correctly reflect the Sync state.
// Only one of these 3 should ever be visible - pass the ID of the broadcaster
// you expect to be visible and it will check it's the only one that is.
function checkBroadcasterVisible(broadcasterId) {
  let all = ["sync-reauth-state", "sync-setup-state", "sync-syncnow-state"];
  Assert.ok(all.indexOf(broadcasterId) >= 0, "valid id");
  for (let check of all) {
    let eltHidden = document.getElementById(check).hidden;
    Assert.equal(eltHidden, check == broadcasterId ? false : true, check);
  }
}

function promiseObserver(topic) {
  return new Promise(resolve => {
    let obs = (subject, topic, data) => {
      Services.obs.removeObserver(obs, topic);
      resolve(subject);
    }
    Services.obs.addObserver(obs, topic, false);
  });
}

function checkButtonTooltips(stringPrefix) {
  for (let butId of ["sync-button", "PanelUI-fxa-icon"]) {
    let text = document.getElementById(butId).getAttribute("tooltiptext");
    let desc = `Text is "${text}", expecting it to start with "${stringPrefix}"`
    Assert.ok(text.startsWith(stringPrefix), desc);
  }
}

add_task(function* prepare() {
  // add the Sync button to the toolbar so we can get it!
  CustomizableUI.addWidgetToArea("sync-button", CustomizableUI.AREA_NAVBAR);
  registerCleanupFunction(() => {
    CustomizableUI.removeWidgetFromArea("sync-button");
  });

  let xps = Components.classes["@mozilla.org/weave/service;1"]
                              .getService(Components.interfaces.nsISupports)
                              .wrappedJSObject;
  yield xps.whenLoaded();
  // Put Sync and the UI into a known state.
  Weave.Status.login = Weave.LOGIN_FAILED_NO_USERNAME;
  yield notifyAndPromiseUIUpdated("weave:ui:clear-error");

  checkBroadcasterVisible("sync-setup-state");
  checkButtonTooltips("Sign In To Sync");
  // mock out the "_needsSetup()" function so we don't short-circuit.
  let oldNeedsSetup = window.gSyncUI._needsSetup;
  window.gSyncUI._needsSetup = () => Promise.resolve(false);
  registerCleanupFunction(() => {
    window.gSyncUI._needsSetup = oldNeedsSetup;
    // and an observer to set the state back to what it should be now we've
    // restored the stub.
  yield notifyAndPromiseUIUpdated("weave:ui:clear-error");
  });
  // and a notification to have the state change away from "needs setup"
  Services.obs.notifyObservers(null, "weave:ui:clear-error", null);
  checkBroadcasterVisible("sync-syncnow-state");
});

add_task(function* testSyncNeedsVerification() {
  Assert.equal(Notifications.notifications.length, 0, "start with no notifications");
  // mock out the "_needsVerification()" function
  let oldNeedsVerification = window.gSyncUI._needsVerification;
  window.gSyncUI._needsVerification = () => true;
  try {
    // a notification for the state change
    yield notifyAndPromiseUIUpdated("weave:ui:clear-error");
    checkButtonTooltips("Verify");
  } finally {
    window.gSyncUI._needsVerification = oldNeedsVerification;
  }
});


add_task(function* testSyncLoginError() {
  Assert.equal(Notifications.notifications.length, 0, "start with no notifications");
  checkBroadcasterVisible("sync-syncnow-state");

  // Pretend we are in a "login failed" error state
  Weave.Status.sync = Weave.LOGIN_FAILED;
  Weave.Status.login = Weave.LOGIN_FAILED_LOGIN_REJECTED;
  yield notifyAndPromiseUIUpdated("weave:ui:sync:error");

  Assert.equal(Notifications.notifications.length, 0, "no notifications shown on login error");
  // But the menu *should* reflect the login error.
  checkBroadcasterVisible("sync-reauth-state");
  // The tooltips for the buttons should also reflect it.
  checkButtonTooltips("Reconnect");

  // Now pretend we just had a successful login - the error notification should go away.
  Weave.Status.sync = Weave.STATUS_OK;
  Weave.Status.login = Weave.LOGIN_SUCCEEDED;
  yield notifyAndPromiseUIUpdated("weave:service:login:start");
  yield notifyAndPromiseUIUpdated("weave:service:login:finish");
  Assert.equal(Notifications.notifications.length, 0, "no notifications left");
  // The menus should be back to "all good"
  checkBroadcasterVisible("sync-syncnow-state");
});

function checkButtonsStatus(shouldBeActive) {
  let button = document.getElementById("sync-button");
  let panelbutton = document.getElementById("PanelUI-fxa-status");
  if (shouldBeActive) {
    Assert.equal(button.getAttribute("status"), "active");
    Assert.equal(panelbutton.getAttribute("syncstatus"), "active");
  } else {
    Assert.ok(!button.hasAttribute("status"));
    Assert.ok(!panelbutton.hasAttribute("syncstatus"));
  }
}

function* testButtonActions(startNotification, endNotification, expectActive = true) {
  checkButtonsStatus(false);
  // pretend a sync is starting.
  yield notifyAndPromiseUIUpdated(startNotification);
  checkButtonsStatus(expectActive);
  // and has stopped
  yield notifyAndPromiseUIUpdated(endNotification);
  checkButtonsStatus(false);
}

function *doTestButtonActivities() {
  yield testButtonActions("weave:service:login:start", "weave:service:login:finish");
  yield testButtonActions("weave:service:login:start", "weave:service:login:error");

  yield testButtonActions("weave:service:sync:start", "weave:service:sync:finish");
  yield testButtonActions("weave:service:sync:start", "weave:service:sync:error");

  // and ensure the counters correctly handle multiple in-flight syncs
  yield notifyAndPromiseUIUpdated("weave:service:sync:start");
  checkButtonsStatus(true);
  // sync stops.
  yield notifyAndPromiseUIUpdated("weave:service:sync:finish");
  // Button should not be active.
  checkButtonsStatus(false);
}

add_task(function* testButtonActivitiesInNavBar() {
  // check the button's functionality while the button is in the NavBar - which
  // it already is.
  yield doTestButtonActivities();
});

add_task(function* testButtonActivitiesInPanel() {
  // check the button's functionality while the button is in the panel - it's
  // currently in the NavBar - move it to the panel and open it.
  CustomizableUI.addWidgetToArea("sync-button", CustomizableUI.AREA_PANEL);
  // check the button's functionality
  yield PanelUI.show();
  try {
    yield doTestButtonActivities();
  } finally {
    PanelUI.hide();
  }
});
