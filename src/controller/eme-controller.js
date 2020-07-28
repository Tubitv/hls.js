/**
 * @author Stephan Hesse <disparat@gmail.com> | <tchakabam@gmail.com>
 *
 * DRM support for Hls.js
 */

import EventHandler from '../event-handler';
import Event from '../events';
import { ErrorTypes, ErrorDetails } from '../errors';
import { logger } from '../utils/logger';
import { KeySystems } from '../utils/mediakeys-helper';

const { XMLHttpRequest } = window;

const MAX_LICENSE_REQUEST_FAILURES = 3;

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/API/MediaKeySystemConfiguration
 * @param {Array<string>} audioCodecs List of required audio codecs to support
 * @param {Array<string>} videoCodecs List of required video codecs to support
 * @param {object} drmSystemOptions Optional parameters/requirements for the key-system
 * @returns {Array<MediaSystemConfiguration>} An array of supported configurations
 */

const createWidevineMediaKeySystemConfigurations = function (audioCodecs, videoCodecs, drmSystemOptions = {}) { /* jshint ignore:line */
  const baseConfig = {
    // initDataTypes: ['keyids', 'mp4'],
    // label: "",
    // persistentState: "not-allowed", // or "required" ?
    // distinctiveIdentifier: "not-allowed", // or "required" ?
    // sessionTypes: ['temporary'],
    audioCapabilities: [
      // { contentType: 'audio/mp4; codecs="mp4a.40.2"' }
    ],
    videoCapabilities: [
      // { contentType: 'video/mp4; codecs="avc1.42E01E"' }
    ]
  };

  audioCodecs.forEach((codec) => {
    baseConfig.audioCapabilities.push({
      contentType: `audio/mp4; codecs="${codec}"`,
      robustness: drmSystemOptions.audioRobustness || ''
    });
  });
  videoCodecs.forEach((codec) => {
    baseConfig.videoCapabilities.push({
      contentType: `video/mp4; codecs="${codec}"`,
      robustness: drmSystemOptions.videoRobustness || ''
    });
  });

  return [
    baseConfig
  ];
};

const createPlayreadyMediaKeySystemConfigurations = function (audioCodecs, videoCodecs, drmSystemOptions = {}) { /* jshint ignore:line */
  const baseConfig = {
    initDataTypes: ['cenc'],
    // label: "",
    // persistentState: "not-allowed", // or "required" ?
    // distinctiveIdentifier: "not-allowed", // or "required" ?
    // sessionTypes: ['temporary'],
    audioCapabilities: [
      // { contentType: 'audio/mp4; codecs="mp4a.40.2"' }
    ],
    videoCapabilities: [
      // { contentType: 'video/mp4; codecs="avc1.42E01E"' }
    ]
  };

  audioCodecs.forEach((codec) => {
    baseConfig.audioCapabilities.push({
      contentType: `audio/mp4; codecs="${codec}"`,
      robustness: drmSystemOptions.audioRobustness || ''
    });
  });
  videoCodecs.forEach((codec) => {
    baseConfig.videoCapabilities.push({
      contentType: `video/mp4; codecs="${codec}"`,
      robustness: drmSystemOptions.videoRobustness || ''
    });
  });

  return [
    baseConfig
  ];
};

/**
 * The idea here is to handle key-system (and their respective platforms) specific configuration differences
 * in order to work with the local requestMediaKeySystemAccess method.
 *
 * We can also rule-out platform-related key-system support at this point by throwing an error or returning null.
 *
 * @param {string} keySystem Identifier for the key-system, see `KeySystems` enum
 * @param {Array<string>} audioCodecs List of required audio codecs to support
 * @param {Array<string>} videoCodecs List of required video codecs to support
 * @param {object} drmSystemOptions Optional parameters/requirements for the key-system
 * @returns {Array<MediaSystemConfiguration> | null} A non-empty Array of MediaKeySystemConfiguration objects or `null`
 */
const getSupportedMediaKeySystemConfigurations = function (keySystem, audioCodecs, videoCodecs, drmSystemOptions = {}) {
  switch (keySystem) {
  case KeySystems.WIDEVINE:
    return createWidevineMediaKeySystemConfigurations(audioCodecs, videoCodecs, drmSystemOptions);
  case KeySystems.PLAYREADY:
    return createPlayreadyMediaKeySystemConfigurations(audioCodecs, videoCodecs, drmSystemOptions);
  default:
    throw new Error('Unknown key-system: ' + keySystem);
  }
};

/**
 * Controller to deal with encrypted media extensions (EME)
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Encrypted_Media_Extensions_API
 *
 * @class
 * @constructor
 */
