import { logger } from '../utils/logger';

function base64DecodeUint8Array(input) {
  const raw = window.atob(input);
  const rawLength = raw.length;
  const array = new Uint8Array(new ArrayBuffer(rawLength));
  for (i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i);
  }

  return array;
}

const toArrayBuffer = (view) => {
  if (view instanceof ArrayBuffer) {
    return view;
  } else {
    if (view.byteOffset == 0 && view.byteLength == view.buffer.byteLength) {
      // This is a TypedArray over the whole buffer.
      return view.buffer;
    }
    // This is a "view" on the buffer.  Create a new buffer that only contains
    // the data.  Note that since this isn't an ArrayBuffer, the "new" call
    // will allocate a new buffer to hold the copy.
    return new Uint8Array(view).buffer;
  }
};

const unsafeGetArrayBuffer = (view) => {
  if (view instanceof ArrayBuffer) {
    return view;
  } else {
    return view.buffer;
  }
};

const toUint8 = (data, offset = 0, length = Number.POSITIVE_INFINITY) => {
  const buffer = unsafeGetArrayBuffer(data);
  return new Uint8Array(
    buffer,
    (data.byteOffset || 0) + Math.min(offset, data.byteLength),
    Math.max(0, Math.min(data.byteLength - offset, length))
  );
};

const equal = (arr1, arr2) => {
  if (!arr1 && !arr2) {
    return true;
  }
  if (!arr1 || !arr2) {
    return false;
  }
  if (arr1.byteLength != arr2.byteLength) {
    return false;
  }

  // Quickly check if these are views of the same buffer.  An ArrayBuffer can
  // be passed but doesn't have a byteOffset field, so default to 0.
  if (unsafeGetArrayBuffer(arr1) == unsafeGetArrayBuffer(arr2) &&
      (arr1.byteOffset || 0) == (arr2.byteOffset || 0)) {
    return true;
  }

  const uint8A = toUint8(arr1);
  const uint8B = toUint8(arr2);
  for (let i = 0; i < arr1.byteLength; i++) {
    if (uint8A[i] != uint8B[i]) {
      return false;
    }
  }
  return true;
};

class EventManager {
  constructor() {
    this.bindingList = [];
  }

  on(target, event, handler) {
    this.bindingList.push({ target, event, handler });
    target.addEventListener(event, handler);
  }

  once(target, event, handler) {
    const newHandler = (...args) => {
      this.off(target, event, newHandler);
      handler(...args);
    };
    this.on(target, event, newHandler);
  }

  off(target, event, handler) {
    const index = this.bindingList.findIndex(binding => (
      target === binding.target && event === binding.event && handler === binding.handler
    ));
    if (index === -1) return;

    const binding = this.bindingList.splice(index, 1)[0];
    binding.target.removeEventListener(binding.event, binding.handler);
    binding.target = null;
    binding.handler = null;
  }

  removeAll() {
    this.bindingList.forEach(({ target, event, handler }) => {
      this.off(target, event, handler);
    });
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners_ = {};
    this.dispatchTarget = this;
  }

  /**
   * Add an event listener to this object.
   *
   * @param {string} type The event type to listen for.
   * @param {function} listener The callback or
   *   listener object to invoke.
   * @override
   * @exportInterface
   */
  addEventListener(type, listener) {
    if (!this.listeners_[type]) {
      this.listeners_[type] = [];
    }
    this.listeners_[type].push(listener);
  }

  /**
   * Remove an event listener from this object.
   *
   * @param {string} type The event type for which you wish to remove a
   *   listener.
   * @param {function} listener The callback or
   *   listener object to remove.
   * @override
   * @exportInterface
   */
  removeEventListener(type, listener) {
    const index = (this.listeners_[type] || []).findIndex(listener);
    if (index !== -1) {
      this.listeners_[type].splice(index, 1);
    }
  }

