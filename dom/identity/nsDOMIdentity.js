/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const PREF_DEBUG = "toolkit.identity.debug";
const PREF_ENABLED = "dom.identity.enabled";

// Bug 822450: Workaround for Bug 821740.  When testing with marionette,
// relax navigator.id.request's requirement that it be handling native
// events.  Synthetic marionette events are ok.
const PREF_SYNTHETIC_EVENTS_OK = "dom.identity.syntheticEventsOk";

// Maximum length of a string that will go through IPC
const MAX_STRING_LENGTH = 2048;
// Maximum number of times navigator.id.request can be called for a document
const MAX_RP_CALLS = 100;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "checkDeprecated",
                                  "resource://gre/modules/identity/IdentityUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "checkRenamed",
                                  "resource://gre/modules/identity/IdentityUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "objectCopy",
                                  "resource://gre/modules/identity/IdentityUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "uuidgen",
                                   "@mozilla.org/uuid-generator;1",
                                   "nsIUUIDGenerator");

// This is the child process corresponding to nsIDOMIdentity
XPCOMUtils.defineLazyServiceGetter(this, "cpmm",
                                   "@mozilla.org/childprocessmessagemanager;1",
                                   "nsIMessageSender");


const ERRORS = {
  "ERROR_INVALID_ASSERTION_AUDIENCE":
    "Assertion audience may not differ from origin",
  "ERROR_REQUEST_WHILE_NOT_HANDLING_USER_INPUT":
    "The request() method may only be invoked when handling user input",
};

function nsDOMIdentity() {
}

