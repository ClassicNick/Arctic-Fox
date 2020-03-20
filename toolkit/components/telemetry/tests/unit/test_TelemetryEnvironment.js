/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/TelemetryEnvironment.jsm", this);
Cu.import("resource://gre/modules/Preferences.jsm", this);
Cu.import("resource://gre/modules/PromiseUtils.jsm", this);

function run_test() {
  do_test_pending();
  do_get_profile();
  run_next_test();
}

function isRejected(promise) {
  return new Promise((resolve, reject) => {
    promise.then(() => resolve(false), () => resolve(true));
  });
}

add_task(function* test_initAndShutdown() {
  // Check that init and shutdown work properly.
  TelemetryEnvironment.init();
  yield TelemetryEnvironment.shutdown();
  TelemetryEnvironment.init();
  yield TelemetryEnvironment.shutdown();

  // A double init should be silently handled.
  TelemetryEnvironment.init();
  TelemetryEnvironment.init();

  // getEnvironmentData should return a sane result.
  let data = yield TelemetryEnvironment.getEnvironmentData();
  Assert.ok(!!data);

  // The change listener registration should silently fail after shutdown.
  yield TelemetryEnvironment.shutdown();
  TelemetryEnvironment.registerChangeListener("foo", () => {});
  TelemetryEnvironment.unregisterChangeListener("foo");

  // Shutting down again should be ignored.
  yield TelemetryEnvironment.shutdown();

  // Getting the environment data should reject after shutdown.
  Assert.ok(yield isRejected(TelemetryEnvironment.getEnvironmentData()));
});

add_task(function* test_changeNotify() {
  TelemetryEnvironment.init();

  // Register some listeners
  let results = new Array(4).fill(false);
  for (let i=0; i<results.length; ++i) {
    let k = i;
    TelemetryEnvironment.registerChangeListener("test"+k, () => results[k] = true);
  }
  // Trigger environment change notifications.
  // TODO: test with proper environment changes, not directly.
  TelemetryEnvironment._onEnvironmentChange("foo");
  Assert.ok(results.every(val => val), "All change listeners should have been notified.");
  results.fill(false);
  TelemetryEnvironment._onEnvironmentChange("bar");
  Assert.ok(results.every(val => val), "All change listeners should have been notified.");

  // Unregister listeners
  for (let i=0; i<4; ++i) {
    TelemetryEnvironment.unregisterChangeListener("test"+i);
  }
});

add_task(function* test_prefWatchPolicies() {
  const PREF_TEST_1 = "toolkit.telemetry.test.pref_new";
  const PREF_TEST_2 = "toolkit.telemetry.test.pref1";
  const PREF_TEST_3 = "toolkit.telemetry.test.pref2";

  const expectedValue = "some-test-value";
  gNow = futureDate(gNow, 10 * MILLISECONDS_PER_MINUTE);
  fakeNow(gNow);

  const PREFS_TO_WATCH = new Map([
    [PREF_TEST_1, TelemetryEnvironment.RECORD_PREF_VALUE],
    [PREF_TEST_2, TelemetryEnvironment.RECORD_PREF_STATE],
    [PREF_TEST_3, TelemetryEnvironment.RECORD_PREF_STATE],
    [PREF_TEST_4, TelemetryEnvironment.RECORD_PREF_VALUE],
  ]);

  Preferences.set(PREF_TEST_4, expectedValue);

  // Set the Environment preferences to watch.
  TelemetryEnvironment._watchPreferences(PREFS_TO_WATCH);
  let deferred = PromiseUtils.defer();

  // Check that the pref values are missing or present as expected
  Assert.strictEqual(TelemetryEnvironment.currentEnvironment.settings.userPrefs[PREF_TEST_1], undefined);
  Assert.strictEqual(TelemetryEnvironment.currentEnvironment.settings.userPrefs[PREF_TEST_4], expectedValue);

  TelemetryEnvironment.registerChangeListener("testWatchPrefs",
    (reason, data) => deferred.resolve(data));
  let oldEnvironmentData = TelemetryEnvironment.currentEnvironment;

  // Trigger a change in the watched preferences.
  Preferences.set(PREF_TEST_1, expectedValue);
  Preferences.set(PREF_TEST_2, false);
  let eventEnvironmentData = yield deferred.promise;

  // Unregister the listener.
  TelemetryEnvironment.unregisterChangeListener("testWatchPrefs");

  // Check environment contains the correct data.
  Assert.deepEqual(oldEnvironmentData, eventEnvironmentData);
  let userPrefs = TelemetryEnvironment.currentEnvironment.settings.userPrefs;

  Assert.equal(userPrefs[PREF_TEST_1], expectedValue,
               "Environment contains the correct preference value.");
  Assert.equal(userPrefs[PREF_TEST_2], "<user-set>",
               "Report that the pref was user set but the value is not shown.");
  Assert.ok(!(PREF_TEST_3 in userPrefs),
            "Do not report if preference not user set.");
});

