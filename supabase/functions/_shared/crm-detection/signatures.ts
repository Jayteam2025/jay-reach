// Catalogue exhaustif des CRMs reconnus par la detection auto.
// Source : recherche web 2026-05-07 (top international + FR/EU + enterprise + open source).
//
// Architecture : pour chaque CRM connu, on declare les signatures observables :
//   - DNS_SPF : inclusions SPF/TXT typiques quand l'entreprise envoie via le CRM
//   - DNS_MX  : MX du CRM (rare, surtout Zoho Mail / HubSpot optionnel)
//   - SUBDOMAIN_CNAME : ce vers quoi pointent les CNAME custom (crm.boite.com)
//   - HTML : trackers/forms/scripts visibles dans le source page
//   - CUSTOMER_STORY : domain ou le CRM publie ses case studies
//
// Pour les CRMs sans pattern DNS public (petits FR), seules HTML/customer-story restent
// — ils seront detectes via la home + Brave search.

// Note : Oracle Eloqua, Adobe Marketo, Mailchimp, Brevo (en mode ESP) sont
// VOLONTAIREMENT exclus de cette liste — ce sont du marketing automation pur
// ou de l'ESP, pas des CRMs. Leurs patterns sont dans NON_CRM_TOOLS.
export type CrmName =
  // Top international
  | "Salesforce" | "HubSpot" | "Pipedrive" | "Zoho" | "Microsoft Dynamics"
  | "monday.com" | "Freshsales" | "Insightly" | "Copper CRM" | "Capsule"
  | "EngageBay" | "Apptivo" | "Vtiger" | "SugarCRM" | "Close"
  | "Salesflare" | "Nutshell" | "Streak" | "NoCRM" | "Keap"
  | "Nimble" | "Less Annoying CRM" | "ActiveCampaign" | "Bitrix24" | "AmoCRM"
  | "Zendesk Sell"
  // Europe / FR
  | "Sellsy" | "Teamleader" | "Axonaut" | "Eudonet" | "Efficy"
  | "Saalz" | "Initiative CRM" | "Karlia" | "Furious Squad"
  | "Ines CRM" | "Iko System" | "Tilkee"
  // Enterprise CRM (sales/service cloud, pas marketing pur)
  | "SAP C4C" | "Oracle NetSuite"
  // Open source / niche
  | "Odoo" | "Sage CRM" | "EspoCRM" | "SuiteCRM" | "Yoneos CRM"
  // Sectoriels
  | "Apimo" | "Hektor" | "Tactill" | "Wynd";

export type SignatureMatch = {
  crm: CrmName;
  source: "dns_spf" | "dns_mx" | "subdomain_cname" | "html" | "customer_story";
  evidence: string; // pattern matched, for debug
};

/**
 * Sous-domaines courants a probe en CNAME (en cascade). Si crm.boite.com
 * pointe vers *.salesforce.com, c'est un signal HIGH.
 */
export const SUBDOMAINS_TO_PROBE = [
  "crm",
  "app",
  "info",
  "support",
  "community",
  "help",
  "portal",
  "sales",
  "marketing",
  "go",
  "track",
];

/**
 * Patterns DNS SPF/TXT. Les inclusions SPF sont quasi-impossibles a faker
 * (l'entreprise doit reellement utiliser le CRM pour envoyer des mails).
 *
 * Note : variants flexibles (HubSpot a spf00, spf01, spf02 selon la region;
 * Bitrix24 a _sv1 a _sv9). Regex matche les variants.
 */
