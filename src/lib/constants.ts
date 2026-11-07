export const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: "LayoutDashboard" },
  { href: "/discovery", label: "AI Lead Discovery", icon: "Search" },
  { href: "/leads", label: "Leads & Companies", icon: "Building2" },
  { href: "/research", label: "AI Research", icon: "Sparkles" },
  { href: "/products", label: "Products & Services", icon: "Package" },
  { href: "/campaigns", label: "Outreach Campaigns", icon: "Megaphone" },
  { href: "/inbox", label: "Email Inbox", icon: "Inbox" },
  { href: "/pipeline", label: "Sales Pipeline", icon: "KanbanSquare" },
  { href: "/marketing", label: "AI Marketing Studio", icon: "Bot" },
  { href: "/calendar", label: "Content Calendar", icon: "CalendarDays" },
  { href: "/proposals", label: "Proposals", icon: "FileText" },
  { href: "/analytics", label: "Analytics & Reports", icon: "BarChart3" },
  { href: "/integrations", label: "Integrations", icon: "Plug" },
  { href: "/workflows", label: "Automation Workflows", icon: "Workflow" },
  { href: "/settings", label: "Settings", icon: "Settings" },
] as const;

export const PIPELINE_STAGES = [
  { id: "new", label: "New", probability: 5 },
  { id: "discovered", label: "Discovered", probability: 10 },
  { id: "researched", label: "Researched", probability: 20 },
  { id: "qualified", label: "Qualified", probability: 35 },
  { id: "contacted", label: "Contacted", probability: 45 },
  { id: "replied", label: "Replied", probability: 55 },
  { id: "meeting_scheduled", label: "Meeting Scheduled", probability: 70 },
  { id: "proposal_sent", label: "Proposal Sent", probability: 75 },
  { id: "negotiation", label: "Negotiation", probability: 85 },
  { id: "won", label: "Won", probability: 100 },
  { id: "lost", label: "Lost", probability: 0 },
] as const;

export type LeadStage = (typeof PIPELINE_STAGES)[number]["id"];

export const OPEN_STAGES: LeadStage[] = [
  "qualified",
  "contacted",
  "replied",
  "meeting_scheduled",
  "proposal_sent",
  "negotiation",
];

export const QUALIFIED_STAGES: LeadStage[] = [
  "qualified",
  "contacted",
  "replied",
  "meeting_scheduled",
  "proposal_sent",
  "negotiation",
  "won",
];

export const COUNTRY_OPTIONS = [
  "India",
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "United Arab Emirates",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "Ireland",
  "Sweden",
];

export const OPPORTUNITY_TYPES = [
  { id: "website", label: "New website" },
  { id: "ecommerce", label: "E-commerce website" },
  { id: "saas", label: "SaaS platform" },
  { id: "android", label: "Android application" },
  { id: "ios", label: "iOS application" },
  { id: "webapp", label: "Web application" },
  { id: "ai_app", label: "AI-powered application" },
  { id: "automation", label: "Business automation" },
  { id: "crm", label: "CRM" },
  { id: "erp", label: "ERP" },
  { id: "api", label: "Custom API integrations" },
  { id: "custom_software", label: "Custom software development" },
] as const;

export const SUGGESTED_SERVICES = [
  ["Custom software development", "Design and build software around a client's operations.", "Custom development"],
  ["AI application development", "Build applications that use machine learning or language models.", "AI"],
  ["Generative AI solutions", "Apply generative AI to content, support, or internal knowledge work.", "AI"],
  ["AI agents and chatbots", "Create assistants that answer questions or complete defined workflows.", "AI"],
  ["Business process automation", "Replace repetitive manual steps with reliable workflows.", "Automation"],
  ["Website development", "Plan and build a marketing or content website.", "Web"],
  ["Web application development", "Build browser-based software for a specific business process.", "Web"],
  ["Android application development", "Build and release an Android application.", "Mobile"],
  ["iOS application development", "Build and release an iOS application.", "Mobile"],
  ["SaaS product development", "Design, build, and launch a multi-tenant software product.", "SaaS"],
  ["CRM/ERP solutions", "Implement customer or operations systems around the client's process.", "Business systems"],
  ["API integrations and system modernization", "Connect existing systems and replace fragile manual handoffs.", "Integration"],
] as const;

