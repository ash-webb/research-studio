// Research Studio · Qualtrics JavaScript test (v1)
// Paste into the JavaScript of the question that shows the test panel.
// Change ALLOWED_ORIGIN if the site moves (for example to the IRS GitHub Pages address).
Qualtrics.SurveyEngine.addOnload(function () {
  var ALLOWED_ORIGIN = 'https://ash-webb.github.io';
  var NS = 'RS_QX_TEST';

  // Save to embedded data. Newer layouts use setJSEmbeddedData (field declared as __js_<name>);
  // older layouts use setEmbeddedData (field declared as <name>). Try both.
  function save(name, value) {
    value = String(value);
    try { Qualtrics.SurveyEngine.setJSEmbeddedData(name, value); } catch (e) {}
    try { Qualtrics.SurveyEngine.setEmbeddedData(name, value); } catch (e) {}
  }

  save('rs_js_ran', 'yes');

  function onMessage(event) {
    if (event.origin !== ALLOWED_ORIGIN) return;
    var m = event.data;
    if (!m || m.namespace !== NS) return;
    if (m.type === 'hello') save('rs_frame_ok', 'yes');
    if (m.type === 'result' && typeof m.payload === 'string') {
      save('rs_' + m.kind + '_size', m.payload.length);
      save('rs_' + m.kind, m.payload);
    }
    if (event.source) {
      event.source.postMessage({ namespace: NS, type: 'ack', received: m.type === 'result' ? m.kind : m.type, size: m.payload ? m.payload.length : 0 }, event.origin);
    }
  }
  window.addEventListener('message', onMessage);
  Qualtrics.SurveyEngine.addOnUnload(function () { window.removeEventListener('message', onMessage); });
});
