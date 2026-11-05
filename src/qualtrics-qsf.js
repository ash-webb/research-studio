// Starter Qualtrics survey (.qsf) for running a study inside a survey (v0.3.12).
// Import it in Qualtrics (Create project ▸ Survey ▸ Import a QSF file) and then add your own consent,
// PRA notice, screening and follow-up questions. It contains:
//   - every rs_… embedded data field the study sends, declared;
//   - for laptop/desktop-only studies, the device check on the first page and a branch that ends the
//     survey for phones and tablets before the randomizer;
//   - a randomizer (evenly presented) that sets rs_variant for A/B studies;
//   - the Research Studio page with its script, a branch that ends the survey if Research Studio
//     still found an unsupported device, and a follow-up page.
import { normalizeMethod } from './methods.js';
import { fieldNames } from './qualtrics-embed.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = s => String(s).replace(/<[^>]+>/g, '').slice(0, 99);

export function fillScript(template, { studyPage, studyId, layout = 'fullscreen', autoAdvance = true }) {
  return template.replace(/studyPage: '[^']*'/, `studyPage: '${studyPage}'`).replace(/studyId: '[^']*'/, `studyId: '${studyId}'`)
    .replace(/layout: '[^']*'/, `layout: '${layout === 'inline' ? 'inline' : 'fullscreen'}'`).replace(/autoAdvance: (true|false)/, `autoAdvance: ${!!autoAdvance}`);
}