  /**
   * Dispatch an event from this object.
   *
   * @param {!Event} event The event to be dispatched from this object.
   * @return {boolean} True if the default action was prevented.
   * @override
   * @exportInterface
   */
  dispatchEvent(event) {
    const listeners = this.listeners_(event.type) || [];

    // Execute this event on listeners until the event has been stopped or we
    // run out of listeners.
    for (const listener of listeners) {
      // Do this every time, since events can be re-dispatched from handlers.
      event.target = this.dispatchTarget;
      event.currentTarget = this.dispatchTarget;

      try {
        // Check for the |handleEvent| member to test if this is a
        // |EventListener| instance or a basic function.
        if (listener.handleEvent) {
          listener.handleEvent(event);
        } else {
          // eslint-disable-next-line no-restricted-syntax
          listener.call(this, event);
        }
      } catch (exception) {
        // Exceptions during event handlers should not affect the caller,
        // but should appear on the console as uncaught, according to MDN:
        // https://mzl.la/2JXgwRo
        logger.error('Uncaught exception in event handler', exception,
            exception ? exception.message : null,
            exception ? exception.stack : null);
      }

      if (event.stopped) {
        break;
      }
    }

    return event.defaultPrevented;
  }
}

/**
 * @summary Create an Event work-alike object based on the provided dictionary.
 * The event should contain all of the same properties from the dict.
 */
class FakeEvent {
  /**
   * @param {string} type
   * @param {Object=} dict
   */
  constructor(type, dict = {}) {
    // Take properties from dict if present.
    for (const key in dict) {
      Object.defineProperty(this, key, {
        value: dict[key],
        writable: true,
        enumerable: true,
      });
    }

    // The properties below cannot be set by the dict.  They are all provided
    // for compatibility with native events.

    /** @const {boolean} */
    this.bubbles = false;

    /** @type {boolean} */
    this.cancelable = false;

    /** @type {boolean} */
    this.defaultPrevented = false;

    /**
     * According to MDN, Chrome uses high-res timers instead of epoch time.
     * Follow suit so that timeStamps on FakeEvents use the same base as
     * on native Events.
     * @const {number}
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Event/timeStamp
     */
    this.timeStamp = window.performance && window.performance.now ?
        window.performance.now() : Date.now();

    /** @const {string} */
    this.type = type;

    /** @const {boolean} */
    this.isTrusted = false;

    /** @type {EventTarget} */
    this.currentTarget = null;

    /** @type {EventTarget} */
    this.target = null;

    /**
     * Non-standard property read by FakeEventTarget to stop processing
     * listeners.
     * @type {boolean}
     */
    this.stopped = false;
  }

  /**
   * Prevents the default action of the event.  Has no effect if the event isn't
   * cancellable.
   * @override
   */
  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  /**
   * Stops processing event listeners for this event.  Provided for
   * compatibility with native Events.
   * @override
   */
  stopImmediatePropagation() {
    this.stopped = true;
  }

  /**
   * Does nothing, since FakeEvents do not bubble.  Provided for compatibility
   * with native Events.
   * @override
   */
  stopPropagation() {}
}

class PublicPromise {
  /**
   * @return {Promise.<T>}
   */
  constructor() {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise(((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }));
    promise.resolve = resolvePromise;
    promise.reject = rejectPromise;

    return promise;
  }
}

export default class EMEPolyfillSafari {
  /**
   * Installs the polyfill if needed.
   */
  static install() {
    if (!window.HTMLVideoElement || !window.WebKitMediaKeys) {
      // No HTML5 video or no prefixed EME.
      return;
    }

    logger.debug('Using Apple-prefixed EME');

    // Delete mediaKeys to work around strict mode compatibility issues.
    // eslint-disable-next-line no-restricted-syntax
    delete HTMLMediaElement.prototype['mediaKeys'];
    // Work around read-only declaration for mediaKeys by using a string.
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype['mediaKeys'] = null;
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype.setMediaKeys = EMEPolyfillSafari.setMediaKeys;

    // Install patches
    window.MediaKeys = EMEPolyfillSafari.MediaKeys;
    window.MediaKeySystemAccess = EMEPolyfillSafari.MediaKeySystemAccess;
    navigator.requestMediaKeySystemAccess = EMEPolyfillSafari.requestMediaKeySystemAccess;
  }

