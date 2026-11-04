// Research Studio inside a Qualtrics survey (v1). Paste into the JavaScript of the question that runs
// the Research Studio part (a Text/Graphic question on a page of its own). Research Studio's
// "Qualtrics setup" page (qualtrics-embed.html?study=<id>) fills in CONFIG for your study.
Qualtrics.SurveyEngine.addOnReady(function () {
  var CONFIG = {
    studyPage: 'https://YOUR-RESEARCH-STUDIO-SITE/study.html', // Research Studio's study.html
    studyId: 'YOUR-STUDY-ID',
    variant: '${e://Field/rs_variant}',   // design picked by the survey's randomizer; blank = Research Studio picks
    participantId: '${e://Field/ResponseID}',
    layout: 'fullscreen',                 // 'fullscreen' covers the page while it runs; 'inline' sits in the question
    autoAdvance: true                     // go to the next page when Research Studio has finished and saved
  };
  var NS = 'RS_QX', V = 1, MAX_CHARS = 32000, FIELD = /^rs_[a-z0-9_]{1,60}$/;
  var q = this, origin = new URL(CONFIG.studyPage).origin, saved = 0, finished = false, inerted = [];

  // Newer survey layouts store setJSEmbeddedData values in fields declared as __js_<name>;
  // older layouts store setEmbeddedData values in fields declared as <name>. Try both.
  function save(name, value) {
    value = String(value == null ? '' : value).slice(0, MAX_CHARS);
    try { Qualtrics.SurveyEngine.setJSEmbeddedData(name, value); } catch (e) {}
    try { Qualtrics.SurveyEngine.setEmbeddedData(name, value); } catch (e) {}
  }
  function clean(v) { v = String(v || '').trim(); return /^\$\{e:\/\//.test(v) ? '' : v; } // unpiped text → blank

  var params = 'study=' + encodeURIComponent(CONFIG.studyId) + '&embed=qualtrics';
  if (clean(CONFIG.variant)) params += '&variant=' + encodeURIComponent(clean(CONFIG.variant));
  if (clean(CONFIG.participantId)) params += '&pid=' + encodeURIComponent(clean(CONFIG.participantId));

  var frame = document.createElement('iframe');
  frame.src = CONFIG.studyPage + (CONFIG.studyPage.indexOf('?') < 0 ? '?' : '&') + params;
  frame.title = 'Research activity';
  frame.setAttribute('allow', 'fullscreen');
  frame.style.cssText = 'border:0;width:100%;display:block;background:#fff;';

  var box = document.createElement('div');
  if (CONFIG.layout === 'inline') {
    frame.style.height = '85vh';
    box.style.cssText = 'width:100%;margin:8px 0;';
    q.getQuestionContainer().appendChild(box);
  } else {
    // Attached to <body> so the survey's own layout can't clip or shift it.
    box.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:#fff;';
    frame.style.height = '100%';
    document.body.appendChild(box);
    document.documentElement.style.overflow = 'hidden';
    // Keep keyboard and screen-reader users inside the activity while it covers the page.
    for (var i = 0; i < document.body.children.length; i++) {
      var el = document.body.children[i];
      if (el !== box && !el.inert) { el.inert = true; inerted.push(el); }
    }
  }
  function restore() {
    if (box.parentNode && CONFIG.layout !== 'inline') box.parentNode.removeChild(box);
    document.documentElement.style.overflow = '';
    for (var j = 0; j < inerted.length; j++) inerted[j].inert = false;
    inerted = [];
  }
  box.appendChild(frame);
  q.hideNextButton();
  try { q.hidePreviousButton(); } catch (e) {}
  setTimeout(function () { try { frame.focus(); } catch (e) {} }, 300);

  function finish() {
    if (finished) return; finished = true;
    restore();
    q.showNextButton();
    var note = document.createElement('p');
    note.textContent = 'Thank you. The activity is complete. Select the next button to continue.';
    q.getQuestionContainer().appendChild(note);
    if (CONFIG.autoAdvance) setTimeout(function () { q.clickNextButton(); }, 600);
  }

  function onMessage(e) {
    if (e.origin !== origin || e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || m.ns !== NS || m.v !== V) return;
    if (m.type === 'hello') {
      save('rs_embed_ok', 'yes');
      frame.contentWindow.postMessage({ ns: NS, v: V, type: 'hello-ack' }, origin);
    } else if (m.type === 'save' && m.fields && typeof m.seq === 'number') {
      if (m.seq < saved) return; // an older save arriving late
      for (var k in m.fields) if (Object.prototype.hasOwnProperty.call(m.fields, k) && FIELD.test(k)) save(k, m.fields[k]);
      saved = m.seq;
      frame.contentWindow.postMessage({ ns: NS, v: V, type: 'saved', seq: m.seq }, origin);
    } else if (m.type === 'done') {
      setTimeout(finish, 1500);
    }
  }
  window.addEventListener('message', onMessage);
  Qualtrics.SurveyEngine.addOnUnload(function () {
    window.removeEventListener('message', onMessage);
    restore();
  });
});