add_task(function* test_prefWatch_prefReset() {
  const PREF_TEST = "toolkit.telemetry.test.pref1";
  const PREFS_TO_WATCH = new Map([
    [PREF_TEST, TelemetryEnvironment.RECORD_PREF_STATE],
  ]);

  // Set the preference to a non-default value.
  Preferences.set(PREF_TEST, false);

  gNow = futureDate(gNow, 10 * MILLISECONDS_PER_MINUTE);
  fakeNow(gNow);

  // Set the Environment preferences to watch.
  TelemetryEnvironment._watchPreferences(PREFS_TO_WATCH);
  let deferred = PromiseUtils.defer();
  TelemetryEnvironment.registerChangeListener("testWatchPrefs_reset", deferred.resolve);

  Assert.strictEqual(TelemetryEnvironment.currentEnvironment.settings.userPrefs[PREF_TEST], "<user-set>");

  // Trigger a change in the watched preferences.
  Preferences.reset(PREF_TEST);
  yield deferred.promise;

  Assert.strictEqual(TelemetryEnvironment.currentEnvironment.settings.userPrefs[PREF_TEST], undefined);

  // Unregister the listener.
  TelemetryEnvironment.unregisterChangeListener("testWatchPrefs_reset");
});

add_task(function* test_changeThrottling() {
  const PREF_TEST = "toolkit.telemetry.test.pref1";
  const PREFS_TO_WATCH = new Map([
    [PREF_TEST, TelemetryEnvironment.RECORD_PREF_STATE],
  ]);
  Preferences.reset(PREF_TEST);

  gNow = futureDate(gNow, 10 * MILLISECONDS_PER_MINUTE);
  fakeNow(gNow);

  // Set the Environment preferences to watch.
  TelemetryEnvironment._watchPreferences(PREFS_TO_WATCH);
  let deferred = PromiseUtils.defer();
  let changeCount = 0;
  TelemetryEnvironment.registerChangeListener("testWatchPrefs_throttling", () => {
    ++changeCount;
    deferred.resolve();
  });

  // The first pref change should trigger a notification.
  Preferences.set(PREF_TEST, 1);
  yield deferred.promise;
  Assert.equal(changeCount, 1);

  // We should only get a change notification for second of the following changes.
  deferred = PromiseUtils.defer();
  gNow = futureDate(gNow, MILLISECONDS_PER_MINUTE);
  fakeNow(gNow);
  Preferences.set(PREF_TEST, 2);
  gNow = futureDate(gNow, 5 * MILLISECONDS_PER_MINUTE);
  fakeNow(gNow);
  Preferences.set(PREF_TEST, 3);
  yield deferred.promise;

  Assert.equal(changeCount, 2);

  // Unregister the listener.
  TelemetryEnvironment.unregisterChangeListener("testWatchPrefs_throttling");
});

add_task(function*() {
  do_test_finished();
});