export const DNS_SPF_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  // Salesforce + ses produits emailing
  { pattern: /_spf\.salesforce\.com/i, crm: "Salesforce" },
  { pattern: /cust-spf\.exacttarget\.com|exacttarget\.com\/spf/i, crm: "Salesforce" },
  { pattern: /salesforce-emailrelay\.com/i, crm: "Salesforce" },
  { pattern: /_spf\.pardot\.com|pi\.pardot\.com/i, crm: "Salesforce" },

  // HubSpot (variants regionaux : spf00, spf01, spf02, ...)
  { pattern: /spf\d*\.hubspotemail\.net|spf\.hubspot\.com|_spf\.hubspot/i, crm: "HubSpot" },

  // Zoho (CRM ou Mail)
  { pattern: /spf\.zoho\.com|zoho\.com\/?(?:[^a-z0-9]|$)/i, crm: "Zoho" },

  // Microsoft Dynamics 365
  { pattern: /spf\.dynamics\.com|crmdynint\.com|spf\.protection\.outlook\.com.{0,50}dynamics/i, crm: "Microsoft Dynamics" },

  // Pipedrive
  { pattern: /spf\.pipedrive\.com|pipedrivemail\.com/i, crm: "Pipedrive" },

  // Freshsales (Freshworks)
  { pattern: /_spf\.freshsales\.io|spf\.freshworks\.com|freshmail\.io/i, crm: "Freshsales" },

  // Sellsy / Teamleader / Axonaut / Eudonet / Efficy / Saalz
  { pattern: /spf\.sellsy\.com|sellsy\.com\/spf/i, crm: "Sellsy" },
  { pattern: /spf\.teamleader\.eu|teamleader\.io/i, crm: "Teamleader" },
  { pattern: /axonaut\.com|spf\.axonaut/i, crm: "Axonaut" },
  { pattern: /spf\.eudonet\.com|eudonet\.com\/spf/i, crm: "Eudonet" },
  { pattern: /spf\.efficy\.com/i, crm: "Efficy" },
  { pattern: /spf\.saalz\.com/i, crm: "Saalz" },

  // monday / Insightly / Copper / Apptivo / Vtiger / SugarCRM
  { pattern: /spf\.monday\.com/i, crm: "monday.com" },
  { pattern: /spf\.insightly\.com/i, crm: "Insightly" },
  { pattern: /spf\.copper\.com|spf\.prosperworks\.com/i, crm: "Copper CRM" },
  { pattern: /spf\.apptivo\.com/i, crm: "Apptivo" },
  { pattern: /spf\.vtiger\.com|vtigeronline\.com/i, crm: "Vtiger" },
  { pattern: /spf\.sugarcrm\.com|sugaropencloud\.com|sugarondemand\.com/i, crm: "SugarCRM" },

  // Close / Salesflare / Nutshell / Streak / NoCRM / Keap / Nimble / Less Annoying
  { pattern: /spf\.close\.com|mailgun\.org.*close/i, crm: "Close" },
  { pattern: /spf\.salesflare\.com/i, crm: "Salesflare" },
  { pattern: /spf\.nutshell\.com/i, crm: "Nutshell" },
  { pattern: /spf\.streak\.com/i, crm: "Streak" },
  { pattern: /spf\.nocrm\.io|youdontneedacrm\.com/i, crm: "NoCRM" },
  { pattern: /spf\.keap\.com|infusionmail\.com|infusionsoft\.com/i, crm: "Keap" },
  { pattern: /spf\.nimble\.com/i, crm: "Nimble" },
  { pattern: /spf\.lessannoyingcrm\.com/i, crm: "Less Annoying CRM" },

  // ActiveCampaign / Bitrix24 / AmoCRM / Zendesk Sell
  { pattern: /spf\.activecampaign\.com|emsd1\.com|activehosted\.com/i, crm: "ActiveCampaign" },
  { pattern: /_sv[1-9]\.bitrix24\.com|spf\.bitrix24\.com/i, crm: "Bitrix24" },
  { pattern: /spf\.amocrm\.(?:com|ru)/i, crm: "AmoCRM" },
  { pattern: /getbase\.com\/spf|spf\.zendesk\.com/i, crm: "Zendesk Sell" },

  // FR niche
  { pattern: /spf\.karlia\.com|karlia\.com\/spf/i, crm: "Karlia" },
  { pattern: /spf\.tilkee\.com/i, crm: "Tilkee" },
  { pattern: /spf\.inescrm\.com|spf\.ines\.eu/i, crm: "Ines CRM" },
  { pattern: /spf\.initiative-crm\.com/i, crm: "Initiative CRM" },

  // Enterprise CRM (Eloqua/Marketo dans NON_CRM_TOOLS — marketing pur)
  { pattern: /spf\.sap\.com|sapcustomerexperience\.com|crm\.ondemand\.com/i, crm: "SAP C4C" },
  { pattern: /spf\.netsuite\.com|netsuite\.com\/spf/i, crm: "Oracle NetSuite" },

  // Open source / cloud
  { pattern: /_spf\.odoo\.com|spf\.odoo/i, crm: "Odoo" },
  { pattern: /spf\.sage\.com|sage-crm\.com/i, crm: "Sage CRM" },
];

