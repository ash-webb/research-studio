// PUBLIC browser configuration. Never put a Supabase secret/service-role key here.
window.UTP_SETTINGS = {
  supabaseUrl: '', // e.g. 'https://xxxx.supabase.co'
  supabasePublishableKey: '', // e.g. 'sb_publishable_...'
  // Hosts that "Return to the survey" links may point to (https only; subdomains included).
  // Narrowed to the IRS Qualtrics account (v0.3.14); use 'qualtrics.com' to allow any account.
  returnUrlHosts: ['irsresearch.gov1.qualtrics.com'],
  // Survey sites that may show Research Studio inside a page and receive results there (https only;
  // subdomains included). See qualtrics-embed.html.
  embedHosts: ['irsresearch.gov1.qualtrics.com']
};
