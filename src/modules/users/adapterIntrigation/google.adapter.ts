/**
 * ============================================================
 * 🔹 GOOGLE ADS LEAD ADAPTER
 * ------------------------------------------------------------
 * ROLE:
 * - Google Ads / Landing Page se aane wale data ko
 *   ek COMMON lead format me convert karna
 * - Yahan koi DB, duplicate, tenant, owner resolve logic nahi
 * ============================================================
 */

type GoogleLeadInput = {
  // User filled form fields
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;

  // Google params (URL se aate hain)
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  landing_page?: string;
};

/**
 * ============================================================
 * ✅ normalizeGoogleLead
 * ------------------------------------------------------------
 * Input  : Raw Google Ads + Form data
 * Output : Normalized lead object (COMMON format)
 * ============================================================
 */
export const normalizeGoogleLead = (data: GoogleLeadInput) => {
  return {
    // ===============================
    // 👤 USER PROVIDED DATA
    // ===============================
    first_name: data.first_name,
    last_name: data.last_name || null,
    email: data.email || null,
    phone: data.phone || null,

    // ===============================
    // 🌍 SOURCE INFORMATION
    // ===============================
    source: "google", // fixed (source identifier)
    medium: data.utm_medium || null,
    campaign: data.utm_campaign || null,
    term: data.utm_term || null,
    content: data.utm_content || null,

    // ===============================
    // 🔑 GOOGLE IDENTIFIERS
    // ===============================
    gclid: data.gclid || null,
    landing_page: data.landing_page || null,

    // ===============================
    // 🔐 OWNER RESOLUTION KEY
    // ------------------------------------------------
    // IMPORTANT:
    // We use utm_campaign (or any agreed param)
    // to resolve OWNER in lead.service.ts
    // ===============================
    owner_key: data.utm_campaign || null,
  };
};
