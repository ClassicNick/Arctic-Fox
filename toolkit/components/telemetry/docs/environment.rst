
Environment
===========

The environment consists of data that is expected to be characteristic for performance and other behavior and not expected to change too often.

Changes to most of these data points are detected (where possible and sensible) and will lead to a session split in the :doc:`main-ping`.
The environment data may also be submitted by other ping types.

*Note:* This is not submitted with all ping types due to privacy concerns. This and other data is inspected under the `data collection policy <https://wiki.mozilla.org/Firefox/Data_Collection>`_.

Some parts of the environment must be fetched asynchronously at startup. We don't want other Telemetry components to block on waiting for the environment, so some items may be missing from it until the async fetching finished.
This currently affects the following sections:

- profile
- addons


Structure::

    {
      build: {
        applicationId: <string>, // nsIXULAppInfo.ID
        applicationName: <string>, // "Firefox"
        architecture: <string>, // e.g. "x86", build architecture for the active build
        architecturesInBinary: <string>, // e.g. "i386-x86_64", from nsIMacUtils.architecturesInBinary, only present for mac universal builds
        buildId: <string>, // e.g. "20141126041045"
        version: <string>, // e.g. "35.0"
        vendor: <string>, // e.g. "Mozilla"
        platformVersion: <string>, // e.g. "35.0"
        xpcomAbi: <string>, // e.g. "x86-msvc"
        hotfixVersion: <string>, // e.g. "20141211.01"
      },
      settings: {
        addonCompatibilityCheckEnabled: <bool>, // Whether application compatibility is respected for add-ons
        blocklistEnabled: <bool>, // true on failure
        isDefaultBrowser: <bool>, // null on failure, not available on Android
        defaultSearchEngine: <string>, // e.g. "yahoo"
        defaultSearchEngineData: {, // data about the current default engine
          name: <string>, // engine name, e.g. "Yahoo"; or "NONE" if no default
          loadPath: <string>, // where the engine line is located; missing if no default
          submissionURL: <string> // missing if no default or for user-installed engines
        },
        e10sEnabled: <bool>, // whether e10s is on, i.e. browser tabs open by default in a different process
        telemetryEnabled: <bool>, // false on failure
        isInOptoutSample: <bool>, // whether this client is part of the opt-out sample
        locale: <string>, // e.g. "it", null on failure
        update: {
          channel: <string>, // e.g. "release", null on failure
          enabled: <bool>, // true on failure
          autoDownload: <bool>, // true on failure
        },
        userPrefs: {
          // Only prefs which are changed from the default value are listed
          // in this block
          "pref.name.value": value // some prefs send the value
          "pref.name.url": "<user-set>" // For some privacy-sensitive prefs
            // only the fact that the value has been changed is recorded
        },
      },
      profile: { // This section is not available on Android.
        creationDate: <integer>, // integer days since UNIX epoch, e.g. 16446
        resetDate: <integer>, // integer days since UNIX epoch, e.g. 16446 - optional
      },
      partner: { // This section may not be immediately available on startup
        distributionId: <string>, // pref "distribution.id", null on failure
        distributionVersion: <string>, // pref "distribution.version", null on failure
        partnerId: <string>, // pref mozilla.partner.id, null on failure
        distributor: <string>, // pref app.distributor, null on failure
        distributorChannel: <string>, // pref app.distributor.channel, null on failure
        partnerNames: [
          // list from prefs app.partner.<name>=<name>
        ],
      },
      system: {
        memoryMB: <number>,
        virtualMaxMB: <number>, // windows-only
        isWow64: <bool>, // windows-only
        cpu: {
            count: <number>,  // desktop only, e.g. 8, or null on failure - logical cpus
            cores: <number>, // desktop only, e.g., 4, or null on failure - physical cores
            vendor: <string>, // desktop only, e.g. "GenuineIntel", or null on failure
            family: <string>, // desktop only, null on failure
            model: <string>, // desktop only, null on failure
            stepping: <string>, // desktop only, null on failure
            l2cacheKB: <number>, // L2 cache size in KB, only on windows & mac
            l3cacheKB: <number>, // desktop only, L3 cache size in KB
            speedMHz: <number>, // desktop only, cpu clock speed in MHz
            extensions: [
              <string>,
              ...
              // as applicable:
              // "MMX", "SSE", "SSE2", "SSE3", "SSSE3", "SSE4A", "SSE4_1",
              // "SSE4_2", "EDSP", "ARMv6", "ARMv7", "NEON"
            ],
        },
        device: { // This section is only available on mobile devices.
          model: <string>, // the "device" from FHR, null on failure
          manufacturer: <string>, // null on failure
          hardware: <string>, // null on failure
          isTablet: <bool>, // null on failure
        },
        os: {
            name: <string>, // "Windows_NT" or null on failure
            version: <string>, // e.g. "6.1", null on failure
            kernelVersion: <string>, // android/b2g only or null on failure
            servicePackMajor: <number>, // windows only or null on failure
            servicePackMinor: <number>, // windows only or null on failure
            locale: <string>, // "en" or null on failure
        },
        hdd: {
          profile: { // hdd where the profile folder is located
              model: <string>, // windows only or null on failure
              revision: <string>, // windows only or null on failure
          },
          binary:  { // hdd where the application binary is located
              model: <string>, // windows only or null on failure
              revision: <string>, // windows only or null on failure
          },
          system:  { // hdd where the system files are located
              model: <string>, // windows only or null on failure
              revision: <string>, // windows only or null on failure
          },
        },
        gfx: {
            D2DEnabled: <bool>, // null on failure
            DWriteEnabled: <bool>, // null on failure
            //DWriteVersion: <string>, // temporarily removed, pending bug 1154500
            adapters: [
              {
                description: <string>, // e.g. "Intel(R) HD Graphics 4600", null on failure
                vendorID: <string>, // null on failure
                deviceID: <string>, // null on failure
                subsysID: <string>, // null on failure
                RAM: <number>, // in MB, null on failure
                driver: <string>, // null on failure
                driverVersion: <string>, // null on failure
                driverDate: <string>, // null on failure
                GPUActive: <bool>, // currently always true for the first adapter
              },
              ...
            ],
            // Note: currently only added on Desktop. On Linux, only a single
            // monitor is returned representing the entire virtual screen.
            monitors: [
              {
                screenWidth: <number>,  // screen width in pixels
                screenHeight: <number>, // screen height in pixels
                refreshRate: <number>,  // refresh rate in hertz (present on Windows only)
                pseudoDisplay: <bool>,  // networked screen (present on Windows only)
                scale: <number>,        // backing scale factor (present on Mac only)
              },
              ...
            ],
            features: {
              compositor: <string>,     // Layers backend for compositing (eg "d3d11", "none", "opengl")

              // Each the following features can have one of the following statuses:
              //   "unused"      - This feature has not been requested.
              //   "unavailable" - Safe Mode or OS restriction prevents use.
              //   "blocked"     - Blocked due to an internal condition such as safe mode.
              //   "blacklisted" - Blocked due to a blacklist restriction.
              //   "disabled"    - User explicitly disabled this default feature.
              //   "failed"      - This feature was attempted but failed to initialize.
              //   "available"   - User has this feature available.
              "d3d11" { // This feature is Windows-only.
                status: <string>,
                warp: <bool>,           // Software rendering (WARP) mode was chosen.
                textureSharing: <bool>  // Whether or not texture sharing works.
                version: <number>,      // The D3D11 device feature level.
              },
              "d2d" { // This feature is Windows-only.
                status: <string>,
                version: <string>,      // Either "1.0" or "1.1".
              },
            },
          },
      },
      addons: {
        activeAddons: { // the currently enabled addons
          <addon id>: {
            blocklisted: <bool>,
            description: <string>, // null if not available
            name: <string>,
            userDisabled: <bool>,
            appDisabled: <bool>,
            version: <string>,
            scope: <integer>,
            type: <string>, // "extension", "service", ...
            foreignInstall: <bool>,
            hasBinaryComponents: <bool>
            installDay: <number>, // days since UNIX epoch, 0 on failure
            updateDay: <number>, // days since UNIX epoch, 0 on failure
            signedState: <integer>, // whether the add-on is signed by AMO, only present for extensions
          },
          ...
        },
        theme: { // the active theme
          id: <string>,
          blocklisted: <bool>,
          description: <string>,
          name: <string>,
          userDisabled: <bool>,
          appDisabled: <bool>,
          version: <string>,
          scope: <integer>,
          foreignInstall: <bool>,
          hasBinaryComponents: <bool>
          installDay: <number>, // days since UNIX epoch, 0 on failure
          updateDay: <number>, // days since UNIX epoch, 0 on failure
        },
        activePlugins: [
          {
            name: <string>,
            version: <string>,
            description: <string>,
            blocklisted: <bool>,
            disabled: <bool>,
            clicktoplay: <bool>,
            mimeTypes: [<string>, ...],
            updateDay: <number>, // days since UNIX epoch, 0 on failure
          },
          ...
        ],
        activeGMPlugins: {
            <gmp id>: {
                version: <string>,
                userDisabled: <bool>,
                applyBackgroundUpdates: <bool>,
            },
            ...
        ],
        activeExperiment: { // section is empty if there's no active experiment
            id: <string>, // id
            branch: <string>, // branch name
        },
        persona: <string>, // id of the current persona, null on GONK
      },
    }