/**
 * MX records — surtout pour les CRMs qui font aussi mail hosting.
 */
export const DNS_MX_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  { pattern: /\bmx\.zoho\.com$|zoho\.eu$|zohomail/i, crm: "Zoho" },
  { pattern: /salesforce\.com$/i, crm: "Salesforce" },
  { pattern: /\bmx\.hubspot\.com$/i, crm: "HubSpot" },
];

/**
 * CNAMEs de sous-domaines : si crm.boite.com -> *.salesforce.com,
 * c'est un signal HIGH (configuration explicite).
 */
export const SUBDOMAIN_CNAME_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  // Salesforce
  { pattern: /\.my\.salesforce\.com$|\.lightning\.force\.com$|\.cloudforce\.com$|\.force\.com$|\.salesforce-sites\.com$|\.visualforce\.com$/i, crm: "Salesforce" },

  // HubSpot
  { pattern: /\.hubspot\.net$|\.hs-sites\.com$|\.hubspotusercontent.*\.net$|\.hubspotemail\.net$|\.hsforms\.net$/i, crm: "HubSpot" },

  // Zoho
  { pattern: /\.zohohost\.com$|\.zoho\.com$|\.zohopublic\.com$|\.zohomail\.com$/i, crm: "Zoho" },

  // Microsoft Dynamics 365
  { pattern: /\.crm\.dynamics\.com$|\.crm\d+\.dynamics\.com$|\.dynamics365portals\.com$|\.microsoftcrmportals\.com$|\.dynamics365commerce\.ms$/i, crm: "Microsoft Dynamics" },

  // Pipedrive
  { pattern: /\.pipedrive\.com$|\.pipedriveassets\.com$|\.pipedrivemail\.com$/i, crm: "Pipedrive" },

  // Sellsy / Teamleader / Axonaut / Eudonet / Efficy
  { pattern: /\.sellsy\.com$|\.sellsy\.fr$/i, crm: "Sellsy" },
  { pattern: /\.teamleader\.eu$|\.focus\.teamleader\.eu$/i, crm: "Teamleader" },
  { pattern: /\.axonaut\.com$/i, crm: "Axonaut" },
  { pattern: /\.eudonet\.com$/i, crm: "Eudonet" },
  { pattern: /\.efficy\.com$/i, crm: "Efficy" },

  // monday / Freshsales / Insightly / Copper / Apptivo / Vtiger / SugarCRM
  { pattern: /\.monday\.com$|proxy\.clientportalbuilder\.com$/i, crm: "monday.com" },
  { pattern: /\.freshsales\.io$|\.myfreshworks\.com$/i, crm: "Freshsales" },
  { pattern: /\.insightly\.com$/i, crm: "Insightly" },
  { pattern: /\.copper\.com$|\.prosperworks\.com$/i, crm: "Copper CRM" },
  { pattern: /\.apptivo\.com$/i, crm: "Apptivo" },
  { pattern: /\.vtiger\.com$|\.vtigeronline\.com$/i, crm: "Vtiger" },
  { pattern: /\.sugarcrm\.com$|\.sugaropencloud\.com$|\.sugarondemand\.com$/i, crm: "SugarCRM" },

  // Close / Salesflare / Nutshell / Streak / NoCRM / Keap
  { pattern: /\.close\.com$|\.close\.io$/i, crm: "Close" },
  { pattern: /\.salesflare\.com$/i, crm: "Salesflare" },
  { pattern: /\.nutshell\.com$/i, crm: "Nutshell" },
  { pattern: /\.streak\.com$/i, crm: "Streak" },
  { pattern: /\.nocrm\.io$|\.youdontneedacrm\.com$/i, crm: "NoCRM" },
  { pattern: /\.keap\.com$|\.infusionsoft\.com$|\.infusion-app\.com$/i, crm: "Keap" },
  { pattern: /\.nimble\.com$/i, crm: "Nimble" },
  { pattern: /\.lessannoyingcrm\.com$/i, crm: "Less Annoying CRM" },

  // ActiveCampaign / Bitrix24 / AmoCRM / Zendesk Sell
  { pattern: /\.activecampaign\.com$|\.activehosted\.com$/i, crm: "ActiveCampaign" },
  { pattern: /\.bitrix24\.(?:com|fr|eu|de|es|it)$/i, crm: "Bitrix24" },
  { pattern: /\.amocrm\.(?:com|ru)$/i, crm: "AmoCRM" },
  { pattern: /\.getbase\.com$/i, crm: "Zendesk Sell" },

  // FR niche
  { pattern: /\.karlia\.com$/i, crm: "Karlia" },
  { pattern: /\.tilkee\.com$/i, crm: "Tilkee" },
  { pattern: /\.inescrm\.com$|\.ines\.eu$/i, crm: "Ines CRM" },
  { pattern: /\.initiative-crm\.com$/i, crm: "Initiative CRM" },
  { pattern: /\.iko\.fr$|iko-system\.com$/i, crm: "Iko System" },
  { pattern: /\.furiouslysquadded\.com$|\.furious\.io$/i, crm: "Furious Squad" },
  { pattern: /\.saalz\.com$/i, crm: "Saalz" },

  // Enterprise CRM (Eloqua/Marketo dans NON_CRM_TOOLS)
  { pattern: /\.crm\.ondemand\.com$|\.c4c\.net\.sap\.srip\.net$|\.cloud\.sap$/i, crm: "SAP C4C" },
  { pattern: /\.netsuite\.com$|\.na\d+\.netsuite\.com$/i, crm: "Oracle NetSuite" },

  // Open source / cloud
  { pattern: /\.odoo\.com$|\.odoocloud\.com$/i, crm: "Odoo" },
  { pattern: /\.sage-crm\.com$/i, crm: "Sage CRM" },
  { pattern: /\.espocrm\.com$/i, crm: "EspoCRM" },
  { pattern: /\.suitecrm\.com$/i, crm: "SuiteCRM" },

  // Sectoriels FR
  { pattern: /\.apimo\.eu$|\.apimo\.pro$/i, crm: "Apimo" },
  { pattern: /\.hektor\.fr$/i, crm: "Hektor" },

  // Note : Brevo/Klaviyo classes en NON_CRM (ESP) — pas dans la whitelist CRM
];