  /**
   * An implementation of navigator.requestMediaKeySystemAccess.
   * Retrieves a MediaKeySystemAccess object.
   *
   * @this {!Navigator}
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   * @return {!Promise.<!MediaKeySystemAccess>}
   */
  static requestMediaKeySystemAccess(keySystem, supportedConfigurations) {
    logger.debug('EMEPolyfillSafari.requestMediaKeySystemAccess');

    try {
      const access = new EMEPolyfillSafari.MediaKeySystemAccess(
          keySystem, supportedConfigurations);
      return Promise.resolve(access);
    } catch (exception) {
      return Promise.reject(exception);
    }
  }

  /**
   * An implementation of HTMLMediaElement.prototype.setMediaKeys.
   * Attaches a MediaKeys object to the media element.
   *
   * @this {!HTMLMediaElement}
   * @param {MediaKeys} mediaKeys
   * @return {!Promise}
   */
  static setMediaKeys(mediaKeys) {
    logger.debug('EMEPolyfillSafari.setMediaKeys');

    const newMediaKeys = mediaKeys;
    const oldMediaKeys = this.mediaKeys;

    if (oldMediaKeys && oldMediaKeys != newMediaKeys) {
      // Have the old MediaKeys stop listening to events on the video tag.
      oldMediaKeys.setMedia(null);
    }

    delete this['mediaKeys'];  // in case there is an existing getter
    this['mediaKeys'] = mediaKeys;  // work around read-only declaration

    if (newMediaKeys) {
      return newMediaKeys.setMedia(this);
    }

    return Promise.resolve();
  }

  /**
   * Handler for the native media elements webkitneedkey event.
   *
   * @this {!HTMLMediaElement}
   * @param {!MediaKeyEvent} event
   * @private
   */
  static onWebkitNeedKey_(event) {
    logger.debug('EMEPolyfillSafari.onWebkitNeedKey_', event);

    const mediaKeys = this.mediaKeys;

    // NOTE: Because "this" is a real EventTarget, the event we dispatch here
    // must also be a real Event.
    const newEvent = new Event('encrypted');
    newEvent.initDataType = 'cenc';
    newEvent.initData = toArrayBuffer(event.initData);

    this.dispatchEvent(newEvent);
  }
}


/**
 * An implementation of MediaKeySystemAccess.
 *
 * @implements {MediaKeySystemAccess}
 */
EMEPolyfillSafari.MediaKeySystemAccess = class {
  /**
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   */
  constructor(keySystem, supportedConfigurations) {
    logger.debug('EMEPolyfillSafari.MediaKeySystemAccess');

    this.keySystem = keySystem;
    this.configuration_;

    // Optimization: WebKitMediaKeys.isTypeSupported delays responses by a
    // significant amount of time, possibly to discourage fingerprinting.
    // Since we know only FairPlay is supported here, let's skip queries for
    // anything else to speed up the process.
    if (keySystem.startsWith('com.apple.fps')) {
      for (const cfg of supportedConfigurations) {
        const newCfg = this.checkConfig_(cfg);
        if (newCfg) {
          this.configuration_ = newCfg;
          return;
        }
      }
    }

    // As per the spec, this should be a DOMException, but there is not a
    // public constructor for DOMException.
    const unsupportedKeySystemError = new Error('Unsupported keySystem');
    unsupportedKeySystemError.name = 'NotSupportedError';
    unsupportedKeySystemError.code = DOMException.NOT_SUPPORTED_ERR;
    throw unsupportedKeySystemError;
  }

  /**
   * Check a single config for MediaKeySystemAccess.
   *
   * @param {MediaKeySystemConfiguration} cfg The requested config.
   * @return {?MediaKeySystemConfiguration} A matching config we can support, or
   *   null if the input is not supportable.
   * @private
   */
  checkConfig_(cfg) {
    if (cfg.persistentState == 'required') {
      // Not supported by the prefixed API.
      return null;
    }

    // Create a new config object and start adding in the pieces which we find
    // support for.  We will return this from getConfiguration() later if
    // asked.

    /** @type {!MediaKeySystemConfiguration} */
    const newCfg = {
      'audioCapabilities': [],
      'videoCapabilities': [],
      // It is technically against spec to return these as optional, but we
      // don't truly know their values from the prefixed API:
      'persistentState': 'optional',
      'distinctiveIdentifier': 'optional',
      // Pretend the requested init data types are supported, since we don't
      // really know that either:
      'initDataTypes': cfg.initDataTypes,
      'sessionTypes': ['temporary'],
      'label': cfg.label,
    };

    // EMEPolyfillSafari tests for key system availability through
    // WebKitMediaKeys.isTypeSupported.
    let ranAnyTests = false;
    let success = false;

    if (cfg.audioCapabilities) {
      for (const cap of cfg.audioCapabilities) {
        if (cap.contentType) {
          ranAnyTests = true;

          const contentType = cap.contentType.split(';')[0];
          if (WebKitMediaKeys.isTypeSupported(this.keySystem, contentType)) {
            newCfg.audioCapabilities.push(cap);
            success = true;
          }
        }
      }
    }

    if (cfg.videoCapabilities) {
      for (const cap of cfg.videoCapabilities) {
        if (cap.contentType) {
          ranAnyTests = true;

          const contentType = cap.contentType.split(';')[0];
          if (WebKitMediaKeys.isTypeSupported(this.keySystem, contentType)) {
            newCfg.videoCapabilities.push(cap);
            success = true;
          }
        }
      }
    }

    if (!ranAnyTests) {
      // If no specific types were requested, we check all common types to
      // find out if the key system is present at all.
      success = WebKitMediaKeys.isTypeSupported(this.keySystem, 'video/mp4');
    }

    if (success) {
      return newCfg;
    }
    return null;
  }

  /** @override */
  createMediaKeys() {
    logger.debug('EMEPolyfillSafari.MediaKeySystemAccess.createMediaKeys');

    const mediaKeys = new EMEPolyfillSafari.MediaKeys(this.keySystem);
    return Promise.resolve(mediaKeys);
  }

  /** @override */
  getConfiguration() {
    logger.debug('EMEPolyfillSafari.MediaKeySystemAccess.getConfiguration');
    return this.configuration_;
  }
};