class EMEController extends EventHandler {
  /**
     * @constructs
     * @param {Hls} hls Our Hls.js instance
     */
  constructor (hls) {
    super(hls,
      Event.MEDIA_ATTACHED,
      Event.MEDIA_DETACHED,
      Event.MANIFEST_PARSED
    );

    this._drmSystemOptions = hls.config.drmSystemOptions;
    this._emeEnabled = hls.config.emeEnabled;
    this._licenseXhrSetup = hls.config.licenseXhrSetup;
    this._minHdcpVersion = hls.config.minHdcpVersion;
    this._playreadyLicenseUrl = hls.config.playreadyLicenseUrl;
    this._requestMediaKeySystemAccess = hls.config.requestMediaKeySystemAccessFunc;
    this._widevineLicenseUrl = hls.config.widevineLicenseUrl;

    this._hasSetMediaKeys = false;
    this._media = null;
    this._mediaKeysList = [];
    this._mediaKeysPromise = null;
    this._onMediaEncrypted = this._onMediaEncrypted.bind(this);
    this._requestLicenseFailureCount = 0;
    this._xhr = null;
  }

  _throwLicenseSystemError (msg) {
    logger.error(msg);
    this.hls.trigger(Event.ERROR, {
      type: ErrorTypes.KEY_SYSTEM_ERROR,
      details: ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
      fatal: true
    });
  }

  /**
     *
     * @param {string} keySystem Identifier for the key-system, see `KeySystems` enum
     * @returns {string} License server URL for key-system (if any configured, otherwise causes error)
     */
  getLicenseServerUrl (keySystem) {
    let url;
    switch (keySystem) {
    case KeySystems.WIDEVINE:
      url = this._widevineLicenseUrl;
      break;
    case KeySystems.PLAYREADY:
      url = this._playreadyLicenseUrl;
      break;
    default:
      url = null;
      break;
    }

    if (!url) {
      this._throwLicenseSystemError(`No license server URL configured for key-system "${keySystem}"`);
    }

    return url;
  }