nsDOMIdentity.prototype = {

  // require native events unless syntheticEventsOk is set
  get nativeEventsRequired() {
    if (Services.prefs.prefHasUserValue(PREF_SYNTHETIC_EVENTS_OK) &&
        (Services.prefs.getPrefType(PREF_SYNTHETIC_EVENTS_OK) ===
         Ci.nsIPrefBranch.PREF_BOOL)) {
      return !Services.prefs.getBoolPref(PREF_SYNTHETIC_EVENTS_OK);
    }
    return true;
  },

  reportErrors: function(message) {
    let onerror = function() {};
    if (this._rpWatcher && this._rpWatcher.onerror) {
      onerror = this._rpWatcher.onerror;
    }

    message.errors.forEach((error) => {
      // Report an error string to content
      Cu.reportError(ERRORS[error]);

      // Report error code to RP callback, if available
      onerror(error);
    });
  },

  /**
   * Relying Party (RP) APIs
   */

  watch: function nsDOMIdentity_watch(aOptions = {}) {
    aOptions = Cu.waiveXrays(aOptions);
    if (this._rpWatcher) {
      // For the initial release of Firefox Accounts, we support callers who
      // invoke watch() either for Firefox Accounts, or Persona, but not both.
      // In the future, we may wish to support the dual invocation (say, for
      // packaged apps so they can sign users in who reject the app's request
      // to sign in with their Firefox Accounts identity).
      throw new Error("navigator.id.watch was already called");
    }

    assertCorrectCallbacks(aOptions);

    let message = this.DOMIdentityMessage(aOptions);

    // loggedInUser vs loggedInEmail
    // https://developer.mozilla.org/en-US/docs/DOM/navigator.id.watch
    // This parameter, loggedInUser, was renamed from loggedInEmail in early
    // September, 2012. Both names will continue to work for the time being,
    // but code should be changed to use loggedInUser instead.
    checkRenamed(aOptions, "loggedInEmail", "loggedInUser");

    // Bad IPC or IDL converts null and undefined to "null" and "undefined".
    // We can't assign to aOptions, which complicates the workaround.
    message["loggedInUser"] = aOptions["loggedInUser"];
    if (message.loggedInUser == "null" || message.loggedInUser == "undefined") {
      message.loggedInUser = null;
    }

    if (message.loggedInUser) {
      if (typeof(message.loggedInUser) !== "string") {
        throw new Error("loggedInUser must be a String or null");
      }

      // TODO: Bug 767610 - check email format.
      // See HTMLInputElement::IsValidEmailAddress
      if (aOptions["loggedInUser"].indexOf("@") == -1
          || aOptions["loggedInUser"].length > MAX_STRING_LENGTH) {
        throw new Error("loggedInUser is not valid");
      }
    }
    this._log("loggedInUser: " + message.loggedInUser);

    this._rpWatcher = aOptions;
    this._rpWatcher.audience = message.audience;

    if (message.errors.length) {
      this.reportErrors(message);
      // We don't delete the rpWatcher object, because we don't want the
      // broken client to be able to call watch() any more.  It's broken.
      return;
    }
    this._mm.sendAsyncMessage(
      "Identity:RP:Watch",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  request: function nsDOMIdentity_request(aOptions = {}) {
    aOptions = Cu.waiveXrays(aOptions);
    this._log("request: " + JSON.stringify(aOptions));

    // Has the caller called watch() before this?
    if (!this._rpWatcher) {
      throw new Error("navigator.id.request called before navigator.id.watch");
    }
    if (this._rpCalls > MAX_RP_CALLS) {
      throw new Error("navigator.id.request called too many times");
    }

    let util = this._window.QueryInterface(Ci.nsIInterfaceRequestor)
                           .getInterface(Ci.nsIDOMWindowUtils);

    let message = this.DOMIdentityMessage(aOptions);

    // We permit calling of request() outside of a user input handler only when
    // a certified or privileged app is calling, or when we are handling the
    // (deprecated) get() or getVerifiedEmail() calls, which make use of an RP
    // context marked as _internal.

    if (!aOptions._internal &&
        this._appStatus !== Ci.nsIPrincipal.APP_STATUS_CERTIFIED &&
        this._appStatus !== Ci.nsIPrincipal.APP_STATUS_PRIVILEGED) {

      // If the caller is not special in one of those ways, see if the user has
      // preffed on 'syntheticEventsOk' (useful for testing); otherwise, if
      // this is a non-native event, reject it.
      let util = this._window.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindowUtils);

      if (!util.isHandlingUserInput && this.nativeEventsRequired) {
        message.errors.push("ERROR_REQUEST_WHILE_NOT_HANDLING_USER_INPUT");
      }
    }

    // Report and fail hard on any errors.
    if (message.errors.length) {
      this.reportErrors(message);
      return;
    }

    if (aOptions) {
      // Optional string properties
      let optionalStringProps = ["privacyPolicy", "termsOfService"];
      for (let propName of optionalStringProps) {
        if (!aOptions[propName] || aOptions[propName] === "undefined")
          continue;
        if (typeof(aOptions[propName]) !== "string") {
          throw new Error(propName + " must be a string representing a URL.");
        }
        if (aOptions[propName].length > MAX_STRING_LENGTH) {
          throw new Error(propName + " is invalid.");
        }
        message[propName] = aOptions[propName];
      }

      if (aOptions["oncancel"]
            && typeof(aOptions["oncancel"]) !== "function") {
        throw new Error("oncancel is not a function");
      } else {
        // Store optional cancel callback for later.
        this._onCancelRequestCallback = aOptions.oncancel;
      }
    }

    this._rpCalls++;
    this._mm.sendAsyncMessage(
      "Identity:RP:Request",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  logout: function nsDOMIdentity_logout() {
    if (!this._rpWatcher) {
      throw new Error("navigator.id.logout called before navigator.id.watch");
    }
    if (this._rpCalls > MAX_RP_CALLS) {
      throw new Error("navigator.id.logout called too many times");
    }

    this._rpCalls++;
    let message = this.DOMIdentityMessage();

    // Report and fail hard on any errors.
    if (message.errors.length) {
      this.reportErrors(message);
      return;
    }

    this._mm.sendAsyncMessage(
      "Identity:RP:Logout",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  /*
   * Get an assertion.  This function is deprecated.  RPs are
   * encouraged to use the observer API instead (watch + request).
   */
  get: function nsDOMIdentity_get(aCallback, aOptions) {
    var opts = {};
    aOptions = aOptions || {};

    // We use the observer API (watch + request) to implement get().
    // Because the caller can call get() and getVerifiedEmail() as
    // many times as they want, we lift the restriction that watch() can
    // only be called once.
    this._rpWatcher = null;

    // This flag tells internal_api.js (in the shim) to record in the
    // login parameters whether the assertion was acquired silently or
    // with user interaction.
    opts._internal = true;

    opts.privacyPolicy = aOptions.privacyPolicy || undefined;
    opts.termsOfService = aOptions.termsOfService || undefined;
    opts.privacyURL = aOptions.privacyURL || undefined;
    opts.tosURL = aOptions.tosURL || undefined;
    opts.siteName = aOptions.siteName || undefined;
    opts.siteLogo = aOptions.siteLogo || undefined;

    opts.oncancel = function get_oncancel() {
      if (aCallback) {
        aCallback(null);
        aCallback = null;
      }
    };

    if (checkDeprecated(aOptions, "silent")) {
      // Silent has been deprecated, do nothing. Placing the check here
      // prevents the callback from being called twice, once with null and
      // once after internalWatch has been called. See issue #1532:
      // https://github.com/mozilla/browserid/issues/1532
      if (aCallback) {
        setTimeout(function() { aCallback(null); }, 0);
      }
      return;
    }

    // Get an assertion by using our observer api: watch + request.
    var self = this;
    this.watch({
      _internal: true,
      onlogin: function get_onlogin(assertion, internalParams) {
        if (assertion && aCallback && internalParams && !internalParams.silent) {
          aCallback(assertion);
          aCallback = null;
        }
      },
      onlogout: function get_onlogout() {},
      onready: function get_onready() {
        self.request(opts);
      }
    });
  },

  getVerifiedEmail: function nsDOMIdentity_getVerifiedEmail(aCallback) {
    Cu.reportError("WARNING: getVerifiedEmail has been deprecated");
    this.get(aCallback, {});
  },

  /**
   *  Identity Provider (IDP) Provisioning APIs
   */

  beginProvisioning: function nsDOMIdentity_beginProvisioning(aCallback) {
    this._log("beginProvisioning");
    if (this._beginProvisioningCallback) {
      throw new Error("navigator.id.beginProvisioning already called.");
    }
    if (!aCallback || typeof(aCallback) !== "function") {
      throw new Error("beginProvisioning callback is required.");
    }

    this._beginProvisioningCallback = aCallback;
    this._mm.sendAsyncMessage(
      "Identity:IDP:BeginProvisioning",
      this.DOMIdentityMessage(),
      null,
      this._window.document.nodePrincipal
    );
  },

  genKeyPair: function nsDOMIdentity_genKeyPair(aCallback) {
    this._log("genKeyPair");
    if (!this._beginProvisioningCallback) {
      throw new Error("navigator.id.genKeyPair called outside of provisioning");
    }
    if (this._genKeyPairCallback) {
      throw new Error("navigator.id.genKeyPair already called.");
    }
    if (!aCallback || typeof(aCallback) !== "function") {
      throw new Error("genKeyPair callback is required.");
    }

    this._genKeyPairCallback = aCallback;
    this._mm.sendAsyncMessage(
      "Identity:IDP:GenKeyPair",
      this.DOMIdentityMessage(),
      null,
      this._window.document.nodePrincipal
    );
  },

  registerCertificate: function nsDOMIdentity_registerCertificate(aCertificate) {
    this._log("registerCertificate");
    if (!this._genKeyPairCallback) {
      throw new Error("navigator.id.registerCertificate called outside of provisioning");
    }
    if (this._provisioningEnded) {
      throw new Error("Provisioning already ended");
    }
    this._provisioningEnded = true;

    let message = this.DOMIdentityMessage();
    message.cert = aCertificate;
    this._mm.sendAsyncMessage(
      "Identity:IDP:RegisterCertificate",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  raiseProvisioningFailure: function nsDOMIdentity_raiseProvisioningFailure(aReason) {
    this._log("raiseProvisioningFailure '" + aReason + "'");
    if (this._provisioningEnded) {
      throw new Error("Provisioning already ended");
    }
    if (!aReason || typeof(aReason) != "string") {
      throw new Error("raiseProvisioningFailure reason is required");
    }
    this._provisioningEnded = true;

    let message = this.DOMIdentityMessage();
    message.reason = aReason;
    this._mm.sendAsyncMessage(
      "Identity:IDP:ProvisioningFailure",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  /**
   *  Identity Provider (IDP) Authentication APIs
   */

  beginAuthentication: function nsDOMIdentity_beginAuthentication(aCallback) {
    this._log("beginAuthentication");
    if (this._beginAuthenticationCallback) {
      throw new Error("navigator.id.beginAuthentication already called.");
    }
    if (typeof(aCallback) !== "function") {
      throw new Error("beginAuthentication callback is required.");
    }
    if (!aCallback || typeof(aCallback) !== "function") {
      throw new Error("beginAuthentication callback is required.");
    }

    this._beginAuthenticationCallback = aCallback;
    this._mm.sendAsyncMessage(
      "Identity:IDP:BeginAuthentication",
      this.DOMIdentityMessage(),
      null,
      this._window.document.nodePrincipal
    );
  },

  completeAuthentication: function nsDOMIdentity_completeAuthentication() {
    if (this._authenticationEnded) {
      throw new Error("Authentication already ended");
    }
    if (!this._beginAuthenticationCallback) {
      throw new Error("navigator.id.completeAuthentication called outside of authentication");
    }
    this._authenticationEnded = true;

    this._mm.sendAsyncMessage(
      "Identity:IDP:CompleteAuthentication",
      this.DOMIdentityMessage(),
      null,
      this._window.document.nodePrincipal
    );
  },

  raiseAuthenticationFailure: function nsDOMIdentity_raiseAuthenticationFailure(aReason) {
    if (this._authenticationEnded) {
      throw new Error("Authentication already ended");
    }
    if (!aReason || typeof(aReason) != "string") {
      throw new Error("raiseProvisioningFailure reason is required");
    }

    let message = this.DOMIdentityMessage();
    message.reason = aReason;
    this._mm.sendAsyncMessage(
      "Identity:IDP:AuthenticationFailure",
      message,
      null,
      this._window.document.nodePrincipal
    );
  },

  /**
   * Called during init and shutdown.
   */
  _initializeState: function nsDOMIdentity__initializeState() {
    // Some state to prevent abuse
    // Limit the number of calls to .request
    this._rpCalls = 0;
    this._provisioningEnded = false;
    this._authenticationEnded = false;

    this._rpWatcher = null;
    this._onCancelRequestCallback = null;
    this._beginProvisioningCallback = null;
    this._genKeyPairCallback = null;
    this._beginAuthenticationCallback = null;
  },

  // nsIMessageListener
  receiveMessage: function nsDOMIdentity_receiveMessage(aMessage) {
    let msg = aMessage.json;

    // Is this message intended for this window?
    if (msg.id != this._id) {
      return;
    }

    switch (aMessage.name) {
      case "Identity:ResetState":
        if (!this._debug) {
          return;
        }
        this._initializeState();
        Services.obs.notifyObservers(null, "identity-DOM-state-reset", this._id);
        break;
      case "Identity:RP:Watch:OnLogin":
        // Do we have a watcher?
        if (!this._rpWatcher) {
          this._log("WARNING: Received OnLogin message, but there is no RP watcher");
          return;
        }

        if (this._rpWatcher.onlogin) {
          if (this._rpWatcher._internal) {
            this._rpWatcher.onlogin(msg.assertion, msg._internalParams);
          } else {
            this._rpWatcher.onlogin(msg.assertion);
          }
        }
        break;
      case "Identity:RP:Watch:OnLogout":
        // Do we have a watcher?
        if (!this._rpWatcher) {
          this._log("WARNING: Received OnLogout message, but there is no RP watcher");
          return;
        }

        if (this._rpWatcher.onlogout) {
          this._rpWatcher.onlogout();
        }
        break;
      case "Identity:RP:Watch:OnReady":
        // Do we have a watcher?
        if (!this._rpWatcher) {
          this._log("WARNING: Received OnReady message, but there is no RP watcher");
          return;
        }

        if (this._rpWatcher.onready) {
          this._rpWatcher.onready();
        }
        break;
      case "Identity:RP:Watch:OnCancel":
        // Do we have a watcher?
        if (!this._rpWatcher) {
          this._log("WARNING: Received OnCancel message, but there is no RP " +
                    "watcher");
          return;
        }

        if (this._onCancelRequestCallback) {
          this._onCancelRequestCallback();
        }
        break;
      case "Identity:RP:Watch:OnError":
        if (!this._rpWatcher) {
          this._log("WARNING: Received OnError message, but there is no RP " +
                    "watcher");
          return;
        }

        if (this._rpWatcher.onerror) {
          this._rpWatcher.onerror(JSON.stringify({name: msg.message.error}));
        }
        break;
      case "Identity:IDP:CallBeginProvisioningCallback":
        this._callBeginProvisioningCallback(msg);
        break;
      case "Identity:IDP:CallGenKeyPairCallback":
        this._callGenKeyPairCallback(msg);
        break;
      case "Identity:IDP:CallBeginAuthenticationCallback":
        this._callBeginAuthenticationCallback(msg);
        break;
    }
  },

  _callGenKeyPairCallback: function nsDOMIdentity__callGenKeyPairCallback(message) {
    // create a pubkey object that works
    let chrome_pubkey = JSON.parse(message.publicKey);

    // bunch of stuff to create a proper object in window context
    function genPropDesc(value) {
      return {
        enumerable: true, configurable: true, writable: true, value: value
      };
    }

    let propList = {};
    for (let k in chrome_pubkey) {
      propList[k] = genPropDesc(chrome_pubkey[k]);
    }

    let pubkey = Cu.createObjectIn(this._window);
    Object.defineProperties(pubkey, propList);
    Cu.makeObjectPropsNormal(pubkey);

    // do the callback
    this._genKeyPairCallback(pubkey);
  },

  _callBeginProvisioningCallback:
      function nsDOMIdentity__callBeginProvisioningCallback(message) {
    let identity = message.identity;
    let certValidityDuration = message.certDuration;
    this._beginProvisioningCallback(identity,
                                    certValidityDuration);
  },

  _callBeginAuthenticationCallback:
      function nsDOMIdentity__callBeginAuthenticationCallback(message) {
    let identity = message.identity;
    this._beginAuthenticationCallback(identity);
  },

  /**
   * Helper to create messages to send using a message manager.
   * Pass through user options if they are not functions.  Always
   * overwrite id, origin, audience, and appStatus.  The caller
   * does not get to set those.
   */
  DOMIdentityMessage: function DOMIdentityMessage(aOptions) {
    aOptions = aOptions || {};
    let message = {
      errors: []
    };

    objectCopy(aOptions, message);

    // outer window id
    message.id = this._id;

    // window origin
    message.origin = this._origin;

    // Normally the window origin will be the audience in assertions.  On b2g,
    // certified apps have the power to override this and declare any audience
    // the want.  Privileged apps can also declare a different audience, as
    // long as it is the same as the origin specified in their manifest files.
    // All other apps are stuck with b2g origins of the form app://{guid}.
    // Since such an origin is meaningless for the purposes of verification,
    // they will have to jump through some hoops to sign in: Specifically, they
    // will have to host their sign-in flows and DOM API requests in an iframe,
    // have the iframe xhr post assertions up to their server for verification,
    // and then post-message the results down to their app.
    let _audience = message.origin;
    if (message.audience && message.audience != message.origin) {
      if (this._appStatus === Ci.nsIPrincipal.APP_STATUS_CERTIFIED) {
        _audience = message.audience;
        this._log("Certified app setting assertion audience: " + _audience);
      } else {
        message.errors.push("ERROR_INVALID_ASSERTION_AUDIENCE");
      }
    }

    // Replace any audience supplied by the RP with one that has been sanitised
    message.audience = _audience;

    this._log("DOMIdentityMessage: " + JSON.stringify(message));

    return message;
  },

 /**
  * Internal methods that are not exposed to content.
  * See dom/webidl/Identity.webidl for the public interface.
  */
  // nsIObserver
  observe: function nsDOMIdentityInternal_observe(aSubject, aTopic, aData) {
    let wId = aSubject.QueryInterface(Ci.nsISupportsPRUint64).data;
    if (wId != this._innerWindowID) {
      return;
    }

    this.uninit();

    Services.obs.removeObserver(this, "inner-window-destroyed");
    this._initializeState();

    // TODO: Also send message to DOMIdentity notifiying window is no longer valid
    // ie. in the case that the user closes the auth. window and we need to know.

    try {
      for (let msgName of this._messages) {
        this._mm.removeMessageListener(msgName, this);
      }
    } catch (ex) {
      // Avoid errors when removing more than once.
    }

    this._mm = null;
  },

  //  Because we implement nsIDOMGlobalPropertyInitializer, our init() method
  //  is invoked with content window as its single argument.
  init: function nsDOMIdentityInternal_init(aWindow) {
    if (Services.prefs.getPrefType(PREF_ENABLED) != Ci.nsIPrefBranch.PREF_BOOL
        || !Services.prefs.getBoolPref(PREF_ENABLED)) {
      return null;
    }

    this._debug =
      Services.prefs.getPrefType(PREF_DEBUG) == Ci.nsIPrefBranch.PREF_BOOL
      && Services.prefs.getBoolPref(PREF_DEBUG);

    // Setup identifiers for current window.
    let util = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);

    // To avoid cross-process windowId collisions, use a uuid as an
    // almost certainly unique identifier.
    //
    // XXX Bug 869182 - use a combination of child process id and
    // innerwindow id to construct the unique id.
    this._id = uuidgen.generateUUID().toString();
    this._window = aWindow;

    // nsDOMIdentity needs to know our _id, so this goes after
    // its creation.
    this._initializeState();

    // Store window and origin URI.
    this._window = aWindow;
    this._origin = aWindow.document.nodePrincipal.origin;
    this._appStatus = aWindow.document.nodePrincipal.appStatus;
    this._appId = aWindow.document.nodePrincipal.appId;

    this._log("init was called from " + aWindow.document.location);

    this._mm = cpmm;

    // Setup listeners for messages from parent process.
    this._messages = [
      "Identity:ResetState",
      "Identity:RP:Watch:OnLogin",
      "Identity:RP:Watch:OnLogout",
      "Identity:RP:Watch:OnReady",
      "Identity:RP:Watch:OnCancel",
      "Identity:RP:Watch:OnError",
      "Identity:IDP:CallBeginProvisioningCallback",
      "Identity:IDP:CallGenKeyPairCallback",
      "Identity:IDP:CallBeginAuthenticationCallback"
    ];
    this._messages.forEach(function(msgName) {
      this._mm.addMessageListener(msgName, this);
    }, this);

    // Setup observers so we can remove message listeners.
    Services.obs.addObserver(this, "inner-window-destroyed", false);
  },

  uninit: function DOMIdentity_uninit() {
    this._log("nsDOMIdentity uninit() " + this._id);
    this._mm.sendAsyncMessage(
      "Identity:RP:Unwatch",
      { id: this._id }
    );
   },

  // Private.
  _log: function nsDOMIdentityInternal__log(msg) {
    if (!this._debug) {
      return;
    }
    dump("nsDOMIdentity (" + this._id + "): " + msg + "\n");
  },

  // Component setup.
  classID: Components.ID("{210853d9-2c97-4669-9761-b1ab9cbf57ef}"),

  QueryInterface: XPCOMUtils.generateQI([
      Ci.nsIMessageListener,
      Ci.nsIObserver,
      Ci.nsIDOMGlobalPropertyInitializer
  ]),

  classInfo: XPCOMUtils.generateCI({
    classID: Components.ID("{210853d9-2c97-4669-9761-b1ab9cbf57ef}"),
    contractID: "@mozilla.org/dom/identity;1",
    interfaces: [],
    classDescription: "Identity DOM Implementation"
  })
};

function assertCorrectCallbacks(aOptions) {
  // The relying party (RP) provides callbacks on watch().
  //
  // In the future, BrowserID will probably only require an onlogin()
  // callback, lifting the requirement that BrowserID handle logged-in
  // state management for RPs.  See
  // https://github.com/mozilla/id-specs/blob/greenfield/browserid/api-rp.md
  //
  // However, Firefox Accounts requires callers to provide onlogout(),
  // onready(), and also supports an onerror() callback.

  let requiredCallbacks = ["onlogin"];
  let optionalCallbacks = ["onlogout", "onready", "onerror"];

  if (aOptions.wantIssuer == "firefox-accounts") {
    requiredCallbacks = ["onlogin", "onlogout", "onready"];
    optionalCallbacks = ["onerror"];
  }

  for (let cbName of requiredCallbacks) {
    if (typeof(aOptions[cbName]) != "function") {
      throw new Error(cbName + " callback is required.");
    }
  }

  for (let cbName of optionalCallbacks) {
    if (aOptions[cbName] && typeof(aOptions[cbName]) != "function") {
      throw new Error(cbName + " must be a function");
    }
  }
}

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([nsDOMIdentity]);
