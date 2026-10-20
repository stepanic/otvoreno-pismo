export interface Env {
  DB: D1Database;
  SITE_NAME: string;
  BASE_URL: string;
  ORGANIZERS: string;
  MAIL_MODE: string;
  MAIL_FROM: string;
  ORCID_BASE: string;
  CERTILIA_BASE: string;
  TURNSTILE_SITE_KEY: string;
  EXTRA_DOMAINS: string;
  HMAC_KEY: string;
  RESEND_API_KEY?: string;
  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;
  CERTILIA_CLIENT_ID?: string;
  CERTILIA_CLIENT_SECRET?: string;
  TURNSTILE_SECRET?: string;
}