/**
 * Patterns dans le HTML (script src, tracker URL, form endpoint, mention textuelle).
 */
export const HTML_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  // HubSpot (forms, scripts, trackers, regional CDN)
  { pattern: /js(?:-eu1|-eu2|-na1)?\.hsforms\.net|js\.hs-scripts\.com|js\.hs-banner\.com|hs-analytics\.net|track\.hubspot\.com|forms\.hubspot\.com/i, crm: "HubSpot" },
  { pattern: /\b_hsq\b|hubspotutk/i, crm: "HubSpot" },

  // Salesforce + Pardot + Marketing Cloud
  { pattern: /pi\.pardot\.com|\.pardot\.com\/(?:pd|pa)\.js|go\.pardot|pi-cdn\.pardot/i, crm: "Salesforce" },
  { pattern: /web-form-tracking\.salesforce\.com|salesforce\.com\/event-tracking|c\.la1-c1cs-iad\.salesforceliveagent/i, crm: "Salesforce" },
  { pattern: /\.lightning\.force\.com|\.my\.salesforce\.com|sfdcsessid|sf-crm/i, crm: "Salesforce" },
  { pattern: /exacttarget\.com|s\.exct\.net|click\.exacttarget/i, crm: "Salesforce" },

  // Zoho
  { pattern: /salesiq\.zoho\.com|forms\.zoho\.com|crm\.zoho\.com|crm\.zohopublic\.com/i, crm: "Zoho" },
  { pattern: /\.zoho\.com\/javascript\/zcga\.js|zohoverify/i, crm: "Zoho" },

  // Microsoft Dynamics 365 + D365 Marketing
  { pattern: /\.crm\.dynamics\.com|d365marketing|dynamics365portals|mscrm365/i, crm: "Microsoft Dynamics" },

  // Pipedrive
  { pattern: /webforms\.pipedrive\.com|pipedrivewebforms\.com|pipedrive\.com\/forms/i, crm: "Pipedrive" },

  // Sellsy / Teamleader / Axonaut / Eudonet / Efficy / Karlia / Tilkee
  { pattern: /sellsy\.com\/(?:api|forms|webforms)/i, crm: "Sellsy" },
  { pattern: /focus\.teamleader\.eu|api\.teamleader\.eu/i, crm: "Teamleader" },
  { pattern: /app\.axonaut\.com|axonaut\.com\/widget/i, crm: "Axonaut" },
  { pattern: /eudonet\.com\/(?:api|widget|forms)/i, crm: "Eudonet" },
  { pattern: /efficy\.com\/(?:api|widget)/i, crm: "Efficy" },
  { pattern: /karlia\.com\/(?:api|widget|forms)/i, crm: "Karlia" },
  { pattern: /tilkee\.com\/(?:tracking|api|widget)|tilkee-tracker/i, crm: "Tilkee" },

  // monday / Freshsales / Insightly / Copper / Apptivo / Vtiger / SugarCRM
  { pattern: /forms\.monday\.com|cdn\.monday\.com\/forms/i, crm: "monday.com" },
  { pattern: /freshsales\.io|freshworks-crm|freshchat\.com.*crm/i, crm: "Freshsales" },
  { pattern: /insightly\.com\/(?:api|widget)/i, crm: "Insightly" },
  { pattern: /copper\.com\/(?:api|tracking)|prosperworks\.com/i, crm: "Copper CRM" },
  { pattern: /apptivo\.com\/(?:api|widget)/i, crm: "Apptivo" },
  { pattern: /vtiger\.com\/(?:webforms|api)|vtigeronline\.com/i, crm: "Vtiger" },
  { pattern: /sugarcrm\.com\/(?:api|webforms)|sugaropencloud\.com|sugarondemand\.com/i, crm: "SugarCRM" },

  // Close / Salesflare / Nutshell / Streak / NoCRM / Keap / Nimble / Less Annoying
  { pattern: /close\.com\/api|close\.io\/widget/i, crm: "Close" },
  { pattern: /salesflare\.com\/(?:api|widget)/i, crm: "Salesflare" },
  { pattern: /nutshell\.com\/(?:api|widget)/i, crm: "Nutshell" },
  { pattern: /streak\.com\/(?:api|gmail-widget)/i, crm: "Streak" },
  { pattern: /nocrm\.io\/(?:api|widget)|youdontneedacrm\.com/i, crm: "NoCRM" },
  { pattern: /keap\.com\/(?:api|widget)|infusionsoft\.com|infusion-app\.com/i, crm: "Keap" },
  { pattern: /nimble\.com\/(?:api|widget)/i, crm: "Nimble" },
  { pattern: /lessannoyingcrm\.com\/(?:api|widget)/i, crm: "Less Annoying CRM" },

  // ActiveCampaign / Bitrix24 / AmoCRM / Zendesk Sell
  { pattern: /activecampaign\.com\/(?:api|tracking)|activehosted\.com|trackcmp\.net/i, crm: "ActiveCampaign" },
  { pattern: /bitrix24\.(?:com|fr|eu|de)\/(?:api|widget)|bitrix\.info/i, crm: "Bitrix24" },
  { pattern: /amocrm\.(?:com|ru)\/(?:api|widget)/i, crm: "AmoCRM" },
  { pattern: /getbase\.com|zendesk\.com\/sell/i, crm: "Zendesk Sell" },

  // Odoo (Brevo/Klaviyo classes NON_CRM)
  { pattern: /\.odoo\.com\/(?:web|crm|api)|odoocloud\.com/i, crm: "Odoo" },

  // Enterprise CRM (Eloqua/Marketo dans NON_CRM_TOOLS)
  { pattern: /\.crm\.ondemand\.com|c4c\.net\.sap|sapcustomerexperience/i, crm: "SAP C4C" },
  { pattern: /\.netsuite\.com|na\d+\.netsuite\.com/i, crm: "Oracle NetSuite" },

  // Open source
  { pattern: /espocrm\.com\/(?:api|widget)/i, crm: "EspoCRM" },
  { pattern: /suitecrm\.com\/(?:api|widget)/i, crm: "SuiteCRM" },
  { pattern: /sage-crm\.com|sage\.com\/.*crm/i, crm: "Sage CRM" },

  // Sectoriels
  { pattern: /apimo\.(?:eu|pro|net)/i, crm: "Apimo" },
  { pattern: /hektor\.fr\/(?:api|widget)/i, crm: "Hektor" },
];