/**
 * An implementation of MediaKeys.
 *
 * @implements {MediaKeys}
 */
EMEPolyfillSafari.MediaKeys = class {
  /** @param {string} keySystem */
  constructor(keySystem) {
    logger.debug('EMEPolyfillSafari.MediaKeys');

    this.nativeMediaKeys_ = new WebKitMediaKeys(keySystem);
    this.eventManager_ = new EventManager();
  }

  /** @override */
  createSession(sessionType) {
    logger.debug('EMEPolyfillSafari.MediaKeys.createSession');

    sessionType = sessionType || 'temporary';
    // For now, only the 'temporary' type is supported.
    if (sessionType != 'temporary') {
      throw new TypeError('Session type ' + sessionType +
      ' is unsupported on this platform.');
    }

    return new EMEPolyfillSafari.MediaKeySession(this.nativeMediaKeys_, sessionType);
  }

  /** @override */
  setServerCertificate(serverCertificate) {
    logger.debug('EMEPolyfillSafari.MediaKeys.setServerCertificate');
    return Promise.resolve(false);
  }

  /**
   * @param {HTMLMediaElement} media
   * @protected
   * @return {!Promise}
   */
  setMedia(media) {
    // Remove any old listeners.
    this.eventManager_.removeAll();

    // It is valid for media to be null; null is used to flag that event
    // handlers need to be cleaned up.
    if (!media) {
      return Promise.resolve();
    }

    // Intercept and translate these prefixed EME events.
    this.eventManager_.on(media, 'webkitneedkey', EMEPolyfillSafari.onWebkitNeedKey_);

    // Wrap native HTMLMediaElement.webkitSetMediaKeys with a Promise.
    try {
      // Some browsers require that readyState >= 1 before mediaKeys can be
      // set, so check this and wait for loadedmetadata if we are not in the
      // correct state
      if (media.readyState >= 1) {
        media.webkitSetMediaKeys(this.nativeMediaKeys_);
      } else {
        this.eventManager_.once(media, 'loadedmetadata', () => {
          media.webkitSetMediaKeys(this.nativeMediaKeys_);
        });
      }

      return Promise.resolve();
    } catch (exception) {
      return Promise.reject(exception);
    }
  }
};


/**
 * An implementation of MediaKeySession.
 *
 * @implements {MediaKeySession}
 */