Settings
--------

defaultSearchEngine
~~~~~~~~~~~~~~~~~~~
Note: Deprecated, use defaultSearchEngineData instead.

Contains the string identifier or name of the default search engine provider. This will not be present in environment data collected before the Search Service initialization.

The special value ``NONE`` could occur if there is no default search engine.

The special value ``UNDEFINED`` could occur if a default search engine exists but its identifier could not be determined.

This field's contents are ``Services.search.defaultEngine.identifier`` (if defined) or ``"other-"`` + ``Services.search.defaultEngine.name`` if not. In other words, search engines without an ``.identifier`` are prefixed with ``other-``.

defaultSearchEngineData
~~~~~~~~~~~~~~~~~~~~~~~
Contains data identifying the engine currently set as the default.

The object contains:

- a ``name`` property with the name of the engine, or ``NONE`` if no
  engine is currently set as the default.

- a ``loadPath`` property: an anonymized path of the engine xml file, e.g.
 jar:[app]/omni.ja!browser/engine.xml
  (where 'browser' is the name of the chrome package, not a folder)
 [profile]/searchplugins/engine.xml
 [distribution]/searchplugins/common/engine.xml
 [other]/engine.xml

- a ``submissionURL`` property with the HTTP url we would use to search.
  For privacy, we don't record this for user-installed engines.