/**
 * Mentions textuelles dans pages legales/privacy/contact. Le verbe d'usage
 * (utilise, heberge, traite, gere, stocke, exploite, sous-traite, transmis a)
 * est exige pour eviter les faux positifs (ex: simple lien partenaire).
 *
 * Tolerance maximale : tirets/espaces/points entre les mots, accents FR,
 * synonymes courants.
 */
const VERB_USAGE = "(?:utilise|h[eé]berge|traite|g[eè]re|stocke|exploit[eé]|sous[\\s\\-]?trait[eé]|transmis[\\s\\-]?[aà]|partage[\\s\\-]?(?:avec|via)|via)";
const W = 50; // window of 50 chars between verb and CRM name

export const TEXT_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(salesforce(?:\\.com)?|sales[\\s\\-\\.]?force|sfdc|pardot|sales[\\s\\-]?cloud|service[\\s\\-]?cloud|marketing[\\s\\-]?cloud)\\b`, "i"), crm: "Salesforce" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bhub[\\s\\-]?spot\\b`, "i"), crm: "HubSpot" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bzoho(?:[\\s\\-]?(?:crm|one|salesiq|desk|bigin))?\\b`, "i"), crm: "Zoho" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(microsoft[\\s\\-]?dynamics(?:[\\s\\-]?365)?|dynamics[\\s\\-]?(?:365|crm)|d[\\s\\-]?365|ms[\\s\\-]?crm|ms[\\s\\-]?dynamics)\\b`, "i"), crm: "Microsoft Dynamics" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bpipe[\\s\\-]?drive\\b`, "i"), crm: "Pipedrive" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bsellsy\\b`, "i"), crm: "Sellsy" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bteam[\\s\\-]?leader(?:[\\s\\-]?focus)?\\b`, "i"), crm: "Teamleader" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(odoo|openerp)\\b`, "i"), crm: "Odoo" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\baxonaut\\b`, "i"), crm: "Axonaut" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\beudonet\\b`, "i"), crm: "Eudonet" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\befficy\\b`, "i"), crm: "Efficy" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bactive[\\s\\-]?campaign\\b`, "i"), crm: "ActiveCampaign" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bfresh[\\s\\-]?(?:sales|works(?:[\\s\\-]?crm)?)\\b`, "i"), crm: "Freshsales" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\binsightly\\b`, "i"), crm: "Insightly" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bsugar[\\s\\-]?crm\\b`, "i"), crm: "SugarCRM" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bnet[\\s\\-]?suite\\b`, "i"), crm: "Oracle NetSuite" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bbitrix[\\s\\-]?24\\b`, "i"), crm: "Bitrix24" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bamo[\\s\\-]?crm\\b`, "i"), crm: "AmoCRM" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bnutshell\\b`, "i"), crm: "Nutshell" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bsales[\\s\\-]?flare\\b`, "i"), crm: "Salesflare" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bcopper[\\s\\-]?crm\\b`, "i"), crm: "Copper CRM" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(no[\\s\\-]?crm(?:\\.io)?|you[\\s\\-]?don[\\s\\-']?t[\\s\\-]?need[\\s\\-]?a[\\s\\-]?crm)\\b`, "i"), crm: "NoCRM" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(keap|infusion[\\s\\-]?soft)\\b`, "i"), crm: "Keap" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bclose(?:\\.(?:com|io))?\\b`, "i"), crm: "Close" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bvtiger\\b`, "i"), crm: "Vtiger" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bapptivo\\b`, "i"), crm: "Apptivo" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\bsage[\\s\\-]?crm\\b`, "i"), crm: "Sage CRM" },
  { pattern: new RegExp(`${VERB_USAGE}.{0,${W}}\\b(zendesk[\\s\\-]?sell|getbase|base[\\s\\-]?crm)\\b`, "i"), crm: "Zendesk Sell" },
];

/**
 * Domains hosting customer stories / case studies — match dans Brave search results.
 */
export const CUSTOMER_STORY_PATTERNS: { pattern: RegExp; crm: CrmName }[] = [
  { pattern: /salesforce\.com\/(?:[a-z]{2}\/)?(?:customer|customers|customer-stories|case-studies)/i, crm: "Salesforce" },
  { pattern: /hubspot\.com\/(?:[a-z]{2}\/)?(?:case-studies|customers|customer-stories)/i, crm: "HubSpot" },
  { pattern: /zoho\.com\/(?:[a-z]{2}\/)?(?:customers|case-studies|customer)/i, crm: "Zoho" },
  { pattern: /pipedrive\.com\/(?:[a-z]{2}\/)?(?:customers|case-studies)/i, crm: "Pipedrive" },
  { pattern: /microsoft\.com\/.*(?:customers|case-studies).*dynamics/i, crm: "Microsoft Dynamics" },
  { pattern: /monday\.com\/(?:[a-z]{2}\/)?(?:customer-stories|customers|case-studies)/i, crm: "monday.com" },
  { pattern: /freshworks\.com\/(?:customers|case-studies)|freshsales\.com\/customers/i, crm: "Freshsales" },
  { pattern: /sellsy\.com\/(?:fr\/)?(?:success-stories|customers|temoignages)/i, crm: "Sellsy" },
  { pattern: /teamleader\.eu\/(?:[a-z]{2}\/)?(?:customers|case-studies|cases)/i, crm: "Teamleader" },
  { pattern: /axonaut\.com\/(?:fr\/)?(?:customers|temoignages)/i, crm: "Axonaut" },
  { pattern: /odoo\.com\/(?:[a-z]{2}\/)?customers/i, crm: "Odoo" },
  { pattern: /sap\.com\/.*customer-stories.*c4c|sap\.com\/.*sales-cloud\/customers/i, crm: "SAP C4C" },
  { pattern: /oracle\.com\/(?:[a-z]{2}\/)?customers.*netsuite/i, crm: "Oracle NetSuite" },
  // Adobe Marketo retire (non-CRM, marketing automation)
];

/**
 * NON-CRM tools : ESP, marketing automation pure, support, analytics.
 * Detectes via DNS/HTML mais NE remontent PAS comme CRM.
 * On les expose dans signals.marketing_tools pour le contexte commercial.
 */
export const NON_CRM_TOOLS: { pattern: RegExp; tool: string; category: "esp" | "support" | "analytics" | "marketing" }[] = [
  // ESP
  { pattern: /spf\.brevo\.com|_spf-brevo\.com|brevo-code:|sendinblue-code:|sib-fast/i, tool: "Brevo (ESP)", category: "esp" },
  { pattern: /spf\.mandrillapp\.com|mandrill_verify|servers\.mcsv\.net|mailchimp\.com/i, tool: "Mailchimp", category: "esp" },
  { pattern: /spf\.mailjet\.com|api\.mailjet\.com/i, tool: "Mailjet", category: "esp" },
  { pattern: /sendgrid\.net|spf\.sendgrid\.net|u\d+\.ct\.sendgrid/i, tool: "SendGrid", category: "esp" },
  { pattern: /mailgun\.org|mg\.mailgun\.com/i, tool: "Mailgun", category: "esp" },
  { pattern: /postmark\.app|postmarkapp\.com/i, tool: "Postmark", category: "esp" },

  // Marketing automation pure
  { pattern: /spf\.mktomail\.com|marketo\.com|mktoresp\.com/i, tool: "Marketo (Adobe)", category: "marketing" },
  { pattern: /eloqua\.com|elqcdn\.com/i, tool: "Eloqua (Oracle)", category: "marketing" },
  { pattern: /acoustic\.com|silverpop/i, tool: "Acoustic", category: "marketing" },

  // Customer support / chat
  { pattern: /widget\.intercom\.io|intercomcdn\.com|intercom-mail/i, tool: "Intercom", category: "support" },
  { pattern: /js\.driftt\.com|drift\.com\/widget|drift-chat/i, tool: "Drift", category: "support" },
  { pattern: /(?<!sell\.)zendesk\.com|zdassets\.com/i, tool: "Zendesk Support", category: "support" },
  { pattern: /crisp\.chat|client\.crisp\.chat/i, tool: "Crisp", category: "support" },
  { pattern: /tawk\.to|embed\.tawk/i, tool: "Tawk.to", category: "support" },
  { pattern: /front\.com\/api|frontapp\.com/i, tool: "Front", category: "support" },
  { pattern: /helpscout\.net|beacon-v2/i, tool: "Help Scout", category: "support" },

  // Analytics / ABM
  { pattern: /6sense\.com|sixsense/i, tool: "6sense", category: "analytics" },
  { pattern: /demandbase\.com/i, tool: "Demandbase", category: "analytics" },
  { pattern: /zoominfo\.com|insent\.ai/i, tool: "ZoomInfo", category: "analytics" },
  { pattern: /cognism\.com/i, tool: "Cognism", category: "analytics" },
];

/**
 * Helper : extrait tous les `include:xxx` d'un SPF record.
 */
export function extractSpfIncludes(spfRecord: string): string[] {
  const matches = [...spfRecord.matchAll(/include:([^\s]+)/gi)];
  return matches.map((m) => m[1].toLowerCase());
}

/**
 * Helper : trouve le 1er CRM matchant les patterns sur un texte.
 * Renvoie null si aucun. Pour le DEBUG, on peut aussi appeler avec
 * un `tracker` pour collecter tous les matches.
 */
export function matchPatterns<T extends { pattern: RegExp; crm: CrmName }>(
  patterns: T[],
  text: string,
): { crm: CrmName; pattern: string } | null {
  for (const p of patterns) {
    if (p.pattern.test(text)) return { crm: p.crm, pattern: p.pattern.source };
  }
  return null;
}

export function matchAllPatterns<T extends { pattern: RegExp; crm: CrmName }>(
  patterns: T[],
  text: string,
): { crm: CrmName; pattern: string }[] {
  const matches: { crm: CrmName; pattern: string }[] = [];
  for (const p of patterns) {
    if (p.pattern.test(text)) matches.push({ crm: p.crm, pattern: p.pattern.source });
  }
  return matches;
}

/**
 * Helper : detecte un outil non-CRM dans un texte (DNS ou HTML).
 */
export function matchNonCrm(text: string): { tool: string; category: string }[] {
  const matches: { tool: string; category: string }[] = [];
  for (const p of NON_CRM_TOOLS) {
    if (p.pattern.test(text)) matches.push({ tool: p.tool, category: p.category });
  }
  return matches;
}