EMEPolyfillSafari.MediaKeySession = class extends FakeEventTarget {
  /**
    * @param {WebKitMediaKeys} nativeMediaKeys
    * @param {string} sessionType
    */
  constructor(nativeMediaKeys, sessionType) {
    logger.debug('EMEPolyfillSafari.MediaKeySession');
    super();

    /**
      * The native MediaKeySession, which will be created in
      * generateRequest.
      * @private {WebKitMediaKeySession}
      */
    this.nativeMediaKeySession_ = null;

    /** @private {WebKitMediaKeys} */
    this.nativeMediaKeys_ = nativeMediaKeys;

    // Promises that are resolved later
    /** @private {PublicPromise} */
    this.generateRequestPromise_ = null;

    /** @private {PublicPromise} */
    this.updatePromise_ = null;

    /** @private {!EventManager} */
    this.eventManager_ = new EventManager();

    /** @type {string} */
    this.sessionId = '';

    /** @type {number} */
    this.expiration = NaN;

    /** @type {!PublicPromise} */
    this.closed = new PublicPromise();

    /** @type {!EMEPolyfillSafari.MediaKeyStatusMap} */
    this.keyStatuses = new EMEPolyfillSafari.MediaKeyStatusMap();
  }

  /** @override */
  generateRequest(initDataType, initData) {
    logger.debug(
        'EMEPolyfillSafari.MediaKeySession.generateRequest');

    this.generateRequestPromise_ = new PublicPromise();

    try {
      // This EME spec version requires a MIME content type as the 1st
      // param to createSession, but doesn't seem to matter what the
      // value is.
      // It also only accepts Uint8Array, not ArrayBuffer, so explicitly
      // make initData into a Uint8Array.
      const session = this.nativeMediaKeys_.createSession('video/mp4', toUint8(initData));
      this.nativeMediaKeySession_ = session;
      this.sessionId = session.sessionId || '';

      // Attach session event handlers here.
      this.eventManager_.on(
          this.nativeMediaKeySession_, 'webkitkeymessage',
          ((event) => this.onWebkitKeyMessage_(event)));
      this.eventManager_.on(session, 'webkitkeyadded',
          ((event) => this.onWebkitKeyAdded_(event)));
      this.eventManager_.on(session, 'webkitkeyerror',
          ((event) => this.onWebkitKeyError_(event)));

      this.updateKeyStatus_('status-pending');
    } catch (exception) {
      this.generateRequestPromise_.reject(exception);
    }

    return this.generateRequestPromise_;
  }

  /** @override */
  load() {
    logger.debug('EMEPolyfillSafari.MediaKeySession.load');

    return Promise.reject(
        new Error('MediaKeySession.load not yet supported'));
  }

  /** @override */
  update(response) {
    logger.debug('EMEPolyfillSafari.MediaKeySession.update');

    this.updatePromise_ = new PublicPromise();

    try {
      let keyText = response.trim();
      if (keyText.substr(0, 5) === '<ckc>' && keyText.substr(-6) === '</ckc>') {
        keyText = keyText.slice(5, -6);
      }
      // Pass through to the native session.
      this.nativeMediaKeySession_.update(base64DecodeUint8Array(keyText));
    } catch (exception) {
      this.updatePromise_.reject(exception);
    }

    return this.updatePromise_;
  }

  /** @override */
  close() {
    logger.debug('EMEPolyfillSafari.MediaKeySession.close');

    try {
      // Pass through to the native session.
      this.nativeMediaKeySession_.close();

      this.closed.resolve();
      this.eventManager_.removeAll();
    } catch (exception) {
      this.closed.reject(exception);
    }

    return this.closed;
  }

  /** @override */
  remove() {
    logger.debug('EMEPolyfillSafari.MediaKeySession.remove');

    return Promise.reject(new Error('MediaKeySession.remove is only ' +
    'applicable for persistent licenses, which are not supported on ' +
    'this platform'));
  }

  /**
    * Handler for the native keymessage event on WebKitMediaKeySession.
    *
    * @param {!MediaKeyEvent} event
    * @private
    */
  onWebkitKeyMessage_(event) {
    logger.debug('EMEPolyfillSafari.onWebkitKeyMessage_', event);

    if (this.generateRequestPromise_) {
      this.generateRequestPromise_.resolve();
      this.generateRequestPromise_ = null;
    }

    const isNew = this.keyStatuses.getStatus() == undefined;

    const newEvent = new FakeEvent('message', {
      messageType: isNew ? 'license-request' : 'license-renewal',
      message: toArrayBuffer(event.message),
    });

    this.dispatchEvent(newEvent);
  }

  /**
    * Handler for the native keyadded event on WebKitMediaKeySession.
    *
    * @param {!MediaKeyEvent} event
    * @private
    */
  onWebkitKeyAdded_(event) {
    logger.debug('EMEPolyfillSafari.onWebkitKeyAdded_', event);

    if (this.updatePromise_) {
      this.updateKeyStatus_('usable');
      this.updatePromise_.resolve();
      this.updatePromise_ = null;
    }
  }

  /**
    * Handler for the native keyerror event on WebKitMediaKeySession.
    *
    * @param {!MediaKeyEvent} event
    * @private
    */
  onWebkitKeyError_(event) {
    logger.debug('EMEPolyfillSafari.onWebkitKeyError_', event);

    const error = new Error('EME EMEPolyfillSafari key error');
    error.errorCode = this.nativeMediaKeySession_.error;

    if (this.generateRequestPromise_ != null) {
      this.generateRequestPromise_.reject(error);
      this.generateRequestPromise_ = null;
    } else if (this.updatePromise_ != null) {
      this.updatePromise_.reject(error);
      this.updatePromise_ = null;
    } else {
      // Unexpected error - map native codes to standardised key statuses.
      // Possible values of this.nativeMediaKeySession_.error.code:
      // MEDIA_KEYERR_UNKNOWN        = 1
      // MEDIA_KEYERR_CLIENT         = 2
      // MEDIA_KEYERR_SERVICE        = 3
      // MEDIA_KEYERR_OUTPUT         = 4
      // MEDIA_KEYERR_HARDWARECHANGE = 5
      // MEDIA_KEYERR_DOMAIN         = 6

      switch (this.nativeMediaKeySession_.error.code) {
        case WebKitMediaKeyError.MEDIA_KEYERR_OUTPUT:
        case WebKitMediaKeyError.MEDIA_KEYERR_HARDWARECHANGE:
          this.updateKeyStatus_('output-not-allowed');
          break;
        default:
          this.updateKeyStatus_('internal-error');
          break;
      }
    }
  }

  /**
    * Updates key status and dispatch a 'keystatuseschange' event.
    *
    * @param {string} status
    * @private
    */
  updateKeyStatus_(status) {
    this.keyStatuses.setStatus(status);
    const event = new FakeEvent('keystatuseschange');
    this.dispatchEvent(event);
  }
};

