// Civic Research Studio · device check for a Qualtrics survey (v1).
// For studies that run on laptops and desktops only. Paste into the JavaScript of a question on a page
// BEFORE the randomizer (for example the welcome or consent question). It sets rs_device_class to
// desktop, tablet or phone; a Branch after that page ends the survey for phone and tablet, so they are
// never assigned a design. Declare rs_device_class in the survey flow's embedded data.
// Same logic as Civic Research Studio's src/devices.js.
Qualtrics.SurveyEngine.addOnload(function () {
  function save(name, value) {
    try { Qualtrics.SurveyEngine.setJSEmbeddedData(name, value); } catch (e) {}
    try { Qualtrics.SurveyEngine.setEmbeddedData(name, value); } catch (e) {}
  }
  function mm(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  var nav = window.navigator || {}, ua = String(nav.userAgent || '');
  var mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua) || (nav.userAgentData && nav.userAgentData.mobile === true);
  var iPadAsMac = /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;
  var touchOnly = mm('(hover: none) and (pointer: coarse)') && !mm('(any-pointer: fine)');
  var kind = 'desktop';
  if (mobile || iPadAsMac || touchOnly) {
    var s = window.screen || {}, shortSide = Math.min(Number(s.width) || 0, Number(s.height) || 0);
    kind = shortSide && shortSide < 600 ? 'phone' : 'tablet';
  }
  save('rs_device_class', kind);
});