``loadPath`` and ``submissionURL`` are not present if ``name`` is ``NONE``.

searchCohort
~~~~~~~~~~~~

If the user has been enrolled into a search default change experiment, this contains the string identifying the experiment the user is taking part in. Most user profiles will never be part of any search default change experiment, and will not send this value.

userPrefs
~~~~~~~~~

This object contains user preferences.

Each key in the object is the name of a preference. A key's value depends on the policy with which the preference was collected. There are two such policies, "value" and "state". For preferences collected under the "value" policy, the value will be the preference's value. For preferences collected under the "state" policy, the value will be an opaque marker signifying only that the preference has a user value. The "state" policy is therefore used when user privacy is a concern.

The following is a partial list of collected preferences.

- ``browser.search.suggest.enabled``: The "master switch" for search suggestions everywhere in Firefox (search bar, urlbar, etc.). Defaults to true.

- ``browser.urlbar.suggest.searches``: True if search suggestions are enabled in the urlbar. Defaults to false.

- ``browser.urlbar.unifiedcomplete``: True if the urlbar's UnifiedComplete back-end is enabled.

- ``browser.urlbar.userMadeSearchSuggestionsChoice``: True if the user has clicked Yes or No in the urlbar's opt-in notification. Defaults to false.

partner
~~~~~~~

If the user is using a partner repack, this contains information identifying the repack being used, otherwise "partnerNames" will be an empty array and other entries will be null. The information may be missing when the profile just becomes available. In Firefox for desktop, the information along with other customizations defined in distribution.ini are processed later in the startup phase, and will be fully applied when "distribution-customization-complete" notification is sent.

activeAddons
~~~~~~~~~~~~

Starting from Firefox 44, the length of the following string fields: ``name``, ``description`` and ``version`` is limited to 100 characters. The same limitation applies to the same fields in ``theme`` and ``activePlugins``.