export const CONTENT_TYPES = [
  { id: "linkedin_post", label: "LinkedIn post" },
  { id: "instagram", label: "Instagram caption" },
  { id: "facebook", label: "Facebook content" },
  { id: "blog", label: "Blog article" },
  { id: "seo_page", label: "SEO landing page" },
  { id: "announcement", label: "Product announcement" },
  { id: "launch", label: "Product launch campaign" },
  { id: "newsletter", label: "Email newsletter" },
  { id: "ad_copy", label: "Ad copy" },
  { id: "slogan", label: "Marketing slogan" },
  { id: "idea", label: "Content idea" },
  { id: "case_study", label: "Case study" },
] as const;

export const WORKFLOW_STEP_TYPES = [
  { id: "research_company", label: "Research company", description: "Create a research profile from public fields and configured AI." },
  { id: "score_lead", label: "Generate lead score", description: "Score the lead from stored fit, contact, and engagement facts." },
  { id: "match_products", label: "Match products and services", description: "Compare the company profile with the catalog." },
  { id: "generate_outreach_draft", label: "Generate outreach draft", description: "Save an email draft. This step does not send it." },
  { id: "notify_member", label: "Notify workspace member", description: "Send an in-app notification to the lead owner." },
  { id: "wait_for_approval", label: "Wait for approval", description: "Pause until a person approves the draft." },
  { id: "send_approved_email", label: "Send approved email", description: "Send only when automated sending and compliance checks both pass." },
  { id: "monitor_response", label: "Monitor response", description: "Record whether a reply has been stored. Open tracking is not assumed." },
  { id: "update_crm_status", label: "Update CRM status", description: "Move the lead to Contacted only after an email was actually sent." },
] as const;

export const INTEGRATION_CATALOG = [
  { id: "openai", name: "OpenAI", description: "Research, outreach drafts, marketing content, and the assistant.", secret: true },
  { id: "anthropic", name: "Anthropic", description: "Optional Claude provider behind the same AI interface.", secret: true },
  { id: "gemini", name: "Gemini", description: "Optional Google Gemini provider behind the same AI interface.", secret: true },
  { id: "google_search", name: "Google Search", description: "Custom Search JSON API for public company discovery.", secret: true },
  { id: "google_maps", name: "Google Maps", description: "Places API for public business listings.", secret: true },
  { id: "hunter", name: "Hunter.io", description: "Business email discovery for a known company domain.", secret: true },
  { id: "apollo", name: "Apollo.io", description: "Company search when an authorized Apollo subscription is connected.", secret: true },
  { id: "gmail", name: "Google Gmail", description: "OAuth connection for drafts, sending, and reply sync.", secret: false },
  { id: "resend", name: "Resend", description: "Transactional and outreach email sending plus delivery webhooks.", secret: true },
  { id: "linkedin", name: "LinkedIn", description: "Approved partner APIs only. Unofficial automation is not available.", secret: false },
  { id: "stripe", name: "Stripe", description: "Reserved for a future subscription release. No charges are created.", secret: false },
] as const;

export const POSITIVE_REPLY_CATEGORIES = ["interested", "meeting_request", "pricing", "needs_info"] as const;

export const LAWFUL_BASIS_OPTIONS = [
  { id: "consent", label: "Consent recorded" },
  { id: "existing_relationship", label: "Existing business relationship" },
  { id: "legitimate_interest_reviewed", label: "Legitimate interest reviewed for this recipient" },
  { id: "other_documented", label: "Other documented lawful basis" },
] as const;
