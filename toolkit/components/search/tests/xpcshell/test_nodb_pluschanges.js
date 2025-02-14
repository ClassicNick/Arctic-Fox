/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */


/*
 * test_nodb: Start search engine
 * - without search-metadata.json
 * - without search.sqlite
 *
 * Ensure that :
 * - nothing explodes;
 * - if we change the order, search.json is updated;
 * - this search.json can be parsed;
 * - the order stored in search.json is consistent.
 *
 * Notes:
 * - we install the search engines of test "test_downloadAndAddEngines.js"
 * to ensure that this test is independent from locale, commercial agreements
 * and configuration of Firefox.
 */

function run_test() {
  updateAppInfo();
  do_load_manifest("data/chrome.manifest");
  useHttpServer();

  run_next_test();
}

add_task(function* test_nodb_pluschanges() {
  let [engine1, engine2] = yield addTestEngines([
    { name: "Test search engine", xmlFileName: "engine.xml" },
    { name: "A second test engine", xmlFileName: "engine2.xml"},
  ]);
  yield promiseAfterCache();

  let search = Services.search;

  search.moveEngine(engine1, 0);
  search.moveEngine(engine2, 1);

  // This is needed to avoid some reentrency issues in nsSearchService.
  do_print("Next step is forcing flush");
  yield new Promise(resolve => do_execute_soon(resolve));

  do_print("Forcing flush");
  let promiseCommit = new Promise(resolve => afterCommit(resolve));
  search.QueryInterface(Ci.nsIObserver)
        .observe(null, "quit-application", "");
  yield promiseCommit;
  do_print("Commit complete");

  // Check that the entries are placed as specified correctly
  let json = getSearchMetadata();
  do_check_eq(json["[profile]/test-search-engine.xml"].order, 1);
  do_check_eq(json["[profile]/a-second-test-engine.xml"].order, 2);

  do_print("Cleaning up");
  removeMetadata();
});
