/**
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMediaKeySystemAccess
 */
export const KeySystems = {
  PLAYREADY: 'com.microsoft.playready',
  WIDEVINE: 'com.widevine.alpha'
};

export const requestMediaKeySystemAccess = (function () {
  if (typeof window !== 'undefined' && window.navigator && window.navigator.requestMediaKeySystemAccess) {
    return window.navigator.requestMediaKeySystemAccess.bind(window.navigator);
  } else {
    return null;
  }
})();