  /**
     * Requests access object and adds it to our list upon success
     * @private
     * @param {string} keySystem System ID (see `KeySystems`)
     * @param {Array<string>} audioCodecs List of required audio codecs to support
     * @param {Array<string>} videoCodecs List of required video codecs to support
     */
  _attemptKeySystemAccess (keySystem, audioCodecs, videoCodecs) {
    let mediaKeySystemConfigs;
    try {
      mediaKeySystemConfigs = getSupportedMediaKeySystemConfigurations(keySystem, audioCodecs, videoCodecs, this._drmSystemOptions);
    } catch (err) {
      this._throwLicenseSystemError(err);
    }

    logger.log('Requesting encrypted media key-system access');

    // expecting interface like window.navigator.requestMediaKeySystemAccess
    const keySystemAccessPromise = this.requestMediaKeySystemAccess(keySystem, mediaKeySystemConfigs);

    this._mediaKeysPromise = keySystemAccessPromise.then((mediaKeySystemAccess) => {
      return this._onMediaKeySystemAccessObtained(keySystem, mediaKeySystemAccess);
    });

    keySystemAccessPromise.catch((err) => {
      logger.error(`Failed to obtain key-system "${keySystem}" access:`, err);
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_ACCESS,
        fatal: true
      });
    });
  }

  get requestMediaKeySystemAccess () {
    if (!this._requestMediaKeySystemAccess) {
      this._throwLicenseSystemError('No requestMediaKeySystemAccess function configured');
    }

    return this._requestMediaKeySystemAccess;
  }

  /**
     * Handles obtaining access to a key-system
     *
     * @param {string} keySystem
     * @param {MediaKeySystemAccess} mediaKeySystemAccess https://developer.mozilla.org/en-US/docs/Web/API/MediaKeySystemAccess
     */
  _onMediaKeySystemAccessObtained (keySystem, mediaKeySystemAccess) {
    logger.log(`Access for key-system "${keySystem}" obtained`);

    const mediaKeysListItem = {
      mediaKeysSessionInitialized: false,
      mediaKeySystemAccess: mediaKeySystemAccess,
      mediaKeySystemDomain: keySystem
    };

    this._mediaKeysList.push(mediaKeysListItem);

    const mediaKeysPromise = Promise.resolve()
      .then(() => {
        return mediaKeySystemAccess.createMediaKeys();
      })
      .then((mediaKeys) => {
        mediaKeysListItem.mediaKeys = mediaKeys;

        logger.log(`Media-keys created for key-system "${keySystem}"`);

        // Using `MediaKeys.getStatusForPolicy()` to check available HDCP version,
        // only when you manually set up `minHdcpVersion` before.
        if (typeof this._minHdcpVersion !== 'undefined' && typeof mediaKeys.getStatusForPolicy === 'function') {
          logger.log(`Checking accessbility of HDCP version ${this._minHdcpVersion}"`);

          const getStatusForPolicyPromise = mediaKeys.getStatusForPolicy({ minHdcpVersion: this._minHdcpVersion });

          getStatusForPolicyPromise.then((status) => {
            if (status !== 'usable') {
              return Promise.reject(new Error(`Not a valid HDCP policy status ${status}`));
            }

            logger.log(`Accessbility of HDCP version ${this._minHdcpVersion}" passed`);

            this._onMediaKeysCreated();

            return mediaKeys;
          });

          // Jump out upcoming handlers if HDCP version does not passed our needs.
          getStatusForPolicyPromise.catch((err) => {
            logger.error('Failed to pass HDCP policy:', err);
            this.hls.trigger(Event.ERROR, {
              type: ErrorTypes.KEY_SYSTEM_ERROR,
              details: ErrorDetails.KEY_SYSTEM_INVALID_HDCP_VERSION,
              fatal: true
            });
          });

          return getStatusForPolicyPromise;
        } else {
          this._onMediaKeysCreated();

          return mediaKeys;
        }
      });

    mediaKeysPromise.catch((err) => {
      logger.error('Failed to create media-keys:', err);
    });

    return mediaKeysPromise;
  }

  /**
     * Handles key-creation (represents access to CDM). We are going to create key-sessions upon this
     * for all existing keys where no session exists yet.
     */
  _onMediaKeysCreated () {
    // check for all key-list items if a session exists, otherwise, create one
    this._mediaKeysList.forEach((mediaKeysListItem) => {
      if (!mediaKeysListItem.mediaKeysSession) {
        // mediaKeys is definitely initialized here
        mediaKeysListItem.mediaKeysSession = mediaKeysListItem.mediaKeys.createSession();
        this._onNewMediaKeySession(mediaKeysListItem.mediaKeysSession);
      }
    });
  }

  /**
     *
     * @param {*} keySession
     */
  _onNewMediaKeySession (keySession) {
    logger.log(`New key-system session ${keySession.sessionId}`);

    keySession.addEventListener('message', (event) => {
      this._onKeySessionMessage(event.target, event.message);
    }, false);

    keySession.addEventListener('keystatuseschange', (event) => {
      this._onKeySessionKeyStatusesChange(event.target);
    }, false);
  }

  _onKeySessionMessage (keySession, message) {
    logger.log('Got EME message event, creating license request');

    this._requestLicense(message, (data) => {
      logger.log(`Received license data (length: ${data ? data.byteLength : data}), updating key-session`);
      keySession.update(data);
    });
  }

  _onKeySessionKeyStatusesChange (keySession) {
    logger.log('Got EME keystatuseschange event, detecting license status');

    // `keyStatuses` is `Map`-like object connecting to the length of `KeyIds`,
    // but every `keyStatuses` needs to be `usable` to continue.
    keySession.keyStatuses.forEach((status) => {
      if (status === 'output-downscaled' || status === 'output-restricted') {
        logger.error(`Key session (status: ${status}) is not in a valid status.`);

        this.hls.trigger(Event.ERROR, {
          type: ErrorTypes.KEY_SYSTEM_ERROR,
          details: ErrorDetails.KEY_SYSTEM_LICENSE_INVALID_STATUS,
          fatal: true
        });
      }
    });
  }

  _onMediaEncrypted (event) {
    logger.log(`Media is encrypted using "${event.initDataType}" init data type`);

    if (!this._mediaKeysPromise) {
      logger.error('Fatal: Media is encrypted but no CDM access or no keys have been requested');
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_KEYS,
        fatal: true
      });
      return;
    }

    const finallySetKeyAndStartSession = (mediaKeys) => {
      if (!this._media) {
        return;
      }
      this._attemptSetMediaKeys(mediaKeys);
      this._generateRequestWithPreferredKeySession(event.initDataType, event.initData);
    };

    // Could use `Promise.finally` but some Promise polyfills are missing it
    this._mediaKeysPromise.then(finallySetKeyAndStartSession).catch(finallySetKeyAndStartSession);
  }

  _attemptSetMediaKeys () {
    if (!this._hasSetMediaKeys) {
      // FIXME: see if we can/want/need-to really to deal with several potential key-sessions?
      const keysListItem = this._mediaKeysList[0];
      if (!keysListItem || !keysListItem.mediaKeys) {
        logger.error('Fatal: Media is encrypted but no CDM access or no keys have been obtained yet');
        this.hls.trigger(Event.ERROR, {
          type: ErrorTypes.KEY_SYSTEM_ERROR,
          details: ErrorDetails.KEY_SYSTEM_NO_KEYS,
          fatal: true
        });
        return;
      }

      logger.log('Setting keys for encrypted media');

      this._media.setMediaKeys(keysListItem.mediaKeys);
      this._hasSetMediaKeys = true;
    }
  }

  _generateRequestWithPreferredKeySession (initDataType, initData) {
    // FIXME: see if we can/want/need-to really to deal with several potential key-sessions?
    const keysListItem = this._mediaKeysList[0];
    if (!keysListItem) {
      logger.error('Fatal: Media is encrypted but not any key-system access has been obtained yet');
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_ACCESS,
        fatal: true
      });
      return;
    }

    if (keysListItem.mediaKeysSessionInitialized) {
      logger.warn('Key-Session already initialized but requested again');
      return;
    }

    const keySession = keysListItem.mediaKeysSession;
    if (!keySession) {
      logger.error('Fatal: Media is encrypted but no key-session existing');
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_SESSION,
        fatal: true
      });
      return;
    }

    // initData is null if the media is not CORS-same-origin
    if (!initData) {
      logger.warn('Fatal: initData required for generating a key session is null');
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_INIT_DATA,
        fatal: true
      });
      return;
    }

    logger.log(`Generating key-session request for "${initDataType}" init data type`);
    keysListItem.mediaKeysSessionInitialized = true;

    keySession
      .generateRequest(initDataType, initData)
      .then(() => {
        logger.debug('Key-session generation succeeded');
      })
      .catch((err) => {
        logger.error('Error generating key-session request:', err);
        this.hls.trigger(Event.ERROR, {
          type: ErrorTypes.KEY_SYSTEM_ERROR,
          details: ErrorDetails.KEY_SYSTEM_NO_SESSION,
          fatal: false
        });
      });
  }

  /**
     * @param {string} url License server URL
     * @param {ArrayBuffer} keyMessage Message data issued by key-system
     * @param {function} callback Called when XHR has succeeded
     * @returns {XMLHttpRequest} Unsent (but opened state) XHR object
     */
  _createLicenseXhr (url, keyMessage, callback) {
    const xhr = new XMLHttpRequest();
    const licenseXhrSetup = this._licenseXhrSetup;

    try {
      if (licenseXhrSetup) {
        try {
          licenseXhrSetup(xhr, url);
        } catch (e) {
          // let's try to open before running setup
          xhr.open('POST', url, true);
          licenseXhrSetup(xhr, url);
        }
      }
      // if licenseXhrSetup did not yet call open, let's do it now
      if (!xhr.readyState) {
        xhr.open('POST', url, true);
      }
    } catch (e) {
      // IE11 throws an exception on xhr.open if attempting to access an HTTP resource over HTTPS
      logger.error('Error setting up key-system license XHR', e);
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
        fatal: true
      });
      return;
    }

    xhr.responseType = 'arraybuffer';
    xhr.onreadystatechange =
        this._onLicenseRequestReadyStageChange.bind(this, xhr, url, keyMessage, callback);
    return xhr;
  }

  /**
     * @param {XMLHttpRequest} xhr
     * @param {string} url License server URL
     * @param {ArrayBuffer} keyMessage Message data issued by key-system
     * @param {function} callback Called when XHR has succeeded
     *
     */
  _onLicenseRequestReadyStageChange (xhr, url, keyMessage, callback) {
    switch (xhr.readyState) {
    case 4:
      if (xhr.status === 200) {
        this._requestLicenseFailureCount = 0;
        logger.log('License request succeeded');
        callback(xhr.response);
      } else {
        logger.error(`License Request XHR failed (${url}). Status: ${xhr.status} (${xhr.statusText})`);

        this._requestLicenseFailureCount++;
        if (this._requestLicenseFailureCount <= MAX_LICENSE_REQUEST_FAILURES) {
          const attemptsLeft = MAX_LICENSE_REQUEST_FAILURES - this._requestLicenseFailureCount + 1;
          logger.warn(`Retrying license request, ${attemptsLeft} attempts left`);
          this._requestLicense(keyMessage, callback);
          return;
        }

        this.hls.trigger(Event.ERROR, {
          type: ErrorTypes.KEY_SYSTEM_ERROR,
          details: ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
          fatal: true
        });
      }
      break;
    }
  }

  /**
     * @param {object} keysListItem
     * @param {ArrayBuffer} keyMessage
     * @returns {ArrayBuffer} Challenge data posted to license server
     */
  _generateLicenseRequestChallenge (keysListItem, keyMessage) {
    const xhr = this._xhr;

    let challenge;
    let headerNames;
    let headerValues;
    let keyMessageXml;

    switch (keysListItem.mediaKeySystemDomain) {
    case KeySystems.PLAYREADY:
      // from https://github.com/MicrosoftEdge/Demos/blob/master/eme/scripts/demo.js
      keyMessageXml = new DOMParser().parseFromString(String.fromCharCode.apply(null, new Uint16Array(keyMessage)), 'application/xml');
      if (keyMessageXml.getElementsByTagName('Challenge')[0]) {
        challenge = atob(keyMessageXml.getElementsByTagName('Challenge')[0].childNodes[0].nodeValue);
      } else {
        this._throwLicenseSystemError('Cannot find <Challenge> in key message');
      }
      headerNames = keyMessageXml.getElementsByTagName('name');
      headerValues = keyMessageXml.getElementsByTagName('value');
      if (headerNames.length !== headerValues.length) {
        this._throwLicenseSystemError('Mismatched header <name>/<value> pair in key message');
      }
      for (let i = 0; i < headerNames.length; i++) {
        xhr.setRequestHeader(headerNames[i].childNodes[0].nodeValue, headerValues[i].childNodes[0].nodeValue);
      }
      break;
    case KeySystems.WIDEVINE:
      // for Widevine CDMs, the challenge is the keyMessage.
      challenge = keyMessage;
      break;
    default:
      this._throwLicenseSystemError(`unsupported key-system: ${keysListItem.mediaKeySystemDomain}`);
    }

    return challenge;
  }

  _requestLicense (keyMessage, callback) {
    logger.log('Requesting content license for key-system');

    const keysListItem = this._mediaKeysList[0];
    if (!keysListItem) {
      logger.error('Fatal error: Media is encrypted but no key-system access has been obtained yet');
      this.hls.trigger(Event.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_NO_ACCESS,
        fatal: true
      });
      return;
    }
    try {
      const url = this.getLicenseServerUrl(keysListItem.mediaKeySystemDomain);
      const xhr = this._createLicenseXhr(url, keyMessage, callback);
      this._xhr = xhr;

      logger.log(`Sending license request to URL: ${url}`);

      const challenge = this._generateLicenseRequestChallenge(keysListItem, keyMessage);
      xhr.send(challenge);
    } catch (err) {
      this._throwLicenseSystemError(`Failure requesting DRM license: ${err}`);
    }
  }

  onMediaAttached (data) {
    if (!this._emeEnabled) {
      return;
    }

    const media = data.media;

    // keep reference of media
    this._media = media;

    media.addEventListener('encrypted', this._onMediaEncrypted);
  }

  onMediaDetached () {
    const media = this._media;
    const mediaKeysList = this._mediaKeysList;

    if (!media) {
      return;
    }

    media.removeEventListener('encrypted', this._onMediaEncrypted);
    this._media = null;
    this._mediaKeysList = [];

    // Close all sessions and remove media keys from the video element.
    Promise.all(
      mediaKeysList.map((mediaKeysListItem) => {
        if (mediaKeysListItem.mediaKeysSession) {
          try {
            return mediaKeysListItem.mediaKeysSession.close();
          } catch (ex) {
            // Ignore errors when closing the sessions. Closing a session that
            // generated no key requests will throw an error.
          }
        }
      })
    )
      .then(() => {
        try {
          return media.setMediaKeys(null);
        } catch (ex) {
          // Ignore any failures while removing media keys from the video element.
        }
      })
      .then(() => {
        // Fire an event so that the application could decide when to destroy Hls instance or other tasks
        this.hls.trigger(Event.EME_DESTROYED, {});
      })
      .catch(() => {
        // Ignore any failures while removing media keys from the video element.
      });
  }

  onManifestParsed (data) {
    if (!this._emeEnabled) {
      return;
    }

    const audioCodecs = data.levels.map((level) => level.audioCodec);
    const videoCodecs = data.levels.map((level) => level.videoCodec);

    let keySystem;
    if (this._playreadyLicenseUrl) {
      keySystem = KeySystems.PLAYREADY;
    } else if (this._widevineLicenseUrl) {
      keySystem = KeySystems.WIDEVINE;
    } else {
      this._throwLicenseSystemError('Unknown license url type, please use "playreadyLicenseUrl" or "widevineLicenseUrl"');
    }

    this._attemptKeySystemAccess(keySystem, audioCodecs, videoCodecs);
  }
}

export default EMEController;