/**
 * @summary An implementation of MediaKeyStatusMap.
 * This fakes a map with a single key ID.
 *
 * @todo Consolidate the MediaKeyStatusMap types in these polyfills.
 * @implements {MediaKeyStatusMap}
 */
EMEPolyfillSafari.MediaKeyStatusMap = class {
  constructor() {
    /**
     * @type {number}
     */
    this.size = 0;

    /**
     * @private {string|undefined}
     */
    this.status_ = undefined;
  }

  /**
   * An internal method used by the session to set key status.
   * @param {string|undefined} status
   */
  setStatus(status) {
    this.size = status == undefined ? 0 : 1;
    this.status_ = status;
  }

  /**
   * An internal method used by the session to get key status.
   * @return {string|undefined}
   */
  getStatus() {
    return this.status_;
  }

  /** @override */
  forEach(fn) {
    if (this.status_) {
      fn(this.status_, toArrayBuffer(new Uint8Array([0])));
    }
  }

  /** @override */
  get(keyId) {
    if (this.has(keyId)) {
      return this.status_;
    }
    return undefined;
  }

  /** @override */
  has(keyId) {
    const fakeKeyId = toArrayBuffer(new Uint8Array([0]));
    if (this.status_ && equal(keyId, fakeKeyId)) {
      return true;
    }
    return false;
  }

  /**
   * @override
   */
  entries() {
  }

  /**
   * @override
   */
  keys() {
  }

  /**
   * @override
   */
  values() {
  }
};

EMEPolyfillSafari.install();
