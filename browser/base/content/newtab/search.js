#ifdef 0
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
#endif

let gSearch = {

  currentEngineName: null,

  init: function () {
    for (let idSuffix of this._nodeIDSuffixes) {
      this._nodes[idSuffix] =
        document.getElementById("newtab-search-" + idSuffix);
    }

    window.addEventListener("ContentSearchService", this);
  },

  setUpInitialState: function () {
    this._send("GetState");
  },

  showPanel: function () {
    let panel = this._nodes.panel;
    let logo = this._nodes.logo;
    panel.openPopup(logo);
    logo.setAttribute("active", "true");
    panel.addEventListener("popuphidden", function onHidden() {
      panel.removeEventListener("popuphidden", onHidden);
      logo.removeAttribute("active");
    });
  },

  search: function (event) {
    if (event) {
      event.preventDefault();
    }
    let searchText = this._nodes.text;
    let searchStr = searchText.value;
    if (this.currentEngineName && searchStr.length) {
      let useNewTab = event && event.button == 1;
      let eventData = {
        engineName: this.currentEngineName,
        searchString: searchStr,
        whence: "newtab",
        useNewTab: useNewTab,
      }

      if (searchText.hasAttribute("selection-index")) {
        eventData.selection = {
          index: searchText.getAttribute("selection-index"),
          kind: searchText.getAttribute("selection-kind")
        };
      }

      this._send("Search", eventData);
    }
    this._suggestionController.addInputValueToFormHistory();
  },

  manageEngines: function () {
    this._nodes.panel.hidePopup();
    this._send("ManageEngines");
  },

  setWidth: function (width) {
    this._nodes.form.style.width = width + "px";
    this._nodes.form.style.maxWidth = width + "px";
  },

  handleEvent: function (event) {
    let methodName = "on" + event.detail.type;
    if (this.hasOwnProperty(methodName)) {
      this[methodName](event.detail.data);
    }
  },

  onState: function (data) {
    this._makePanel(data.engines);
    this._setCurrentEngine(data.currentEngine);
    this._initWhenInitalStateReceived();
  },

  onCurrentState: function (data) {
    if (this._initialStateReceived) {
      this._makePanel(data.engines);
      this._setCurrentEngine(data.currentEngine);
    }
  },

  onCurrentEngine: function (engineName) {
    if (this._initialStateReceived) {
      this._setCurrentEngine(engineName);
    }
  },

  onFocusInput: function () {
    this._nodes.text.focus();
  },

  _nodeIDSuffixes: [
    "form",
    "logo",
    "manage",
    "panel",
    "text",
  ],

  _nodes: {},

  _initWhenInitalStateReceived: function () {
    this._nodes.form.addEventListener("submit", e => this.search(e));
    this._nodes.logo.addEventListener("click", e => this.showPanel());
    this._nodes.manage.addEventListener("click", e => this.manageEngines());
    this._initialStateReceived = true;
    this._initWhenInitalStateReceived = function () {};
  },

  _send: function (type, data=null) {
    window.dispatchEvent(new CustomEvent("ContentSearchClient", {
      detail: {
        type: type,
        data: data,
      },
    }));
  },

  _makePanel: function (engines) {
    let panel = this._nodes.panel;

    // Empty the panel except for the Manage Engines row.
    let i = 0;
    while (i < panel.childNodes.length) {
      let node = panel.childNodes[i];
      if (node != this._nodes.manage) {
        panel.removeChild(node);
      }
      else {
        i++;
      }
    }

    // Add all the engines.
    for (let engine of engines) {
      panel.insertBefore(this._makePanelEngine(panel, engine),
                         this._nodes.manage);
    }
  },

  _makePanelEngine: function (panel, engine) {
    let box = document.createElementNS(XUL_NAMESPACE, "hbox");
    box.className = "newtab-search-panel-engine";
    box.setAttribute("engine", engine.name);

    box.addEventListener("click", () => {
      this._send("SetCurrentEngine", engine.name);
      panel.hidePopup();
      this._nodes.text.focus();
    });

    let image = document.createElementNS(XUL_NAMESPACE, "image");
    if (engine.iconBuffer) {
      let blob = new Blob([engine.iconBuffer]);
      image.setAttribute("src", URL.createObjectURL(blob));
    }
    box.appendChild(image);

    let label = document.createElementNS(XUL_NAMESPACE, "label");
    label.setAttribute("value", engine.name);
    box.appendChild(label);

    return box;
  },

  _setCurrentEngine: function (engine) {
    this.currentEngineName = engine.name;

    // Set the logo.
    let logoBuf = window.devicePixelRatio == 2 ? engine.logo2xBuffer :
                  engine.logoBuffer || engine.logo2xBuffer;
    if (logoBuf) {
      this._nodes.logo.hidden = false;
      let uri = URL.createObjectURL(new Blob([logoBuf]));
      this._nodes.logo.style.backgroundImage = "url(" + uri + ")";
      this._nodes.text.placeholder = "";
    }
    else {
      this._nodes.logo.hidden = true;
      this._nodes.text.placeholder = engine.name;
    }

    // Set the selected state of all the engines in the panel.
    for (let box of this._nodes.panel.childNodes) {
      if (box.getAttribute("engine") == engine.name) {
        box.setAttribute("selected", "true");
      }
      else {
        box.removeAttribute("selected");
      }
    }

    // Set up the suggestion controller.
    if (!this._suggestionController) {
      let parent = document.getElementById("newtab-scrollbox");
      this._suggestionController =
        new SearchSuggestionUIController(this._nodes.text, parent,
                                         event => this.search(event));
    }
    this._suggestionController.engineName = engine.name;
  },
};