// template: docs/qualtrics-embed.js; deviceCheck: docs/qualtrics-device-check.js (used for desktop-only studies).
export function starterSurvey(study, { studyPage, layout, autoAdvance, template, deviceCheck, now = new Date() }) {
  const SV = 'SV_rsStarter0001', stamp = now.toISOString().slice(0, 19).replace('T', ' ');
  const desktopOnly = study.allowedDevices === 'desktop';
  const ab = (study.tasks || []).filter(t => normalizeMethod(t) === 'ab_test');
  const variants = ab.length ? ab[0].variants.map(v => v.id) : [];
  const single = new Set(ab.map(t => t.experimentId || t.id)).size === 1;
  const ed = n => ({ Description: n, Type: 'Recipient', Field: n, VariableType: 'String', DataVisibility: [], AnalyzeText: false });
  const setVar = v => ({ Description: 'rs_variant', Type: 'Custom', Field: 'rs_variant', VariableType: 'String', DataVisibility: [], AnalyzeText: false, Value: v });
  const expr = (field, value, conj) => ({ LogicType: 'EmbeddedField', LeftOperand: field, Operator: 'EqualTo', RightOperand: value, Type: 'Expression',
    Description: `<span class="ConjDesc">${conj || 'If'}</span> <span class="LeftOpDesc">${field}</span> <span class="OpDesc">Is Equal to</span> <span class="RightOpDesc"> ${value} </span>`, ...(conj ? { Conjuction: conj } : {}) });
  const branch = (id, exprs, flow) => ({ Type: 'Branch', FlowID: id, Description: 'New Branch', Flow: flow,
    BranchLogic: { 0: { ...Object.fromEntries(exprs.map((e, i) => [i, e])), Type: 'If' }, Type: 'BooleanExpression' } });
  const q = (qid, tag, text, extra = {}) => ({ SurveyID: SV, Element: 'SQ', PrimaryAttribute: qid, SecondaryAttribute: plain(text), TertiaryAttribute: null,
    Payload: { QuestionText: text, DefaultChoices: false, DataExportTag: tag, QuestionType: 'DB', Selector: 'TB', Configuration: { QuestionDescriptionOption: 'UseText' },
      QuestionDescription: plain(text), ChoiceOrder: [], Validation: { Settings: { Type: 'None' } }, GradingData: [], Language: [], NextChoiceId: 4, NextAnswerId: 1, QuestionID: qid, ...extra } });

  const blocks = [
    { Type: 'Default', Description: 'Welcome and consent (add yours)', ID: 'BL_rsWelcome', BlockElements: [{ Type: 'Question', QuestionID: 'QID1' }] },
    { Type: 'Standard', SubType: '', Description: 'Research Studio activity', ID: 'BL_rsActivity', BlockElements: [{ Type: 'Question', QuestionID: 'QID2' }] },
    { Type: 'Standard', SubType: '', Description: 'Follow-up (add yours)', ID: 'BL_rsFollow', BlockElements: [{ Type: 'Question', QuestionID: 'QID3' }] }
  ];
  // Two copies of the "computer needed" page: a block may appear only once in a survey flow.
  if (desktopOnly) blocks.push({ Type: 'Standard', SubType: '', Description: 'Computer needed (before assignment)', ID: 'BL_rsDevice', BlockElements: [{ Type: 'Question', QuestionID: 'QID4' }] },
    { Type: 'Standard', SubType: '', Description: 'Computer needed (found by Research Studio)', ID: 'BL_rsDevice2', BlockElements: [{ Type: 'Question', QuestionID: 'QID5' }] });
  const notOnComputer = desktopOnly ? [{ Type: 'Block', ID: 'BL_rsDevice', FlowID: 'FL_21', Autofill: [] }, { Type: 'EndSurvey', FlowID: 'FL_22' }] : [];
  const flow = [
    { Type: 'EmbeddedData', FlowID: 'FL_2', EmbeddedData: fieldNames(study).map(ed) },
    { Type: 'Block', ID: 'BL_rsWelcome', FlowID: 'FL_3', Autofill: [] },
    ...(desktopOnly ? [branch('FL_20', [expr('rs_device_class', 'phone'), expr('rs_device_class', 'tablet', 'Or')], notOnComputer)] : []),
    ...(variants.length && single ? [{ Type: 'BlockRandomizer', FlowID: 'FL_4', SubSet: '1', EvenPresentation: true,
      Flow: variants.map((v, i) => ({ Type: 'EmbeddedData', FlowID: `FL_${5 + i}`, EmbeddedData: [setVar(v)] })) }] : []),
    { Type: 'Block', ID: 'BL_rsActivity', FlowID: 'FL_15', Autofill: [] },
    ...(desktopOnly ? [branch('FL_23', [expr('rs_status', 'device_not_supported')], [{ Type: 'Block', ID: 'BL_rsDevice2', FlowID: 'FL_24', Autofill: [] }, { Type: 'EndSurvey', FlowID: 'FL_25' }])] : []),
    { Type: 'Block', ID: 'BL_rsFollow', FlowID: 'FL_16', Autofill: [] }
  ];
  const welcome = `<strong>Replace this page with your consent statement and Paperwork Reduction Act notice.</strong> The next page runs “${esc(study.title || study.id)}” in Research Studio.${desktopOnly ? ' This study needs a laptop or desktop computer.' : ''}`;
  const elements = [
    { SurveyID: SV, Element: 'BL', PrimaryAttribute: 'Survey Blocks', SecondaryAttribute: null, TertiaryAttribute: null, Payload: blocks },
    { SurveyID: SV, Element: 'FL', PrimaryAttribute: 'Survey Flow', SecondaryAttribute: null, TertiaryAttribute: null, Payload: { Type: 'Root', FlowID: 'FL_1', Flow: flow, Properties: { Count: 25 } } },
    { SurveyID: SV, Element: 'SO', PrimaryAttribute: 'Survey Options', SecondaryAttribute: null, TertiaryAttribute: null, Payload: { BackButton: 'false', SaveAndContinue: 'true', SurveyProtection: 'PublicSurvey', BallotBoxStuffingPrevention: 'false', NoIndex: 'Yes', SecureResponseFiles: 'true', SurveyExpiration: null, SurveyTermination: 'DefaultMessage', Header: '', Footer: '', ProgressBarDisplay: 'None', PartialData: '+1 week', ValidationMessage: null, PreviousButton: ' ← ', NextButton: ' → ', SurveyTitle: 'Qualtrics Survey | Qualtrics Experience Management', NewScoring: 1 } },
    { SurveyID: SV, Element: 'QC', PrimaryAttribute: 'Survey Question Count', SecondaryAttribute: String(blocks.length), TertiaryAttribute: null, Payload: null },
    { SurveyID: SV, Element: 'RS', PrimaryAttribute: 'RS_rsStarter', SecondaryAttribute: 'Default Response Set', TertiaryAttribute: null, Payload: null },
    q('QID1', 'Q1', welcome, desktopOnly && deviceCheck ? { QuestionJS: deviceCheck } : {}),
    q('QID2', 'Q2', 'Please complete the activity.', { QuestionJS: fillScript(template, { studyPage, studyId: study.id, layout, autoAdvance }) }),
    q('QID3', 'Q3', 'Add your follow-up questions here.')
  ];
  const deviceText = 'This study needs a laptop or desktop computer. Thank you for your interest. Please open the survey link again on a computer if you can.';
  if (desktopOnly) elements.push(q('QID4', 'Q4', deviceText), q('QID5', 'Q5', deviceText));
  return { SurveyEntry: { SurveyID: SV, SurveyName: `${study.title || study.id} (Research Studio)`, SurveyDescription: null, SurveyOwnerID: 'UR_rsStarter', SurveyBrandID: '', DivisionID: null, SurveyLanguage: 'EN', SurveyActiveResponseSet: 'RS_rsStarter', SurveyStatus: 'Inactive', SurveyStartDate: '0000-00-00 00:00:00', SurveyExpirationDate: '0000-00-00 00:00:00', SurveyCreationDate: stamp, CreatorID: 'UR_rsStarter', LastModified: stamp, LastAccessed: '0000-00-00 00:00:00', LastActivated: '0000-00-00 00:00:00', Deleted: null },
    SurveyElements: elements };
}
